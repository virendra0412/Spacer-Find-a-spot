// Wrap async route handlers so thrown errors reach Express's error
// middleware instead of becoming unhandled promise rejections.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
