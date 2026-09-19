const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const {
  getOverview, listUsers, listAllListings, moderateListing, listAllBookings,
} = require('../controllers/admin.controller');
const { listDisputes, resolveDispute } = require('../controllers/disputes.controller');

const router = express.Router();

router.use(requireAuth, asyncHandler(requireAdmin));

router.get('/overview', asyncHandler(getOverview));
router.get('/users', asyncHandler(listUsers));
router.get('/listings', asyncHandler(listAllListings));
router.patch('/listings/:id/status', asyncHandler(moderateListing));
router.get('/bookings', asyncHandler(listAllBookings));
router.get('/disputes', asyncHandler(listDisputes));
router.patch('/disputes/:id', asyncHandler(resolveDispute));

module.exports = router;
