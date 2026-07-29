/**
 * Utilities.gs
 *
 * Generic, reusable helpers shared across the codebase. Nothing in this file
 * should know about business rules (that's Validation.gs/Reminder.gs) — only
 * mechanical spreadsheet, date, string and logging plumbing.
 */

/**
 * Returns (and memoizes for the duration of this execution) the bound
 * response spreadsheet. Using getActiveSpreadsheet() would fail from
 * time-driven triggers with no active context, so we always resolve
 * explicitly by ID once and reuse it.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getEmsSpreadsheet_() {
  if (!getEmsSpreadsheet_.cached_) {
    // Container-bound script: SpreadsheetApp.getActive() works both in
    // simple-trigger and installable-trigger contexts for a bound project.
    getEmsSpreadsheet_.cached_ = SpreadsheetApp.getActive();
  }
  return getEmsSpreadsheet_.cached_;
}

/**
 * Builds a { headerName: zeroBasedColumnIndex } map from a sheet's first row.
 * All row access elsewhere in the codebase should go through this map rather
 * than assuming fixed column positions, so new Form questions never shift
 * system columns.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object<string, number>}
 */
function getColumnMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach(function (header, idx) {
    const key = String(header || '').trim();
    if (key) map[key] = idx;
  });
  return map;
}

/**
 * Ensures every header in `requiredHeaders` exists on the sheet, appending
 * any missing ones to the right. Returns the refreshed column map.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<string>} requiredHeaders
 * @return {Object<string, number>}
 */
function ensureColumns_(sheet, requiredHeaders) {
  let map = getColumnMap_(sheet);
  const missing = requiredHeaders.filter(function (h) { return !(h in map); });
  if (missing.length > 0) {
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]).setFontWeight('bold');
    map = getColumnMap_(sheet);
  }
  return map;
}

/**
 * Generates a unique Exigency ID of the form EX-<SCHOOLCODE>-<YYYYMMDD>-<seq>.
 * Sequence is scoped to school+day and derived by scanning already-assigned
 * IDs in the master sheet, so it is stable even if called from concurrent
 * executions (LockService should still wrap the caller — see FormSubmit.gs).
 * @param {string} schoolCode
 * @param {Date} date
 * @param {Array<string>} existingIds IDs already present in the master sheet.
 * @return {string}
 */
function createUniqueID(schoolCode, date, existingIds) {
  const code = (schoolCode || 'GEN').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GEN';
  const dateStr = Utilities.formatDate(date || new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyyMMdd');
  const prefix = 'EX-' + code + '-' + dateStr + '-';

  let maxSeq = 0;
  (existingIds || []).forEach(function (id) {
    if (typeof id === 'string' && id.indexOf(prefix) === 0) {
      const seq = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });

  const nextSeq = maxSeq + 1;
  return prefix + ('000' + nextSeq).slice(-3);
}

/**
 * Normalizes a cell value that may be a Date object, a date-like string, or
 * blank, returning a Date or null.
 * @param {*} value
 * @return {?Date}
 */
function toDateOrNull_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns true if `date` is today or earlier, comparing calendar days only
 * (ignores time-of-day) in the script's timezone.
 * @param {Date} date
 * @return {boolean}
 */
function isTodayOrPast_(date) {
  if (!date) return false;
  const tz = Session.getScriptTimeZone() || 'Etc/UTC';
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const target = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  return target <= today;
}

/**
 * Returns true if two dates fall on the same calendar day (script timezone).
 * @param {?Date} a
 * @param {?Date} b
 * @return {boolean}
 */
function isSameDay_(a, b) {
  if (!a || !b) return false;
  const tz = Session.getScriptTimeZone() || 'Etc/UTC';
  return Utilities.formatDate(a, tz, 'yyyy-MM-dd') === Utilities.formatDate(b, tz, 'yyyy-MM-dd');
}

/**
 * Whole days between `from` and `to` (to - from), truncated, ignoring time.
 * @param {Date} from
 * @param {Date} to
 * @return {number}
 */
function daysBetween_(from, to) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const tz = Session.getScriptTimeZone() || 'Etc/UTC';
  const f = new Date(Utilities.formatDate(from, tz, 'yyyy-MM-dd'));
  const t = new Date(Utilities.formatDate(to, tz, 'yyyy-MM-dd'));
  return Math.round((t.getTime() - f.getTime()) / MS_PER_DAY);
}

/**
 * Appends a structured row to the Logs sheet. Creates the sheet/header if
 * absent. Never throws — logging must not be able to crash the caller.
 * @param {{recordId:string, recipient:string, type:string, status:string, message:string}} entry
 */
function writeLog_(entry) {
  try {
    const ss = getEmsSpreadsheet_();
    let sheet = ss.getSheetByName(SYSTEM_SHEETS.LOGS);
    if (!sheet) {
      sheet = ss.insertSheet(SYSTEM_SHEETS.LOGS);
      sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date(),
      entry.recordId || '',
      entry.recipient || '',
      entry.type || '',
      entry.status || '',
      entry.message || ''
    ]);
  } catch (e) {
    Logger.log('writeLog_ failed: ' + e.message);
  }
}

/**
 * Central error logger. Writes to Logs and, for critical errors, emails the
 * configured admin. Never re-throws.
 * @param {string} context Human-readable name of the failing operation.
 * @param {Error} error
 * @param {boolean=} critical
 */
function logError_(context, error, critical) {
  const message = context + ': ' + (error && error.message ? error.message : String(error));
  Logger.log(message + (error && error.stack ? '\n' + error.stack : ''));
  writeLog_({
    recordId: '',
    recipient: '',
    type: REMINDER_TYPE.ERROR,
    status: LOG_STATUS.FAILURE,
    message: message
  });

  if (critical) {
    try {
      const config = loadConfiguration();
      if (config.adminEmail) {
        MailApp.sendEmail({
          to: config.adminEmail,
          subject: '[Exigency Management System] Critical Error',
          htmlBody: '<p><strong>Context:</strong> ' + escapeHtml_(context) + '</p>' +
            '<p><strong>Error:</strong> ' + escapeHtml_(message) + '</p>' +
            '<p>Spreadsheet: <a href="' + config.spreadsheetUrl + '">' + config.spreadsheetUrl + '</a></p>'
        });
      }
    } catch (mailErr) {
      Logger.log('logError_ admin mail failed: ' + mailErr.message);
    }
  }
}

/**
 * Minimal HTML-escaping for values interpolated into email templates.
 * @param {*} value
 * @return {string}
 */
function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converts a sheet's data rows (excluding header) into an array of plain
 * objects keyed by header name, alongside their 1-based sheet row number.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Array<{row:number, data:Object}>}
 */
function readRowsAsObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return values.map(function (rowValues, i) {
    const data = {};
    headers.forEach(function (header, colIdx) {
      const key = String(header || '').trim();
      if (key) data[key] = rowValues[colIdx];
    });
    return { row: i + 2, data: data };
  });
}

/**
 * Safely retrieves a named script lock, runs `fn` while holding it, then
 * releases it. Prevents concurrent form submissions from racing on ID
 * generation / sheet appends.
 * @param {function():*} fn
 * @param {number=} timeoutMs
 * @return {*} Whatever fn() returns.
 */
function withLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(timeoutMs || 30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
