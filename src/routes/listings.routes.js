const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  createListing, updateListing, setAvailability, myListings, search, getListing,
} = require('../controllers/listings.controller');
const { listListingReviews } = require('../controllers/reviews.controller');
const { uploadMiddleware, addPhoto, deletePhoto } = require('../controllers/photos.controller');

const router = express.Router();

// Order matters: /mine and /search must be registered before /:id,
// otherwise Express matches them to the :id param instead.
router.get('/mine', requireAuth, asyncHandler(myListings));
router.get('/search', asyncHandler(search));
router.get('/:id', asyncHandler(getListing));
router.get('/:id/reviews', asyncHandler(listListingReviews));

router.post('/', requireAuth, asyncHandler(createListing));
router.patch('/:id', requireAuth, asyncHandler(updateListing));
router.post('/:id/availability', requireAuth, asyncHandler(setAvailability));

// uploadMiddleware is [ownershipCheck, multer] — both wrapped so async
// errors from either (a bad DB call, an over-size file, etc.) reach
// errorHandler.js instead of hanging the request.
router.post(
  '/:id/photos',
  requireAuth,
  ...uploadMiddleware.map((fn) => asyncHandler(fn)),
  asyncHandler(addPhoto)
);
router.delete('/:id/photos/:photoId', requireAuth, asyncHandler(deletePhoto));

module.exports = router;
