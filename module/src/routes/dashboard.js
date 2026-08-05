/**
 * dashboard.js
 *
 * KPI computation for the dashboard UI — total/resolved/unresolved/critical,
 * today's/overdue counts, school-wise and department-wise breakdown.
 */

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../services/authService');

const router = express.Router();

router.use(requireAdmin);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

router.get('/', (req, res) => {
  const today = todayStr();
  const rows = db.prepare('SELECT * FROM exigencies').all();

  let total = 0, resolved = 0, unresolved = 0, critical = 0, overdue = 0, dueToday = 0;
  const bySchool = {};
  const byDepartment = {};

  rows.forEach((r) => {
    total++;
    if (!bySchool[r.school_code]) bySchool[r.school_code] = { school: r.school_code, total: 0, resolved: 0, unresolved: 0 };
    if (!byDepartment[r.department]) byDepartment[r.department] = { department: r.department, total: 0, resolved: 0, unresolved: 0 };
    bySchool[r.school_code].total++;
    byDepartment[r.department].total++;

    if (r.critical) critical++;

    if (r.resolved === 'Yes') {
      resolved++;
      bySchool[r.school_code].resolved++;
      byDepartment[r.department].resolved++;
      return;
    }
    unresolved++;
    bySchool[r.school_code].unresolved++;
    byDepartment[r.department].unresolved++;

    const closureDate = dateOnly(r.closure_date);
    if (closureDate === today) dueToday++;
    if (!closureDate || closureDate <= today) overdue++;
  });

  res.json({
    kpis: { total, resolved, unresolved, critical, dueToday, overdue },
    schoolCounts: Object.values(bySchool),
    departmentCounts: Object.values(byDepartment)
  });
});

module.exports = router;
