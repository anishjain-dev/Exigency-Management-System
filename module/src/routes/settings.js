/**
 * settings.js
 *
 * Read/write the key-value settings table that drives the whole system's
 * configuration (no hardcoded values in code).
 */

const express = require('express');
const { getAllSettings, setSettings } = require('../services/settingsService');
const { requireAdmin } = require('../services/authService');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getAllSettings());
});

// Admin-only: this includes SenderName/SenderEmail (who mail appears to come
// from) alongside the rest of the settings the tab exposes.
router.put('/', requireAdmin, (req, res) => {
  setSettings(req.body || {});
  res.json(getAllSettings());
});

module.exports = router;
