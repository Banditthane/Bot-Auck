const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType, MessageFlags, PermissionFlagsBits } = require("discord.js");

const roomCommand = require("../../src/interfaces/discord/commands/room/command");
const roomSetupCommand = require("../../src/interfaces/discord/commands/admin/room-setup/command");
const { RoomCommandHandler } = require("../../src/interfaces/discord/commands/room/handler");
const { RoomSetupHandler } = require("../../src/interfaces/discord/commands/admin/room-setup/handler");
const { DEFAULT_NUMBERED_NAME_TEMPLATE } = require("../../src/interfaces/discord/commands/admin/room-setup/handler");
const { RoomAuthorizationError } = require("../../src/domain/errors/RoomErrors");

function containerWith(service) {
  return { resolve: (name) => {
    assert.equal(name, "services");
    return { autoRoomService: service };
  } };
}

function roomInteraction({ subcommand = "lock", values = {}, manageChannels = false, replied = false } = {}) {
  const calls = { defer: [], edit: [], reply: [], follow: [] };
  const interaction = {
    guildId: "10000000000000000",
    user: { id: "30000000000000000" },
    member: { voice: { channelId: "40000000000000000" } },
    memberPermissions: { has: () => manageChannels },
    deferred: false,
    replied,
    options: {
      getSubcommand: () => subcommand,
      getUser: () => ({ id: values.userId || "30100000000000000" }),
      getInteger: () => values.number,
      getString: () => values.name,
    },
    async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
    async editReply(payload) { calls.edit.push(payload); },
    async reply(payload) { calls.reply.push(payload); this.replied = true; },
    async followUp(payload) { calls.follow.push(payload); },
  };
  return { interaction, calls };
}

test("room command publishes the MVP controls and deliberately omits PIN", () => {
  const json = roomCommand.data.toJSON();
  assert.equal(json.name, "room");
  assert.equal(json.options.filter((option) => option.name === "help").length, 1);
  assert.deepEqual(
    json.options.map((option) => option.name),
    ["help", "panel", "lock", "unlock", "hide", "invite", "deny", "kick", "limit", "rename", "transfer"]
  );
  assert.doesNotMatch(JSON.stringify(json), /\bpin\b/i);
});

test("room help is ephemeral and works without a managed voice room", async () => {
  const { interaction, calls } = roomInteraction({ subcommand: "help" });
  interaction.member.voice.channelId = null;
  let resolved = false;
  const container = { resolve() { resolved = true; throw new Error("service should not be resolved"); } };

  await new RoomCommandHandler().execute({ interaction, container });

  assert.equal(resolved, false);
  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit.length, 1);
  assert.match(calls.edit[0].content, /คู่มือใช้งาน/);
  assert.match(calls.edit[0].content, /\/room-setup/);
  assert.match(calls.edit[0].content, /\/room lock/);
  assert.match(calls.edit[0].content, /ଘ 🍵 ～ﾉ « 1 »/u);
  assert.match(calls.edit[0].content, /\{number\}/);
  assert.match(calls.edit[0].content, /\/room rename/);
});

test("room handler acknowledges once with MessageFlags.Ephemeral and maps lock", async () => {
  const { interaction, calls } = roomInteraction();
  const serviceCalls = [];
  const service = { async setMode(input) { serviceCalls.push(input); } };

  await new RoomCommandHandler().execute({ interaction, container: containerWith(service) });

  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.reply.length, 0);
  assert.equal(calls.follow.length, 0);
  assert.deepEqual(calls.edit, [{ content: "Voice room locked." }]);
  assert.deepEqual(serviceCalls, [{
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    channelId: interaction.member.voice.channelId,
    adminOverride: false,
    mode: "locked",
  }]);
});

test("known authorization failures remain ephemeral and do not double acknowledge", async () => {
  const { interaction, calls } = roomInteraction();
  const service = {
    async setMode() { throw new RoomAuthorizationError({ actorId: interaction.user.id }); },
  };

  await new RoomCommandHandler().execute({ interaction, container: containerWith(service) });

  assert.equal(calls.defer.length, 1);
  assert.equal(calls.edit.length, 1);
  assert.match(calls.edit[0].content, /owner|manager/i);
  assert.equal(calls.reply.length + calls.follow.length, 0);
});

