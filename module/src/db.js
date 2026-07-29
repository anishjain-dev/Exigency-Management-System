/**
 * db.js
 *
 * SQLite database setup (file-based, no separate DB server needed).
 * Replaces the Google Sheets master/school/settings/logs sheets entirely —
 * this is now the single source of truth for the whole system.
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

  CREATE TABLE IF NOT EXISTS school_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_code TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'Coordinator',
    active INTEGER DEFAULT 1,
    FOREIGN KEY (school_code) REFERENCES schools(code)
  );

  CREATE TABLE IF NOT EXISTS exigencies (
    id TEXT PRIMARY KEY,
    school_code TEXT NOT NULL,
    school_raw TEXT,
    issue TEXT,
    owner TEXT,
    submitter_email TEXT,
    created_at TEXT NOT NULL,
    followup_date TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    next_due_date TEXT,
    closed_date TEXT,
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
`);

/** Seeds sane defaults on first run only (never overwrites existing rows). */
function seedDefaults() {
  const defaults = {
    AdminEmail: '',
    DefaultCC: '',
    OrgDomain: '',
    FsGroupEmail: '',
    StatusList: 'Open,In Progress,Snoozed,Closed',
    ClosedStatus: 'Closed',
    ReminderTriggerHour: '8',
    DashboardTriggerHour: '9',
    'StatusColor:Open': '#FBBC04',
    'StatusColor:In Progress': '#4285F4',
    'StatusColor:Snoozed': '#A142F4',
    'StatusColor:Closed': '#34A853'
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(defaults).forEach(([key, value]) => insert.run(key, value));

  const schoolCount = db.prepare('SELECT COUNT(*) AS c FROM schools').get().c;
  if (schoolCount === 0) {
    const insertSchool = db.prepare('INSERT INTO schools (code, name) VALUES (?, ?)');
    insertSchool.run('FSK', 'FSK');
    insertSchool.run('FSA', 'FSA');
    insertSchool.run('FSL', 'FSL');
  }
}

seedDefaults();

module.exports = db;
