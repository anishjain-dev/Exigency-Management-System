/**
 * emailService.js
 *
 * Sends the reminder HTML email via SMTP (nodemailer), reusing the same
 * branding/table/status-pill design as the original Apps Script version.
 * Every send attempt is logged (success or failure).
 */

const nodemailer = require('nodemailer');
const { writeLog } = require('./logService');
const { getAllSettings } = require('./settingsService');

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function daysBetween(fromIso, toDate) {
  if (!fromIso) return 0;
  const from = new Date(fromIso);
  const to = toDate || new Date();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const f = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const t = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((t.getTime() - f.getTime()) / MS_PER_DAY);
}

function fmtDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusPillStyle(color) {
  return `display:inline-block;padding:2px 10px;border-radius:12px;background:${color};color:#ffffff;font-size:12px;font-weight:600;`;
}

/**
 * If Settings!ForceRecipientEmail is set (comma-separated, one or more
 * addresses), ALL outgoing mail (reminder AND new-submission notification)
 * is redirected to ONLY those addresses — the real department/CC recipients
 * are dropped entirely and do not receive anything.
 * @param {Array<string>} to
 * @param {Array<string>} cc
 * @return {{to: Array<string>, cc: Array<string>, overridden: boolean, originalTo: Array<string>, originalCc: Array<string>}}
 */
