const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { paymentsLimiter } = require('../middleware/rateLimiters');
const { getPayment, markPaid } = require('../controllers/payments.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/:bookingId', asyncHandler(getPayment));
router.post('/:bookingId/mark-paid', paymentsLimiter, asyncHandler(markPaid));

module.exports = router;
