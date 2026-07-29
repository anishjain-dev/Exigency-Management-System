/**
 * dashboard.js
 *
 * KPI computation for the dashboard UI — total/open/closed/pending, today's
 * follow-ups, overdue count, and school-wise breakdown.
 */

const express = require('express');
const db = require('../db');
const { getSetting } = require('../services/settingsService');

const router = express.Router();

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
  const closedStatus = getSetting('ClosedStatus', 'Closed');
  const today = todayStr();
  const rows = db.prepare('SELECT * FROM exigencies').all();

  let total = 0, open = 0, closed = 0, pending = 0, todayFollowups = 0, overdue = 0;
  const bySchool = {};

  rows.forEach((r) => {
    total++;
    if (!bySchool[r.school_code]) bySchool[r.school_code] = { school: r.school_code, total: 0, open: 0, closed: 0 };
    bySchool[r.school_code].total++;

    if (r.status === closedStatus) {
      closed++;
      bySchool[r.school_code].closed++;
      return;
    }
    open++;
    bySchool[r.school_code].open++;

    const followUp = dateOnly(r.followup_date);
    const nextDue = dateOnly(r.next_due_date);
    if (!nextDue) pending++;
    if (followUp === today) todayFollowups++;
    if (followUp && followUp <= today && !nextDue) overdue++;
  });

  res.json({
    kpis: { total, open, closed, pending, todayFollowups, overdue },
    schoolCounts: Object.values(bySchool)
  });
});

module.exports = router;
