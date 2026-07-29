/**
 * Constants.gs
 *
 * Fixed system-level literals only: sheet names that the system itself owns
 * (Logs, Dashboard, Settings), the system column headers it appends to every
 * data sheet, and small enums that are not business configuration.
 *
 * Anything a school admin might reasonably want to change (reminder time,
 * school->sheet mapping, status list, colors, admin email) belongs in the
 * `Settings` sheet and is read via Config.gs — NOT here.
 */

const SYSTEM_SHEETS = Object.freeze({
  MASTER: 'Form Responses 3',
  LOGS: 'Logs',
  DASHBOARD: 'Dashboard',
  SETTINGS: 'Settings'
});

/**
 * System columns appended by the script to the master sheet and to every
 * school sheet's synced-records block. These are appended to the right of
 * whatever columns the Form itself defines, and are always accessed by
 * header name (see Utilities.getColumnMap_), never by fixed index.
 */
const SYSTEM_COLUMNS = Object.freeze({
  EXIGENCY_ID: 'Exigency ID',
  LAST_REMINDER_DATE: 'Last Reminder Date',
  REMINDER_COUNT: 'Reminder Count',
  SYNC_STATUS: 'Sync Status'
});

/**
 * Business columns expected to exist somewhere in the master sheet header
 * row (either as native Form questions or pre-provisioned columns). Column
 * *position* is never assumed — only these header names are looked up.
 */
const DATA_COLUMNS = Object.freeze({
  TIMESTAMP: 'Timestamp',
  SCHOOL: 'School',
  ISSUE: 'Issue',
  OWNER: 'Owner',
  SUBMITTER_EMAIL: 'Email Address',
  FOLLOWUP_DATE: 'Follow-up Date',
  STATUS: 'Status',
  NEXT_DUE_DATE: 'Next Due Date',
  CLOSED_DATE: 'Closed Date',
  // Reserved for Stage 2 (see ARCHITECTURE.md #13) — computed on demand,
  // never persisted, so no schema migration is required to light these up.
  RESPONSE_TIME_HOURS: 'Response Time (hrs)',
  RESOLUTION_TIME_HOURS: 'Resolution Time (hrs)'
});

/** Two-block layout of a per-school sheet. See ARCHITECTURE.md #5. */
const SCHOOL_SHEET_LAYOUT = Object.freeze({
  USERS_BLOCK_START_COL: 1,      // A: Email | B: Role | C: Active
  USERS_HEADERS: ['Email', 'Role', 'Active'],
  RECORDS_BLOCK_START_COL: 5     // E onward: mirrored master columns
});

const LOG_HEADERS = Object.freeze([
  'Timestamp', 'Record ID', 'Recipient', 'Reminder Type', 'Status', 'Message'
]);

const REMINDER_TYPE = Object.freeze({
  INITIAL_OVERDUE: 'OVERDUE_REMINDER',
  DAILY_FOLLOWUP: 'DAILY_FOLLOWUP',
  ESCALATION: 'ESCALATION',
  SYNC: 'SYNC',
  ERROR: 'ERROR'
});

const LOG_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  SKIPPED: 'SKIPPED',
  INFO: 'INFO'
});

/** Default status list used only if Settings sheet has not defined its own. */
const DEFAULT_STATUS_LIST = Object.freeze(['Open', 'In Progress', 'Snoozed', 'Closed']);
const CLOSED_STATUS = 'Closed';

const CACHE_KEYS = Object.freeze({
  CONFIG: 'EMS_CONFIG_CACHE_V1'
});

const CACHE_TTL_SECONDS = 360; // 6 minutes
