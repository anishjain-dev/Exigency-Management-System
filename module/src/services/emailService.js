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

async function sendReminderEmail(record, toEmails, ccEmails, reminderType, appUrl) {
  const recipients = (toEmails || []).filter(Boolean);
  if (recipients.length === 0) {
    writeLog({ recordId: record.id, type: reminderType, status: 'SKIPPED', message: 'No recipients resolved.' });
    return false;
  }

  const settings = getAllSettings();
  const cc = (ccEmails && ccEmails.length ? ccEmails : String(settings.DefaultCC || '').split(',').map((s) => s.trim()).filter(Boolean));

  try {
    const transport = getTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipients.join(','),
      cc: cc.join(','),
      subject: `[Exigency Reminder] ${record.id} - ${record.school_code} - Action Required`,
      html: buildHtmlEmail(record, appUrl)
    });
    writeLog({ recordId: record.id, recipient: recipients.join(','), type: reminderType, status: 'SUCCESS', message: 'Reminder email sent.' });
    return true;
  } catch (error) {
    writeLog({ recordId: record.id, recipient: recipients.join(','), type: reminderType, status: 'FAILURE', message: 'Mail send failed: ' + error.message });
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

module.exports = { sendReminderEmail, sendCriticalErrorEmail, buildHtmlEmail };
