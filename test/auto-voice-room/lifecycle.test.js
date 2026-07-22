const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AutoRoom = require("../../src/domain/entities/AutoRoom");
const AutoRoomService = require("../../src/application/services/AutoRoomService");
const AutoRoomDatabase = require("../../src/infrastructure/database/AutoRoomDatabase");
const SqliteAutoRoomRepository = require("../../src/infrastructure/database/repositories/SqliteAutoRoomRepository");
const SqliteGuildRoomConfigRepository = require("../../src/infrastructure/database/repositories/SqliteGuildRoomConfigRepository");
const { renderRoomName } = AutoRoomService;

class FakeGateway {
  constructor() {
    this.channels = new Map();
    this.created = [];
    this.deleted = [];
    this.moves = [];
    this.transfers = [];
    this.modes = [];
    this.renames = [];
    this.disconnects = [];
    this.nextId = 900;
    this.visibleGuildIds = ["100", "101"];
  }

  async listVisibleGuildIds() { return this.visibleGuildIds; }
  async validateConfig() { return true; }
  async createRoom(input) {
    const channelId = String(this.nextId++);
    this.created.push({ ...input, channelId });
    this.channels.set(channelId, {
      id: channelId, guildId: input.guildId, isVoice: true, managedMarker: true, members: [],
    });
    return { channelId };
  }
  async getChannelSnapshot({ channelId }) {
    const value = this.channels.get(channelId);
    return value ? { ...value, members: value.members.map((member) => ({ ...member })) } : null;
  }
  async moveMember(input) {
    this.moves.push(input);
    const channel = this.channels.get(input.channelId);
    if (channel && !channel.members.some((member) => member.id === input.userId)) {
      channel.members.push({ id: input.userId, bot: false });
    }
  }
  async deleteRoom(input) { this.deleted.push(input.channelId); this.channels.delete(input.channelId); return true; }
  async transferOwnership(input) { this.transfers.push(input); }
  async setRoomMode(input) { this.modes.push(input); }
  async setUserAccess() {}
  async disconnectMember(input) { this.disconnects.push(input); }
  async setUserLimit() {}
  async renameRoom(input) { this.renames.push(input); }
}

function fixture() {
  const database = new AutoRoomDatabase({ filename: ":memory:" });
  const rooms = new SqliteAutoRoomRepository(database);
  const configs = new SqliteGuildRoomConfigRepository(database);
  configs.upsert({
    guildId: "100",
    triggerChannelId: "400",
    categoryId: "500",
    defaultNameTemplate: "{displayName}'s room",
    defaultUserLimit: 0,
    emptyDeleteDelaySeconds: 5,
    updatedAt: 1,
  });
  const gateway = new FakeGateway();
  const jobs = [];
  const scheduler = {
    setTimeout(fn, ms) {
      const handle = { fn, ms, unref() {} };
      jobs.push(handle);
      return handle;
    },
    clearTimeout() {},
  };
  const service = new AutoRoomService({
    roomRepository: rooms,
    configRepository: configs,
    roomGateway: gateway,
    clock: { now: () => 1000 },
    scheduler,
  });
  return { database, rooms, configs, gateway, jobs, service };
}

test("duplicate concurrent trigger events create one room and move to the owned room", async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
  ]);

  assert.equal(f.gateway.created.length, 1);
  assert.equal(f.rooms.listAll().length, 1);
  assert.equal(first.channelId, second.channelId);
  assert.deepEqual([first.created, second.created], [true, false]);
  f.database.close();
});

test("an existing unmarked channel is not reused or deleted", async () => {
  const f = fixture();
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: false, members: [],
  });

  const result = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  assert.equal(result.created, true);
  assert.equal(result.channelId, "900");
  assert.ok(f.gateway.channels.has("778"));
  assert.deepEqual(f.gateway.deleted, []);
  assert.equal(f.rooms.findByOwner("100", "300").channelId, "900");
  f.database.close();
});

