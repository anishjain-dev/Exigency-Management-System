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
 *   2. Expose it publicly with a tunnel, e.g.: `npx localtunnel --port 4000`
 *      (or `ngrok http 4000` if you have a working ngrok agent). Copy the
 *      printed public URL.
 *   3. In this file, set WEBHOOK_URL below to that URL + "/api/webhook/form-submit".
 *   4. Set WEBHOOK_SECRET below to the exact same value as WEBHOOK_SECRET in
 *      module/.env on your machine.
 *   5. Run installTrigger() once (Run > installTrigger) to wire up the
 *      installable onFormSubmit trigger. Grant permissions when prompted.
 *   6. Submit the Form — the module's dashboard (http://localhost:4000)
 *      should show the new exigency within a second or two.
 *
 * Whenever the tunnel restarts, its URL changes — update WEBHOOK_URL and
 * save; no need to re-run installTrigger().
 *
 * NOTE: localtunnel (loca.lt) shows a one-time browser interstitial page to
 * humans, but requires no such thing for direct HTTP calls as long as the
 * 'bypass-tunnel-reminder' header below is present — which it is.
 */

const WEBHOOK_URL = 'https://owned-proceeds-orders-door.trycloudflare.com/api/webhook/form-submit';
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
      school: answers['School Selection'] || '',
      dateOfIncident: answers['Date of the Incident'] || null,
      location: answers['Location'] || '',
      department: answers['Choose the Department'] || 'Other',
      critical: answers['Is this a Critical Issue?'] || 'No',
      issue: answers['Describe the Incident'] || '',
      attachments: answers['Upload photos/videos/documents'] || '',
      immediateActions: answers['What immediate actions were taken?'] || '',
      resolved: answers['Has the issue been resolved?'] || 'No',
      closureDate: answers['If NOT RESOLVED, please specify the closure date.'] || null,
      suggestedChanges: answers['Any suggested Policy, Training, Infra, Services or Process change required?'] || '',
      rawAnswers: answers
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Webhook-Secret': WEBHOOK_SECRET,
        'bypass-tunnel-reminder': 'true'
      },
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
