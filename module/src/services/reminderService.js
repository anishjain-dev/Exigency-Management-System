/**
 * reminderService.js
 *
 * Daily overdue-detection engine, adapted to the real form's fields:
 *   Send reminder when Resolved != "Yes" AND
 *     ReminderDelayDays have passed since the exigency was reported AND
 *     (Closure Date is blank OR today >= Closure Date — a future closure
 *      date snoozes reminders until that date, even past the delay window).
 *   Continue daily until Resolved becomes "Yes" or Closure Date is pushed
 *   to a future date. Dedupes so a record is only reminded once per day.
 *   Recipients are resolved by (School, Department) via
 *   settingsService.getDepartmentRecipients — the same routing the original
 *   "<CODE> Emails" sheets used. Settings!ReminderMessage, if set, is a
 *   fixed note included in every one of these automatic reminder emails.
 */

const db = require('../db');
const { getDepartmentRecipients, getSetting } = require('./settingsService');
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

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function runDailyReminderJob(appUrl) {
  const today = todayStr();
  const delayDays = parseInt(getSetting('ReminderDelayDays', '0'), 10) || 0;
  const commonMessage = String(getSetting('ReminderMessage', '') || '').trim();

  const candidates = db.prepare(`SELECT * FROM exigencies WHERE resolved != 'Yes'`).all();

  let sent = 0;
  let skipped = 0;

  for (const record of candidates) {
    try {
      const closureDate = dateOnly(record.closure_date);
      if (closureDate && closureDate > today) continue; // future closure date = snoozed, don't remind yet

      // Wait ReminderDelayDays after the exigency was reported before the
      // first reminder goes out (e.g. 4 days), regardless of whether a
      // closure date was also given.
      const baseDate = dateOnly(record.created_at) || today;
      if (delayDays > 0 && addDays(baseDate, delayDays) > today) continue;

      const lastReminder = dateOnly(record.last_reminder_date);
      if (lastReminder && lastReminder === today) {
        skipped++;
        continue;
      }

      const recipients = getDepartmentRecipients(record.school_code, record.department);
      const to = recipients.to.filter(isValidEmail);
      const cc = recipients.cc.filter(isValidEmail);

      const wasSent = await sendReminderEmail(record, to, cc, 'DAILY_FOLLOWUP', appUrl, commonMessage);
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
