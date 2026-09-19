const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { getMe, updateMe, getMyStats, getMyReviews } = require('../controllers/users.controller');
const { myDisputes } = require('../controllers/disputes.controller');

const router = express.Router();

router.use(requireAuth);
router.get('/me', asyncHandler(getMe));
router.patch('/me', asyncHandler(updateMe));
router.get('/me/stats', asyncHandler(getMyStats));
router.get('/me/reviews', asyncHandler(getMyReviews));
router.get('/me/disputes', asyncHandler(myDisputes));

module.exports = router;
