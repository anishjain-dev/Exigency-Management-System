/**
 * server.js
 *
 * Entry point for the standalone Exigency Management module. Runs entirely
 * on localhost with its own SQLite database — no Google Sheets involved.
 * Google Form submissions arrive via the /api/webhook/form-submit endpoint,
 * called by the Apps Script webhook (see ExigencyModuleWebhook.gs).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const { getSetting } = require('./src/services/settingsService');
const { runDailyReminderJob } = require('./src/services/reminderService');
const { sendCriticalErrorEmail } = require('./src/services/emailService');
const { writeLog } = require('./src/services/logService');
const { checkForReplies, startReplyWatcher } = require('./src/services/replyService');

const app = express();
const PORT = process.env.PORT || 4000;
const APP_URL = `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/webhook', require('./src/routes/webhook'));
app.use('/api/report', require('./src/routes/report'));
app.use('/api/exigencies', require('./src/routes/exigencies'));
app.use('/api/schools', require('./src/routes/schools'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/logs', require('./src/routes/logs'));
app.use('/api/dashboard', require('./src/routes/dashboard'));

app.post('/api/reminders/run-now', async (req, res) => {
  try {
    const result = await runDailyReminderJob(APP_URL);
    res.json(result);
  } catch (error) {
    console.error(error);
    await sendCriticalErrorEmail('run-now reminder job', error);
    res.status(500).json({ error: error.message });
  }
});

// Central error handler — logs and never lets an unhandled error crash silently.
app.use((err, req, res, next) => {
  console.error(err);
  writeLog({ type: 'ERROR', status: 'FAILURE', message: `${req.method} ${req.path}: ${err.message}` });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Exigency Management module running at ${APP_URL}`);

  // Re-schedule the daily reminder cron at whatever hour is currently in
  // Settings; re-run scheduleReminderCron() after changing the hour via the
  // Settings UI + restarting the server to pick up the new time.
  scheduleReminderCron();

  // Watch the inbox for replies in near-real-time via IMAP IDLE (picks up
  // new mail within seconds instead of waiting for a poll interval). Runs
  // forever, reconnecting on its own if the connection drops.
  startReplyWatcher().catch((error) => console.error('Reply watcher crashed:', error));

  // Safety net: also poll every 5 minutes in case IDLE silently stops
  // without erroring (network changes, sleep/wake, etc).
  cron.schedule('*/5 * * * *', () => {
    checkForReplies().catch((error) => console.error('Reply check failed:', error));
  });
});

let currentTask = null;
function scheduleReminderCron() {
  if (currentTask) currentTask.stop();
  const hour = parseInt(getSetting('ReminderTriggerHour', '8'), 10) || 8;
  currentTask = cron.schedule(`0 ${hour} * * *`, async () => {
    try {
      await runDailyReminderJob(APP_URL);
    } catch (error) {
      console.error('Daily reminder job failed:', error);
      await sendCriticalErrorEmail('runDailyReminderJob (cron)', error);
    }
  });
  console.log(`Daily reminder job scheduled for ${hour}:00 every day.`);
}
