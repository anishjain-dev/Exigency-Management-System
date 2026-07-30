/**
 * ExigencyModuleWebhook.gs
 *
 * Forwards every Form submission to the standalone Exigency Management
 * module (Express + SQLite, running on localhost, tunneled via Cloudflare).
 * This script's container is bound to the response SPREADSHEET, not the
 * Form itself, so the Form is opened explicitly by ID below rather than
 * via FormApp.getActiveForm() (which only works when bound to the Form).
 *
 * Function names are deliberately distinct from Code.gs's own onFormSubmit
 * to avoid colliding with that existing (separate) trigger logic.
 */

const FORM_ID = '1zI7IR7zADGxifpniPv6G0S2AI_KPdAdxsnv5r_ESbEs';
const WEBHOOK_URL = 'https://owned-proceeds-orders-door.trycloudflare.com/api/webhook/form-submit';
const WEBHOOK_SECRET = 'change-me-to-a-long-random-string'; // must match module/.env

/**
 * Installable trigger handler — fires on every Form submission.
 * @param {GoogleAppsScript.Events.FormsOnFormSubmit} e
 */
function sendToExigencyModule(e) {
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
        'X-Webhook-Secret': WEBHOOK_SECRET
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const httpResponse = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log('Webhook response (%s): %s', httpResponse.getResponseCode(), httpResponse.getContentText());
  } catch (error) {
    Logger.log('sendToExigencyModule webhook error: ' + error.message);
  }
}

/**
 * Run once manually to install the trigger — opens the Form explicitly by
 * ID (this script project is bound to the spreadsheet, not the Form, so
 * FormApp.getActiveForm() would return nothing here).
 */
function installExigencyModuleTrigger() {
  const form = FormApp.openById(FORM_ID);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendToExigencyModule') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendToExigencyModule').forForm(form).onFormSubmit().create();
  Logger.log('Trigger installed.');
}
