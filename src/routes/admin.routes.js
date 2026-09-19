const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const {
  getOverview, listUsers, setUserAdmin, listAuditLog, listAllListings, moderateListing, listAllBookings,
  listVerifications, reviewVerification,
} = require('../controllers/admin.controller');
const { listDisputes, resolveDispute } = require('../controllers/disputes.controller');

const router = express.Router();

router.use(requireAuth, asyncHandler(requireAdmin));

router.get('/overview', asyncHandler(getOverview));
router.get('/users', asyncHandler(listUsers));
router.patch('/users/:id/admin', asyncHandler(setUserAdmin));
router.get('/audit-log', asyncHandler(listAuditLog));
router.get('/listings', asyncHandler(listAllListings));
router.patch('/listings/:id/status', asyncHandler(moderateListing));
router.get('/bookings', asyncHandler(listAllBookings));
router.get('/verifications', asyncHandler(listVerifications));
router.patch('/verifications/:userId', asyncHandler(reviewVerification));
router.get('/disputes', asyncHandler(listDisputes));
router.patch('/disputes/:id', asyncHandler(resolveDispute));

module.exports = router;
