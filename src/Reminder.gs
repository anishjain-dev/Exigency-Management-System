/**
 * Reminder.gs
 *
 * Daily overdue-detection engine. Run by a time-driven trigger every
 * morning (see Triggers.createTriggers()). Loops the master sheet once,
 * batches reads/writes, and dedupes so a record is reminded at most once
 * per calendar day.
 *
 * Rule (per spec):
 *   Send reminder when
 *     today >= Follow-up Date
 *     AND Next Due Date is blank
 *     AND Status != Closed
 *   Continue daily until Status = Closed OR Next Due Date is set.
 */

/**
 * Main entry point, wired to the daily time-driven trigger.
 */
function runDailyReminderJob() {
  try {
    withLock_(function () {
      processReminders_();
    });
  } catch (error) {
    logError_('runDailyReminderJob', error, true);
  }
}

/**
 * @private
 */
function processReminders_() {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  if (!master) throw new Error('Master sheet not found.');

  const config = loadConfiguration();
  const colMap = ensureMasterColumns_(master);

  const lastRow = master.getLastRow();
  if (lastRow < 2) return;

  const lastCol = master.getLastColumn();
  const range = master.getRange(2, 1, lastRow - 1, lastCol);
  const values = range.getValues();
  const schoolEmailCache = {};
  let sentCount = 0;
  let skippedCount = 0;

  values.forEach(function (row, i) {
    try {
      const status = row[colMap[DATA_COLUMNS.STATUS]];
      const followUpDate = toDateOrNull_(row[colMap[DATA_COLUMNS.FOLLOWUP_DATE]]);
      const nextDueDate = toDateOrNull_(row[colMap[DATA_COLUMNS.NEXT_DUE_DATE]]);
      const lastReminderDate = toDateOrNull_(row[colMap[SYSTEM_COLUMNS.LAST_REMINDER_DATE]]);
      const exigencyId = row[colMap[SYSTEM_COLUMNS.EXIGENCY_ID]];

      if (!exigencyId) return; // not yet synced/assigned an ID, skip
      if (status === config.closedStatus) return;
      if (nextDueDate) return; // snoozed — no reminder until it's due again (see below)
      if (!followUpDate || !isTodayOrPast_(followUpDate)) return;
      if (lastReminderDate && isSameDay_(lastReminderDate, new Date())) {
        skippedCount++;
        return; // already reminded today
      }

      const record = buildRecordFromRow_(colMap, row);
      const schoolCode = extractSchoolCode_(record[DATA_COLUMNS.SCHOOL], config);
      const recipients = resolveRecipients_(schoolCode, record[DATA_COLUMNS.OWNER], schoolEmailCache);

      const sent = sendReminderEmail(record, recipients.to, recipients.cc, REMINDER_TYPE.DAILY_FOLLOWUP);
      if (sent) {
        row[colMap[SYSTEM_COLUMNS.LAST_REMINDER_DATE]] = new Date();
        row[colMap[SYSTEM_COLUMNS.REMINDER_COUNT]] = (Number(row[colMap[SYSTEM_COLUMNS.REMINDER_COUNT]]) || 0) + 1;
        sentCount++;
      }
    } catch (rowError) {
      // A single bad row must never abort the whole batch.
      logError_('processReminders_ row ' + (i + 2), rowError, false);
    }
  });

  range.setValues(values);

  writeLog_({
    recordId: '',
    recipient: '',
    type: REMINDER_TYPE.DAILY_FOLLOWUP,
    status: LOG_STATUS.INFO,
    message: 'Daily reminder job complete. Sent: ' + sentCount + ', already-done-today skipped: ' + skippedCount + '.'
  });

  // Also re-sync in case any manual master edits happened outside onEdit
  // (e.g. bulk paste), then refresh the dashboard.
  updateSchoolSheets();
  updateDashboard();

  handleSnoozeExpiry_(config);
}

/**
 * Separately scans for records where Next Due Date has now arrived — these
 * resume reminders by clearing Next Due Date back to blank so the main loop
 * picks them up again on the next run, per: "Continue reminders every day
 * until Status becomes Closed OR Next Due Date is updated" (i.e. once the new
 * due date itself passes without being closed or pushed again, reminders
 * resume).
 * @param {Object} config
 * @private
 */
function handleSnoozeExpiry_(config) {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  const colMap = getColumnMap_(master);
  const lastRow = master.getLastRow();
  if (lastRow < 2) return;

  const range = master.getRange(2, 1, lastRow - 1, master.getLastColumn());
  const values = range.getValues();
  let mutated = false;

  values.forEach(function (row) {
    const status = row[colMap[DATA_COLUMNS.STATUS]];
    const nextDueDate = toDateOrNull_(row[colMap[DATA_COLUMNS.NEXT_DUE_DATE]]);
    if (status === config.closedStatus || !nextDueDate) return;

    if (isTodayOrPast_(nextDueDate)) {
      row[colMap[DATA_COLUMNS.NEXT_DUE_DATE]] = '';
      row[colMap[SYSTEM_COLUMNS.LAST_REMINDER_DATE]] = '';
      mutated = true;
    }
  });

  if (mutated) range.setValues(values);
}

