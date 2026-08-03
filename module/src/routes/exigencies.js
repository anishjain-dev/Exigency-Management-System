/**
 * exigencies.js
 *
 * CRUD-ish API for exigency records, used by the dashboard UI.
 */

const express = require('express');
const db = require('../db');
const { writeLog } = require('../services/logService');
const { createUniqueId } = require('../services/idService');
const { resolveSchoolCode, resolveDepartment, getDepartmentRecipients } = require('../services/settingsService');
const { sendStatusUpdateEmail, sendReminderEmail } = require('../services/emailService');

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

const router = express.Router();

router.get('/', (req, res) => {
  const { school, department, resolved, critical } = req.query;
  let sql = `
    SELECT e.*,
      (SELECT COUNT(*) FROM email_replies r WHERE r.record_id = e.id) AS reply_count,
      (SELECT body_text FROM email_replies r WHERE r.record_id = e.id ORDER BY received_at DESC LIMIT 1) AS last_reply_text,
      (SELECT MAX(received_at) FROM email_replies r WHERE r.record_id = e.id) AS last_reply_at
    FROM exigencies e WHERE 1=1`;
  const params = [];
  if (school) { sql += ' AND school_code = ?'; params.push(school); }
  if (department) { sql += ' AND department = ?'; params.push(department); }
  if (resolved) { sql += ' AND resolved = ?'; params.push(resolved); }
  if (critical) { sql += ' AND critical = ?'; params.push(critical === 'true' || critical === '1' ? 1 : 0); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});

router.get('/:id/replies', (req, res) => {
  const replies = db.prepare('SELECT * FROM email_replies WHERE record_id = ? ORDER BY received_at ASC').all(req.params.id);
  res.json(replies);
});

/**
 * Partial update — used by the dashboard to set immediate_actions, resolved,
 * closure_date, suggested_changes. Setting resolved to "Yes" auto-stamps
 * resolved_date; changing closure_date clears last_reminder_date so
 * reminders re-evaluate against the new date on the next run.
 */
router.patch('/:id', (req, res) => {
  const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  const allowed = ['department', 'critical', 'location', 'immediate_actions', 'resolved', 'closure_date', 'suggested_changes'];
  allowed.forEach((field) => {
    if (field in req.body) updates[field] = req.body[field];
  });

  if (updates.resolved === 'Yes' && !record.resolved_date) {
    updates.resolved_date = new Date().toISOString();
  }
  if (updates.resolved === 'No') {
    updates.resolved_date = null;
  }
  if ('closure_date' in updates) {
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

/**
 * Sends a resolution-update email to the same people who received the
 * original notification for this record (department recipients + the
 * submitter), reflecting whatever the record's current `resolved` state
 * is. Triggered on-demand from the dashboard, not automatically on PATCH —
 * the user confirms first via a popup.
 */
router.post('/:id/notify-status', async (req, res) => {
  const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });

  const recipients = getDepartmentRecipients(record.school_code, record.department);
  const to = recipients.to.filter(isValidEmail);
  const cc = [...recipients.cc, record.submitter_email].filter(isValidEmail);

  const appUrl = `${req.protocol}://${req.get('host')}`;
  const sent = await sendStatusUpdateEmail(record, to, cc, appUrl);

  res.json({ sent });
});

/**
 * Sends this one record's reminder email right now, to its real department
 * recipients (same routing/override rules as the daily job), and stamps
 * last_reminder_date/reminder_count exactly like runDailyReminderJob would —
 * so the daily cron doesn't double-send it later today.
 */
router.post('/:id/remind-now', async (req, res) => {
  const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });

  const recipients = getDepartmentRecipients(record.school_code, record.department);
  const to = recipients.to.filter(isValidEmail);
  const cc = recipients.cc.filter(isValidEmail);

  const appUrl = `${req.protocol}://${req.get('host')}`;
  const sent = await sendReminderEmail(record, to, cc, 'MANUAL_REMINDER', appUrl);

  if (sent) {
    db.prepare('UPDATE exigencies SET last_reminder_date = ?, reminder_count = reminder_count + 1 WHERE id = ?')
      .run(new Date().toISOString(), req.params.id);
  }

  res.json({ sent });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const schoolCode = resolveSchoolCode(body.school || '');
  const department = resolveDepartment(body.department || 'Other');
  const createdAt = new Date().toISOString();
  const id = createUniqueId(schoolCode, new Date());

  db.prepare(`
    INSERT INTO exigencies
      (id, school_code, school_raw, department, critical, location, date_of_incident,
       issue, immediate_actions, resolved, submitter_email, created_at, sync_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'No', ?, ?, 'Synced')
  `).run(
    id, schoolCode, body.school || '', department, body.critical ? 1 : 0, body.location || '',
    body.dateOfIncident || null, body.issue || '', body.immediateActions || '', body.submitterEmail || '', createdAt
  );

  writeLog({ recordId: id, type: 'SYNC', status: 'SUCCESS', message: 'Manually created via dashboard.' });
  res.status(201).json(db.prepare('SELECT * FROM exigencies WHERE id = ?').get(id));
});

module.exports = router;