function applyRecipientOverride(to, cc) {
  const forceEmails = String(getAllSettings().ForceRecipientEmail || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const originalTo = to || [];
  const originalCc = cc || [];
  if (forceEmails.length === 0) {
    return { to: originalTo, cc: originalCc, overridden: false, originalTo, originalCc };
  }
  return { to: forceEmails, cc: [], overridden: true, originalTo, originalCc };
}

function buildHtmlEmail(record, appUrl) {
  const settings = getAllSettings();
  const resolvedColor = settings.ResolvedColor || '#34A853';
  const unresolvedColor = settings.UnresolvedColor || '#FBBC04';
  const criticalColor = settings.CriticalColor || '#EA4335';
  const resolved = record.resolved || 'No';
  const statusColor = resolved === 'Yes' ? resolvedColor : unresolvedColor;
  const pendingSince = daysBetween(record.created_at);

  const rows = [
    ['Exigency ID', escapeHtml(record.id)],
    ['School', escapeHtml(record.school_code)],
    ['Department', escapeHtml(record.department)],
    ['Critical', record.critical
      ? `<span style="${statusPillStyle(criticalColor)}">CRITICAL</span>`
      : 'No'],
    ['Location', escapeHtml(record.location)],
    ['Issue', escapeHtml(record.issue)],
    ['Immediate Actions Taken', escapeHtml(record.immediate_actions) || 'N/A'],
    ['Reported Date', fmtDate(record.created_at)],
    ['Pending Since', `${pendingSince} day${pendingSince === 1 ? '' : 's'}`],
    ['Expected Closure Date', fmtDate(record.closure_date)],
    ['Resolved', `<span style="${statusPillStyle(statusColor)}">${escapeHtml(resolved)}</span>`]
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;width:38%;background:#fafafa;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8eaed;color:#202124;">${value}</td>
    </tr>`).join('');

  const timestamp = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return `
<div style="margin:0;padding:0;background-color:#f1f3f4;font-family:Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f3f4;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.12);">
        <tr><td style="background:${record.critical ? criticalColor : '#1a73e8'};padding:20px 24px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">Exigency Management System</span><br/>
          <span style="color:#e8f0fe;font-size:13px;">${escapeHtml(record.school_code)} &middot; ${escapeHtml(record.department)}</span>
        </td></tr>
        <tr><td style="padding:20px 24px 4px 24px;">
          <p style="margin:0 0 12px 0;font-size:15px;color:#202124;">
            The exigency below is <strong>unresolved</strong> and requires your action.
          </p>
        </td></tr>
        <tr><td style="padding:0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
            ${tableRows}
          </table>
        </td></tr>
        <tr><td style="padding:24px;">
          <a href="${appUrl}" style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:4px;font-size:14px;font-weight:600;">
            Open Dashboard
          </a>
        </td></tr>
        <tr><td style="background:#f8f9fa;padding:14px 24px;border-top:1px solid #e8eaed;">
          <p style="margin:0;font-size:11px;color:#5f6368;">
            Automated reminder generated by the Exigency Management System &middot; ${timestamp}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

/**
 * Master kill-switch: when Settings!MailingEnabled is explicitly 'false',
 * no mail goes out to anyone at all (reminders or new-submission notices).
 * Records are still saved/updated normally — only the email send is skipped.
 * @return {boolean}
 */
function isMailingEnabled() {
  return String(getAllSettings().MailingEnabled ?? 'true').trim().toLowerCase() !== 'false';
}

async function sendReminderEmail(record, toEmails, ccEmails, reminderType, appUrl) {
  if (!isMailingEnabled()) {
    writeLog({ recordId: record.id, type: reminderType, status: 'SKIPPED', message: 'Mailing is disabled (Settings!MailingEnabled=false).' });
    return false;
  }

  const settings = getAllSettings();
  const ccFallback = (ccEmails && ccEmails.length ? ccEmails : String(settings.DefaultCC || '').split(',').map((s) => s.trim()).filter(Boolean));
  const { to: recipients, cc, overridden, originalTo } = applyRecipientOverride(toEmails, ccFallback);

  if (recipients.length === 0) {
    writeLog({ recordId: record.id, type: reminderType, status: 'SKIPPED', message: 'No recipients resolved.' });
    return false;
  }

  const overrideNote = overridden ? ` [+CC: also sent to ForceRecipientEmail list]` : '';

  try {
    const transport = getTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipients.join(','),
      cc: cc.join(','),
      subject: `[Exigency Reminder] ${record.id} - ${record.school_code} - Action Required`,
      html: buildHtmlEmail(record, appUrl)
    });
    writeLog({ recordId: record.id, recipient: recipients.join(','), type: reminderType, status: 'SUCCESS', message: 'Reminder email sent.' + overrideNote });
    return true;
  } catch (error) {
    writeLog({ recordId: record.id, recipient: recipients.join(','), type: reminderType, status: 'FAILURE', message: 'Mail send failed: ' + error.message + overrideNote });
    return false;
  }
}

/**
 * Builds the "Guide & Spark" branded field/value table for a brand-new
 * submission — Fountainhead brand colours (#005BAA blue, #B8292F red,
 * #F2C418 yellow accent) and the guideline's own 45/45/10 colour-proportion
 * chart, rendered as a bar under the header.
 * @param {Object} record
 * @return {string}
 */
function buildSubmissionTableHtml(record) {
  const fields = [
    ['Form Number', record.id],
    ['Timestamp', fmtDate(record.created_at)],
    ['Form Filled by', record.submitter_email],
    ['School Selection', record.school_raw || record.school_code],
    ['Date of the Incident', fmtDate(record.date_of_incident)],
    ['Location', record.location],
    ['Department', record.department],
    ['Is this a Critical Issue?', record.critical ? 'Yes' : 'No'],
    ['Describe the Incident', record.issue],
    ['Photos/videos/documents', record.attachments],
    ['What immediate actions were taken?', record.immediate_actions]
  ];

  const resolved = record.resolved || 'No';
  const resolvedBadge = resolved === 'Yes'
    ? `<span style="display:inline-block;padding:2px 10px;border-radius:100px;background:#227eb8;color:#ffffff;font-size:11.5px;font-weight:700;">RESOLVED</span>`
    : `<span style="display:inline-block;padding:2px 10px;border-radius:100px;background:#B8292F;color:#ffffff;font-size:11.5px;font-weight:700;">NOT RESOLVED</span>`;

  const trailingFields = [
    ['If NOT RESOLVED, please specify the closure date.', fmtDate(record.closure_date)],
    ['Any suggested Policy, Training, Infra, Services or Process change required?', record.suggested_changes]
  ];

  const rowStyle = (i) => i % 2 === 0 ? '' : 'background:#fafbfd;';
  const labelStyle = 'padding:9px 14px;font-size:13.5px;font-weight:700;width:42%;color:#005BAA;vertical-align:top;';
  const valueStyle = 'padding:9px 14px;font-size:13.5px;vertical-align:top;color:#202124;';

  const fieldRows = fields.map(([label, value], i) => `
    <tr style="${rowStyle(i)}">
      <td style="${labelStyle}">${escapeHtml(label)}</td>
      <td style="${valueStyle}">${escapeHtml(value) || 'N/A'}</td>
    </tr>`).join('');

  const resolvedRow = `
    <tr style="${rowStyle(fields.length)}">
      <td style="${labelStyle}">Has the issue been resolved?</td>
      <td style="${valueStyle}">${resolvedBadge}</td>
    </tr>`;

  const trailingRows = trailingFields.map(([label, value], i) => `
    <tr style="${rowStyle(fields.length + 1 + i)}">
      <td style="${labelStyle}">${escapeHtml(label)}</td>
      <td style="${valueStyle}">${escapeHtml(value) || 'N/A'}</td>
    </tr>`).join('');

  return `
<table cellspacing="0" cellpadding="0" width="100%" style="max-width:620px;border-collapse:collapse;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,'Segoe UI',sans-serif;">
  <tr>
    <td style="padding:20px 20px 6px;background:#ffffff;">
      <table cellspacing="0" cellpadding="0"><tr>
        <td style="width:16px;height:16px;border-radius:50%;background:#005BAA;position:relative;">&nbsp;</td>
        <td style="padding-left:8px;font-weight:800;letter-spacing:0.03em;color:#1a2230;font-size:13px;text-transform:uppercase;">Fountainhead &middot; Exigency Management</td>
      </tr></table>
      <div style="font-size:19px;font-weight:800;color:#1a2230;margin-top:10px;">${escapeHtml(record.id)}</div>
      <div style="font-size:13px;color:#5b6472;margin-top:2px;">${escapeHtml(record.school_raw || record.school_code)} &middot; ${escapeHtml(record.department)}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:12px 20px 16px;">
      <table cellspacing="0" cellpadding="0" width="100%"><tr>
        <td width="45%" style="height:6px;background:#005BAA;font-size:0;line-height:0;">&nbsp;</td>
        <td width="45%" style="height:6px;background:#B8292F;font-size:0;line-height:0;">&nbsp;</td>
        <td width="10%" style="height:6px;background:#F2C418;font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>
    </td>
  </tr>
  ${fieldRows}
  ${resolvedRow}
  ${trailingRows}
</table>`;
}

/**
 * Sends the instant "new exigency reported" notification, in the
 * MakeHTMLTable field/value layout, to the department's To/CC recipients.
 * Fired once, immediately on submission (separate from the daily reminder).
 * @param {Object} record
 * @param {Array<string>} toEmails
 * @param {Array<string>} ccEmails
 * @param {string} appUrl
 * @return {Promise<boolean>}
 */
async function sendNewSubmissionEmail(record, toEmails, ccEmails, appUrl) {
  if (!isMailingEnabled()) {
    writeLog({ recordId: record.id, type: 'NEW_SUBMISSION', status: 'SKIPPED', message: 'Mailing is disabled (Settings!MailingEnabled=false).' });
    return false;
  }

  const { to: recipients, cc, overridden, originalTo } = applyRecipientOverride(toEmails, ccEmails);

  if (recipients.length === 0) {
    writeLog({ recordId: record.id, type: 'NEW_SUBMISSION', status: 'SKIPPED', message: 'No recipients resolved for this department.' });
    return false;
  }

  const overrideNote = overridden ? ` [+CC: also sent to ForceRecipientEmail list]` : '';
  const criticalPrefix = record.critical ? '[CRITICAL] ' : '';
  const html = `
    <div style="background:#f4f6fa;padding:24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        ${buildSubmissionTableHtml(record)}
      </td></tr></table>
    </div>`;

  try {
    const transport = getTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipients.join(','),
      cc: cc.join(','),
      subject: `${criticalPrefix}Exigency - ${record.school_raw || record.school_code} - ${record.department}`,
      html
    });
    writeLog({ recordId: record.id, recipient: recipients.join(','), type: 'NEW_SUBMISSION', status: 'SUCCESS', message: 'New submission notification sent.' + overrideNote });
    return true;
  } catch (error) {
    writeLog({ recordId: record.id, recipient: recipients.join(','), type: 'NEW_SUBMISSION', status: 'FAILURE', message: 'Mail send failed: ' + error.message + overrideNote });
    return false;
  }
}

async function sendCriticalErrorEmail(context, error) {
  const settings = getAllSettings();
  const adminEmail = settings.AdminEmail;
  if (!adminEmail) return;
  try {
    const transport = getTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: adminEmail,
      subject: '[Exigency Management System] Critical Error',
      html: `<p><strong>Context:</strong> ${escapeHtml(context)}</p><p><strong>Error:</strong> ${escapeHtml(error.message || String(error))}</p>`
    });
  } catch (mailErr) {
    console.error('sendCriticalErrorEmail failed:', mailErr.message);
  }
}

module.exports = { sendReminderEmail, sendNewSubmissionEmail, sendCriticalErrorEmail, buildHtmlEmail, buildSubmissionTableHtml };
