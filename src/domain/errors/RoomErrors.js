class RoomError extends Error {
  constructor(message, code = "ROOM_ERROR", details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

class RoomValidationError extends RoomError {
  constructor(message, details) {
    super(message, "ROOM_VALIDATION", details);
  }
}

class RoomNotFoundError extends RoomError {
  constructor(details) {
    super("Managed voice room was not found.", "ROOM_NOT_FOUND", details);
  }
}

class RoomAuthorizationError extends RoomError {
  constructor(details) {
    super("Only the room owner or a server manager may perform this action.", "ROOM_FORBIDDEN", details);
  }
}

class RoomConflictError extends RoomError {
  constructor(message, details) {
    super(message, "ROOM_CONFLICT", details);
  }
}

module.exports = {
  RoomError,
  RoomValidationError,
  RoomNotFoundError,
  RoomAuthorizationError,
  RoomConflictError,
};
