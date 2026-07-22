const IPC_TYPE = "AUCK_STARTUP_ERROR";
const IPC_VERSION = 1;
const MAX_SHARD_COUNT = 1000;

const PHASES = Object.freeze(["database", "bootstrap", "discord-login", "shard-manager"]);
const MESSAGES = Object.freeze({
  AUTO_ROOM_SCHEMA_INVALID: "Auto Voice Room database schema validation failed.",
  SQLITE_BUSY: "Database startup lock could not be acquired.",
  SQLITE_LOCKED: "Database startup lock could not be acquired.",
  UND_ERR_CONNECT_TIMEOUT: "Discord connection timed out.",
  SHARD_COUNT_INVALID: `SHARD_COUNT must be a positive integer from 1 to ${MAX_SHARD_COUNT}.`,
  SHARDING_READY_TIMEOUT: "A shard did not become ready before the startup deadline.",
  DISCORD_AUTH_REJECTED: "Discord rejected the bot credentials.",
  STARTUP_UNKNOWN: "Startup failed for an unknown reason.",
});
const ALLOWED_CODES = new Set(Object.keys(MESSAGES));
const ALLOWED_PHASES = new Set(PHASES);

function normalizeCode(value) {
  if (value === "ShardingReadyTimeout") return "SHARDING_READY_TIMEOUT";
  return ALLOWED_CODES.has(value) ? value : null;
}

function findStartupCode(error) {
  const visited = new Set();
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if ((typeof current !== "object" && typeof current !== "function") || visited.has(current)) break;
    visited.add(current);
    const code = normalizeCode(current.code) || normalizeCode(current.name);
    if (code) return code;
    if (current.status === 401 || current.response?.status === 401 || current.code === 401) {
      return "DISCORD_AUTH_REJECTED";
    }
    if (current.name === "AutoRoomDatabaseError" ||
      (current.name === "Error" && /^(?:Auto Voice Room )?Database schema\b/i.test(current.message || ""))) {
      return "AUTO_ROOM_SCHEMA_INVALID";
    }
    current = current.cause;
  }
  return "STARTUP_UNKNOWN";
}

function phaseForCode(code, fallback = "bootstrap") {
  if (["AUTO_ROOM_SCHEMA_INVALID", "SQLITE_BUSY", "SQLITE_LOCKED"].includes(code)) return "database";
  if (["UND_ERR_CONNECT_TIMEOUT", "DISCORD_AUTH_REJECTED"].includes(code)) return "discord-login";
  if (["SHARD_COUNT_INVALID", "SHARDING_READY_TIMEOUT"].includes(code)) return "shard-manager";
  return ALLOWED_PHASES.has(fallback) ? fallback : "bootstrap";
}

function sanitizeStartupError(error, { phase } = {}) {
  const code = findStartupCode(error);
  return Object.freeze({ code, phase: phaseForCode(code, phase), message: MESSAGES[code] });
}

function createStartupErrorPayload(error, options) {
  return Object.freeze({ type: IPC_TYPE, version: IPC_VERSION, ...sanitizeStartupError(error, options) });
}

function sanitizeStartupErrorPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const keys = Object.keys(payload).sort();
  if (keys.join(",") !== "code,message,phase,type,version") return null;
  if (payload.type !== IPC_TYPE || payload.version !== IPC_VERSION) return null;
  const code = normalizeCode(payload.code);
  if (!code || !ALLOWED_PHASES.has(payload.phase)) return null;
  if (payload.phase !== phaseForCode(code, payload.phase)) return null;
  return Object.freeze({ type: IPC_TYPE, version: IPC_VERSION, code, phase: payload.phase, message: MESSAGES[code] });
}

function formatStartupFailure(prefix, failure) {
  return `${prefix} Startup failed during ${failure.phase} (${failure.code}): ${failure.message}`;
}

module.exports = {
  IPC_TYPE, IPC_VERSION, MAX_SHARD_COUNT, PHASES, MESSAGES,
  sanitizeStartupError, createStartupErrorPayload, sanitizeStartupErrorPayload, formatStartupFailure,
};
