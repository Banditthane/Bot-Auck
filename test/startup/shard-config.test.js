const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  parseShardCount,
  createManager,
  main,
} = require("../../src/Index");

test("SHARD_COUNT defaults to numeric one and accepts bounded positive integers", () => {
  assert.equal(parseShardCount(undefined), 1);
  assert.equal(parseShardCount("1"), 1);
  assert.equal(parseShardCount("12"), 12);
  assert.equal(typeof parseShardCount("12"), "number");
});

test("SHARD_COUNT rejects zero, negative, fractional, non-numeric, unsafe, and excessive values", () => {
  for (const value of ["", "0", "-1", "1.5", "abc", " 1", "01", "1001", "9007199254740992", 2]) {
    assert.throws(() => parseShardCount(value), (error) => {
      assert.equal(error.code, "SHARD_COUNT_INVALID");
      assert.doesNotMatch(error.message, /TOKEN|secret/i);
      return true;
    });
  }
});

test("fake ShardingManager receives numeric totalShards without network", () => {
  let received;
  class FakeManager {
    constructor(file, options) { received = { file, options }; }
  }
  createManager({ token: "test-token", shardCount: 4, Manager: FakeManager, shardFile: "fake-shard.js" });
  assert.equal(received.file, "fake-shard.js");
  assert.equal(received.options.totalShards, 4);
  assert.equal(typeof received.options.totalShards, "number");
  assert.equal(received.options.respawn, true);
});

test("main uses injected manager and never reads dotenv or creates a real shard", async () => {
  let configured = false;
  let options;
  class FakeManager extends EventEmitter {
    constructor(file, managerOptions) { super(); options = managerOptions; }
    async spawn() { this.spawned = true; }
  }
  const processRef = { exitCode: 0 };
  const manager = await main({
    env: { TOKEN: "fake-token", SHARD_COUNT: "7" },
    configureEnv() { configured = true; },
    Manager: FakeManager,
    logger: { log() {}, error() { throw new Error("unexpected failure"); } },
    processRef,
    shardFile: "fake-shard.js",
  });
  assert.equal(configured, true);
  assert.equal(manager.spawned, true);
  assert.equal(options.totalShards, 7);
  assert.equal(processRef.exitCode, 0);
});

test("invalid shard configuration fails before manager creation with safe output", async () => {
  let constructed = false;
  class FakeManager { constructor() { constructed = true; } }
  const logs = [];
  const processRef = { exitCode: 0 };
  const result = await main({
    env: { TOKEN: "TOKEN=do-not-print", SHARD_COUNT: "0 SECRET SQL C:\\db.sqlite" },
    configureEnv() {},
    Manager: FakeManager,
    logger: { log() {}, error(message) { logs.push(message); } },
    processRef,
  });
  assert.equal(result, null);
  assert.equal(constructed, false);
  assert.equal(processRef.exitCode, 1);
  assert.match(logs[0], /SHARD_COUNT_INVALID/);
  assert.doesNotMatch(logs[0], /do-not-print|SECRET|SQL|db\.sqlite/);
});

test("spawn timeout summary keeps child root before downstream error", async () => {
  class FakeManager extends EventEmitter {
    async spawn() {
      const shard = new EventEmitter();
      shard.id = 0;
      this.emit("shardCreate", shard);
      shard.emit("message", {
        type: "AUCK_STARTUP_ERROR", version: 1,
        code: "AUTO_ROOM_SCHEMA_INVALID", phase: "database", message: "TOKEN SQL C:\\secret.sqlite",
      });
      throw Object.assign(new Error("raw downstream stack"), { code: "ShardingReadyTimeout" });
    }
  }
  const logs = [];
  await main({
    env: { TOKEN: "fake", SHARD_COUNT: "1" }, configureEnv() {}, Manager: FakeManager,
    logger: { log() {}, error(message) { logs.push(message); } }, processRef: { exitCode: 0 },
  });
  assert.ok(logs[0].indexOf("AUTO_ROOM_SCHEMA_INVALID") < logs[0].indexOf("SHARDING_READY_TIMEOUT"));
  assert.doesNotMatch(logs[0], /TOKEN SQL|secret\.sqlite|raw downstream/);
});