/**
 * @param {Object} colMap
 * @param {Array<*>} row
 * @return {Object} Header-keyed record.
 * @private
 */
function buildRecordFromRow_(colMap, row) {
  const record = {};
  Object.keys(colMap).forEach(function (header) {
    record[header] = row[colMap[header]];
  });
  return record;
}

/**
 * Resolves recipients for a reminder: all active users in the school sheet's
 * Users block, plus the record's Owner (if it looks like an email address).
 * Results are cached per-school for the duration of a single job run.
 * @param {string} schoolCode
 * @param {string} owner
 * @param {Object} cache
 * @return {{to: Array<string>, cc: Array<string>}}
 * @private
 */
function resolveRecipients_(schoolCode, owner, cache) {
  if (!cache[schoolCode]) {
    cache[schoolCode] = getActiveSchoolEmails_(schoolCode);
  }
  const to = cache[schoolCode].slice();
  if (owner && /@/.test(owner) && to.indexOf(owner) === -1) {
    to.push(owner);
  }
  return { to: to, cc: [] };
}

/**
 * Reads the Users block of a school sheet and returns active emails.
 * @param {string} schoolCode
 * @return {Array<string>}
 * @private
 */
function getActiveSchoolEmails_(schoolCode) {
  const ss = getEmsSpreadsheet_();
  const sheet = ss.getSheetByName(getSchoolSheetName_(schoolCode));
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const startCol = SCHOOL_SHEET_LAYOUT.USERS_BLOCK_START_COL;
  const values = sheet.getRange(2, startCol, lastRow - 1, SCHOOL_SHEET_LAYOUT.USERS_HEADERS.length).getValues();

  return values
    .filter(function (r) { return r[0] && (r[2] === true || String(r[2]).toUpperCase() === 'TRUE' || r[2] === ''); })
    .map(function (r) { return String(r[0]).trim(); });
}

/**
 * Marks an exigency as closed: sets Status to the configured closed status
 * and stamps Closed Date, located by Exigency ID. Can be called manually
 * (e.g. from a custom menu) or by an external integration.
 * @param {string} exigencyId
 */
function closeExigency(exigencyId) {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  const colMap = getColumnMap_(master);
  const row = findMasterRowById_(master, colMap, exigencyId);
  if (row === -1) throw new Error('Exigency ID not found: ' + exigencyId);

  const config = loadConfiguration();
  master.getRange(row, colMap[DATA_COLUMNS.STATUS] + 1).setValue(config.closedStatus);
  master.getRange(row, colMap[DATA_COLUMNS.CLOSED_DATE] + 1).setValue(new Date());

  updateSchoolSheets(row);
  updateDashboard();

  writeLog_({
    recordId: exigencyId,
    recipient: '',
    type: REMINDER_TYPE.SYNC,
    status: LOG_STATUS.INFO,
    message: 'Exigency closed.'
  });
}

/**
 * Sets a new follow-up/next-due date for an exigency, which pauses daily
 * reminders until that date arrives (per spec: "Next Due Date is updated").
 * @param {string} exigencyId
 * @param {Date} nextDueDate
 */
function scheduleNextFollowup(exigencyId, nextDueDate) {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  const colMap = getColumnMap_(master);
  const row = findMasterRowById_(master, colMap, exigencyId);
  if (row === -1) throw new Error('Exigency ID not found: ' + exigencyId);

  master.getRange(row, colMap[DATA_COLUMNS.NEXT_DUE_DATE] + 1).setValue(nextDueDate);
  master.getRange(row, colMap[SYSTEM_COLUMNS.LAST_REMINDER_DATE] + 1).setValue('');

  updateSchoolSheets(row);

  writeLog_({
    recordId: exigencyId,
    recipient: '',
    type: REMINDER_TYPE.SYNC,
    status: LOG_STATUS.INFO,
    message: 'Next follow-up scheduled for ' + nextDueDate + '.'
  });
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} master
 * @param {Object} colMap
 * @param {string} exigencyId
 * @return {number} 1-based row number, or -1 if not found.
 * @private
 */
function findMasterRowById_(master, colMap, exigencyId) {
  const lastRow = master.getLastRow();
  if (lastRow < 2) return -1;
  const ids = master.getRange(2, colMap[SYSTEM_COLUMNS.EXIGENCY_ID] + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === exigencyId) return i + 2;
  }
  return -1;
}