test("room creation has a minimal deterministic cooldown after a room disappears", async () => {
  const f = fixture();
  let now = 1000;
  f.service.clock = { now: () => now };
  const first = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  f.rooms.deleteByChannel(first.channelId);
  f.gateway.channels.delete(first.channelId);

  await assert.rejects(
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
    (error) => error.code === "ROOM_CONFLICT" && error.details.retryAfterMs === 5000
  );
  now += 5000;
  const second = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  assert.equal(second.created, true);
  f.database.close();
});

test("persistence failure compensates only the newly created channel", async () => {
  const f = fixture();
  const failure = new Error("persist failed");
  f.service.rooms = { ...f.rooms, findByOwner: () => null, create: () => { throw failure; } };
  await assert.rejects(
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
    failure
  );
  assert.deepEqual(f.gateway.deleted, ["900"]);
  assert.equal(f.rooms.listAll().length, 0);
  f.database.close();
});

test("delayed cleanup refetches and preserves a room when a member rejoins", async () => {
  const f = fixture();
  const created = await f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" });
  f.gateway.channels.get(created.channelId).members = [];
  f.service.scheduleDeleteIfEmpty({ guildId: "100", channelId: created.channelId, delaySeconds: 5 });
  f.gateway.channels.get(created.channelId).members.push({ id: "301", bot: false });

  assert.equal(f.jobs[0].ms, 5000);
  await f.jobs[0].fn();
  assert.equal(f.gateway.deleted.length, 0);
  assert.ok(f.rooms.findByChannel(created.channelId));
  f.database.close();
});

test("empty managed room deletes, while an unrecorded channel is never deleted", async () => {
  const f = fixture();
  f.gateway.channels.set("777", {
    id: "777", guildId: "100", isVoice: true, managedMarker: false, members: [],
  });
  assert.equal(await f.service.deleteIfEmpty({ guildId: "100", channelId: "777" }), false);

  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: true, members: [],
  });
  assert.equal(await f.service.deleteIfEmpty({ guildId: "100", channelId: "778" }), true);
  assert.deepEqual(f.gateway.deleted, ["778"]);
  assert.equal(f.rooms.findByChannel("778"), null);
  f.database.close();
});

test("owner departure transfers to a stable non-bot member", async () => {
  const f = fixture();
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "999", bot: true }, { id: "302", bot: false }, { id: "301", bot: false }],
  });
  await f.service.handleVoiceDeparture({ guildId: "100", channelId: "778", userId: "300" });

  assert.equal(f.rooms.findByChannel("778").ownerId, "301");
  assert.equal(f.gateway.transfers[0].newOwnerId, "301");
  f.database.close();
});

test("automatic transfer skips a member who already owns another room", async () => {
  const f = fixture();
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "779", ownerId: "301", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "301", bot: false }, { id: "302", bot: false }],
  });

  await f.service.handleVoiceDeparture({ guildId: "100", channelId: "778", userId: "300" });
  assert.equal(f.rooms.findByChannel("778").ownerId, "302");
  assert.equal(f.gateway.transfers[0].newOwnerId, "302");
  f.database.close();
});

