/**
 * db.js
 *
 * SQLite database setup (file-based, no separate DB server needed).
 * Replaces the Google Sheets master/school/settings/logs sheets entirely —
 * this is now the single source of truth for the whole system.
 *
 * Schema matches the REAL Exigency Reporting Form fields (from the actual
 * response export), not a generic guess:
 *   Timestamp, Email Address, School Selection, Date of the Incident,
 *   Location, Choose the Department, Is this a Critical Issue?,
 *   Describe the Incident, Upload photos/videos/documents,
 *   What immediate actions were taken?, Has the issue been resolved?,
 *   If NOT RESOLVED please specify the closure date.,
 *   Any suggested Policy/Training/Infra/Services/Process change required?
 *
 * Recipients are routed by (School, Department) — matching the original
 * "<CODE> Emails" sheets' Department -> To/CC mapping — not by a single
 * generic "Owner" field.
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'exigency.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS departments (
    name TEXT PRIMARY KEY
  );

  -- Replaces the "<CODE> Emails" sheets: one row per (school, department).
  CREATE TABLE IF NOT EXISTS department_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_code TEXT NOT NULL,
    department TEXT NOT NULL,
    to_emails TEXT DEFAULT '',
    cc_emails TEXT DEFAULT '',
    UNIQUE(school_code, department)
  );

  CREATE TABLE IF NOT EXISTS exigencies (
    id TEXT PRIMARY KEY,
    school_code TEXT NOT NULL,
    school_raw TEXT,
    department TEXT,
    critical INTEGER DEFAULT 0,
    location TEXT,
    date_of_incident TEXT,
    issue TEXT,
    attachments TEXT,
    immediate_actions TEXT,
    resolved TEXT DEFAULT 'No',
    closure_date TEXT,
    resolved_date TEXT,
    suggested_changes TEXT,
    submitter_email TEXT,
    created_at TEXT NOT NULL,
    last_reminder_date TEXT,
    reminder_count INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'Synced',
    raw_json TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    record_id TEXT,
    recipient TEXT,
    type TEXT,
    status TEXT,
    message TEXT
  );

  -- Inbound replies to notification/reminder emails, matched back to their
  -- exigency via the [EXG###] tag embedded in the outgoing email subject.
  CREATE TABLE IF NOT EXISTS email_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL,
    from_email TEXT,
    subject TEXT,
    body_text TEXT,
    received_at TEXT NOT NULL,
    message_id TEXT UNIQUE
  );
`);

/** Seeds sane defaults + real school/department/recipient data on first run only. */
function seedDefaults() {
  const defaults = {
    AdminEmail: '',
    DefaultCC: '',
    OrgDomain: 'fountainheadschools.org',
    FsGroupEmail: '',
    // TEST MODE: when set, ALL outgoing mail (reminders + new-submission
    // notifications) is redirected to only this address, regardless of the
    // real department recipients. Clear this value to resume real routing.
    ForceRecipientEmail: '',
    // Master kill-switch: set to 'false' to stop ALL outgoing mail (reminders
    // and new-submission notices) to everyone, without touching any other
    // config. Records still save/update normally either way.
    MailingEnabled: 'true',
    ResolvedValue: 'Yes',
    ReminderTriggerHour: '8',
    DashboardTriggerHour: '9',
    // Days to wait after the closure date (or submission date, if no closure
    // date) before a reminder email goes out. Set manually in the Settings tab.
    ReminderDelayDays: '0',
    CriticalColor: '#EA4335',
    ResolvedColor: '#34A853',
    UnresolvedColor: '#FBBC04',
    // Highest IMAP UID already scanned for replies — the reply watcher only
    // fetches messages newer than this on each poll.
    ImapLastUid: '0'
  };
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(defaults).forEach(([key, value]) => insertSetting.run(key, value));

  const schoolCount = db.prepare('SELECT COUNT(*) AS c FROM schools').get().c;
  if (schoolCount === 0) {
    const seedData = require('./seedDepartmentRecipients.json');
    const insertSchool = db.prepare('INSERT OR IGNORE INTO schools (code, name) VALUES (?, ?)');
    const insertDept = db.prepare('INSERT OR IGNORE INTO departments (name) VALUES (?)');
    const insertRecipient = db.prepare(`
      INSERT OR IGNORE INTO department_recipients (school_code, department, to_emails, cc_emails)
      VALUES (?, ?, ?, ?)
    `);

    Object.entries(seedData).forEach(([schoolCode, depts]) => {
      insertSchool.run(schoolCode, schoolCode);
      Object.entries(depts).forEach(([deptName, recipients]) => {
        insertDept.run(deptName);
        insertRecipient.run(schoolCode, deptName, (recipients.to || []).join(','), (recipients.cc || []).join(','));
      });
    });
  }
}

seedDefaults();

module.exports = db;
