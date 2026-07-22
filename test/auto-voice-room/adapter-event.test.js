const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DiscordConfig = require("../../src/infrastructure/config/DiscordConfig");
const DiscordRoomGateway = require("../../src/infrastructure/providers/discord/DiscordRoomGateway");
const voiceEvent = require("../../src/interfaces/discord/events/voice/voiceStateUpdate");
const { PermissionFlagsBits } = require("discord.js");

test("Discord config includes GuildVoiceStates intent", () => {
  const options = new DiscordConfig({}).getClientOptions();
  assert.ok(options.intents.includes("GuildVoiceStates"));
});

test("gateway maps locked mode and owner permissions without network", async () => {
  let createOptions;
  const guild = {
    id: "100",
    channels: {
      cache: new Map(),
      async create(options) { createOptions = options; return { id: "900" }; },
    },
  };
  const client = {
    user: { id: "999" },
    guilds: { cache: new Map([["100", guild]]) },
  };
  const gateway = new DiscordRoomGateway(client);
  assert.deepEqual(await gateway.createRoom({
    guildId: "100", categoryId: "500", name: "Room", userLimit: 2, ownerId: "300",
    moderatorRoleId: "700", mode: "locked",
  }), { channelId: "900" });

  const everyone = createOptions.permissionOverwrites.find((entry) => entry.id === "100");
  const owner = createOptions.permissionOverwrites.find((entry) => entry.id === "300");
  const moderator = createOptions.permissionOverwrites.find((entry) => entry.id === "700");
  assert.deepEqual(everyone.allow, [PermissionFlagsBits.ViewChannel]);
  assert.deepEqual(everyone.deny, [PermissionFlagsBits.Connect]);
  assert.deepEqual(owner.allow, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.MoveMembers,
  ]);
  assert.deepEqual(moderator.allow, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
  ]);
  assert.equal(moderator.allow.includes(PermissionFlagsBits.ManageChannels), false);
  assert.equal(moderator.allow.includes(PermissionFlagsBits.MoveMembers), false);
  assert.equal(createOptions.userLimit, 2);
});

test("gateway maps open/locked/hidden and grant/deny overwrites exactly", async () => {
  const edits = [];
  const channel = {
    permissionOverwrites: {
      async edit(id, options, metadata) { edits.push({ id, options, metadata }); },
    },
  };
  const guild = { id: "100", channels: { cache: new Map([["778", channel]]) } };
  const client = { guilds: { cache: new Map([["100", guild]]) } };
  const gateway = new DiscordRoomGateway(client);

  await gateway.setRoomMode({ guildId: "100", channelId: "778", mode: "open" });
  await gateway.setRoomMode({ guildId: "100", channelId: "778", mode: "locked" });
  await gateway.setRoomMode({ guildId: "100", channelId: "778", mode: "hidden" });
  await gateway.setUserAccess({ guildId: "100", channelId: "778", userId: "300", access: "allowed" });
  await gateway.setUserAccess({ guildId: "100", channelId: "778", userId: "301", access: "denied" });

  assert.deepEqual(edits.map(({ id, options }) => ({ id, options })), [
    { id: "100", options: { ViewChannel: null, Connect: true } },
    { id: "100", options: { ViewChannel: true, Connect: false } },
    { id: "100", options: { ViewChannel: false, Connect: false } },
    { id: "300", options: { ViewChannel: true, Connect: true } },
    { id: "301", options: { ViewChannel: null, Connect: false } },
  ]);
  assert.ok(edits.every((entry) => typeof entry.metadata.reason === "string"));
});

test("kick refetches the target and refuses to disconnect after they move channels", async () => {
  let fetchOptions;
  let disconnects = 0;
  const member = {
    voice: {
      channelId: "other-channel",
      async disconnect() { disconnects += 1; },
    },
  };
  const guild = {
    members: {
      async fetch(options) { fetchOptions = options; return member; },
    },
  };
  const client = { guilds: { cache: new Map([["100", guild]]) } };
  const gateway = new DiscordRoomGateway(client);

  await assert.rejects(
    gateway.disconnectMember({ guildId: "100", userId: "300", expectedChannelId: "778" }),
    (error) => error.code === "TARGET_MOVED"
  );
  assert.deepEqual(fetchOptions, { user: "300", force: true });
  assert.equal(disconnects, 0);
});

