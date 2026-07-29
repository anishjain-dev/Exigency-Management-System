/**
 * reminderService.js
 *
 * Daily overdue-detection engine — the same rule as the original system:
 *   Send reminder when today >= Follow-up Date AND Next Due Date is blank
 *   AND Status != Closed. Continue daily until Closed or Next Due Date set.
 * Dedupes so a record is only reminded once per calendar day.
 */

const db = require('../db');
const { getSetting, getActiveSchoolEmails } = require('./settingsService');
const { sendReminderEmail } = require('./emailService');
const { writeLog } = require('./logService');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function runDailyReminderJob(appUrl) {
  const closedStatus = getSetting('ClosedStatus', 'Closed');
  const today = todayStr();

  const candidates = db.prepare(`
    SELECT * FROM exigencies
    WHERE status != ?
      AND (next_due_date IS NULL OR next_due_date = '')
      AND followup_date IS NOT NULL AND followup_date != ''
  `).all(closedStatus);

  let sent = 0;
  let skipped = 0;

  for (const record of candidates) {
    try {
      const followUp = dateOnly(record.followup_date);
      if (!followUp || followUp > today) continue;

      const lastReminder = dateOnly(record.last_reminder_date);
      if (lastReminder && lastReminder === today) {
        skipped++;
        continue;
      }

      const recipients = getActiveSchoolEmails(record.school_code);
      const to = recipients.slice();
      if (record.owner && /@/.test(record.owner) && !to.includes(record.owner)) to.push(record.owner);

      const wasSent = await sendReminderEmail(record, to, [], 'DAILY_FOLLOWUP', appUrl);
      if (wasSent) {
        db.prepare('UPDATE exigencies SET last_reminder_date = ?, reminder_count = reminder_count + 1 WHERE id = ?')
          .run(new Date().toISOString(), record.id);
        sent++;
      }
    } catch (rowError) {
      writeLog({ recordId: record.id, type: 'ERROR', status: 'FAILURE', message: 'Row processing failed: ' + rowError.message });
    }
  }

  // Resume reminders once a snoozed Next Due Date arrives.
  const snoozed = db.prepare(`
    SELECT * FROM exigencies
    WHERE status != ? AND next_due_date IS NOT NULL AND next_due_date != ''
  `).all(closedStatus);

  snoozed.forEach((record) => {
    const nextDue = dateOnly(record.next_due_date);
    if (nextDue && nextDue <= today) {
      db.prepare('UPDATE exigencies SET next_due_date = NULL, last_reminder_date = NULL WHERE id = ?').run(record.id);
    }
  });

  writeLog({ type: 'DAILY_FOLLOWUP', status: 'INFO', message: `Daily reminder job complete. Sent: ${sent}, skipped (already done today): ${skipped}.` });
  return { sent, skipped };
}

module.exports = { runDailyReminderJob };
