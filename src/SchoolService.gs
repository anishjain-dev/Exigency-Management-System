/**
 * SchoolService.gs
 *
 * Owns creation and synchronization of per-school sheets (e.g. "FSK Emails").
 * One-way sync master -> school on new/changed master rows; edits made
 * directly on a school sheet's records block are propagated back to the
 * master row by Exigency ID (see syncEditToMaster_, invoked from Main.onEditRouter).
 */

/**
 * Returns the school sheet name for a given school code, e.g. "FSK" -> "FSK Emails".
 * @param {string} schoolCode
 * @return {string}
 */
function getSchoolSheetName_(schoolCode) {
  return String(schoolCode).trim().toUpperCase() + ' Emails';
}

/**
 * Ensures a school sheet exists with the correct two-block layout
 * (Users block + Records block). Idempotent.
 * @param {string} schoolCode
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function ensureSchoolSheet_(schoolCode) {
  const ss = getEmsSpreadsheet_();
  const name = getSchoolSheetName_(schoolCode);
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);

  // Block A: authorized users.
  const usersStartCol = SCHOOL_SHEET_LAYOUT.USERS_BLOCK_START_COL;
  sheet.getRange(1, usersStartCol, 1, SCHOOL_SHEET_LAYOUT.USERS_HEADERS.length)
    .setValues([SCHOOL_SHEET_LAYOUT.USERS_HEADERS])
    .setFontWeight('bold');

  // Block B: synced records, headers mirrored from master on first sync.
  const masterHeaders = getMasterHeaders_();
  const recordsStartCol = SCHOOL_SHEET_LAYOUT.RECORDS_BLOCK_START_COL;
  if (masterHeaders.length) {
    sheet.getRange(1, recordsStartCol, 1, masterHeaders.length)
      .setValues([masterHeaders])
      .setFontWeight('bold');
  }

  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Returns the master sheet's header row, appending required system columns
 * first if they are missing.
 * @return {Array<string>}
 * @private
 */
function getMasterHeaders_() {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  if (!master) return [];
  ensureMasterColumns_(master);
  const lastCol = master.getLastColumn();
  return master.getRange(1, 1, 1, lastCol).getValues()[0];
}

/**
 * Main sync entry point: pushes new and updated master rows out to their
 * respective school sheets. Called from FormSubmit.onFormSubmit (single row)
 * and can also be called with no argument to reconcile the whole master
 * sheet (e.g. after manual edits), which is what the daily reminder job does
 * as a safety net.
 *
 * @param {number=} onlyRowNumber If provided, only this 1-based master row is synced.
 */
function updateSchoolSheets(onlyRowNumber) {
  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  if (!master) return;

  const config = loadConfiguration();
  const headers = getMasterHeaders_();
  const colMap = getColumnMap_(master);
  const lastRow = master.getLastRow();
  if (lastRow < 2) return;

  const startRow = onlyRowNumber || 2;
  const numRows = onlyRowNumber ? 1 : (lastRow - 1);
  const range = master.getRange(startRow, 1, numRows, master.getLastColumn());
  const values = range.getValues();

  // Pre-load existing IDs across the whole master sheet for uniqueness checks.
  const idCol = colMap[SYSTEM_COLUMNS.EXIGENCY_ID];
  const allIds = master.getRange(2, idCol + 1, lastRow - 1, 1).getValues().map(function (r) { return r[0]; });

  const updatedValues = [];
  let mutated = false;

  values.forEach(function (row, i) {
    const absoluteRow = startRow + i;
    const schoolRaw = row[colMap[DATA_COLUMNS.SCHOOL]];
    const schoolCode = extractSchoolCode_(schoolRaw, config);
    let exigencyId = row[colMap[SYSTEM_COLUMNS.EXIGENCY_ID]];

    if (!exigencyId) {
      const followUpDate = toDateOrNull_(row[colMap[DATA_COLUMNS.FOLLOWUP_DATE]]) || new Date();
      exigencyId = createUniqueID(schoolCode, followUpDate, allIds);
      allIds.push(exigencyId);
      row[colMap[SYSTEM_COLUMNS.EXIGENCY_ID]] = exigencyId;
      if (!row[colMap[DATA_COLUMNS.STATUS]]) {
        row[colMap[DATA_COLUMNS.STATUS]] = config.statusList[0] || 'Open';
      }
      mutated = true;
    }

    row[colMap[SYSTEM_COLUMNS.SYNC_STATUS]] = 'Synced';
    updatedValues.push(row);

    if (schoolCode && isKnownSchool_(schoolCode, config)) {
      upsertSchoolRecord_(schoolCode, headers, row, exigencyId);
    } else {
      writeLog_({
        recordId: exigencyId,
        recipient: '',
        type: REMINDER_TYPE.SYNC,
        status: LOG_STATUS.FAILURE,
        message: 'Unknown/unmapped school code "' + schoolRaw + '" — record not synced to a school sheet.'
      });
    }
  });

  if (mutated || true) {
    range.setValues(updatedValues);
  }
}

