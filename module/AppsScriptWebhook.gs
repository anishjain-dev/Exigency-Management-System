/**
 * AppsScriptWebhook.gs
 *
 * Replaces the entire Sheets-based FormSubmit/SchoolService/Reminder/Dashboard
 * pipeline. This is the ONLY Apps Script code needed now — attach it to the
 * Google Form itself (Extensions > Apps Script, from the FORM editor, not a
 * spreadsheet), so it can read submitted answers directly without needing a
 * linked response spreadsheet at all.
 *
 * Setup:
 *   1. Start the local module: `npm install && npm start` (see module/README.md).
 *   2. Expose it publicly with a tunnel, e.g.: `ngrok http 4000`
 *      Copy the printed https://xxxx.ngrok-free.app URL.
 *   3. In this file, set WEBHOOK_URL below to that URL + "/api/webhook/form-submit".
 *   4. Set WEBHOOK_SECRET below to the exact same value as WEBHOOK_SECRET in
 *      module/.env on your machine.
 *   5. Run installTrigger() once (Run > installTrigger) to wire up the
 *      installable onFormSubmit trigger. Grant permissions when prompted.
 *   6. Submit the Form — the module's dashboard (http://localhost:4000)
 *      should show the new exigency within a second or two.
 *
 * Whenever ngrok restarts, its URL changes — update WEBHOOK_URL and re-run
 * onFormSubmit will pick up the new value automatically (no need to
 * re-install the trigger, just edit the constant and save).
 */

const WEBHOOK_URL = 'https://YOUR-NGROK-SUBDOMAIN.ngrok-free.app/api/webhook/form-submit';
const WEBHOOK_SECRET = 'change-me-to-a-long-random-string'; // must match module/.env

/**
 * Installable trigger handler — fires on every Form submission.
 * @param {GoogleAppsScript.Events.FormsOnFormSubmit} e
 */
function onFormSubmit(e) {
  try {
    const response = e.response;
    const itemResponses = response.getItemResponses();
    const answers = {};
    itemResponses.forEach(function (itemResponse) {
      answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
    });

    const payload = {
      timestamp: response.getTimestamp().toISOString(),
      submitterEmail: response.getRespondentEmail() || answers['Email Address'] || '',
      school: answers['School Selection'] || answers['School'] || '',
      issue: answers['Describe the Incident'] || answers['Issue'] || '',
      owner: answers['Owner'] || '',
      followupDate: answers['Follow-up Date'] || null,
      status: 'Open',
      rawAnswers: answers
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const httpResponse = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log('Webhook response (%s): %s', httpResponse.getResponseCode(), httpResponse.getContentText());
  } catch (error) {
    Logger.log('onFormSubmit webhook error: ' + error.message);
  }
}

/**
 * Run once manually to install the trigger (Apps Script editor does not
 * support installable Form triggers via simple function execution the same
 * way spreadsheet triggers do — this creates it explicitly).
 */
function installTrigger() {
  const form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Trigger installed.');
}
