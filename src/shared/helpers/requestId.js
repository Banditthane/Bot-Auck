const crypto = require("crypto");

/**
 * Generate unique request ID
 * Used for tracing logs across layers
 */
function createRequestId() {
  return crypto.randomUUID();
}

module.exports = {
  createRequestId
};