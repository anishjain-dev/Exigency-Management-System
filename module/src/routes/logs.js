const express = require('express');
const { getRecentLogs } = require('../services/logService');
const { requireAdmin } = require('../services/authService');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(getRecentLogs(limit));
});

module.exports = router;
