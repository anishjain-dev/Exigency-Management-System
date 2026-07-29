/**
 * EmailService.gs
 *
 * Builds and sends the professional HTML reminder email, and logs every
 * send attempt (success or failure) to the Logs sheet. Templating is kept
 * generic (buildHtmlEmail_ takes a field list) so Stage 2 summary/weekly
 * emails can reuse it without new plumbing (see ARCHITECTURE.md #13).
 */

/**
 * Sends a reminder email for a single exigency record.
 *
 * @param {Object} record Header-keyed record data, must include Exigency ID,
 *   School, Issue, Owner, Timestamp, Follow-up Date, Status.
 * @param {Array<string>} toEmails Primary recipients (school users + owner).
 * @param {Array<string>=} ccEmails Additional CC recipients.
 * @param {string=} reminderType One of REMINDER_TYPE.*
 * @return {boolean} True if the send succeeded.
 */
function sendReminderEmail(record, toEmails, ccEmails, reminderType) {
  const config = loadConfiguration();
  const recipients = (toEmails || []).filter(Boolean);
  if (recipients.length === 0) {
    writeLog_({
      recordId: record[SYSTEM_COLUMNS.EXIGENCY_ID],
      recipient: '',
      type: reminderType || REMINDER_TYPE.DAILY_FOLLOWUP,
      status: LOG_STATUS.SKIPPED,
      message: 'No recipients resolved for this record; email not sent.'
    });
    return false;
  }

  const cc = (ccEmails && ccEmails.length ? ccEmails : config.defaultCc).filter(Boolean);
  const subject = buildEmailSubject_(record, config);
  const htmlBody = buildHtmlEmail_(record, config);

  try {
    MailApp.sendEmail({
      to: recipients.join(','),
      cc: cc.join(','),
      subject: subject,
      htmlBody: htmlBody
    });

    writeLog_({
      recordId: record[SYSTEM_COLUMNS.EXIGENCY_ID],
      recipient: recipients.join(','),
      type: reminderType || REMINDER_TYPE.DAILY_FOLLOWUP,
      status: LOG_STATUS.SUCCESS,
      message: 'Reminder email sent.'
    });
    return true;
  } catch (error) {
    writeLog_({
      recordId: record[SYSTEM_COLUMNS.EXIGENCY_ID],
      recipient: recipients.join(','),
      type: reminderType || REMINDER_TYPE.DAILY_FOLLOWUP,
      status: LOG_STATUS.FAILURE,
      message: 'Mail send failed: ' + error.message
    });
    return false;
  }
}

/**
 * @param {Object} record
 * @param {Object} config
 * @return {string}
 * @private
 */
function buildEmailSubject_(record, config) {
  return '[Exigency Reminder] ' + record[SYSTEM_COLUMNS.EXIGENCY_ID] + ' - ' +
    record[DATA_COLUMNS.SCHOOL] + ' - Action Required';
}

/**
 * Builds a responsive HTML email with school branding, a details table, a
 * color-coded status pill, a direct spreadsheet link, and a timestamped
 * footer.
 * @param {Object} record
 * @param {Object} config
 * @return {string}
 * @private
 */
function buildHtmlEmail_(record, config) {
  const followUpDate = toDateOrNull_(record[DATA_COLUMNS.FOLLOWUP_DATE]);
  const createdDate = toDateOrNull_(record[DATA_COLUMNS.TIMESTAMP]);
  const tz = Session.getScriptTimeZone() || 'Etc/UTC';
  const pendingSince = followUpDate ? daysBetween_(followUpDate, new Date()) : 0;
  const status = record[DATA_COLUMNS.STATUS] || 'Open';
  const statusColor = config.statusColors[status] || '#5F6368';
  const school = record[DATA_COLUMNS.SCHOOL] || 'N/A';

  const rows = [
    ['Exigency ID', escapeHtml_(record[SYSTEM_COLUMNS.EXIGENCY_ID])],
    ['School', escapeHtml_(school)],
    ['Issue', escapeHtml_(record[DATA_COLUMNS.ISSUE])],
    ['Owner', escapeHtml_(record[DATA_COLUMNS.OWNER])],
    ['Created Date', createdDate ? Utilities.formatDate(createdDate, tz, 'dd MMM yyyy') : 'N/A'],
    ['Follow-up Date', followUpDate ? Utilities.formatDate(followUpDate, tz, 'dd MMM yyyy') : 'N/A'],
    ['Pending Since', pendingSince + (pendingSince === 1 ? ' day' : ' days')],
    ['Current Status', '<span style="' + statusPillStyle_(statusColor) + '">' + escapeHtml_(status) + '</span>']
  ];

  const tableRows = rows.map(function (pair) {
    return '<tr>' +
      '<td style="' + labelCellStyle_() + '">' + pair[0] + '</td>' +
      '<td style="' + valueCellStyle_() + '">' + pair[1] + '</td>' +
      '</tr>';
  }).join('');

  const now = new Date();
  const timestamp = Utilities.formatDate(now, tz, 'dd MMM yyyy, HH:mm z');

  return '' +
'<div style="margin:0;padding:0;background-color:#f1f3f4;font-family:Roboto,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f3f4;padding:24px 0;">' +
    '<tr><td align="center">' +
      '<table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.12);">' +
        '<tr><td style="background:#1a73e8;padding:20px 24px;">' +
          '<span style="color:#ffffff;font-size:20px;font-weight:700;">Exigency Management System</span><br/>' +
          '<span style="color:#e8f0fe;font-size:13px;">' + escapeHtml_(school) + '</span>' +
        '</td></tr>' +
        '<tr><td style="padding:20px 24px 4px 24px;">' +
          '<p style="margin:0 0 12px 0;font-size:15px;color:#202124;">' +
            'The exigency below is <strong>overdue for follow-up</strong> and requires your action.' +
          '</p>' +
        '</td></tr>' +
        '<tr><td style="padding:0 24px;">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">' +
            tableRows +
          '</table>' +
        '</td></tr>' +
        '<tr><td style="padding:24px;">' +
          '<a href="' + config.spreadsheetUrl + '" ' +
            'style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;' +
            'padding:12px 20px;border-radius:4px;font-size:14px;font-weight:600;">' +
            'Open Spreadsheet' +
          '</a>' +
        '</td></tr>' +
        '<tr><td style="background:#f8f9fa;padding:14px 24px;border-top:1px solid #e8eaed;">' +
          '<p style="margin:0;font-size:11px;color:#5f6368;">' +
            'Automated reminder generated by the Exigency Management System · ' + timestamp +
          '</p>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr>' +
  '</table>' +
'</div>';
}

/** @private */
function statusPillStyle_(color) {
  return 'display:inline-block;padding:2px 10px;border-radius:12px;background:' + color +
    ';color:#ffffff;font-size:12px;font-weight:600;';
}

/** @private */
function labelCellStyle_() {
  return 'padding:8px 12px;border-bottom:1px solid #e8eaed;color:#5f6368;font-weight:600;width:38%;background:#fafafa;';
}

/** @private */
function valueCellStyle_() {
  return 'padding:8px 12px;border-bottom:1px solid #e8eaed;color:#202124;';
}