test("ownership rollback restores only owner overwrites and preserves concurrent unrelated changes", async () => {
  const original = [
    { id: "100", type: 0, allow: 1n, deny: 2n },
    {
      id: "300", type: 1,
      allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect,
      deny: 0n,
    },
    {
      id: "301", type: 1,
      allow: PermissionFlagsBits.ViewChannel,
      deny: PermissionFlagsBits.Connect,
    },
    { id: "555", type: 1, allow: 16n, deny: 32n },
  ];
  const cache = new Map(original.map((entry) => [entry.id, {
    id: entry.id,
    type: entry.type,
    allow: { bitfield: entry.allow },
    deny: { bitfield: entry.deny },
  }]));
  const edits = [];
  let firstDelete = true;
  const permissionOverwrites = {
    cache,
    async edit(id, options) {
      edits.push({ id, options });
      cache.set(id, { id, type: 1, allow: { bitfield: 999n }, deny: { bitfield: 0n } });
    },
    async delete() {
      if (firstDelete) {
        firstDelete = false;
        cache.set("777", {
          id: "777", type: 1, allow: { bitfield: 64n }, deny: { bitfield: 0n },
        });
        throw new Error("delete failed");
      }
    },
  };
  const channel = { permissionOverwrites };
  const guild = { channels: { cache: new Map([["778", channel]]) } };
  const client = { guilds: { cache: new Map([["100", guild]]) } };
  const gateway = new DiscordRoomGateway(client);

  await assert.rejects(
    gateway.transferOwnership({ guildId: "100", channelId: "778", oldOwnerId: "300", newOwnerId: "301" }),
    /delete failed/
  );
  assert.deepEqual(edits[0], { id: "301", options: {
    ViewChannel: true, Connect: true, Speak: true, MoveMembers: true,
  } });
  assert.equal(edits[1].id, "300");
  assert.equal(edits[1].options.ViewChannel, true);
  assert.equal(edits[1].options.Connect, true);
  assert.equal(edits[2].id, "301");
  assert.equal(edits[2].options.ViewChannel, true);
  assert.equal(edits[2].options.Connect, false);
  assert.ok(cache.has("555"));
  assert.ok(cache.has("777"));
});

test("voice event passes primitives to service and ignores bots", async () => {
  const calls = [];
  const logger = { warn() {}, error() {} };
  const services = { autoRoomService: { async handleVoiceStateChange(input) { calls.push(input); } } };
  const container = { resolve(name) { return name === "logger" ? logger : services; } };
  const member = { id: "300", displayName: "Owner", user: { bot: false } };
  await voiceEvent.execute({
    container,
    args: [
      { channelId: null, guild: { id: "100" }, member },
      { channelId: "400", guild: { id: "100" }, member },
    ],
  });
  assert.deepEqual(calls, [{
    guildId: "100", userId: "300", displayName: "Owner", bot: false,
    oldChannelId: null, newChannelId: "400",
  }]);

  member.user.bot = true;
  await voiceEvent.execute({ container, args: [{ channelId: "400", guild: { id: "100" }, member }, { channelId: null, guild: { id: "100" }, member }] });
  assert.equal(calls.length, 1);
});

test("application and domain Auto Voice Room modules do not import discord.js", () => {
  const files = [
    "src/application/services/AutoRoomService.js",
    "src/application/repositories/contracts/AutoRoomRepository.js",
    "src/application/repositories/contracts/GuildRoomConfigRepository.js",
    "src/domain/entities/AutoRoom.js",
    "src/domain/policies/RoomPermissionPolicy.js",
    "src/domain/errors/RoomErrors.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    assert.doesNotMatch(source, /require\(["']discord\.js["']\)/, file);
  }
});
