/**
 * webhook.js
 *
 * Receives Google Form submissions forwarded by the Apps Script webhook
 * (see ../../AppsScriptWebhook.gs). This replaces onFormSubmit + the master
 * sheet entirely — this endpoint IS the new "master database" entry point.
 *
 * Expected payload fields (mapped 1:1 from the real Form questions):
 *   timestamp, submitterEmail, school, dateOfIncident, location, department,
 *   critical ("Yes"/"No"), issue, attachments, immediateActions,
 *   resolved ("Yes"/"No"), closureDate, suggestedChanges
 */

const express = require('express');
const db = require('../db');
const { createUniqueId } = require('../services/idService');
const { writeLog } = require('../services/logService');
const { resolveSchoolCode, resolveDepartment, isKnownSchool, getSetting } = require('../services/settingsService');

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
  const submitterEmail = body.submitterEmail || '';
  const schoolRaw = body.school || '';
  const issue = body.issue || '';

  if (!isAuthorizedSubmitter(submitterEmail)) {
    writeLog({ recipient: submitterEmail, type: 'SYNC', status: 'FAILURE', message: 'Unauthorized submitter: ' + submitterEmail });
    return res.status(200).json({ accepted: false, reason: 'Unauthorized submitter (not in FS Group / org domain).' });
  }

  if (!schoolRaw || !issue) {
    writeLog({ recipient: submitterEmail, type: 'SYNC', status: 'FAILURE', message: 'Row validation failed: missing School or Issue description.' });
    return res.status(200).json({ accepted: false, reason: 'Missing required fields (School Selection / Describe the Incident).' });
  }

  const schoolCode = resolveSchoolCode(schoolRaw);
  const department = resolveDepartment(body.department || 'Other');
  const createdAt = body.timestamp || new Date().toISOString();
  const id = createUniqueId(schoolCode, new Date(createdAt));
  const critical = /^y/i.test(body.critical || '') ? 1 : 0;
  const resolved = /^y/i.test(body.resolved || '') ? 'Yes' : 'No';

  db.prepare(`
    INSERT INTO exigencies
      (id, school_code, school_raw, department, critical, location, date_of_incident,
       issue, attachments, immediate_actions, resolved, closure_date, resolved_date,
       suggested_changes, submitter_email, created_at, sync_status, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, schoolCode, schoolRaw, department, critical, body.location || '', body.dateOfIncident || null,
    issue, body.attachments || '', body.immediateActions || '', resolved, body.closureDate || null,
    resolved === 'Yes' ? createdAt : null, body.suggestedChanges || '', submitterEmail, createdAt,
    isKnownSchool(schoolCode) ? 'Synced' : 'Unmapped school',
    JSON.stringify(body)
  );

  writeLog({ recordId: id, recipient: submitterEmail, type: 'SYNC', status: 'SUCCESS', message: 'New submission stored via webhook.' });

  res.json({ accepted: true, id });
});

module.exports = router;
