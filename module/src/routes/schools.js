/**
 * schools.js
 *
 * Manage schools, departments, and the department-based recipient mapping
 * that replaces the original per-school "<CODE> Emails" sheets.
 */

const express = require('express');
const {
  getSchools, upsertSchool, getDepartments, upsertDepartment,
  getAllDepartmentRecipients, upsertDepartmentRecipients
} = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  const schools = getSchools();
  const recipients = getAllDepartmentRecipients();
  res.json(schools.map((s) => ({ ...s, departments: recipients[s.code] || [] })));
});

router.post('/', (req, res) => {
  const { code, name } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  const normalized = upsertSchool(code, name);
  res.status(201).json({ code: normalized });
});

router.get('/departments', (req, res) => {
  res.json(getDepartments());
});

router.post('/departments', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  upsertDepartment(name);
  res.status(201).json(getDepartments());
});

router.put('/:code/departments/:department', (req, res) => {
  const { to, cc } = req.body || {};
  upsertDepartmentRecipients(req.params.code, req.params.department, to || '', cc || '');
  res.json({ saved: true });
});

module.exports = router;
