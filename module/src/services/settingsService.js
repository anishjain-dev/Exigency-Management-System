/**
 * settingsService.js
 *
 * Everything configurable (thresholds, emails, colors, school list) lives in
 * the `settings` and `schools`/`school_users` tables — never hardcoded.
 */

const db = require('../db');

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach((r) => { map[r.key] = r.value; });
  return map;
}

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function setSettings(entries) {
  Object.entries(entries).forEach(([key, value]) => setSetting(key, value));
}

function getSchools() {
  return db.prepare('SELECT code, name FROM schools ORDER BY code').all();
}

function upsertSchool(code, name) {
  const normalizedCode = String(code).trim().toUpperCase();
  db.prepare(`
    INSERT INTO schools (code, name) VALUES (?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name
  `).run(normalizedCode, name || normalizedCode);
  return normalizedCode;
}

function getSchoolUsers(schoolCode) {
  return db.prepare('SELECT id, email, role, active FROM school_users WHERE school_code = ? ORDER BY id')
    .all(String(schoolCode).trim().toUpperCase());
}

function getActiveSchoolEmails(schoolCode) {
  return db.prepare('SELECT email FROM school_users WHERE school_code = ? AND active = 1')
    .all(String(schoolCode).trim().toUpperCase())
    .map((r) => r.email);
}

function addSchoolUser(schoolCode, email, role, active) {
  db.prepare('INSERT INTO school_users (school_code, email, role, active) VALUES (?, ?, ?, ?)')
    .run(String(schoolCode).trim().toUpperCase(), email, role || 'Coordinator', active === false ? 0 : 1);
}

function removeSchoolUser(id) {
  db.prepare('DELETE FROM school_users WHERE id = ?').run(id);
}

/**
 * Resolves a raw "School Selection" form value (which may be a full label
 * like "Fountainhead School Kukatpally") to a known school code, using the
 * school's `name` column as the mapping (case-insensitive).
 * @param {string} rawValue
 * @return {string} Resolved code, or the uppercased raw value if unmapped.
 */
function resolveSchoolCode(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  const valueUpper = value.toUpperCase();
  const valueLower = value.toLowerCase();

  const schools = getSchools();
  const byName = schools.find((s) => String(s.name).trim().toLowerCase() === valueLower);
  if (byName) return byName.code;

  const byCode = schools.find((s) => s.code === valueUpper);
  if (byCode) return byCode.code;

  const contained = schools.find((s) => valueUpper.indexOf(s.code) !== -1);
  return contained ? contained.code : valueUpper;
}

function isKnownSchool(code) {
  return !!db.prepare('SELECT 1 FROM schools WHERE code = ?').get(String(code).trim().toUpperCase());
}

module.exports = {
  getAllSettings,
  getSetting,
  setSetting,
  setSettings,
  getSchools,
  upsertSchool,
  getSchoolUsers,
  getActiveSchoolEmails,
  addSchoolUser,
  removeSchoolUser,
  resolveSchoolCode,
  isKnownSchool
};
