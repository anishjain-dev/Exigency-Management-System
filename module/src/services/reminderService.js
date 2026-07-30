/**
 * reminderService.js
 *
 * Daily overdue-detection engine, adapted to the real form's fields:
 *   Send reminder when Resolved != "Yes" AND
 *     (Closure Date is blank OR today >= Closure Date).
 *   Continue daily until Resolved becomes "Yes" or Closure Date is pushed
 *   to a future date. Dedupes so a record is only reminded once per day.
 *   Recipients are resolved by (School, Department) via
 *   settingsService.getDepartmentRecipients — the same routing the original
 *   "<CODE> Emails" sheets used.
 */

const db = require('../db');
const { getDepartmentRecipients } = require('./settingsService');
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function runDailyReminderJob(appUrl) {
  const today = todayStr();

  const candidates = db.prepare(`SELECT * FROM exigencies WHERE resolved != 'Yes'`).all();

  let sent = 0;
  let skipped = 0;

  for (const record of candidates) {
    try {
      const closureDate = dateOnly(record.closure_date);
      if (closureDate && closureDate > today) continue; // future closure date = snoozed, don't remind yet

      const lastReminder = dateOnly(record.last_reminder_date);
      if (lastReminder && lastReminder === today) {
        skipped++;
        continue;
      }

      const recipients = getDepartmentRecipients(record.school_code, record.department);
      const to = recipients.to.filter(isValidEmail);
      const cc = recipients.cc.filter(isValidEmail);

      const wasSent = await sendReminderEmail(record, to, cc, 'DAILY_FOLLOWUP', appUrl);
      if (wasSent) {
        db.prepare('UPDATE exigencies SET last_reminder_date = ?, reminder_count = reminder_count + 1 WHERE id = ?')
          .run(new Date().toISOString(), record.id);
        sent++;
      }
    } catch (rowError) {
      writeLog({ recordId: record.id, type: 'ERROR', status: 'FAILURE', message: 'Row processing failed: ' + rowError.message });
    }
  }

  writeLog({ type: 'DAILY_FOLLOWUP', status: 'INFO', message: `Daily reminder job complete. Sent: ${sent}, skipped (already done today): ${skipped}.` });
  return { sent, skipped };
}

module.exports = { runDailyReminderJob };
