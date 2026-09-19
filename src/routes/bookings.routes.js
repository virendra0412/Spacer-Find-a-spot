const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { bookingsLimiter } = require('../middleware/rateLimiters');
const {
  createBooking, myBookings, getBooking, startSession, endSession, extendSession, cancelBooking,
} = require('../controllers/bookings.controller');
const { createReview } = require('../controllers/reviews.controller');
const { raiseDispute } = require('../controllers/disputes.controller');

const router = express.Router();

router.use(requireAuth); // every booking route requires a logged-in user

router.post('/', bookingsLimiter, asyncHandler(createBooking));
// Must be registered before /:id, or Express matches "mine" to the :id param.
router.get('/mine', asyncHandler(myBookings));
router.get('/:id', asyncHandler(getBooking));
router.post('/:id/start', bookingsLimiter, asyncHandler(startSession));
router.post('/:id/end', bookingsLimiter, asyncHandler(endSession));
router.post('/:id/extend', bookingsLimiter, asyncHandler(extendSession));
router.post('/:id/cancel', bookingsLimiter, asyncHandler(cancelBooking));
router.post('/:id/review', bookingsLimiter, asyncHandler(createReview));
router.post('/:id/dispute', bookingsLimiter, asyncHandler(raiseDispute));

module.exports = router;
