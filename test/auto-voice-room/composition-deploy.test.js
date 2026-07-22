const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("module-alias/register");

const AutoRoomService = require("../../src/application/services/AutoRoomService");
const createServices = require("../../src/application/services");
const readyEvent = require("../../src/interfaces/discord/events/client/ready");
const { deployCommands } = require("../../src/scripts/deploy-commands");

test("services factory composes AutoRoomService from injected ports", () => {
  const logger = { info() {}, warn() {}, error() {} };
  const container = { resolve(name) { assert.equal(name, "logger"); return logger; } };
  const dependencies = {
    roomRepository: {},
    configRepository: {},
    roomGateway: {},
  };
  const services = createServices(container, dependencies);

  assert.ok(services.autoRoomService instanceof AutoRoomService);
  assert.equal(services.autoRoomService.rooms, dependencies.roomRepository);
  assert.equal(services.autoRoomService.configs, dependencies.configRepository);
  assert.equal(services.autoRoomService.gateway, dependencies.roomGateway);
  assert.ok(services.pingService);
  assert.ok(services.memberService);
});

test("ready event awaits reconciliation and logs its result", async () => {
  const events = [];
  const logger = {
    info(message, context) { events.push({ level: "info", message, context }); },
    warn(message, context) { events.push({ level: "warn", message, context }); },
    error(message, context) { events.push({ level: "error", message, context }); },
  };
  let reconciled = 0;
  const services = {
    autoRoomService: {
      async reconcile() {
        reconciled += 1;
        return { staleRecordsRemoved: 2 };
      },
    },
  };
  const container = { resolve(name) { return name === "logger" ? logger : services; } };

  await readyEvent.execute({ client: { user: { tag: "Bot#0001" }, shard: { ids: [2] } }, container });

  assert.equal(reconciled, 1);
  assert.ok(events.some((entry) => entry.message === "Auto Voice Room reconciliation completed."));
  assert.equal(events.at(-1).context.staleRecordsRemoved, 2);
});

test("ready event contains reconciliation failure and records a sanitized code", async () => {
  const errors = [];
  const logger = { info() {}, warn() {}, error(message, context) { errors.push({ message, context }); } };
  const services = { autoRoomService: { async reconcile() { throw Object.assign(new Error("boom"), { code: "DB_BUSY" }); } } };
  const container = { resolve(name) { return name === "logger" ? logger : services; } };

  await readyEvent.execute({ client: { user: { tag: "Bot#0001" } }, container });

  assert.deepEqual(errors, [{
    message: "Auto Voice Room reconciliation failed.",
    context: { shardId: 0, code: "DB_BUSY" },
  }]);
});

test("guild deployment requires confirmation and replaces with the full local command set", async () => {
  const env = {
    TOKEN: "test-token-not-a-secret",
    CLIENT_ID: "10000000000000000",
    GUILD_ID: "20000000000000000",
  };
  await assert.rejects(
    deployCommands({ env, rest: { put: async () => {} } }),
    (error) => error.code === "REPLACEMENT_CONFIRMATION_REQUIRED"
  );

  const calls = [];
  const rest = { async put(route, options) { calls.push({ route, options }); } };
  const result = await deployCommands({ env, rest, confirmReplacement: true });

  assert.deepEqual(result, {
    count: 3,
    scope: "guild",
    commandNames: ["ping", "room", "room-setup"],
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.body.map((command) => command.name), ["ping", "room", "room-setup"]);
  const submittedRoom = calls[0].options.body.find((command) => command.name === "room");
  assert.equal(submittedRoom.options.filter((option) => option.name === "help").length, 1);
  assert.equal(calls[0].route, "/applications/10000000000000000/guilds/20000000000000000/commands");
});

test("Bootstrap creates the client before the Discord gateway and registers each command once", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/core/bootstrap/Bootstrap.js"), "utf8");
  assert.ok(source.indexOf("createBot(container)") < source.indexOf("new DiscordRoomGateway"));
  for (const name of ["pingCommand", "roomCommand", "roomSetupCommand"]) {
    const matches = source.match(new RegExp(`commandRegistry\\.register\\(${name}\\.data\\.name`, "g")) || [];
    assert.equal(matches.length, 1, name);
  }
});

test("owned production files do not use deprecated ephemeral booleans", () => {
  const files = [
    "src/interfaces/discord/commands/room/handler.js",
    "src/interfaces/discord/commands/admin/room-setup/handler.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    assert.doesNotMatch(source, /\bephemeral\s*:/, file);
  }
});
