/**
 * replyService.js
 *
 * Polls the same Gmail inbox used for SMTP_USER (via IMAP) for replies to
 * outgoing exigency emails, matches each reply back to its exigency record
 * by the [EXG###]-style tag embedded in the email subject (see
 * emailService.js), and stores the full reply text so it shows up in the
 * dashboard. Runs on a schedule set up in server.js, not called directly.
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('../db');
const { getSetting, setSetting } = require('./settingsService');
const { writeLog } = require('./logService');

const RECORD_TAG_RE = /\[([A-Za-z0-9-]+)\]/;

/**
 * Reply bodies come back with the quoted original message (and often the
 * sender's signature) appended below a "On ... wrote:" line — strip
 * everything from that line onward so only what the person actually typed
 * is stored/shown.
 */
function stripQuotedReply(text) {
  if (!text) return text;
  const cutPatterns = [
    /\n[ \t]*On [\s\S]{0,300}?wrote:[ \t]*\n/,        // Gmail/Outlook "On ... wrote:"
    /\n[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/i, // Outlook "-----Original Message-----"
    /\n[ \t]*From:[ \t].*\n[ \t]*Sent:[ \t].*\n[ \t]*To:[ \t]/i, // Outlook header block
    /\n>[^\n]*(\n>[^\n]*)*[ \t]*$/                     // trailing block of '>' quoted lines
  ];
  let cutIndex = text.length;
  for (const re of cutPatterns) {
    const m = text.match(re);
    if (m && typeof m.index === 'number' && m.index < cutIndex) cutIndex = m.index;
  }
  return text.slice(0, cutIndex).trim();
}

function imapConfig() {
  const host = process.env.IMAP_HOST || (String(process.env.SMTP_HOST || '').includes('gmail') ? 'imap.gmail.com' : '');
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  return { host, port: Number(process.env.IMAP_PORT || 993), secure: true, auth: { user, pass } };
}

function recordExists(id) {
  return !!db.prepare('SELECT 1 FROM exigencies WHERE id = ?').get(id);
}

function saveReply({ recordId, fromName, fromEmail, subject, bodyText, receivedAt, messageId }) {
  db.prepare(`
    INSERT OR IGNORE INTO email_replies (record_id, from_name, from_email, subject, body_text, received_at, message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(recordId, fromName || null, fromEmail, subject, bodyText, receivedAt, messageId || null);
}

/**
 * Fetches + stores anything newer than the last-seen UID on an
 * already-connected, already-locked client. Shared by both the one-shot
 * poll and the persistent IDLE watcher below.
 */
async function processNewMessages(client) {
  const lastUid = Number(getSetting('ImapLastUid', '0')) || 0;
  const status = await client.status('INBOX', { uidNext: true });
  const uidNext = status.uidNext || 1;
  if (uidNext <= lastUid + 1) return; // nothing new

  let highestUid = lastUid;
  for await (const message of client.fetch(`${lastUid + 1}:*`, { uid: true, envelope: true, source: true })) {
    if (message.uid > highestUid) highestUid = message.uid;
    if (message.uid <= lastUid) continue;

    const subject = message.envelope?.subject || '';
    const tagMatch = subject.match(RECORD_TAG_RE);
    if (!tagMatch || !recordExists(tagMatch[1])) continue;
    if (!message.envelope?.inReplyTo) continue; // not actually a reply — e.g. our own outgoing notification landing in this inbox

    const parsed = await simpleParser(message.source);
    const bodyText = stripQuotedReply((parsed.text || '').trim());
    if (!bodyText) continue;

    const fromAddrs = message.envelope?.from || [];
    saveReply({
      recordId: tagMatch[1],
      fromName: fromAddrs.map((a) => a.name).filter(Boolean).join(', '),
      fromEmail: fromAddrs.map((a) => a.address).join(', '),
      subject,
      bodyText,
      receivedAt: (message.envelope?.date || new Date()).toISOString(),
      messageId: message.envelope?.messageId || null
    });
    writeLog({ recordId: tagMatch[1], type: 'REPLY', status: 'SUCCESS', message: `Reply received from ${message.envelope?.from?.[0]?.address || 'unknown'}.` });
  }

  if (highestUid > lastUid) setSetting('ImapLastUid', String(highestUid));
}

/**
 * One-shot poll cycle: connect, process anything new, disconnect. Used as a
 * periodic safety net alongside the IDLE watcher (in case IDLE silently
 * drops without throwing). A config/auth failure just logs and skips this
 * cycle rather than crashing the scheduler.
 */
async function checkForReplies() {
  const config = imapConfig();
  if (!config.host || !config.auth.user || !config.auth.pass) {
    return; // IMAP not configured — silently skip, don't spam logs every cycle.
  }

  const client = new ImapFlow({ host: config.host, port: config.port, secure: config.secure, auth: config.auth, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await processNewMessages(client);
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (error) {
    writeLog({ recordId: '', type: 'REPLY', status: 'FAILURE', message: 'IMAP reply check failed: ' + error.message });
    try { await client.logout(); } catch (_) { /* already disconnected */ }
  }
}

/**
 * Keeps one IMAP connection open using IDLE so new replies are picked up
 * within seconds instead of waiting for the next poll. Gmail drops IDLE
 * sessions after ~29 minutes and the connection can drop for other reasons
 * too — on any error/close this reconnects after a short backoff, forever.
 * Call once at startup; never awaited/returns.
 */
async function startReplyWatcher() {
  const config = imapConfig();
  if (!config.host || !config.auth.user || !config.auth.pass) {
    return; // IMAP not configured — nothing to watch.
  }

  for (;;) {
    const client = new ImapFlow({ host: config.host, port: config.port, secure: config.secure, auth: config.auth, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        await processNewMessages(client); // catch up on anything missed while disconnected
        for (;;) {
          await client.idle(); // resolves when new mail arrives, the connection times out, or ~29min elapses
          await processNewMessages(client);
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      writeLog({ recordId: '', type: 'REPLY', status: 'FAILURE', message: 'IMAP watcher connection dropped: ' + error.message + ' — reconnecting.' });
    }
    try { await client.logout(); } catch (_) { /* already disconnected */ }
    await new Promise((resolve) => setTimeout(resolve, 10_000)); // brief backoff before reconnecting
  }
}

module.exports = { checkForReplies, startReplyWatcher, stripQuotedReply };
