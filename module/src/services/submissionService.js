/**
 * submissionService.js
 *
 * Single entry point for turning a raw exigency submission (regardless of
 * where it came from — the built-in form, or the legacy Google Form
 * webhook) into a stored record + instant notification email. Shared so
 * both intake paths apply the exact same validation/authorization/mail
 * behavior instead of drifting apart.
 *
 * Expected payload fields (mapped 1:1 from the original Form questions):
 *   timestamp, submitterEmail, school, dateOfIncident, location, department,
 *   critical ("Yes"/"No"), issue, attachments, immediateActions,
 *   resolved ("Yes"/"No"), closureDate, suggestedChanges
 */

const db = require('../db');
const { createUniqueId } = require('./idService');
const { writeLog } = require('./logService');
const { resolveSchoolCode, resolveDepartment, isKnownSchool, getDepartmentRecipients } = require('./settingsService');
const { sendNewSubmissionEmail } = require('./emailService');

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/**
 * @param {Object} body - raw submission payload
 * @param {string} appUrl - e.g. `${req.protocol}://${req.get('host')}`
 * @return {Promise<{accepted: boolean, reason?: string, id?: string}>}
 */
async function processSubmission(body, appUrl) {
  const submitterEmail = body.submitterEmail || '';
  const schoolRaw = body.school || '';
  const issue = body.issue || '';

  if (!schoolRaw || !issue) {
    writeLog({ recipient: submitterEmail, type: 'SYNC', status: 'FAILURE', message: 'Row validation failed: missing School or Issue description.' });
    return { accepted: false, reason: 'Missing required fields (School Selection / Describe the Incident).' };
  }

  const schoolCode = resolveSchoolCode(schoolRaw);
  const department = resolveDepartment(body.department || 'Other');
  const createdAt = body.timestamp || new Date().toISOString();
  const id = createUniqueId();
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

  writeLog({ recordId: id, recipient: submitterEmail, type: 'SYNC', status: 'SUCCESS', message: 'New submission stored.' });

  // Notify the department's recipients immediately. Failure to send must
  // never fail the caller's response — the record is already saved.
  try {
    const record = db.prepare('SELECT * FROM exigencies WHERE id = ?').get(id);
    const recipients = getDepartmentRecipients(schoolCode, department);
    const to = Array.from(new Set([...recipients.to, submitterEmail])).filter(isValidEmail);
    const cc = recipients.cc.filter(isValidEmail);
    await sendNewSubmissionEmail(record, to, cc, appUrl);
  } catch (mailError) {
    writeLog({ recordId: id, type: 'NEW_SUBMISSION', status: 'FAILURE', message: 'Notification send threw: ' + mailError.message });
  }

  return { accepted: true, id };
}

module.exports = { processSubmission };
