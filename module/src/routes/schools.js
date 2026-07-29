/**
 * schools.js
 *
 * Manage schools and each school's authorized recipient list — replaces the
 * per-school "<CODE> Emails" sheets.
 */

const express = require('express');
const {
  getSchools, upsertSchool, getSchoolUsers, addSchoolUser, removeSchoolUser
} = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  const schools = getSchools().map((s) => ({ ...s, users: getSchoolUsers(s.code) }));
  res.json(schools);
});

router.post('/', (req, res) => {
  const { code, name } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  const normalized = upsertSchool(code, name);
  res.status(201).json({ code: normalized });
});

router.get('/:code/users', (req, res) => {
  res.json(getSchoolUsers(req.params.code));
});

router.post('/:code/users', (req, res) => {
  const { email, role, active } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  addSchoolUser(req.params.code, email, role, active);
  res.status(201).json(getSchoolUsers(req.params.code));
});

router.delete('/users/:id', (req, res) => {
  removeSchoolUser(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
