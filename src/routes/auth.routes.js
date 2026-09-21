const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../utils/asyncHandler');
const { signup, login, refresh } = require('../controllers/auth.controller');

const router = express.Router();

// Auth endpoints are the classic brute-force target — keep this tight.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/signup', authLimiter, asyncHandler(signup));
router.post('/login', authLimiter, asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));

module.exports = router;
