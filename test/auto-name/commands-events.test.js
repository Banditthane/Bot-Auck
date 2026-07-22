require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");

const command = require("../../src/interfaces/discord/commands/admin/auto-name/command");
const { AutoNameHandler } = require("../../src/interfaces/discord/commands/admin/auto-name/handler");
const memberAdd = require("../../src/interfaces/discord/events/member/guildMemberAdd");
const memberUpdate = require("../../src/interfaces/discord/events/member/guildMemberUpdate");
const DiscordNicknameGateway = require("../../src/infrastructure/providers/discord/DiscordNicknameGateway");
const LoggerAutoNameTelemetry = require("../../src/infrastructure/logging/LoggerAutoNameTelemetry");

function interactionFor(subcommand, values = {}) {
  const calls = [];
  const options = { getSubcommand: () => subcommand };
  for (const method of ["getRole", "getUser", "getString", "getInteger", "getBoolean"])
    options[method] = (name) => values[name] ?? null;
  return {
    calls,
    interaction: {
      id: "123456789012345678", guildId: "111111111111111111", user: { id: "222222222222222222" }, options,
      deferred: false, replied: false, inGuild: () => true,
      memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageNicknames },
      async deferReply(payload) { calls.push(["defer", payload]); this.deferred = true; },
      async editReply(payload) { calls.push(["edit", payload]); },
    },
  };
}

test("autoname schema is guild-only, permission guarded, and exposes all approved subcommands", () => {
  const json = command.data.toJSON();
  assert.equal(json.name, "autoname");
  assert.equal(json.dm_permission, false);
  assert.equal(json.default_member_permissions, PermissionFlagsBits.ManageNicknames.toString());
  assert.deepEqual(json.options.map((entry) => entry.name), ["setup", "template", "preview", "scan", "scan-status", "repair", "enable", "disable", "config"]);
  const setup = json.options[0];
  assert.equal(setup.options.find((entry) => entry.name === "required-role").required, true);
  assert.equal(setup.options.find((entry) => entry.name === "code-length").max_value, 12);
});

test("scan defers once with MessageFlags.Ephemeral and only enqueues a primitive DTO", async () => {
  const { interaction, calls } = interactionFor("scan", { "dry-run": true });
  let dto;
  const services = { autoNameService: {}, autoNameScanService: { async enqueue(value) { dto = value; return { job: {} }; } } };
  await new AutoNameHandler().execute({ interaction, container: { resolve: () => services } });
  assert.deepEqual(calls[0], ["defer", { flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.filter(([name]) => name === "defer").length, 1);
  assert.deepEqual(dto, { guildId: interaction.guildId, actorId: interaction.user.id, traceId: interaction.id, missingOnly: true, force: false, dryRun: true });
  assert.equal(calls.at(-1)[0], "edit");
});

test("guild and runtime permission checks happen before resolving services", async () => {
  const fixture = interactionFor("config");
  fixture.interaction.memberPermissions.has = () => false;
  let resolved = false;
  await new AutoNameHandler().execute({ interaction: fixture.interaction, container: { resolve() { resolved = true; } } });
  assert.equal(resolved, false);
  assert.match(fixture.calls.at(-1)[1].content, /Manage Nicknames/);
});

test("repair maps member directly and role repair to a bounded queue request", async () => {
  let assigned; let queued;
  const services = { autoNameService: { async assign(dto) { assigned = dto; } }, autoNameScanService: { async enqueue(dto) { queued = dto; } } };
  const memberFixture = interactionFor("repair", { member: { id: "333333333333333333" } });
  await new AutoNameHandler().execute({ interaction: memberFixture.interaction, container: { resolve: () => services } });
  assert.equal(assigned.userId, "333333333333333333");
  assert.equal(assigned.source, "repair");
  const roleFixture = interactionFor("repair", { role: { id: "444444444444444444" } });
  await new AutoNameHandler().execute({ interaction: roleFixture.interaction, container: { resolve: () => services } });
  assert.equal(queued.subsetRoleId, "444444444444444444");
  assert.equal(queued.force, true);
});

test("typed and unknown failures are rendered without raw error leakage", async () => {
  for (const error of [Object.assign(new Error("SECRET sql C:\\private\\db"), { code: "AUTO_NAME_TEMPLATE_INVALID" }), new Error("TOKEN=secret")]) {
    const fixture = interactionFor("template", { template: "{code}" });
    const services = { autoNameService: { async updateTemplate() { throw error; } }, autoNameScanService: {} };
    await new AutoNameHandler().execute({ interaction: fixture.interaction, container: { resolve: () => services } });
    const content = fixture.calls.at(-1)[1].content;
    assert.doesNotMatch(content, /SECRET|private|TOKEN|sql/i);
  }
});

test("member events send primitive assign DTOs and contain sanitized failures", async () => {
  const calls = []; const warnings = [];
  const service = { async assign(dto) { calls.push(dto); } };
  const container = { resolve(name) { return name === "services" ? { autoNameService: service } : { warn: (...args) => warnings.push(args) }; } };
  const base = { id: "555555555555555555", guild: { id: "111111111111111111" }, user: { bot: false }, roles: { cache: new Map([["a", {}]]) } };
  await memberAdd.execute({ container, args: [base] });
  await memberUpdate.execute({ container, args: [{ ...base, roles: { cache: new Map([["a", {}]]) } }, { ...base, roles: { cache: new Map([["a", {}], ["b", {}]]) } }] });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ source }) => source), ["join", "role-add"]);
  assert.equal(Object.values(calls[0]).some((value) => value && typeof value === "object"), false);
  service.assign = async () => { throw Object.assign(new Error("secret"), { code: "BAD\nSECRET" }); };
  await memberAdd.execute({ container, args: [base] });
  assert.equal(warnings[0][1].code, "AUTO_NAME_EVENT_FAILURE");
});

test("gateway refetches fresh facts and returns primitives", async () => {
  const fetched = [];
  const roleCache = new Map([["role", {}]]);
  const target = { id: "target", user: { username: "user", bot: false }, displayName: "display", nickname: null, manageable: true, permissions: { has: () => true }, roles: { cache: roleCache, highest: {} } };
  const bot = { ...target, id: "bot" };
  const actor = { ...target, id: "actor" };
  const members = { async fetch(input) { fetched.push(input); return input.user === "target" ? target : input.user === "actor" ? actor : bot; } };
  const guild = { ownerId: "owner", members, roles: { fetch: async () => ({ name: "Member" }) } };
  const gateway = new DiscordNicknameGateway({ user: { id: "bot" }, guilds: { cache: new Map([["guild", guild]]) } });
  const facts = await gateway.getMemberFacts({ guildId: "guild", userId: "target", actorId: "actor", requiredRoleId: "role" });
  assert.equal(fetched.every((input) => input.force === true), true);
  assert.equal(facts.targetHasRequiredRole, true);
  assert.equal(Object.values(facts).some((value) => value && typeof value === "object"), false);
});

test("telemetry allowlists and sanitizes structured context", () => {
  let record;
  const telemetry = new LoggerAutoNameTelemetry({ info: (...args) => { record = args; }, warn() {}, error() {} });
  telemetry.info("assigned\nsecret", { guildId: "guild\n", traceId: "trace", nickname: "private", secret: "token" });
  assert.equal(record[0], "Auto Name: assigned_secret");
  assert.deepEqual(record[1], { guildId: "guild_", traceId: "trace" });
});
