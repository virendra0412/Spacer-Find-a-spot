const multer = require('multer');
const { pool } = require('../config/db');
const { uploadBuffer, deleteAsset } = require('../config/cloudinary');
const { AppError } = require('../utils/AppError');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new AppError(400, 'Identity files must be images'));
    }
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadVerificationFiles = imageUpload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
]);

async function getMyVerification(req, res) {
  const { rows } = await pool.query(
    `SELECT id, status, review_note, submitted_at, reviewed_at
     FROM identity_verifications WHERE user_id = $1`,
    [req.user.id]
  );
  res.json(rows[0] || { status: 'unsubmitted' });
}

async function submitVerification(req, res) {
  const document = req.files?.document?.[0];
  const selfie = req.files?.selfie?.[0];
  if (!document || !selfie) {
    throw new AppError(400, 'Upload both an identity document and a selfie');
  }

  const existing = await pool.query(
    'SELECT document_public_id, selfie_public_id FROM identity_verifications WHERE user_id = $1',
    [req.user.id]
  );

  const [documentUpload, selfieUpload] = await Promise.all([
    uploadBuffer(document.buffer, { folder: `spacer/identity/${req.user.id}`, resource_type: 'image' }),
    uploadBuffer(selfie.buffer, { folder: `spacer/identity/${req.user.id}`, resource_type: 'image' }),
  ]);

  const { rows } = await pool.query(
    `INSERT INTO identity_verifications
       (user_id, document_url, document_public_id, selfie_url, selfie_public_id, status, review_note, reviewed_at, reviewed_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', NULL, NULL, NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       document_url = EXCLUDED.document_url,
       document_public_id = EXCLUDED.document_public_id,
       selfie_url = EXCLUDED.selfie_url,
       selfie_public_id = EXCLUDED.selfie_public_id,
       status = 'pending',
       review_note = NULL,
       submitted_at = now(),
       reviewed_at = NULL,
       reviewed_by = NULL
     RETURNING id, status, review_note, submitted_at, reviewed_at`,
    [req.user.id, documentUpload.secure_url, documentUpload.public_id, selfieUpload.secure_url, selfieUpload.public_id]
  );
  if (existing.rows[0]) {
    await Promise.all([
      deleteAsset(existing.rows[0].document_public_id).catch(() => {}),
      deleteAsset(existing.rows[0].selfie_public_id).catch(() => {}),
    ]);
  }
  res.status(201).json(rows[0]);
}

module.exports = { uploadVerificationFiles, getMyVerification, submitVerification };
