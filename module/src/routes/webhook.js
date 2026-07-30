/**
 * webhook.js
 *
 * Legacy intake path for Google Form submissions forwarded by the Apps
 * Script webhook (see ../../AppsScriptWebhook.gs / ExigencyModuleWebhook.gs).
 * Kept for backward compatibility, but the module's own built-in form
 * (see routes/report.js, served at /report.html) is now the primary path —
 * it needs no Google Form, Apps Script trigger, or tunnel at all.
 */

const express = require('express');
const { processSubmission } = require('../services/submissionService');

const router = express.Router();

router.post('/form-submit', async (req, res) => {
  const providedSecret = req.header('X-Webhook-Secret');
  if (!process.env.WEBHOOK_SECRET || providedSecret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing webhook secret.' });
  }

  const appUrl = `${req.protocol}://${req.get('host')}`;
  const result = await processSubmission(req.body || {}, appUrl);
  res.json(result);
});

module.exports = router;
