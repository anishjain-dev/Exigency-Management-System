/**
 * Triggers.gs
 *
 * Installs all triggers this system needs. Idempotent: deletes any existing
 * trigger for the same handler function before recreating it, so re-running
 * setup (e.g. after changing ReminderTime in Settings) is always safe and
 * never produces duplicate triggers.
 */

const MANAGED_TRIGGER_HANDLERS_ = Object.freeze([
  'onFormSubmit',
  'runDailyReminderJob',
  'updateDashboard',
  'onEditRouter'
]);

/**
 * Creates/repairs every trigger the system needs:
 *   - Installable onFormSubmit, bound to the spreadsheet's form.
 *   - Time-driven daily reminder job at Settings!ReminderTime.
 *   - Time-driven daily dashboard refresh, shortly after the reminder job.
 *   - Installable onEdit router for school-sheet edit propagation.
 */
function createTriggers() {
  deleteManagedTriggers_();

  const ss = getEmsSpreadsheet_();
  const config = loadConfiguration(true);

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  ScriptApp.newTrigger('runDailyReminderJob')
    .timeBased()
    .atHour(config.reminderTriggerHour)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('updateDashboard')
    .timeBased()
    .atHour(config.dashboardTriggerHour)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('onEditRouter')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  writeLog_({
    recordId: '',
    recipient: '',
    type: REMINDER_TYPE.SYNC,
    status: LOG_STATUS.INFO,
    message: 'Triggers (re)created: form submit, daily reminder @' + config.reminderTriggerHour +
      ':00, dashboard @' + config.dashboardTriggerHour + ':00, onEdit.'
  });
}

/**
 * Removes any existing trigger whose handler function is one this system
 * manages, so createTriggers() can be re-run safely without duplicates.
 * @private
 */
function deleteManagedTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    if (MANAGED_TRIGGER_HANDLERS_.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