test("reconciliation removes stale records, deletes empty managed rooms, and disables invalid configs", async () => {
  const f = fixture();
  f.rooms.create(new AutoRoom({ guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400" }));
  f.rooms.create(new AutoRoom({ guildId: "101", channelId: "779", ownerId: "301", triggerChannelId: "401" }));
  f.gateway.channels.set("779", {
    id: "779", guildId: "101", isVoice: true, managedMarker: true, members: [],
  });
  f.configs.upsert({ guildId: "101", triggerChannelId: "401", categoryId: "501", updatedAt: 1 });
  f.gateway.validateConfig = async ({ guildId }) => guildId !== "101";

  const result = await f.service.reconcile();
  assert.deepEqual(result, { configsDisabled: 1, staleRecordsRemoved: 1, emptyRoomsDeleted: 1, ownersTransferred: 0 });
  assert.equal(f.configs.findByGuild("101").enabled, false);
  assert.equal(f.rooms.listAll().length, 0);
  f.database.close();
});

test("recorded channel without the Discord-side marker is never deleted", async () => {
  const f = fixture();
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: false, members: [],
  });
  assert.equal(await f.service.deleteIfEmpty({ guildId: "100", channelId: "778" }), false);
  assert.deepEqual(f.gateway.deleted, []);
  assert.ok(f.rooms.findByChannel("778"));
  f.database.close();
});

test("reconciliation is scoped to guilds visible to each shard service", async () => {
  const f = fixture();
  f.configs.upsert({ guildId: "101", triggerChannelId: "401", categoryId: "501", updatedAt: 1 });
  f.gateway.visibleGuildIds = ["100"];
  f.gateway.validateConfig = async () => false;

  const secondGateway = new FakeGateway();
  secondGateway.visibleGuildIds = ["101"];
  secondGateway.validateConfig = async () => false;
  const secondService = new AutoRoomService({
    roomRepository: f.rooms,
    configRepository: f.configs,
    roomGateway: secondGateway,
  });

  await f.service.reconcile();
  assert.equal(f.configs.findByGuild("100").enabled, false);
  assert.equal(f.configs.findByGuild("101").enabled, true);
  await secondService.reconcile();
  assert.equal(f.configs.findByGuild("101").enabled, false);
  f.database.close();
});

test("reconciliation skips owner candidates who own another room", async () => {
  const f = fixture();
  f.gateway.visibleGuildIds = ["100"];
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
    createdAt: 1, updatedAt: 1,
  }));
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "779", ownerId: "301", triggerChannelId: "400",
    createdAt: 2, updatedAt: 2,
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "301", bot: false }, { id: "302", bot: false }],
  });
  f.gateway.channels.set("779", {
    id: "779", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "301", bot: false }],
  });

  const result = await f.service.reconcile();
  assert.equal(result.ownersTransferred, 1);
  assert.equal(f.rooms.findByChannel("778").ownerId, "302");
  assert.equal(f.rooms.findByChannel("779").ownerId, "301");
  f.database.close();
});

test("reconciliation removes stale unmarked/non-voice records without deleting channels", async () => {
  const f = fixture();
  f.gateway.visibleGuildIds = ["100"];
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "779", ownerId: "301", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: false, members: [],
  });
  f.gateway.channels.set("779", {
    id: "779", guildId: "100", isVoice: false, managedMarker: true, members: [],
  });

  const result = await f.service.reconcile();
  assert.equal(result.staleRecordsRemoved, 2);
  assert.equal(f.rooms.findByChannel("778"), null);
  assert.equal(f.rooms.findByChannel("779"), null);
  assert.ok(f.gateway.channels.has("778"));
  assert.ok(f.gateway.channels.has("779"));
  assert.deepEqual(f.gateway.deleted, []);
  f.database.close();
});

test("owner controls enforce authorization and rename sanitization/cooldown", async () => {
  const f = fixture();
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
  }));
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "300", bot: false }, { id: "301", bot: false }],
  });

  await assert.rejects(
    f.service.setMode({ guildId: "100", channelId: "778", actorId: "301", mode: "locked" }),
    (error) => error.code === "ROOM_FORBIDDEN"
  );
  await f.service.setMode({ guildId: "100", channelId: "778", actorId: "300", mode: "locked" });
  assert.equal(f.rooms.findByChannel("778").mode, "locked");

  const renamed = await f.service.rename({
    guildId: "100", channelId: "778", actorId: "300", name: "@everyone\u0000 room",
  });
  assert.equal(renamed.name, "@​everyone room");
  await assert.rejects(
    f.service.rename({ guildId: "100", channelId: "778", actorId: "300", name: "again" }),
    (error) => error.code === "ROOM_CONFLICT"
  );
  f.database.close();
});

