const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("module-alias/register");

const createServices = require("../../src/application/services");
const AutoNameService = require("../../src/application/services/AutoNameService");
const AutoNameScanService = require("../../src/application/services/AutoNameScanService");
const { deployCommands } = require("../../src/scripts/deploy-commands");

test("services factory composes Auto Name services from injected ports", () => {
  const logger = { info() {}, warn() {}, error() {} };
  const dependencies = {
    roomRepository: {}, configRepository: {}, roomGateway: {},
    autoNameConfigRepository: {}, autoNameCodeRepository: {}, autoNameAuditRepository: {},
    autoNameScanQueue: {}, autoNameNicknameGateway: {}, autoNameTelemetry: logger,
  };

  const services = createServices({ resolve: () => logger }, dependencies);

  assert.ok(services.autoNameService instanceof AutoNameService);
  assert.ok(services.autoNameScanService instanceof AutoNameScanService);
  assert.ok(services.autoNameTemplateService);
});

test("deploy body includes autoname in the complete guild command set", async () => {
  const calls = [];
  const result = await deployCommands({
    env: { TOKEN: "test-token-not-a-secret", CLIENT_ID: "10000000000000000", GUILD_ID: "20000000000000000" },
    rest: { async put(route, options) { calls.push({ route, options }); } },
    confirmReplacement: true,
  });

  assert.deepEqual(result.commandNames, ["ping", "help", "room", "room-setup", "autoname", "autorole", "ban", "kick", "unban", "timeout", "untimeout"]);
  assert.deepEqual(calls[0].options.body.map((command) => command.name), result.commandNames);
});

test("Bootstrap registers and wires Auto Name exactly once", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/core/bootstrap/Bootstrap.js"), "utf8");
  assert.equal((source.match(/commandRegistry\.register\(descriptor\.name, descriptor\.command, descriptor/g) || []).length, 1);
  assert.match(source, /commandManifest/);
  assert.match(source, /new AutoNameDatabase\(\)/);
  assert.match(source, /new DiscordNicknameGateway/);
  assert.match(source, /new InProcessAutoNameScanWorker/);
});
