/**
 * Main.gs
 *
 * One-time setup entry point and the shared onEdit router. Run
 * initializeSystem() once from the Apps Script editor (or via the custom
 * menu it installs) after deploying the code — see README.md for the full
 * install walkthrough.
 */

/**
 * Full one-time (or re-runnable) system setup:
 *   1. Ensures Settings/Logs/Dashboard sheets exist with sane defaults.
 *   2. Ensures system columns exist on the master sheet.
 *   3. Creates a sheet for every configured school.
 *   4. Backfills IDs and syncs any pre-existing master rows.
 *   5. (Re)installs all triggers.
 *   6. Builds the initial dashboard.
 * Safe to re-run at any time.
 */
function initializeSystem() {
  try {
    ensureSettingsSheet_();
    const config = loadConfiguration(true);

    const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
    if (!master) {
      throw new Error('Expected master sheet "' + SYSTEM_SHEETS.MASTER + '" was not found. ' +
        'Create/rename the Form response sheet to this name before initializing.');
    }
    ensureColumns_(master, [
      SYSTEM_COLUMNS.EXIGENCY_ID,
      SYSTEM_COLUMNS.LAST_REMINDER_DATE,
      SYSTEM_COLUMNS.REMINDER_COUNT,
      SYSTEM_COLUMNS.SYNC_STATUS
    ]);

    config.schoolCodes.forEach(function (code) { ensureSchoolSheet_(code); });

    updateSchoolSheets(); // backfill IDs + sync all existing rows
    createTriggers();
    updateDashboard();

    SpreadsheetApp.getActive().toast('Exigency Management System initialized successfully.', 'EMS Setup', 8);
  } catch (error) {
    logError_('initializeSystem', error, true);
    throw error; // surface to the editor UI when run manually
  }
}

/**
 * Single onEdit entry point for the whole project (Apps Script only allows
 * one installable trigger per event type per function binding cleanly here).
 * Routes to SchoolService when the edited sheet is a school sheet's records
 * block; ignores edits to Settings/Logs/Dashboard/Master (Master is meant to
 * stay untouched per spec, and is fed only via Form/onFormSubmit).
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function onEditRouter(e) {
  try {
    if (!e || !e.range) return;
    const sheetName = e.range.getSheet().getName();

    const isSystemSheet = [
      SYSTEM_SHEETS.MASTER, SYSTEM_SHEETS.LOGS, SYSTEM_SHEETS.DASHBOARD, SYSTEM_SHEETS.SETTINGS
    ].indexOf(sheetName) !== -1;
    if (isSystemSheet) return;

    if (/ Emails$/.test(sheetName)) {
      syncEditToMaster_(e);
    }
  } catch (error) {
    logError_('onEditRouter', error, false);
  }
}

/**
 * Adds a custom menu for admins to trigger key operations manually without
 * opening the Apps Script editor.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Exigency Admin')
    .addItem('Initialize / Repair System', 'initializeSystem')
    .addItem('Run Daily Reminder Job Now', 'runDailyReminderJob')
    .addItem('Refresh Dashboard', 'updateDashboard')
    .addItem('Re-sync All School Sheets', 'updateSchoolSheets')
    .addToUi();
}