test("numeric templates allocate exact monotonic names for concurrent owners", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "ଘ 🍵 ～ﾉ « {number} »", updatedAt: 2,
  });

  const [first, second] = await Promise.all([
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "One" }),
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "301", displayName: "Two" }),
  ]);

  assert.deepEqual(f.gateway.created.map((entry) => entry.name), [
    "ଘ 🍵 ～ﾉ « 1 »",
    "ଘ 🍵 ～ﾉ « 2 »",
  ]);
  assert.deepEqual([first.roomNumber, second.roomNumber], [1, 2]);
  assert.deepEqual(f.rooms.listAll().map((entry) => entry.roomNumber), [1, 2]);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 3);
  f.database.close();
});

test("rename preserves room number and last-room deletion resets allocation", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  const first = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "One",
  });
  f.gateway.channels.get(first.channelId).members = [{ id: "300", bot: false }];
  await f.service.rename({
    guildId: "100", channelId: first.channelId, actorId: "300", name: "Custom",
  });
  assert.equal(f.rooms.findByChannel(first.channelId).roomNumber, 1);
  f.gateway.channels.get(first.channelId).members = [];
  await f.service.deleteIfEmpty({ guildId: "100", channelId: first.channelId });

  const second = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "301", displayName: "Two",
  });
  assert.equal(second.roomNumber, 1);
  assert.equal(f.gateway.created[1].name, "Room 1");
  f.database.close();
});

test("external creation failure releases its reservation and resets when idle", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  const originalCreate = f.gateway.createRoom.bind(f.gateway);
  const failure = Object.assign(new Error("Discord create failed"), { code: "CREATE_FAILED" });
  let attempt = 0;
  f.gateway.createRoom = async (input) => {
    attempt += 1;
    if (attempt === 1) throw failure;
    return originalCreate(input);
  };

  await assert.rejects(
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "One" }),
    failure
  );
  assert.equal(f.rooms.listAll().length, 0);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);

  const created = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "One",
  });
  assert.equal(created.roomNumber, 1);
  assert.equal(f.gateway.created[0].name, "Room 1");
  f.database.close();
});

test("legacy template keeps display-name behavior and does not allocate", async () => {
  const f = fixture();
  const created = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  assert.equal(f.gateway.created[0].name, "Owner's room");
  assert.equal(created.roomNumber, null);
  assert.equal(f.rooms.findByChannel(created.channelId).roomNumber, null);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);
  f.database.close();
});

test("room name rendering preserves Unicode and validates Unicode code points", () => {
  assert.equal(renderRoomName("ଘ 🍵 ～ﾉ « {number} »", "Owner", 1), "ଘ 🍵 ～ﾉ « 1 »");
  assert.equal([...renderRoomName("😀".repeat(100), "Owner")].length, 100);
  assert.equal(
    renderRoomName("@everyone\u0000 {displayName} {number}", "😀 Owner", 7),
    "@​everyone 😀 Owner 7"
  );
  assert.throws(() => renderRoomName("😀".repeat(101), "Owner"), /1 to 100 visible characters/);
  assert.throws(() => renderRoomName("Room {number}", "Owner"), /positive room number/);
  assert.throws(() => renderRoomName(null, "Owner", 1), /template must be a string/);
  assert.equal(renderRoomName("{displayName} {number}", "   ", 1), "Member 1");
});

test("oversize numeric template releases its reservation before Discord creation", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: `${"😀".repeat(101)} {number}`,
    updatedAt: 2,
  });

  await assert.rejects(
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
    (error) => error.code === "ROOM_VALIDATION"
  );
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);
  assert.equal(f.gateway.created.length, 0);
  assert.equal(f.rooms.listAll().length, 0);
  f.database.close();
});

test("renamed active room blocks reset and retains its number", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  const created = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  await f.service.rename({
    guildId: "100", channelId: created.channelId, actorId: "300", name: "Renamed",
  });

  assert.equal(f.configs.resetNumberingIfNoManagedRooms("100", 3), false);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 2);
  assert.equal(f.rooms.findByChannel(created.channelId).roomNumber, 1);
  assert.equal(f.gateway.renames[0].name, "Renamed");
  f.database.close();
});

