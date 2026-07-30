/**
 * report.js
 *
 * The module's own built-in exigency-report intake — no Google Form,
 * Apps Script trigger, or tunnel required. Backs the form served at
 * /report.html. Uses the exact same validation/authorization/mail
 * pipeline as the legacy Google Form webhook (see services/submissionService.js).
 */

const express = require('express');
const { processSubmission } = require('../services/submissionService');

const router = express.Router();

router.post('/submit', async (req, res) => {
  const appUrl = `${req.protocol}://${req.get('host')}`;
  const result = await processSubmission(req.body || {}, appUrl);
  res.json(result);
});

module.exports = router;
