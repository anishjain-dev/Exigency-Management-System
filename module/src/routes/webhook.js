/**
 * webhook.js
 *
 * Receives Google Form submissions forwarded by the Apps Script webhook
 * (see ../../AppsScriptWebhook.gs). This replaces onFormSubmit + the master
 * sheet entirely — this endpoint IS the new "master database" entry point.
 */

const express = require('express');
const db = require('../db');
const { createUniqueId } = require('../services/idService');
const { writeLog } = require('../services/logService');
const { resolveSchoolCode, isKnownSchool, getSetting } = require('../services/settingsService');

const router = express.Router();

function isAuthorizedSubmitter(email) {
  if (!email) return false;
  const value = String(email).trim().toLowerCase();
  const fsGroupEmail = String(getSetting('FsGroupEmail', '') || '').trim().toLowerCase();
  if (fsGroupEmail && value === fsGroupEmail) return true;

  const orgDomain = String(getSetting('OrgDomain', '') || '').trim().toLowerCase().replace(/^@/, '');
  if (orgDomain) return value.endsWith('@' + orgDomain);

  return false;
}

router.post('/form-submit', (req, res) => {
  const providedSecret = req.header('X-Webhook-Secret');
  if (!process.env.WEBHOOK_SECRET || providedSecret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing webhook secret.' });
  }

  const body = req.body || {};
  const submitterEmail = body.submitterEmail || body.email || '';
  const schoolRaw = body.school || '';
  const issue = body.issue || '';

  if (!isAuthorizedSubmitter(submitterEmail)) {
    writeLog({ recipient: submitterEmail, type: 'SYNC', status: 'FAILURE', message: 'Unauthorized submitter: ' + submitterEmail });
    return res.status(200).json({ accepted: false, reason: 'Unauthorized submitter (not in FS Group / org domain).' });
  }

  if (!schoolRaw || !issue) {
    writeLog({ recipient: submitterEmail, type: 'SYNC', status: 'FAILURE', message: 'Row validation failed: missing School or Issue.' });
    return res.status(200).json({ accepted: false, reason: 'Missing required fields (School/Issue).' });
  }

  const schoolCode = resolveSchoolCode(schoolRaw);
  const followupDate = body.followupDate || null;
  const createdAt = body.timestamp || new Date().toISOString();
  const id = createUniqueId(schoolCode, new Date(createdAt));

  db.prepare(`
    INSERT INTO exigencies
      (id, school_code, school_raw, issue, owner, submitter_email, created_at,
       followup_date, status, next_due_date, closed_date, last_reminder_date,
       reminder_count, sync_status, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id, schoolCode, schoolRaw, issue, body.owner || '', submitterEmail, createdAt,
    followupDate, body.status || 'Open', null, null, null,
    isKnownSchool(schoolCode) ? 'Synced' : 'Unmapped school',
    JSON.stringify(body)
  );

  writeLog({ recordId: id, recipient: submitterEmail, type: 'SYNC', status: 'SUCCESS', message: 'New submission stored via webhook.' });

  res.json({ accepted: true, id });
});

module.exports = router;