test("delayed Discord delete failure leaves managed record and counter unchanged", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  const created = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  f.gateway.channels.get(created.channelId).members = [];
  const failure = Object.assign(new Error("Missing Permissions"), { code: "MISSING_PERMISSIONS" });
  f.gateway.deleteRoom = async () => { throw failure; };

  f.service.scheduleDeleteIfEmpty({
    guildId: "100", channelId: created.channelId, delaySeconds: 5,
  });
  assert.equal(f.jobs.length, 1);
  await f.jobs[0].fn();
  assert.equal(f.rooms.findByChannel(created.channelId).roomNumber, 1);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 2);
  f.database.close();
});

test("reconciliation resets an empty guild so the next room is number one", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  f.database.connection.prepare(
    "UPDATE guild_room_configs SET next_room_number = 12 WHERE guild_id = '100'"
  ).run();

  await f.service.reconcile();
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);
  const created = await f.service.createOrMoveToOwnedRoom({
    guildId: "100", userId: "300", displayName: "Owner",
  });
  assert.equal(created.roomNumber, 1);
  assert.equal(f.gateway.created[0].name, "Room 1");
  f.database.close();
});

test("reconciliation repairs above active max without changing room or channel", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  f.rooms.create(new AutoRoom({
    guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
    roomNumber: 8, createdAt: 1, updatedAt: 1,
  }));
  f.database.connection.prepare(
    "UPDATE guild_room_configs SET next_room_number = 2 WHERE guild_id = '100'"
  ).run();
  f.gateway.channels.set("778", {
    id: "778", guildId: "100", isVoice: true, managedMarker: true,
    name: "Custom active name", members: [{ id: "300", bot: false }],
  });

  await f.service.reconcile();
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 9);
  assert.equal(f.rooms.findByChannel("778").roomNumber, 8);
  assert.equal(f.gateway.channels.get("778").name, "Custom active name");
  assert.deepEqual(f.gateway.renames, []);
  f.database.close();
});

test("numbered persistence failure compensates Discord and releases only its reservation", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  const failure = new Error("reservation persistence failed");
  f.rooms.createFromReservation = () => { throw failure; };

  await assert.rejects(
    f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
    failure
  );
  assert.deepEqual(f.gateway.deleted, ["900"]);
  assert.equal(f.rooms.listAll().length, 0);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);
  assert.equal(
    f.database.connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
    0
  );
  f.database.close();
});

for (const cleanupCode of ["MISSING_PERMISSIONS", "ETIMEDOUT"]) {
  test(`failed ${cleanupCode} compensation retains the reservation fence`, async () => {
    const f = fixture();
    f.configs.upsert({
      guildId: "100", triggerChannelId: "400", categoryId: "500",
      defaultNameTemplate: "Room {number}", updatedAt: 2,
    });
    const persistenceFailure = Object.assign(new Error("private persistence detail"), {
      code: "PERSIST_FAILED",
    });
    const cleanupFailure = Object.assign(new Error("private cleanup detail"), {
      code: cleanupCode,
    });
    const originalFinalize = f.rooms.createFromReservation.bind(f.rooms);
    const originalDelete = f.gateway.deleteRoom.bind(f.gateway);
    let failPersistence = true;
    f.rooms.createFromReservation = (roomInput, reservationId) => {
      if (failPersistence) throw persistenceFailure;
      return originalFinalize(roomInput, reservationId);
    };
    f.gateway.deleteRoom = async () => { throw cleanupFailure; };
    const logs = [];
    f.service.logger = { info() {}, warn() {}, error: (message, context) => logs.push({ message, context }) };

    await assert.rejects(
      f.service.createOrMoveToOwnedRoom({ guildId: "100", userId: "300", displayName: "Owner" }),
      persistenceFailure
    );
    const reservation = f.database.connection.prepare(`
      SELECT guild_id, room_number, channel_id, state FROM auto_room_number_reservations
    `).get();
    assert.deepEqual(reservation, {
      guild_id: "100", room_number: 1, channel_id: "900", state: "orphaned",
    });
    assert.equal(f.configs.findByGuild("100").nextRoomNumber, 2);
    assert.equal(f.gateway.channels.get("900").id, "900");
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0].context.originalCode, "PERSIST_FAILED");
    assert.deepEqual(logs[0].context.compensationCode, cleanupCode);
    assert.doesNotMatch(JSON.stringify(logs), /private persistence detail|private cleanup detail/);

    failPersistence = false;
    f.gateway.deleteRoom = originalDelete;
    const next = await f.service.createOrMoveToOwnedRoom({
      guildId: "100", userId: "301", displayName: "Next",
    });
    assert.equal(next.roomNumber, 2);
    assert.equal(f.gateway.created[0].name, "Room 1");
    assert.equal(f.gateway.created[1].name, "Room 2");
    assert.equal(f.rooms.findByChannel(next.channelId).roomNumber, 2);
    f.database.close();
  });
}

