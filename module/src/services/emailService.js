/**
 * emailService.js
 *
 * Sends the reminder HTML email via SMTP (nodemailer), reusing the same
 * branding/table/status-pill design as the original Apps Script version.
 * Every send attempt is logged (success or failure).
 */

const path = require('path');
const nodemailer = require('nodemailer');
const { writeLog } = require('./logService');
const { getAllSettings } = require('./settingsService');

const LOGO_PATH = path.join(__dirname, '..', '..', 'public', 'images', 'fountainhead-logo.png');
const LOGO_CID = 'fountainhead-logo';
const LOGO_ATTACHMENT = { filename: 'fountainhead-logo.png', path: LOGO_PATH, cid: LOGO_CID };

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

/**
 * Fountainhead brand system (Brand Guidelines 2025): primary blue #005BAA,
 * red #B8292F, yellow accent #F2C418, used at a 45/45/10 ratio. Montserrat
 * for headline/wordmark text, Nunito for body — both declared with safe
 * fallback stacks since most email clients ignore @font-face/webfonts.
 */
const BRAND = {
  blue: '#005BAA',
  blueDeep: '#003c73',
  red: '#B8292F',
  yellow: '#F2C418',
  tintBlue: '#eef4fa',
  ink: '#1a2230',
  sub: '#5b6472',
  headFont: "'Montserrat','Segoe UI',Arial,sans-serif",
  bodyFont: "'Nunito','Segoe UI',Arial,sans-serif"
};

function badgePill(text, bg) {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:100px;background:${bg};color:#ffffff;font-size:11.5px;font-weight:700;font-family:${BRAND.headFont};">${escapeHtml(text)}</span>`;
}

/**
 * Shared letterhead header used by every outgoing email: the real
 * Fountainhead logo on white (the logo's own blue/red would disappear on a
 * blue band), embedded as a CID attachment (see LOGO_ATTACHMENT) so it
 * always renders regardless of whether the module is reachable from the
 * recipient's network — then the brand's own 45/45/10 colour-proportion
 * chart rendered as a thin rule directly beneath it.
 * @param {string} title
 * @param {string} subtitle
 * @return {string}
 */
function brandMasthead(title, subtitle) {
  return `
  <tr>
    <td colspan="2" style="background:#ffffff;padding:22px 26px 18px;">
      <img src="cid:${LOGO_CID}" alt="Fountainhead" height="28" style="height:28px;width:auto;display:block;margin-bottom:14px;" />
      <div style="font-family:${BRAND.headFont};color:${BRAND.blue};font-size:20px;font-weight:800;">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-family:${BRAND.bodyFont};color:${BRAND.sub};font-size:13px;margin-top:3px;">${subtitle}</div>` : ''}
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0;">
      <table cellspacing="0" cellpadding="0" width="100%"><tr>
        <td width="45%" style="height:5px;background:${BRAND.blue};font-size:0;line-height:0;">&nbsp;</td>
        <td width="45%" style="height:5px;background:${BRAND.red};font-size:0;line-height:0;">&nbsp;</td>
        <td width="10%" style="height:5px;background:${BRAND.yellow};font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>
    </td>
  </tr>`;
}

/** Shared footer band, closes out every outgoing email. */
function brandFooter() {
  return '';
}

/**
 * Renders a label/value field table with the brand's alternating-tint rows
 * and blue label column. @param {Array<[string, string]>} rows
 */
function brandFieldTable(rows) {
  const labelStyle = `padding:10px 16px;font-family:${BRAND.headFont};font-size:12.5px;font-weight:700;width:42%;color:${BRAND.blue};vertical-align:top;`;
  const valueStyle = `padding:10px 16px;font-family:${BRAND.bodyFont};font-size:13.5px;vertical-align:top;color:${BRAND.ink};`;
  return rows.map(([label, value], i) => `
    <tr style="${i % 2 === 0 ? '' : `background:${BRAND.tintBlue};`}">
      <td style="${labelStyle}">${escapeHtml(label)}</td>
      <td style="${valueStyle}">${value}</td>
    </tr>`).join('');
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
  const resolved = record.resolved || 'No';
  const pendingSince = daysBetween(record.created_at);

  const rows = [
    ['Form Number', escapeHtml(record.id)],
    ['School Selection', escapeHtml(record.school_raw || record.school_code)],
    ['Department', escapeHtml(record.department)],
    ['Is this a Critical Issue?', record.critical ? badgePill('CRITICAL', BRAND.red) : 'No'],
    ['Location', escapeHtml(record.location) || 'N/A'],
    ['Describe the Incident', escapeHtml(record.issue) || 'N/A'],
    ['What immediate actions were taken?', escapeHtml(record.immediate_actions) || 'N/A'],
    ['Reported Date', fmtDate(record.created_at)],
    ['Pending Since', `${pendingSince} day${pendingSince === 1 ? '' : 's'}`],
    ['If NOT RESOLVED, please specify the closure date.', fmtDate(record.closure_date)],
    ['Has the issue been resolved?', resolved === 'Yes' ? badgePill('RESOLVED', BRAND.blueDeep) : badgePill('NOT RESOLVED', BRAND.red)]
  ];

  return `
