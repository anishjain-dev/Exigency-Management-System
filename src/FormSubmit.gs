/**
 * FormSubmit.gs
 *
 * Entry point wired to the Form's installable "On form submit" trigger
 * (see Triggers.createTriggers()). Keeps Form Responses 3 untouched aside
 * from appending the system columns, validates the row, checks submitter
 * authorization, assigns a unique ID, and fans the row out to its school
 * sheet.
 */

/**
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 */
function onFormSubmit(e) {
  try {
    withLock_(function () {
      handleFormSubmit_(e);
    });
  } catch (error) {
    logError_('onFormSubmit', error, true);
  }
}

/**
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 * @private
 */
function handleFormSubmit_(e) {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  if (!master) {
    throw new Error('Master sheet "' + SYSTEM_SHEETS.MASTER + '" not found.');
  }

  // Ensure system + tracking columns exist before reading the row, so column
  // indices below are correct even on the very first submission.
  ensureMasterColumns_(master);

  // Resolve which row was just submitted. e.range is reliable for installable
  // form-submit triggers bound to the response sheet.
  const submittedRow = e && e.range ? e.range.getRow() : master.getLastRow();
  const colMap = getColumnMap_(master);
  const lastCol = master.getLastColumn();
  const rowValues = master.getRange(submittedRow, 1, 1, lastCol).getValues()[0];

  const rowData = {};
  Object.keys(colMap).forEach(function (header) {
    rowData[header] = rowValues[colMap[header]];
  });

  const config = loadConfiguration();

  // Detective authorization check (see Validation.isAuthorizedSubmitter_).
  const submitterEmail = rowData[DATA_COLUMNS.SUBMITTER_EMAIL];
  if (!isAuthorizedSubmitter_(submitterEmail, config)) {
    writeLog_({
      recordId: '',
      recipient: submitterEmail || '',
      type: REMINDER_TYPE.SYNC,
      status: LOG_STATUS.FAILURE,
      message: 'Unauthorized submitter (not in FS Group / org domain): ' + submitterEmail
    });
    // Row is kept (master is append-only/immutable per spec) but is flagged
    // and NOT synced to any school sheet or reminder pipeline.
    master.getRange(submittedRow, colMap[SYSTEM_COLUMNS.SYNC_STATUS] + 1)
      .setValue('Rejected: Unauthorized submitter');
    return;
  }

  const validation = validateRow(rowData);
  if (!validation.valid) {
    writeLog_({
      recordId: '',
      recipient: submitterEmail || '',
      type: REMINDER_TYPE.SYNC,
      status: LOG_STATUS.FAILURE,
      message: 'Row validation failed: ' + validation.errors.join('; ')
    });
    master.getRange(submittedRow, colMap[SYSTEM_COLUMNS.SYNC_STATUS] + 1)
      .setValue('Invalid: ' + validation.errors.join('; '));
    return;
  }

  updateSchoolSheets(submittedRow);

  writeLog_({
    recordId: master.getRange(submittedRow, colMap[SYSTEM_COLUMNS.EXIGENCY_ID] + 1).getValue(),
    recipient: submitterEmail || '',
    type: REMINDER_TYPE.SYNC,
    status: LOG_STATUS.SUCCESS,
    message: 'New submission synced to school sheet.'
  });

  updateDashboard();
}