test("orphan reservation survives time advance and failed reconciliation cleanup", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  f.configs.reserveNextRoomNumber("100", "orphan", 10);
  f.configs.markNumberReservationChannel("100", "orphan", "900", "orphaned", 11);
  f.gateway.channels.set("900", {
    id: "900", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "300", bot: false }],
  });
  f.gateway.deleteRoom = async () => {
    throw Object.assign(new Error("not permitted"), { code: "MISSING_PERMISSIONS" });
  };
  f.service.clock = { now: () => 999999999 };

  await f.service.reconcile();
  assert.ok(f.gateway.channels.has("900"));
  assert.equal(f.configs.listNumberReservations("100")[0].state, "orphaned");
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 2);
  f.database.close();
});

test("reconciliation releases a channel-bound reservation only after confirmed absence", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  f.configs.reserveNextRoomNumber("100", "missing", 10);
  f.configs.markNumberReservationChannel("100", "missing", "999", "orphaned", 11);

  await f.service.reconcile();
  assert.deepEqual(f.configs.listNumberReservations("100"), []);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);
  f.database.close();
});

test("reconciliation never deletes a channel_created reservation while its creator finalizes", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  const number = f.configs.reserveNextRoomNumber("100", "finalizing", 10);
  f.configs.markNumberReservationChannel(
    "100", "finalizing", "900", "channel_created", 11
  );
  f.gateway.channels.set("900", {
    id: "900", guildId: "100", isVoice: true, managedMarker: true,
    members: [{ id: "300", bot: false }],
  });
  const pendingReconcile = f.service.reconcile();
  f.rooms.createFromReservation(new AutoRoom({
    guildId: "100", channelId: "900", ownerId: "300", triggerChannelId: "400",
    roomNumber: number, createdAt: 10, updatedAt: 11,
  }), "finalizing");
  await pendingReconcile;

  assert.deepEqual(f.gateway.deleted, []);
  assert.equal(f.rooms.findByChannel("900").roomNumber, 1);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 2);
  f.database.close();
});

test("concurrent reconcilers claim one orphan cleanup exactly once", async () => {
  const f = fixture();
  f.configs.upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "500",
    defaultNameTemplate: "Room {number}", updatedAt: 2,
  });
  f.configs.reserveNextRoomNumber("100", "orphan", 10);
  f.configs.markNumberReservationChannel("100", "orphan", "900", "orphaned", 11);
  f.gateway.channels.set("900", {
    id: "900", guildId: "100", isVoice: true, managedMarker: true, members: [],
  });
  const secondService = new AutoRoomService({
    roomRepository: f.rooms, configRepository: f.configs, roomGateway: f.gateway,
    clock: { now: () => 1000 },
  });

  await Promise.all([f.service.reconcile(), secondService.reconcile()]);
  assert.deepEqual(f.gateway.deleted, ["900"]);
  assert.deepEqual(f.configs.listNumberReservations("100"), []);
  assert.equal(f.configs.findByGuild("100").nextRoomNumber, 1);
  f.database.close();
});

