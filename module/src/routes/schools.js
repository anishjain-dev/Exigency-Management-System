/**
 * schools.js
 *
 * Manage schools, departments, and the department-based recipient mapping
 * that replaces the original per-school "<CODE> Emails" sheets.
 */

const express = require('express');
const {
  getSchools, upsertSchool, getDepartments, upsertDepartment,
  getAllDepartmentRecipients, upsertDepartmentRecipients,
  countExigenciesForSchool, countExigenciesForDepartment,
  deleteSchool, deleteDepartment, renameDepartment
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

router.delete('/:code', (req, res) => {
  const count = countExigenciesForSchool(req.params.code);
  if (count > 0 && req.query.force !== 'true') {
    return res.status(409).json({ error: 'has_exigencies', count });
  }
  deleteSchool(req.params.code);
  res.json({ deleted: true });
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

router.put('/departments/:name', (req, res) => {
  const { name: newName } = req.body || {};
  if (!newName) return res.status(400).json({ error: 'name is required' });
  const saved = renameDepartment(req.params.name, newName);
  res.json({ renamed: true, name: saved });
});

router.delete('/departments/:name', (req, res) => {
  const count = countExigenciesForDepartment(req.params.name);
  if (count > 0 && req.query.force !== 'true') {
    return res.status(409).json({ error: 'has_exigencies', count });
  }
  deleteDepartment(req.params.name);
  res.json({ deleted: true });
});

router.put('/:code/departments/:department', (req, res) => {
  const { to, cc } = req.body || {};
  upsertDepartmentRecipients(req.params.code, req.params.department, to || '', cc || '');
  res.json({ saved: true });
});

module.exports = router;
