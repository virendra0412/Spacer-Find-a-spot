const { v2: cloudinary } = require('cloudinary');
const { AppError } = require('../utils/AppError');

const configured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

function requireCloudinary() {
  if (!configured) {
    throw new AppError(503, 'Cloudinary is not configured');
  }
  return cloudinary;
}

function uploadBuffer(buffer, options) {
  const client = requireCloudinary();
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

async function deleteAsset(publicId) {
  if (!publicId) return;
  await requireCloudinary().uploader.destroy(publicId, { resource_type: 'image' });
}

module.exports = { uploadBuffer, deleteAsset };
