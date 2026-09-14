// A known, expected error (bad input, not found, conflict) as opposed to
// an unexpected bug. Lets the error middleware respond with the right
// status code and a clean message instead of a generic 500.
class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { AppError };
