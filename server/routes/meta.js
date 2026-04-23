const express = require('express');
const ALLOWED_UNITS = require('../utils/units');

const router = express.Router();

// GET /api/meta/units
router.get('/units', async (req, res) => {
  res.json(ALLOWED_UNITS);
});

module.exports = router;
