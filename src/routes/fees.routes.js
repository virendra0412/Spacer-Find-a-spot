const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { getCurrentFees, estimate } = require('../controllers/fees.controller');

const router = express.Router();

router.get('/current', asyncHandler(getCurrentFees));
router.get('/estimate', asyncHandler(estimate));

module.exports = router;
