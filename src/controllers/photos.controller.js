const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

// v1 storage: local disk, served statically from /uploads (wired in
// app.js). This is the honest tradeoff — the original plan called for
// S3/R2, but that needs real cloud credentials this environment doesn't
// have. Swapping the storage engine later only touches this file: the
// multer config below and the two fs calls in deletePhoto. Everything
// else (the DB row, the URL shape, the API contract) stays the same,
// since a presigned-S3 upload would still end up storing a URL string
// in `listing_photos.url` exactly like this does.
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'listings');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const dir = path.join(UPLOAD_ROOT, req.params.id);
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new AppError(400, 'Only image files are allowed'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — a phone camera photo fits comfortably
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

  // Store a path, not a full URL — the frontend already prefixes API
  // responses with its own API_URL constant (see api/client.js), so this
  // stays correct whether the backend is on localhost, a LAN IP, or a
  // real domain in production.
  const url = `/uploads/listings/${req.params.id}/${req.file.filename}`;

  const { rows } = await pool.query(
    `INSERT INTO listing_photos (listing_id, url, sort_order)
     VALUES ($1, $2, $3) RETURNING id, url, sort_order, created_at`,
    [req.params.id, url, sortOrder]
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

  // Best-effort disk cleanup — a failure here shouldn't fail the request,
  // since the DB row (the part that actually matters to the app) is
  // already gone.
  const filePath = path.join(__dirname, '..', '..', rows[0].url.replace(/^\/uploads\//, 'uploads/'));
  fs.unlink(filePath).catch(() => {});

  res.status(204).send();
}

module.exports = { uploadMiddleware, addPhoto, deletePhoto };
