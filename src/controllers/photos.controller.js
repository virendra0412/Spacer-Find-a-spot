const multer = require('multer');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { uploadBuffer, deleteAsset } = require('../config/cloudinary');

function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new AppError(400, 'Only image files are allowed'));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Ownership check runs BEFORE multer touches the filesystem, so a
// non-owner's upload attempt never even gets written to disk.
async function requireOwnedListing(req, res, next) {
  const { rows } = await pool.query(
    'SELECT id FROM listings WHERE id = $1 AND host_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return next(new AppError(404, 'Listing not found'));
  next();
}

const uploadMiddleware = [requireOwnedListing, upload.single('photo')];

async function addPhoto(req, res) {
  if (!req.file) throw new AppError(400, 'No photo file provided (field name: "photo")');

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM listing_photos WHERE listing_id = $1',
    [req.params.id]
  );
  const sortOrder = countRows[0].n;

  const uploaded = await uploadBuffer(req.file.buffer, {
    folder: `spacer/listings/${req.params.id}`,
    resource_type: 'image',
  });

  const { rows } = await pool.query(
    `INSERT INTO listing_photos (listing_id, url, public_id, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING id, url, public_id, sort_order, created_at`,
    [req.params.id, uploaded.secure_url, uploaded.public_id, sortOrder]
  );

  await pool.query(
    `UPDATE listings SET status = 'active' WHERE id = $1 AND status = 'paused'`,
    [req.params.id]
  );

  res.status(201).json(rows[0]);
}

async function deletePhoto(req, res) {
  const { rows } = await pool.query(
    `DELETE FROM listing_photos
     WHERE id = $1 AND listing_id = $2
     RETURNING url`,
    [req.params.photoId, req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'Photo not found');

  await deleteAsset(rows[0].public_id).catch(() => {});

  const { rows: remaining } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM listing_photos WHERE listing_id = $1',
    [req.params.id]
  );
  if (remaining[0].count === 0) {
    await pool.query(
      `UPDATE listings SET status = 'paused' WHERE id = $1 AND status = 'active'`,
      [req.params.id]
    );
  }

  res.status(204).send();
}

module.exports = { uploadMiddleware, addPhoto, deletePhoto };
