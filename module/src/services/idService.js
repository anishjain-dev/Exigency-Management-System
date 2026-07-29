/**
 * idService.js
 *
 * Generates unique Exigency IDs: EX-<CODE>-<YYYYMMDD>-<seq>, sequence scoped
 * per school+day, derived from existing IDs already in the database.
 */

const db = require('../db');

function todayStamp(date) {
  const d = date || new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function createUniqueId(schoolCode, date) {
  const code = String(schoolCode || 'GEN').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GEN';
  const dateStr = todayStamp(date);
  const prefix = `EX-${code}-${dateStr}-`;

  const rows = db.prepare('SELECT id FROM exigencies WHERE id LIKE ?').all(`${prefix}%`);
  let maxSeq = 0;
  rows.forEach((r) => {
    const seq = parseInt(r.id.substring(prefix.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  });

  const nextSeq = maxSeq + 1;
  return prefix + String(nextSeq).padStart(3, '0');
}

module.exports = { createUniqueId };
