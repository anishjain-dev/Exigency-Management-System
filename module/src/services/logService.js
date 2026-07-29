/**
 * logService.js
 *
 * Append-only audit trail, replacing the Google Sheets "Logs" tab.
 */

const db = require('../db');

function writeLog({ recordId = '', recipient = '', type = '', status = '', message = '' }) {
  try {
    db.prepare(`
      INSERT INTO logs (timestamp, record_id, recipient, type, status, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), recordId, recipient, type, status, message);
  } catch (e) {
    console.error('writeLog failed:', e.message);
  }
}

function getRecentLogs(limit = 200) {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { writeLog, getRecentLogs };