test("paused reservation survives last-delete while later reservations remain unique", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-service-race-"));
  const filename = path.join(directory, "rooms.sqlite");
  const firstDatabase = new AutoRoomDatabase({ filename });
  const secondDatabase = new AutoRoomDatabase({ filename });
  const gateway = new FakeGateway();
  try {
    const firstRooms = new SqliteAutoRoomRepository(firstDatabase);
    const firstConfigs = new SqliteGuildRoomConfigRepository(firstDatabase);
    const secondRooms = new SqliteAutoRoomRepository(secondDatabase);
    const secondConfigs = new SqliteGuildRoomConfigRepository(secondDatabase);
    firstConfigs.upsert({
      guildId: "100", triggerChannelId: "400", categoryId: "500",
      defaultNameTemplate: "Room {number}", updatedAt: 1,
    });
    firstRooms.create(new AutoRoom({
      guildId: "100", channelId: "778", ownerId: "300", triggerChannelId: "400",
      roomNumber: 1, createdAt: 1, updatedAt: 1,
    }));
    firstDatabase.connection.prepare(
      "UPDATE guild_room_configs SET next_room_number = 2 WHERE guild_id = '100'"
    ).run();
    gateway.channels.set("778", {
      id: "778", guildId: "100", isVoice: true, managedMarker: true, members: [],
    });
    const firstService = new AutoRoomService({
      roomRepository: firstRooms, configRepository: firstConfigs, roomGateway: gateway,
    });
    const secondService = new AutoRoomService({
      roomRepository: secondRooms, configRepository: secondConfigs, roomGateway: gateway,
    });

    const originalCreate = gateway.createRoom.bind(gateway);
    let releaseCreate;
    let markFirstCreateEntered;
    let markAllCreatesEntered;
    let enteredCount = 0;
    const firstCreateEntered = new Promise((resolve) => { markFirstCreateEntered = resolve; });
    const allCreatesEntered = new Promise((resolve) => { markAllCreatesEntered = resolve; });
    const createGate = new Promise((resolve) => { releaseCreate = resolve; });
    gateway.createRoom = async (input) => {
      enteredCount += 1;
      if (enteredCount === 1) markFirstCreateEntered();
      if (enteredCount === 3) markAllCreatesEntered();
      await createGate;
      return originalCreate(input);
    };

    const reservationA = secondService.createOrMoveToOwnedRoom({
      guildId: "100", userId: "301", displayName: "Second",
    });
    await firstCreateEntered;
    assert.equal(await firstService.deleteIfEmpty({ guildId: "100", channelId: "778" }), true);
    const reservationB = firstService.createOrMoveToOwnedRoom({
      guildId: "100", userId: "302", displayName: "Third",
    });
    const reservationC = secondService.createOrMoveToOwnedRoom({
      guildId: "100", userId: "303", displayName: "Fourth",
    });
    await allCreatesEntered;
    assert.deepEqual(
      firstDatabase.connection.prepare(
        "SELECT room_number FROM auto_room_number_reservations ORDER BY room_number"
      ).all().map((entry) => entry.room_number),
      [2, 3, 4]
    );
    releaseCreate();
    const createdRooms = await Promise.all([reservationA, reservationB, reservationC]);
    gateway.createRoom = originalCreate;

    assert.deepEqual(createdRooms.map((entry) => entry.roomNumber).sort(), [2, 3, 4]);
    assert.deepEqual(firstRooms.listAll().map((entry) => entry.roomNumber).sort(), [2, 3, 4]);
    assert.deepEqual(gateway.created.map((entry) => entry.name).sort(), ["Room 2", "Room 3", "Room 4"]);
    assert.equal(firstConfigs.findByGuild("100").nextRoomNumber, 5);
    assert.equal(
      firstDatabase.connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
      0
    );
  } finally {
    secondDatabase.close();
    firstDatabase.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
