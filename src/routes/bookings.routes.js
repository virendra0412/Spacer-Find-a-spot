const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  createBooking, myBookings, getBooking, startSession, endSession, cancelBooking,
} = require('../controllers/bookings.controller');
const { createReview } = require('../controllers/reviews.controller');

const router = express.Router();

router.use(requireAuth); // every booking route requires a logged-in user

router.post('/', asyncHandler(createBooking));
// Must be registered before /:id, or Express matches "mine" to the :id param.
router.get('/mine', asyncHandler(myBookings));
router.get('/:id', asyncHandler(getBooking));
router.post('/:id/start', asyncHandler(startSession));
router.post('/:id/end', asyncHandler(endSession));
router.post('/:id/cancel', asyncHandler(cancelBooking));
router.post('/:id/review', asyncHandler(createReview));

module.exports = router;
