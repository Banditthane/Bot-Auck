const { RoomValidationError } = require("../errors/RoomErrors");

const MODES = Object.freeze(["open", "locked", "hidden"]);

function assertMode(mode) {
  if (!MODES.includes(mode)) {
    throw new RoomValidationError(`Unsupported room mode: ${mode}`, { mode });
  }
  return mode;
}

function permissionsForMode(mode) {
  assertMode(mode);

  if (mode === "hidden") {
    return { viewChannel: false, connect: false };
  }
  if (mode === "locked") {
    return { viewChannel: true, connect: false };
  }
  return { viewChannel: null, connect: true };
}

function mayManageRoom({ actorId, ownerId, adminOverride = false }) {
  return Boolean(adminOverride || (actorId && actorId === ownerId));
}

module.exports = {
  MODES,
  assertMode,
  permissionsForMode,
  mayManageRoom,
};
