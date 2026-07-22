const AUTO_ROOM_DATABASE_ERROR_CODES = Object.freeze({
  SCHEMA_INVALID: "AUTO_ROOM_SCHEMA_INVALID",
});

class AutoRoomDatabaseError extends Error {
  constructor(message = "Auto Voice Room database schema is invalid.", options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AutoRoomDatabaseError";
    this.code = AUTO_ROOM_DATABASE_ERROR_CODES.SCHEMA_INVALID;
  }
}

module.exports = AutoRoomDatabaseError;
module.exports.AUTO_ROOM_DATABASE_ERROR_CODES = AUTO_ROOM_DATABASE_ERROR_CODES;
