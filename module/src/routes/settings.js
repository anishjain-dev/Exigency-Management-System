/**
 * settings.js
 *
 * Read/write the key-value settings table that drives the whole system's
 * configuration (no hardcoded values in code).
 */

const express = require('express');
const { getAllSettings, setSettings } = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getAllSettings());
});

router.put('/', (req, res) => {
  setSettings(req.body || {});
  res.json(getAllSettings());
});

module.exports = router;
