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

function imapConfig() {
  const host = process.env.IMAP_HOST || (String(process.env.SMTP_HOST || '').includes('gmail') ? 'imap.gmail.com' : '');
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  return { host, port: Number(process.env.IMAP_PORT || 993), secure: true, auth: { user, pass } };
}

function recordExists(id) {
  return !!db.prepare('SELECT 1 FROM exigencies WHERE id = ?').get(id);
}

function saveReply({ recordId, fromEmail, subject, bodyText, receivedAt, messageId }) {
  db.prepare(`
    INSERT OR IGNORE INTO email_replies (record_id, from_email, subject, body_text, received_at, message_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(recordId, fromEmail, subject, bodyText, receivedAt, messageId || null);
}

/**
 * One poll cycle: connect, fetch anything newer than the last-seen UID,
 * match + store replies, remember the new high-water mark, disconnect.
 * Safe to call on a tight interval — a config/auth failure just logs and
 * skips this cycle rather than crashing the scheduler.
 */
async function checkForReplies() {
  const config = imapConfig();
  if (!config.host || !config.auth.user || !config.auth.pass) {
    return; // IMAP not configured — silently skip, don't spam logs every minute.
  }

  const lastUid = Number(getSetting('ImapLastUid', '0')) || 0;
  const client = new ImapFlow({ host: config.host, port: config.port, secure: config.secure, auth: config.auth, logger: false });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
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

        const parsed = await simpleParser(message.source);
        saveReply({
          recordId: tagMatch[1],
          fromEmail: (message.envelope?.from || []).map((a) => a.address).join(', '),
          subject,
          bodyText: (parsed.text || '').trim(),
          receivedAt: (message.envelope?.date || new Date()).toISOString(),
          messageId: message.envelope?.messageId || null
        });
        writeLog({ recordId: tagMatch[1], type: 'REPLY', status: 'SUCCESS', message: `Reply received from ${message.envelope?.from?.[0]?.address || 'unknown'}.` });
      }

      if (highestUid > lastUid) setSetting('ImapLastUid', String(highestUid));
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (error) {
    writeLog({ recordId: '', type: 'REPLY', status: 'FAILURE', message: 'IMAP reply check failed: ' + error.message });
    try { await client.logout(); } catch (_) { /* already disconnected */ }
  }
}

module.exports = { checkForReplies };