test("room handler maps every remaining owner control to the frozen service API", async () => {
  const cases = [
    ["unlock", {}, "setMode", (input) => assert.equal(input.mode, "open")],
    ["hide", {}, "setMode", (input) => assert.equal(input.mode, "hidden")],
    ["invite", { userId: "30200000000000000" }, "inviteUser", (input) => assert.equal(input.userId, "30200000000000000")],
    ["deny", { userId: "30200000000000000" }, "denyUser", (input) => assert.equal(input.userId, "30200000000000000")],
    ["kick", { userId: "30200000000000000" }, "kickUser", (input) => assert.equal(input.userId, "30200000000000000")],
    ["limit", { number: 7 }, "setLimit", (input) => assert.equal(input.userLimit, 7)],
    ["rename", { name: "New Room" }, "rename", (input) => assert.equal(input.name, "New Room")],
    ["transfer", { userId: "30200000000000000" }, "transfer", (input) => assert.equal(input.userId, "30200000000000000")],
  ];

  for (const [subcommand, values, expectedMethod, verify] of cases) {
    const { interaction, calls } = roomInteraction({ subcommand, values });
    let invoked;
    const service = new Proxy({}, {
      get(_target, property) {
        return async (input) => {
          invoked = { property, input };
          return property === "rename" ? { name: "New Room" } : true;
        };
      },
    });

    await new RoomCommandHandler().execute({ interaction, container: containerWith(service) });

    assert.equal(invoked.property, expectedMethod, subcommand);
    assert.equal(invoked.input.guildId, interaction.guildId, subcommand);
    assert.equal(invoked.input.channelId, interaction.member.voice.channelId, subcommand);
    verify(invoked.input);
    assert.equal(calls.defer.length, 1, subcommand);
    assert.equal(calls.edit.length, 1, subcommand);
  }
});

test("an already-replied panel uses an ephemeral follow-up without a second acknowledgement", async () => {
  const { interaction, calls } = roomInteraction({ subcommand: "panel", replied: true });
  const service = {
    getManagedRoom: () => ({
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
      mode: "open",
      userLimit: 0,
    }),
  };

  await new RoomCommandHandler().execute({ interaction, container: containerWith(service) });

  assert.equal(calls.defer.length, 0);
  assert.equal(calls.edit.length, 0);
  assert.equal(calls.follow.length, 1);
  assert.equal(calls.follow[0].flags, MessageFlags.Ephemeral);
});

test("room setup requires Manage Channels and passes primitive configuration", async () => {
  const setupJson = roomSetupCommand.data.toJSON();
  assert.equal(setupJson.name, "room-setup");
  assert.equal(setupJson.default_member_permissions, PermissionFlagsBits.ManageChannels.toString());
  const categoryOption = setupJson.options.find((option) => option.name === "category");
  assert.equal(categoryOption.required ?? false, false);
  assert.deepEqual(categoryOption.channel_types, [ChannelType.GuildCategory]);
  const nameTemplateOption = setupJson.options.find((option) => option.name === "name-template");
  assert.match(nameTemplateOption.description, /\{number\}.*number/i);

  const calls = { defer: [], edit: [] };
  const interaction = {
    guildId: "10000000000000000",
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageChannels },
    deferred: false,
    replied: false,
    options: {
      getChannel(name) {
        return ({
          trigger: { id: "40000000000000000", parentId: "50000000000000000" },
          category: null,
          "log-channel": null,
        })[name];
      },
      getRole: () => null,
      getString: () => null,
      getInteger: (name) => name === "default-limit" ? 4 : 8,
    },
    async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
    async editReply(payload) { calls.edit.push(payload); },
  };
  const configurations = [];
  const service = {
    getGuildConfig() { return null; },
    async configureGuild(input) {
      configurations.push(input);
      return input;
    },
  };

  await new RoomSetupHandler().execute({ interaction, container: containerWith(service) });

  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit.length, 1);
  assert.deepEqual(configurations, [{
    guildId: interaction.guildId,
    triggerChannelId: "40000000000000000",
    categoryId: "50000000000000000",
    logChannelId: null,
    moderatorRoleId: null,
    defaultNameTemplate: DEFAULT_NUMBERED_NAME_TEMPLATE,
    defaultUserLimit: 4,
    emptyDeleteDelaySeconds: 8,
    enabled: true,
  }]);
});

