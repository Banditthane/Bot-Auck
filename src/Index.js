const path = require("path");
const {
  MAX_SHARD_COUNT,
  MESSAGES,
  sanitizeStartupError,
  sanitizeStartupErrorPayload,
  formatStartupFailure,
} = require("./shared/errors/StartupErrorSanitizer");

function invalidShardCount() {
  return Object.assign(new Error(MESSAGES.SHARD_COUNT_INVALID), { code: "SHARD_COUNT_INVALID" });
}

function parseShardCount(value) {
  if (value === undefined || value === null) return 1;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw invalidShardCount();
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count > MAX_SHARD_COUNT) throw invalidShardCount();
  return count;
}

function validateToken(token) {
  if (!token) throw new Error("Bot TOKEN is required.");
  return token;
}

function createManager({ token, shardCount, Manager = require("discord.js").ShardingManager,
  shardFile = path.join(__dirname, "Shard.js") } = {}) {
  return new Manager(shardFile, { token: validateToken(token), totalShards: shardCount, respawn: true });
}

function attachShardDiagnostics(manager, { logger = console, failures = new Map() } = {}) {
  manager.on("shardCreate", (shard) => {
    logger.log(`[ShardManager] Spawned shard ${shard.id}`);
    shard.on("message", (message) => {
      const failure = sanitizeStartupErrorPayload(message);
      if (failure) failures.set(shard.id, failure);
    });
  });
  return failures;
}

function latestFailure(failures) {
  if (!(failures instanceof Map) || failures.size === 0) return null;
  return Array.from(failures.values()).at(-1) || null;
}

function describeManagerFailure(error, failures = new Map()) {
  const downstream = sanitizeStartupError(error, { phase: "shard-manager" });
  const root = latestFailure(failures);
  if (root && downstream.code === "SHARDING_READY_TIMEOUT") {
    return `${formatStartupFailure("[ShardManager] Root cause:", root)} ` +
      `Downstream failure (${downstream.code}): ${downstream.message}`;
  }
  if (downstream.code === "UND_ERR_CONNECT_TIMEOUT") {
    return `${formatStartupFailure("[ShardManager]", downstream)} ` +
      "Check DNS, firewall, VPN, or proxy access to discord.com:443.";
  }
  return formatStartupFailure("[ShardManager]", downstream);
}

async function main({ env = process.env, configureEnv = () => require("dotenv").config(), Manager,
  logger = console, processRef = process, shardFile } = {}) {
  const failures = new Map();
  try {
    configureEnv();
    const manager = createManager({ token: env.TOKEN, shardCount: parseShardCount(env.SHARD_COUNT), Manager, shardFile });
    attachShardDiagnostics(manager, { logger, failures });
    await manager.spawn();
    return manager;
  } catch (error) {
    logger.error(describeManagerFailure(error, failures));
    processRef.exitCode = 1;
    return null;
  }
}

if (require.main === module) void main();

module.exports = { parseShardCount, validateToken, createManager, attachShardDiagnostics, describeManagerFailure, main };
