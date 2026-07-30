/**
 * idService.js
 *
 * Generates unique Exigency Form Numbers: EXG<seq>, a single global sequence
 * (not scoped per school/day) zero-padded to 3 digits, e.g. EXG077.
 */

const db = require('../db');

const PREFIX = 'EXG';

function createUniqueId() {
  const rows = db.prepare('SELECT id FROM exigencies WHERE id LIKE ?').all(`${PREFIX}%`);
  let maxSeq = 0;
  rows.forEach((r) => {
    const seq = parseInt(r.id.substring(PREFIX.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  });

  const nextSeq = maxSeq + 1;
  return PREFIX + String(nextSeq).padStart(3, '0');
}

module.exports = { createUniqueId };