/**
 * Extracts a school code from the raw "School" form field. Resolution order:
 *   1. Settings!SchoolMap exact match (full dropdown label -> code) — needed
 *      when the Form shows full school names rather than bare codes.
 *   2. The code itself (e.g. "FSK").
 *   3. A longer label that contains the code (e.g. "FSK - Kingston Campus").
 * @param {string} rawSchoolValue
 * @param {Object} config
 * @return {string}
 * @private
 */
function extractSchoolCode_(rawSchoolValue, config) {
  const value = String(rawSchoolValue || '').trim();
  if (!value) return '';
  const valueUpper = value.toUpperCase();
  const valueLower = value.toLowerCase();

  const mappedCode = Object.keys(config.schoolMap || {}).find(function (code) {
    return config.schoolMap[code] === valueLower;
  });
  if (mappedCode) return mappedCode;

  const direct = config.schoolCodes.find(function (code) { return code.toUpperCase() === valueUpper; });
  if (direct) return direct;

  const contained = config.schoolCodes.find(function (code) { return valueUpper.indexOf(code.toUpperCase()) !== -1; });
  return contained || valueUpper;
}

/**
 * Inserts or updates a single record row in the given school's Records
 * block, keyed by Exigency ID to avoid duplicates.
 * @param {string} schoolCode
 * @param {Array<string>} headers Master header row (defines column order).
 * @param {Array<*>} rowValues Full master row values in header order.
 * @param {string} exigencyId
 * @private
 */
function upsertSchoolRecord_(schoolCode, headers, rowValues, exigencyId) {
  const sheet = ensureSchoolSheet_(schoolCode);
  const startCol = SCHOOL_SHEET_LAYOUT.RECORDS_BLOCK_START_COL;
  const idColOffset = headers.indexOf(SYSTEM_COLUMNS.EXIGENCY_ID);

  const lastRow = sheet.getLastRow();
  let targetRow = -1;

  if (lastRow >= 2) {
    const existingIds = sheet.getRange(2, startCol + idColOffset, lastRow - 1, 1).getValues();
    for (let i = 0; i < existingIds.length; i++) {
      if (existingIds[i][0] === exigencyId) {
        targetRow = i + 2;
        break;
      }
    }
  }

  if (targetRow === -1) {
    targetRow = Math.max(lastRow + 1, 2);
  }

  sheet.getRange(targetRow, startCol, 1, rowValues.length).setValues([rowValues]);
}

/**
 * Propagates an edit made in a school sheet's Records block back to the
 * corresponding master row, matched by Exigency ID. Invoked from
 * Main.onEditRouter when the edited sheet is a school sheet.
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function syncEditToMaster_(e) {
  const editedSheet = e.range.getSheet();
  const editedCol = e.range.getColumn();
  const startCol = SCHOOL_SHEET_LAYOUT.RECORDS_BLOCK_START_COL;
  if (editedCol < startCol) return; // edit was in the Users block, not records
  if (e.range.getRow() === 1) return; // header row edit, ignore

  const headers = getMasterHeaders_();
  if (!headers.length) return;

  const idColOffset = headers.indexOf(SYSTEM_COLUMNS.EXIGENCY_ID);
  const editedRow = e.range.getRow();
  const exigencyId = editedSheet.getRange(editedRow, startCol + idColOffset).getValue();
  if (!exigencyId) return;

  const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
  const masterColMap = getColumnMap_(master);
  const masterLastRow = master.getLastRow();
  if (masterLastRow < 2) return;

  const masterIds = master.getRange(2, masterColMap[SYSTEM_COLUMNS.EXIGENCY_ID] + 1, masterLastRow - 1, 1).getValues();
  let masterRow = -1;
  for (let i = 0; i < masterIds.length; i++) {
    if (masterIds[i][0] === exigencyId) {
      masterRow = i + 2;
      break;
    }
  }
  if (masterRow === -1) {
    writeLog_({
      recordId: exigencyId,
      recipient: '',
      type: REMINDER_TYPE.SYNC,
      status: LOG_STATUS.FAILURE,
      message: 'Edit on school sheet could not find matching master row.'
    });
    return;
  }

  // Copy the full edited row back (records block is a 1:1 mirror of master columns).
  const rowValues = editedSheet.getRange(editedRow, startCol, 1, headers.length).getValues()[0];
  master.getRange(masterRow, 1, 1, headers.length).setValues([rowValues]);

  writeLog_({
    recordId: exigencyId,
    recipient: '',
    type: REMINDER_TYPE.SYNC,
    status: LOG_STATUS.SUCCESS,
    message: 'School sheet edit synced back to master row ' + masterRow + '.'
  });
}
