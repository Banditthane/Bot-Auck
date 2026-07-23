const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("module-alias/register");

const createServices = require("../../src/application/services");
const ModerationService = require("../../src/application/services/ModerationService");
const { deployCommands } = require("../../src/scripts/deploy-commands");

test("services factory composes ModerationService from injected gateway", () => {
  const logger = { info() {}, warn() {}, error() {} };
  const moderationGateway = {};
  const services = createServices({ resolve: () => logger }, {
    roomRepository: {},
    configRepository: {},
    roomGateway: {},
    moderationGateway,
    logger,
  });

  assert.ok(services.moderationService instanceof ModerationService);
  assert.equal(services.moderationService.gateway, moderationGateway);
});

test("deploy command body includes the moderation commands", async () => {
  const calls = [];
  const result = await deployCommands({
    env: {
      TOKEN: "test-token-not-a-secret",
      CLIENT_ID: "10000000000000000",
      GUILD_ID: "20000000000000000",
    },
    rest: { async put(route, options) { calls.push({ route, options }); } },
    confirmReplacement: true,
  });

  assert.deepEqual(result.commandNames, ["ping", "help", "room", "room-setup", "autoname", "autorole", "ban", "kick", "unban", "timeout", "untimeout"]);
  assert.deepEqual(calls[0].options.body.map((command) => command.name), result.commandNames);
});

test("Bootstrap registers each moderation command exactly once", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/core/bootstrap/Bootstrap.js"), "utf8");
  assert.match(source, /commandManifest/);
  assert.equal((source.match(/commandRegistry\.register\(descriptor\.name, descriptor\.command, descriptor/g) || []).length, 1);
});
