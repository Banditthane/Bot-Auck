const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const {
  createStartupErrorPayload,
  sanitizeStartupError,
  sanitizeStartupErrorPayload,
} = require("../../src/shared/errors/StartupErrorSanitizer");
const { reportShardFailure } = require("../../src/Shard");
const {
  attachShardDiagnostics,
  describeManagerFailure,
} = require("../../src/Index");

const SECRET = "TOKEN=secret C:\\private\\rooms.sqlite SELECT * FROM rooms\nstack row-content";

test("plain and nested schema failures become stable database errors", () => {
  const plain = sanitizeStartupError(new Error("Database schema v4 reservation constraint is invalid at C:\\secret.sqlite"));
  assert.deepEqual(plain, {
    code: "AUTO_ROOM_SCHEMA_INVALID",
    phase: "database",
    message: "Auto Voice Room database schema validation failed.",
  });
  const nested = sanitizeStartupError(new Error(SECRET, {
    cause: Object.assign(new Error(SECRET), { code: "AUTO_ROOM_SCHEMA_INVALID" }),
  }));
  assert.equal(nested.code, "AUTO_ROOM_SCHEMA_INVALID");
  assert.equal(JSON.stringify(nested).includes(SECRET), false);
});

test("child log and typed IPC never expose raw error content", () => {
  const sent = [];
  const logged = [];
  const processRef = { send(payload) { sent.push(payload); }, exitCode: 0 };
  const error = Object.assign(new Error(SECRET), { code: "AUTO_ROOM_SCHEMA_INVALID", stack: SECRET });
  const payload = reportShardFailure(error, {
    processRef,
    logger: { error(message) { logged.push(message); } },
  });
  assert.deepEqual(payload, {
    type: "AUCK_STARTUP_ERROR",
    version: 1,
    code: "AUTO_ROOM_SCHEMA_INVALID",
    phase: "database",
    message: "Auto Voice Room database schema validation failed.",
  });
  assert.deepEqual(sent, [payload]);
  assert.equal(processRef.exitCode, 1);
  assert.equal(JSON.stringify({ sent, logged }).includes(SECRET), false);
});

test("unknown failures use generic copy and never raw messages", () => {
  const sanitized = sanitizeStartupError(new Error(SECRET));
  assert.deepEqual(sanitized, {
    code: "STARTUP_UNKNOWN",
    phase: "bootstrap",
    message: "Startup failed for an unknown reason.",
  });
  assert.equal(JSON.stringify(sanitized).includes(SECRET), false);
});

test("manager accepts only typed allowlisted IPC and rebuilds its message", () => {
  const manager = new EventEmitter();
  const shard = new EventEmitter();
  shard.id = 3;
  const failures = attachShardDiagnostics(manager, { logger: { log() {} } });
  manager.emit("shardCreate", shard);
  shard.emit("message", {
    type: "AUCK_STARTUP_ERROR", version: 1,
    code: "AUTO_ROOM_SCHEMA_INVALID", phase: "database", message: SECRET,
  });
  assert.equal(failures.get(3).message, "Auto Voice Room database schema validation failed.");
  for (const malformed of [
    null,
    { type: "other", version: 1, code: "AUTO_ROOM_SCHEMA_INVALID", phase: "database" },
    { type: "AUCK_STARTUP_ERROR", version: 1, code: "AUTO_ROOM_SCHEMA_INVALID", phase: "database", message: "safe", extra: true },
    { type: "AUCK_STARTUP_ERROR", version: 1, code: SECRET, phase: "database", message: SECRET },
    { type: "AUCK_STARTUP_ERROR", version: 1, code: "AUTO_ROOM_SCHEMA_INVALID", phase: "discord-login", message: SECRET },
  ]) shard.emit("message", malformed);
  assert.equal(failures.size, 1);
  assert.equal(sanitizeStartupErrorPayload({ type: "AUCK_STARTUP_ERROR", version: 99 }), null);
});

test("manager reports trusted child root before downstream ready timeout", () => {
  const root = createStartupErrorPayload(Object.assign(new Error(SECRET), { code: "AUTO_ROOM_SCHEMA_INVALID" }));
  const failures = new Map([[0, root]]);
  const summary = describeManagerFailure(Object.assign(new Error(SECRET), { code: "ShardingReadyTimeout" }), failures);
  assert.ok(summary.indexOf("AUTO_ROOM_SCHEMA_INVALID") < summary.indexOf("SHARDING_READY_TIMEOUT"));
  assert.equal(summary.includes(SECRET), false);
});

test("network timeout remains separate and does not claim a schema failure", () => {
  const summary = describeManagerFailure(Object.assign(new Error(SECRET), { code: "UND_ERR_CONNECT_TIMEOUT" }));
  assert.match(summary, /UND_ERR_CONNECT_TIMEOUT/);
  assert.doesNotMatch(summary, /AUTO_ROOM_SCHEMA_INVALID/);
  assert.equal(summary.includes(SECRET), false);
});

test("importing shard entrypoints has no startup or exit side effect", () => {
  const root = path.resolve(__dirname, "../..");
  const result = spawnSync(process.execPath, ["-e", [
    "const before=process.exitCode;",
    "require('./src/Shard'); require('./src/Index');",
    "if(process.exitCode!==before) process.exit(9);",
  ].join("")], { cwd: root, encoding: "utf8", env: {} });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
