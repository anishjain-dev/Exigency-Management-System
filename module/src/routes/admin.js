/**
 * admin.js
 *
 * Single login endpoint for the admin-only actions (currently: editing
 * Settings, which includes who outgoing mail appears to come from).
 */

const express = require('express');
const { verifyCredentials, issueToken, verifyAdmin } = require('../services/authService');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  res.json({ token: issueToken(username) });
});

// Used by the frontend on load to check whether a stored token is still valid.
router.get('/verify', verifyAdmin);

module.exports = router;