<div style="margin:0;padding:0;background-color:#f4f6fa;font-family:${BRAND.bodyFont};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fa;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:620px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.12);">
        ${brandMasthead('Action Required', `${escapeHtml(record.school_raw || record.school_code)} &middot; ${escapeHtml(record.department)}`)}
        <tr><td colspan="2" style="padding:16px 26px 4px;">
          <p style="margin:0 0 8px 0;font-family:${BRAND.bodyFont};font-size:14.5px;color:${BRAND.ink};">
            The exigency below is <strong>unresolved</strong> and requires your action.
          </p>
        </td></tr>
        <tr><td colspan="2" style="padding:0 12px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${brandFieldTable(rows)}
          </table>
        </td></tr>
        <tr><td colspan="2" style="padding:20px 26px 24px;">
          <a href="${appUrl}" style="display:inline-block;background:${BRAND.red};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-family:${BRAND.headFont};font-size:13.5px;font-weight:700;">
            Open Dashboard
          </a>
        </td></tr>
        ${brandFooter()}
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
      subject: `Reminder: Exigency [${record.id}] - ${record.school_raw || record.school_code} - ${record.department}`,
      html: buildHtmlEmail(record, appUrl),
      attachments: [LOGO_ATTACHMENT]
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
  const resolved = record.resolved || 'No';
  const rows = [
    ['Form Number', escapeHtml(record.id)],
    ['Timestamp', fmtDate(record.created_at)],
    ['Form Filled by', escapeHtml(record.submitter_email)],
    ['School Selection', escapeHtml(record.school_raw || record.school_code)],
    ['Date of the Incident', fmtDate(record.date_of_incident)],
    ['Location', escapeHtml(record.location) || 'N/A'],
    ['Department', escapeHtml(record.department)],
    ['Is this a Critical Issue?', record.critical ? badgePill('CRITICAL', BRAND.red) : 'No'],
    ['Describe the Incident', escapeHtml(record.issue) || 'N/A'],
    ['Photos/videos/documents', escapeHtml(record.attachments) || 'N/A'],
    ['What immediate actions were taken?', escapeHtml(record.immediate_actions) || 'N/A'],
    ['Has the issue been resolved?', resolved === 'Yes' ? badgePill('RESOLVED', BRAND.blueDeep) : badgePill('NOT RESOLVED', BRAND.red)],
    ['If NOT RESOLVED, please specify the closure date.', fmtDate(record.closure_date)],
    ['Any suggested Policy, Training, Infra, Services or Process change required?', escapeHtml(record.suggested_changes) || 'N/A']
  ];

  return `
<table cellspacing="0" cellpadding="0" width="100%" style="max-width:620px;border-collapse:collapse;background:#ffffff;border-radius:10px;overflow:hidden;">
  ${brandMasthead('New Exigency Reported', `${escapeHtml(record.school_raw || record.school_code)} &middot; ${escapeHtml(record.department)}`)}
  ${brandFieldTable(rows)}
  ${brandFooter()}
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
      subject: `${criticalPrefix}Exigency [${record.id}] - ${record.school_raw || record.school_code} - ${record.department}`,
      html,
      attachments: [LOGO_ATTACHMENT]
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
