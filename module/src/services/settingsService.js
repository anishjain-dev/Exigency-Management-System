/**
 * settingsService.js
 *
 * Everything configurable (thresholds, emails, colors, school/department
 * list, recipients) lives in the `settings`/`schools`/`departments`/
 * `department_recipients` tables — never hardcoded.
 *
 * Note: real school codes are NOT all uppercase (e.g. "FP VESU", "FP Adajan"),
 * so codes are matched case-insensitively but stored/returned with their
 * original casing — never force-uppercased.
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
  return db.prepare('SELECT code, name FROM schools ORDER BY rowid DESC').all();
}

function upsertSchool(code, name) {
  const normalizedCode = String(code).trim();
  db.prepare(`
    INSERT INTO schools (code, name) VALUES (?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name
  `).run(normalizedCode, name || normalizedCode);
  return normalizedCode;
}

function getDepartments() {
  return db.prepare('SELECT name FROM departments ORDER BY rowid DESC').all().map((r) => r.name);
}

function upsertDepartment(name) {
  db.prepare('INSERT OR IGNORE INTO departments (name) VALUES (?)').run(String(name).trim());
}

function countExigenciesForSchool(code) {
  return db.prepare('SELECT COUNT(*) c FROM exigencies WHERE school_code = ?').get(code).c;
}

function countExigenciesForDepartment(name) {
  return db.prepare('SELECT COUNT(*) c FROM exigencies WHERE department = ?').get(name).c;
}

function deleteSchool(code) {
  db.prepare('DELETE FROM department_recipients WHERE school_code = ?').run(code);
  db.prepare('DELETE FROM schools WHERE code = ?').run(code);
}

function deleteDepartment(name) {
  db.prepare('DELETE FROM department_recipients WHERE department = ?').run(name);
  db.prepare('DELETE FROM departments WHERE name = ?').run(name);
}

function renameDepartment(oldName, newName) {
  const trimmedNew = String(newName).trim();
  db.prepare('UPDATE OR IGNORE departments SET name = ? WHERE name = ?').run(trimmedNew, oldName);
  db.prepare('DELETE FROM departments WHERE name = ?').run(oldName);
  db.prepare('UPDATE OR IGNORE department_recipients SET department = ? WHERE department = ?').run(trimmedNew, oldName);
  db.prepare('DELETE FROM department_recipients WHERE department = ?').run(oldName);
  return trimmedNew;
}

/** Returns the exact school code as stored, matching case-insensitively. */
function findSchoolCode(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  const schools = getSchools();
  const byCode = schools.find((s) => s.code.toLowerCase() === value.toLowerCase());
  if (byCode) return byCode.code;
  const byName = schools.find((s) => s.name.toLowerCase() === value.toLowerCase());
  if (byName) return byName.code;
  const contained = schools.find((s) => value.toLowerCase().indexOf(s.code.toLowerCase()) !== -1);
  return contained ? contained.code : null;
}

/**
 * Resolves a raw "School Selection" form value to a known school code.
 * @param {string} rawValue
 * @return {string} Resolved code, or the raw value trimmed if unmapped.
 */
function resolveSchoolCode(rawValue) {
  const found = findSchoolCode(rawValue);
  return found || String(rawValue || '').trim();
}

function isKnownSchool(code) {
  return !!findSchoolCode(code);
}

/** Returns the exact department name as stored, matching case-insensitively. */
function resolveDepartment(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  const departments = getDepartments();
  const match = departments.find((d) => d.toLowerCase() === value.toLowerCase());
  return match || value;
}

/**
 * Returns { to: [...], cc: [...] } for a given school+department, replacing
 * the original "<CODE> Emails" sheet lookup. Falls back to empty arrays if
 * no mapping row exists yet for that combination.
 */
function getDepartmentRecipients(schoolCode, department) {
  const code = findSchoolCode(schoolCode) || schoolCode;
  const dept = resolveDepartment(department);
  const row = db.prepare('SELECT to_emails, cc_emails FROM department_recipients WHERE school_code = ? AND department = ?')
    .get(code, dept);
  if (!row) return { to: [], cc: [] };
  return {
    to: String(row.to_emails || '').split(',').map((s) => s.trim()).filter(Boolean),
    cc: String(row.cc_emails || '').split(',').map((s) => s.trim()).filter(Boolean)
  };
}

/** Returns every (school, department) recipient row, grouped by school. */
function getAllDepartmentRecipients() {
  const rows = db.prepare('SELECT id, school_code, department, to_emails, cc_emails FROM department_recipients ORDER BY school_code, department').all();
  const bySchool = {};
  rows.forEach((r) => {
    if (!bySchool[r.school_code]) bySchool[r.school_code] = [];
    bySchool[r.school_code].push(r);
  });
  return bySchool;
}

function upsertDepartmentRecipients(schoolCode, department, toEmails, ccEmails) {
  const code = findSchoolCode(schoolCode) || String(schoolCode).trim();
  const dept = department.trim();
  upsertDepartment(dept);
  db.prepare(`
    INSERT INTO department_recipients (school_code, department, to_emails, cc_emails)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(school_code, department) DO UPDATE SET to_emails = excluded.to_emails, cc_emails = excluded.cc_emails
  `).run(code, dept, toEmails || '', ccEmails || '');
}

module.exports = {
  getAllSettings,
  getSetting,
  setSetting,
  setSettings,
  getSchools,
  upsertSchool,
  getDepartments,
  upsertDepartment,
  resolveSchoolCode,
  resolveDepartment,
  isKnownSchool,
  getDepartmentRecipients,
  getAllDepartmentRecipients,
  countExigenciesForSchool,
  countExigenciesForDepartment,
  deleteSchool,
  deleteDepartment,
  renameDepartment,
  upsertDepartmentRecipients
};
