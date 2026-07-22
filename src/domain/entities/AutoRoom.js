const { assertMode } = require("../policies/RoomPermissionPolicy");
const { RoomValidationError } = require("../errors/RoomErrors");

const SYSTEM_MARKER = "auto_voice_room:v1";

function requiredId(value, field) {
  if (typeof value !== "string" || !/^\d{1,32}$/.test(value)) {
    throw new RoomValidationError(`${field} must be a Discord snowflake string.`, { field });
  }
  return value;
}

function validLimit(value) {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new RoomValidationError("userLimit must be an integer from 0 to 99.", { userLimit: value });
  }
  return value;
}

class AutoRoom {
  constructor({
    guildId,
    channelId,
    ownerId,
    triggerChannelId,
    mode = "open",
    userLimit = 0,
    pinHash = null,
    systemMarker = SYSTEM_MARKER,
    createdAt = Date.now(),
    updatedAt = createdAt,
    lastRenamedAt = null,
    roomNumber = null,
  }) {
    this.guildId = requiredId(guildId, "guildId");
    this.channelId = requiredId(channelId, "channelId");
    this.ownerId = requiredId(ownerId, "ownerId");
    this.triggerChannelId = requiredId(triggerChannelId, "triggerChannelId");
    this.mode = assertMode(mode);
    this.userLimit = validLimit(userLimit);
    this.pinHash = pinHash;
    this.systemMarker = systemMarker;
    this.createdAt = Number(createdAt);
    this.updatedAt = Number(updatedAt);
    this.lastRenamedAt = lastRenamedAt === null ? null : Number(lastRenamedAt);
    this.roomNumber = roomNumber === null ? null : Number(roomNumber);

    if (this.systemMarker !== SYSTEM_MARKER) {
      throw new RoomValidationError("Managed room marker is invalid.");
    }
    if (![this.createdAt, this.updatedAt].every(Number.isFinite)) {
      throw new RoomValidationError("Room timestamps must be finite numbers.");
    }
    if (this.roomNumber !== null && (!Number.isInteger(this.roomNumber) || this.roomNumber < 1)) {
      throw new RoomValidationError("roomNumber must be null or a positive integer.");
    }
  }

  static get SYSTEM_MARKER() {
    return SYSTEM_MARKER;
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = AutoRoom;
