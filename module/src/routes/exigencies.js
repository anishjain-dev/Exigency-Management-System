/**
 * exigencies.js
 *
 * CRUD-ish API for exigency records, used by the dashboard UI.
 */

const express = require('express');
const db = require('../db');
const { writeLog } = require('../services/logService');
const { getSetting } = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  const { school, status } = req.query;
  let sql = 'SELECT * FROM exigencies WHERE 1=1';
  const params = [];
  if (school) { sql += ' AND school_code = ?'; params.push(String(school).toUpperCase()); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});

/**
 * Partial update — used by the dashboard to set Owner, Follow-up Date,
 * Status, Next Due Date, Closed Date. Setting Status to the closed status
 * auto-stamps Closed Date; setting Next Due Date clears Last Reminder Date
 * so reminders pause per the original spec.
 */
router.patch('/:id', (req, res) => {
  const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });

  const closedStatus = getSetting('ClosedStatus', 'Closed');
  const updates = {};
  const allowed = ['owner', 'followup_date', 'status', 'next_due_date', 'closed_date'];
  allowed.forEach((field) => {
    if (field in req.body) updates[field] = req.body[field];
  });

  if (updates.status === closedStatus && !updates.closed_date && !record.closed_date) {
    updates.closed_date = new Date().toISOString();
  }
  if ('next_due_date' in updates) {
    updates.last_reminder_date = null;
  }

  const fields = Object.keys(updates);
  if (fields.length === 0) return res.json(record);

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => updates[f]);
  db.prepare(`UPDATE exigencies SET ${setClause} WHERE id = ?`).run(...values, req.params.id);

  writeLog({ recordId: req.params.id, type: 'SYNC', status: 'INFO', message: 'Record updated: ' + fields.join(', ') });

  res.json(db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id));
});

router.post('/', (req, res) => {
  const { createUniqueId } = require('../services/idService');
  const { resolveSchoolCode } = require('../services/settingsService');
  const body = req.body || {};
  const schoolCode = resolveSchoolCode(body.school || '');
  const createdAt = new Date().toISOString();
  const id = createUniqueId(schoolCode, new Date());

  db.prepare(`
    INSERT INTO exigencies
      (id, school_code, school_raw, issue, owner, submitter_email, created_at,
       followup_date, status, sync_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Synced')
  `).run(id, schoolCode, body.school || '', body.issue || '', body.owner || '', body.submitterEmail || '', createdAt, body.followupDate || null, body.status || 'Open');

  writeLog({ recordId: id, type: 'SYNC', status: 'SUCCESS', message: 'Manually created via dashboard.' });
  res.status(201).json(db.prepare('SELECT * FROM exigencies WHERE id = ?').get(id));
});

module.exports = router;