test("room setup gives an explicitly selected category precedence over the trigger parent", async () => {
  const calls = { defer: [], edit: [] };
  const interaction = {
    guildId: "10000000000000000",
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    options: {
      getChannel(name) {
        return ({
          trigger: { id: "40000000000000000", parentId: "50000000000000000" },
          category: { id: "60000000000000000" },
          "log-channel": null,
        })[name];
      },
      getRole: () => null,
      getString: () => null,
      getInteger: () => null,
    },
    async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
    async editReply(payload) { calls.edit.push(payload); },
  };
  const configurations = [];
  const service = {
    getGuildConfig() { return null; },
    async configureGuild(input) {
      configurations.push(input);
      return input;
    },
  };

  await new RoomSetupHandler().execute({ interaction, container: containerWith(service) });

  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit.length, 1);
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].categoryId, "60000000000000000");
});

test("room setup omission preserves an existing stored name template", async () => {
  const calls = { defer: [], edit: [] };
  const interaction = {
    guildId: "10000000000000000",
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    options: {
      getChannel(name) {
        return name === "trigger"
          ? { id: "40000000000000000", parentId: "50000000000000000" }
          : null;
      },
      getRole: () => null,
      getString: () => null,
      getInteger: () => null,
    },
    async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
    async editReply(payload) { calls.edit.push(payload); },
  };
  const existingTemplate = "Legacy {displayName} room";
  const configurations = [];
  const service = {
    getGuildConfig(guildId) {
      assert.equal(guildId, interaction.guildId);
      return { defaultNameTemplate: existingTemplate, nextRoomNumber: 47 };
    },
    async configureGuild(input) {
      configurations.push(input);
      return input;
    },
  };

  await new RoomSetupHandler().execute({ interaction, container: containerWith(service) });

  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit.length, 1);
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].defaultNameTemplate, existingTemplate);
  assert.equal(Object.hasOwn(configurations[0], "nextRoomNumber"), false);
});

test("room setup passes an explicit numbered template unchanged without reading existing config", async () => {
  const calls = { defer: [], edit: [] };
  const explicitTemplate = "Tea room {number} — {displayName}";
  const interaction = {
    guildId: "10000000000000000",
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    options: {
      getChannel(name) {
        return name === "trigger"
          ? { id: "40000000000000000", parentId: "50000000000000000" }
          : null;
      },
      getRole: () => null,
      getString: (name) => name === "name-template" ? explicitTemplate : null,
      getInteger: () => null,
    },
    async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
    async editReply(payload) { calls.edit.push(payload); },
  };
  const configurations = [];
  const service = {
    getGuildConfig() { throw new Error("existing config must not be read for an explicit template"); },
    async configureGuild(input) {
      configurations.push(input);
      return input;
    },
  };

  await new RoomSetupHandler().execute({ interaction, container: containerWith(service) });

  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit.length, 1);
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].defaultNameTemplate, explicitTemplate);
});

test("room setup explains how to fix a trigger without a category", async () => {
  const calls = { defer: [], edit: [] };
  const interaction = {
    guildId: "10000000000000000",
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    options: {
      getChannel: (name) => name === "trigger" ? { id: "40000000000000000", parentId: null } : null,
      getRole: () => null,
      getString: () => null,
      getInteger: () => null,
    },
    async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
    async editReply(payload) { calls.edit.push(payload); },
  };
  let configured = false;
  const service = { async configureGuild() { configured = true; } };

  await new RoomSetupHandler().execute({ interaction, container: containerWith(service) });

  assert.equal(configured, false);
  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit.length, 1);
  assert.match(calls.edit[0].content, /Select a category|trigger voice channel/i);
});

test("room setup denies missing Manage Channels without configuring", async () => {
  const { interaction, calls } = roomInteraction();
  interaction.memberPermissions = { has: () => false };
  let configured = false;
  const service = { async configureGuild() { configured = true; } };

  await new RoomSetupHandler().execute({ interaction, container: containerWith(service) });

  assert.equal(configured, false);
  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.match(calls.edit[0].content, /Manage Channels/);
});
