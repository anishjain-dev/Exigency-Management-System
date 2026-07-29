/**
 * Config.gs
 *
 * Reads all runtime configuration from the `Settings` sheet so nothing in the
 * rest of the codebase is hardcoded. Results are cached for CACHE_TTL_SECONDS
 * within CacheService to avoid re-parsing the sheet on every call inside a
 * single trigger execution (and across near-simultaneous executions).
 *
 * Settings sheet layout (key/value pairs, one per row, from row 2):
 *   A: Key                 B: Value
 *
 * Recognized keys (case-insensitive, whitespace-trimmed):
 *   ReminderTime            "08:00"                 (HH:mm, 24h)
 *   AdminEmail              "admin@example.org"
 *   DefaultCC               "cc1@example.org,cc2@example.org"
 *   SchoolCodes              "FSK,FSA,FSL"           comma list, sheet = "<code> Emails"
 *   StatusList               "Open,In Progress,Snoozed,Closed"
 *   ClosedStatus             "Closed"
 *   StatusColor:Open         "#FBBC04"
 *   StatusColor:In Progress  "#4285F4"
 *   StatusColor:Snoozed      "#A142F4"
 *   StatusColor:Closed       "#34A853"
 *   ReminderTriggerHour      "8"                      (fallback if ReminderTime absent)
 *   DashboardTriggerHour     "8"
 *   SpreadsheetUrl           full URL, used in email links (auto-detected if blank)
 *   OrgDomain                "school.org"             used for FS-group email validation
 *   FsGroupEmail             "fsgroup@school.org"     authorized submitter group
 */

/**
 * Loads configuration, using cache when available.
 * @param {boolean=} forceRefresh Bypass cache and re-read the Settings sheet.
 * @return {Object} Typed configuration object.
 */
function loadConfiguration(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(CACHE_KEYS.CONFIG);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // fall through to rebuild on parse failure
      }
    }
  }

  const config = buildConfigFromSheet_();
  try {
    cache.put(CACHE_KEYS.CONFIG, JSON.stringify(config), CACHE_TTL_SECONDS);
  } catch (e) {
    // Cache put failures (e.g. payload too large) must never break the caller.
    Logger.log('Config cache put failed: ' + e.message);
  }
  return config;
}

/**
 * Reads the raw key/value pairs from the Settings sheet and shapes them into
 * a structured config object with sane defaults for anything missing.
 * @return {Object}
 * @private
 */
function buildConfigFromSheet_() {
  const ss = getEmsSpreadsheet_();
  const sheet = ss.getSheetByName(SYSTEM_SHEETS.SETTINGS);
  const raw = {};

  if (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      values.forEach(function (row) {
        const key = String(row[0] || '').trim();
        const value = row[1];
        if (key) raw[key] = value;
      });
    }
  }

  const statusColors = {};
  Object.keys(raw).forEach(function (key) {
    if (key.indexOf('StatusColor:') === 0) {
      statusColors[key.substring('StatusColor:'.length).trim()] = String(raw[key]).trim();
    }
  });

  const schoolCodes = splitCsv_(raw.SchoolCodes || raw.SchoolCodesList || '');
  const statusList = splitCsv_(raw.StatusList || '');
  const defaultCc = splitCsv_(raw.DefaultCC || raw.DefaultCc || '');

  return {
    reminderTime: String(raw.ReminderTime || '08:00').trim(),
    reminderTriggerHour: toInt_(raw.ReminderTriggerHour, parseHour_(raw.ReminderTime, 8)),
    dashboardTriggerHour: toInt_(raw.DashboardTriggerHour, parseHour_(raw.ReminderTime, 8) + 1),
    adminEmail: String(raw.AdminEmail || '').trim(),
    defaultCc: defaultCc,
    schoolCodes: schoolCodes.length ? schoolCodes : ['FSK', 'FSA', 'FSL'],
    statusList: statusList.length ? statusList : DEFAULT_STATUS_LIST.slice(),
    closedStatus: String(raw.ClosedStatus || CLOSED_STATUS).trim(),
    statusColors: Object.keys(statusColors).length ? statusColors : {
      'Open': '#FBBC04',
      'In Progress': '#4285F4',
      'Snoozed': '#A142F4',
      'Closed': '#34A853'
    },
    spreadsheetUrl: String(raw.SpreadsheetUrl || getEmsSpreadsheet_().getUrl()).trim(),
    orgDomain: String(raw.OrgDomain || '').trim(),
    fsGroupEmail: String(raw.FsGroupEmail || '').trim()
  };
}

/**
 * Splits a comma-separated config value into a trimmed, non-empty array.
 * @param {string} value
 * @return {Array<string>}
 * @private
 */
function splitCsv_(value) {
  return String(value || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/**
 * @param {*} value
 * @param {number} fallback
 * @return {number}
 * @private
 */
function toInt_(value, fallback) {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * Extracts the hour portion out of an "HH:mm" string.
 * @param {string} timeStr
 * @param {number} fallback
 * @return {number}
 * @private
 */
function parseHour_(timeStr, fallback) {
  if (!timeStr) return fallback;
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hour = parseInt(match[1], 10);
  return isNaN(hour) ? fallback : hour;
}

/**
 * Ensures the Settings sheet exists with header rows and sensible sample
 * defaults. Safe to call repeatedly (idempotent) — never overwrites existing
 * rows, only creates the sheet/header if entirely absent.
 */
function ensureSettingsSheet_() {
  const ss = getEmsSpreadsheet_();
  let sheet = ss.getSheetByName(SYSTEM_SHEETS.SETTINGS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SYSTEM_SHEETS.SETTINGS);
  sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]).setFontWeight('bold');
  const defaults = [
    ['ReminderTime', '08:00'],
    ['AdminEmail', ''],
    ['DefaultCC', ''],
    ['SchoolCodes', 'FSK,FSA,FSL'],
    ['StatusList', DEFAULT_STATUS_LIST.join(',')],
    ['ClosedStatus', CLOSED_STATUS],
    ['StatusColor:Open', '#FBBC04'],
    ['StatusColor:In Progress', '#4285F4'],
    ['StatusColor:Snoozed', '#A142F4'],
    ['StatusColor:Closed', '#34A853'],
    ['OrgDomain', ''],
    ['FsGroupEmail', ''],
    ['SpreadsheetUrl', ss.getUrl()]
  ];
  sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
  return sheet;
}
