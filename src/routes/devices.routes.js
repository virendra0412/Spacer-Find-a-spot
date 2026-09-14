const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { registerDevice } = require('../controllers/devices.controller');

const router = express.Router();
router.post('/', requireAuth, asyncHandler(registerDevice));
module.exports = router;
