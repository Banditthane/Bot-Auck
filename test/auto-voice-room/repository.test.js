const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Database = require("better-sqlite3");

const AutoRoom = require("../../src/domain/entities/AutoRoom");
const AutoRoomDatabase = require("../../src/infrastructure/database/AutoRoomDatabase");
const SqliteAutoRoomRepository = require("../../src/infrastructure/database/repositories/SqliteAutoRoomRepository");
const SqliteGuildRoomConfigRepository = require("../../src/infrastructure/database/repositories/SqliteGuildRoomConfigRepository");

function createFixture() {
  const database = new AutoRoomDatabase({ filename: ":memory:" });
  return {
    database,
    rooms: new SqliteAutoRoomRepository(database),
    configs: new SqliteGuildRoomConfigRepository(database),
  };
}

function room(overrides = {}) {
  return new AutoRoom({
    guildId: "100",
    channelId: "200",
    ownerId: "300",
    triggerChannelId: "400",
    ...overrides,
  });
}

function createEmptyV1Database(filename) {
  const connection = new Database(filename);
  connection.exec(`
    CREATE TABLE auto_rooms (
      channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      trigger_channel_id TEXT NOT NULL, mode TEXT NOT NULL, user_limit INTEGER NOT NULL,
      pin_hash TEXT, system_marker TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_renamed_at INTEGER, UNIQUE (guild_id, owner_id)
    );
    CREATE TABLE room_grants (
      channel_id TEXT NOT NULL, user_id TEXT NOT NULL, access TEXT NOT NULL,
      expires_at INTEGER, PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES auto_rooms(channel_id) ON DELETE CASCADE
    );
    CREATE TABLE guild_room_configs (
      guild_id TEXT PRIMARY KEY, trigger_channel_id TEXT NOT NULL, category_id TEXT NOT NULL,
      log_channel_id TEXT, moderator_role_id TEXT, default_name_template TEXT NOT NULL,
      default_user_limit INTEGER NOT NULL, empty_delete_delay_seconds INTEGER NOT NULL,
      enabled INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  connection.close();
}

function createExactHybridFile(filename) {
  const database = new AutoRoomDatabase({ filename });
  const configs = new SqliteGuildRoomConfigRepository(database);
  const rooms = new SqliteAutoRoomRepository(database);
  configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  configs.upsert({ guildId: "101", triggerChannelId: "401", categoryId: "601", updatedAt: 2 });
  rooms.create(room({ roomNumber: 4 }));
  rooms.setGrant({ channelId: "200", userId: "500", access: "allowed", expiresAt: 99 });
  database.connection.exec(`
    INSERT INTO auto_room_number_reservations
      (reservation_id, guild_id, room_number, created_at, channel_id, state, updated_at)
    VALUES
      ('r1', '100', 5, 10, NULL, 'reserved', 11),
      ('r2', '100', 6, 20, '900', 'channel_created', 21),
      ('r3', '100', 7, 30, '901', 'orphaned', 31),
      ('r4', '100', 8, 40, '902', 'cleaning', 41),
      ('r5', '101', 2, 50, NULL, 'reserved', 51);
    UPDATE guild_room_configs SET next_room_number = 2 WHERE guild_id = '100';
    UPDATE guild_room_configs SET next_room_number = 20 WHERE guild_id = '101';
    PRAGMA user_version = 4;
  `);
  database.close();
}

function recoverySnapshot(connection) {
  const rows = (table, order) => connection.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
  return {
    rooms: rows("auto_rooms", "channel_id"),
    grants: rows("room_grants", "channel_id, user_id"),
    configs: rows("guild_room_configs", "guild_id"),
    reservations: rows("auto_room_number_reservations", "reservation_id"),
    schema: connection.prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name"
    ).all(),
    reservationSql: connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='auto_room_number_reservations'"
    ).get().sql,
    reservationRootPage: connection.prepare(
      "SELECT rootpage FROM sqlite_master WHERE type='table' AND name='auto_room_number_reservations'"
    ).get().rootpage,
  };
}
test("migrations are idempotent and repositories preserve the room model", () => {
  const fixture = createFixture();
  fixture.database.migrate();
  const created = room();
  fixture.rooms.create(created);

  assert.deepEqual(fixture.rooms.findByOwner("100", "300").toJSON(), created.toJSON());
  assert.equal(fixture.rooms.listAll().length, 1);
  fixture.database.close();
});

test("database enforces one room per owner/guild and unique channel", () => {
  const fixture = createFixture();
  fixture.rooms.create(room());

  assert.throws(() => fixture.rooms.create(room({ channelId: "201" })), /UNIQUE constraint failed/);
  assert.throws(() => fixture.rooms.create(room({ guildId: "101", ownerId: "301" })), /UNIQUE constraint failed/);
  fixture.database.close();
});

test("grants cascade on room deletion and config upsert is deterministic", () => {
  const fixture = createFixture();
  fixture.rooms.create(room());
  fixture.rooms.setGrant({ channelId: "200", userId: "500", access: "allowed" });
  fixture.rooms.setGrant({ channelId: "200", userId: "500", access: "denied" });
  assert.deepEqual(fixture.rooms.listGrants("200"), [{
    channelId: "200", userId: "500", access: "denied", expiresAt: null,
  }]);

  const saved = fixture.configs.upsert({
    guildId: "100",
    triggerChannelId: "400",
    categoryId: "600",
    defaultUserLimit: 3,
    emptyDeleteDelaySeconds: 7,
    updatedAt: 10,
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.defaultUserLimit, 3);
  assert.equal(fixture.configs.disable("100", 11).enabled, false);

  fixture.rooms.deleteByChannel("200");
  assert.deepEqual(fixture.rooms.listGrants("200"), []);
  fixture.database.close();
});

test("two database handles share schema v3 and configured busy timeout", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-db-"));
  const filename = path.join(directory, "rooms.sqlite");
  const first = new AutoRoomDatabase({ filename });
  const second = new AutoRoomDatabase({ filename });
  try {
    assert.equal(first.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(second.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(first.connection.pragma("busy_timeout", { simple: true }), 5000);
    new SqliteAutoRoomRepository(first).create(room());
    assert.equal(new SqliteAutoRoomRepository(second).findByChannel("200").ownerId, "300");
  } finally {
    second.close();
    first.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v0 legacy tables are transactionally rebuilt into v3 with safe defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-legacy-"));
  const filename = path.join(directory, "rooms.sqlite");
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE auto_rooms (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      trigger_channel_id TEXT NOT NULL
    );
    CREATE TABLE room_grants (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      access TEXT NOT NULL
    );
    CREATE TABLE guild_room_configs (
      guild_id TEXT PRIMARY KEY,
      trigger_channel_id TEXT NOT NULL,
      category_id TEXT NOT NULL
    );
    INSERT INTO auto_rooms VALUES ('200', '100', '300', '400');
    INSERT INTO room_grants VALUES ('200', '500', 'allowed');
    INSERT INTO guild_room_configs VALUES ('100', '400', '600');
  `);
  legacy.close();

  const migrated = new AutoRoomDatabase({ filename });
  try {
    const rooms = new SqliteAutoRoomRepository(migrated);
    const configs = new SqliteGuildRoomConfigRepository(migrated);
    assert.equal(migrated.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(rooms.findByChannel("200").systemMarker, AutoRoom.SYSTEM_MARKER);
    assert.equal(rooms.findByChannel("200").mode, "open");
    assert.deepEqual(rooms.listGrants("200"), [{
      channelId: "200", userId: "500", access: "allowed", expiresAt: null,
    }]);
    assert.equal(configs.findByGuild("100").emptyDeleteDelaySeconds, 5);
  } finally {
    migrated.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unsupported legacy schema fails without falsely stamping v3", () => {
  const connection = new Database(":memory:");
  connection.exec("CREATE TABLE auto_rooms (channel_id TEXT PRIMARY KEY)");
  assert.throws(
    () => new AutoRoomDatabase({ database: connection }),
    /missing required columns guild_id, owner_id, trigger_channel_id/
  );
  assert.equal(connection.pragma("user_version", { simple: true }), 0);
  connection.close();
});

test("room numbers persist and are unique per guild when present", () => {
  const fixture = createFixture();
  fixture.rooms.create(room({ roomNumber: 1 }));
  assert.equal(fixture.rooms.findByChannel("200").roomNumber, 1);
  assert.throws(
    () => fixture.rooms.create(room({ channelId: "201", ownerId: "301", roomNumber: 1 })),
    /UNIQUE constraint failed/
  );
  fixture.rooms.create(room({ guildId: "101", channelId: "202", ownerId: "302", roomNumber: 1 }));
  assert.equal(fixture.rooms.findByChannel("202").roomNumber, 1);
  fixture.database.close();
});

test("reservations are monotonic across two handles, upsert, and reopen", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-counter-"));
  const filename = path.join(directory, "rooms.sqlite");
  let first = new AutoRoomDatabase({ filename });
  let second = new AutoRoomDatabase({ filename });
  try {
    const firstConfigs = new SqliteGuildRoomConfigRepository(first);
    const secondConfigs = new SqliteGuildRoomConfigRepository(second);
    const firstRooms = new SqliteAutoRoomRepository(first);
    const secondRooms = new SqliteAutoRoomRepository(second);
    firstConfigs.upsert({
      guildId: "100", triggerChannelId: "400", categoryId: "600",
      defaultNameTemplate: "ଘ 🍵 ～ﾉ « {number} »", updatedAt: 1,
    });

    const allocations = [
      [firstConfigs, firstRooms, "r1", "200", "300", 2],
      [secondConfigs, secondRooms, "r2", "201", "301", 3],
      [firstConfigs, firstRooms, "r3", "202", "302", 4],
      [secondConfigs, secondRooms, "r4", "203", "303", 5],
    ].map(([configs, rooms, reservationId, channelId, ownerId, updatedAt]) => {
      const roomNumber = configs.reserveNextRoomNumber("100", reservationId, updatedAt);
      configs.markNumberReservationChannel(
        "100", reservationId, channelId, "channel_created", updatedAt
      );
      rooms.createFromReservation(room({ channelId, ownerId, roomNumber }), reservationId);
      return roomNumber;
    });
    assert.deepEqual(allocations, [1, 2, 3, 4]);
    firstConfigs.upsert({
      guildId: "100", triggerChannelId: "401", categoryId: "601",
      defaultNameTemplate: "Room {number}", updatedAt: 6, nextRoomNumber: 1,
    });
    assert.equal(firstConfigs.findByGuild("100").nextRoomNumber, 5);

    second.close();
    first.close();
    first = new AutoRoomDatabase({ filename });
    second = new AutoRoomDatabase({ filename });
    const reopenedConfigs = new SqliteGuildRoomConfigRepository(second);
    assert.equal(reopenedConfigs.reserveNextRoomNumber("100", "r5", 7), 5);
    assert.deepEqual(reopenedConfigs.releaseNumberReservation("100", "r5"), {
      released: true, reset: false,
    });
  } finally {
    second.close();
    first.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v1 migrates losslessly through v2 to v3 and migration is idempotent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-v1-"));
  const filename = path.join(directory, "rooms.sqlite");
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE auto_rooms (
      channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      trigger_channel_id TEXT NOT NULL, mode TEXT NOT NULL, user_limit INTEGER NOT NULL,
      pin_hash TEXT, system_marker TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_renamed_at INTEGER, UNIQUE (guild_id, owner_id)
    );
    CREATE TABLE room_grants (
      channel_id TEXT NOT NULL, user_id TEXT NOT NULL, access TEXT NOT NULL,
      expires_at INTEGER, PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES auto_rooms(channel_id) ON DELETE CASCADE
    );
    CREATE TABLE guild_room_configs (
      guild_id TEXT PRIMARY KEY, trigger_channel_id TEXT NOT NULL, category_id TEXT NOT NULL,
      log_channel_id TEXT, moderator_role_id TEXT, default_name_template TEXT NOT NULL,
      default_user_limit INTEGER NOT NULL, empty_delete_delay_seconds INTEGER NOT NULL,
      enabled INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO auto_rooms VALUES
      ('200','100','300','400','locked',3,NULL,'auto_voice_room:v1',10,11,NULL);
    INSERT INTO room_grants VALUES ('200','500','allowed',NULL);
    INSERT INTO guild_room_configs VALUES
      ('100','400','600',NULL,NULL,'Legacy {displayName}',3,7,1,8,9);
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const migrated = new AutoRoomDatabase({ filename });
  try {
    const rooms = new SqliteAutoRoomRepository(migrated);
    const configs = new SqliteGuildRoomConfigRepository(migrated);
    assert.equal(migrated.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(rooms.findByChannel("200").roomNumber, null);
    assert.equal(rooms.findByChannel("200").mode, "locked");
    assert.deepEqual(rooms.listGrants("200"), [{
      channelId: "200", userId: "500", access: "allowed", expiresAt: null,
    }]);
    assert.equal(configs.findByGuild("100").defaultNameTemplate, "Legacy {displayName}");
    assert.equal(configs.findByGuild("100").nextRoomNumber, 1);
    migrated.migrate();
    assert.equal(configs.reserveNextRoomNumber("100", "legacy-r1", 12), 1);
    assert.deepEqual(configs.releaseNumberReservation("100", "legacy-r1"), {
      released: true, reset: false,
    });
    const indexSql = migrated.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name=?"
    ).get("auto_rooms_guild_room_number_unique").sql;
    assert.match(indexSql, /WHERE room_number IS NOT NULL/i);
  } finally {
    migrated.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid v1 schema fails transactionally without stamping v3", () => {
  const connection = new Database(":memory:");
  connection.exec("CREATE TABLE auto_rooms (channel_id TEXT PRIMARY KEY); PRAGMA user_version = 1;");
  assert.throws(() => new AutoRoomDatabase({ database: connection }), /schema v1 table auto_rooms is missing/);
  assert.equal(connection.pragma("user_version", { simple: true }), 1);
  connection.close();
});

test("reopen repairs a lagging counter above persisted room numbers without decrementing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-repair-"));
  const filename = path.join(directory, "rooms.sqlite");
  let database = new AutoRoomDatabase({ filename });
  try {
    const configs = new SqliteGuildRoomConfigRepository(database);
    const rooms = new SqliteAutoRoomRepository(database);
    configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
    rooms.create(room({ roomNumber: 5 }));
    database.connection.prepare(
      "UPDATE guild_room_configs SET next_room_number = 2 WHERE guild_id = '100'"
    ).run();
    database.close();

    database = new AutoRoomDatabase({ filename });
    assert.equal(new SqliteGuildRoomConfigRepository(database).findByGuild("100").nextRoomNumber, 6);
    database.connection.prepare(
      "UPDATE guild_room_configs SET next_room_number = 10 WHERE guild_id = '100'"
    ).run();
    database.close();

    database = new AutoRoomDatabase({ filename });
    assert.equal(new SqliteGuildRoomConfigRepository(database).findByGuild("100").nextRoomNumber, 10);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("eight processes serialize one v1 to v3 migration without duplicate columns", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-multiprocess-migrate-"));
  const filename = path.join(directory, "rooms.sqlite");
  createEmptyV1Database(filename);
  const databaseModule = path.resolve(
    __dirname,
    "../../src/infrastructure/database/AutoRoomDatabase.js"
  );
  const childSource = `
    const AutoRoomDatabase = require(process.env.AUTO_ROOM_DATABASE_MODULE);
    const database = new AutoRoomDatabase({ filename: process.env.AUTO_ROOM_DATABASE_FILE });
    database.close();
  `;

  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) => {
      const child = spawn(process.execPath, ["-e", childSource], {
        cwd: path.resolve(__dirname, "../.."),
        env: {
          ...process.env,
          AUTO_ROOM_DATABASE_MODULE: databaseModule,
          AUTO_ROOM_DATABASE_FILE: filename,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stderr }));
    })));

    assert.deepEqual(results.map((result) => result.code), Array(8).fill(0), results.map((r) => r.stderr).join("\n"));
    const migrated = new AutoRoomDatabase({ filename });
    assert.equal(migrated.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(
      migrated.connection.pragma("table_info(guild_room_configs)")
        .filter((column) => column.name === "next_room_number").length,
      1
    );
    assert.equal(
      migrated.connection.pragma("table_info(auto_rooms)")
        .filter((column) => column.name === "room_number").length,
      1
    );
    migrated.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("v2 validation rejects malformed same-name room-number indexes", () => {
  const variants = [
    "CREATE INDEX auto_rooms_guild_room_number_unique ON auto_rooms(guild_id, room_number) WHERE room_number IS NOT NULL",
    "CREATE UNIQUE INDEX auto_rooms_guild_room_number_unique ON auto_rooms(room_number, guild_id) WHERE room_number IS NOT NULL",
  ];

  for (const [index, definition] of variants.entries()) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `auto-room-index-${index}-`));
    const filename = path.join(directory, "rooms.sqlite");
    const valid = new AutoRoomDatabase({ filename });
    valid.close();
    const connection = new Database(filename);
    try {
      connection.exec(`
        DROP TABLE auto_room_number_reservations;
        PRAGMA user_version = 2;
        DROP INDEX auto_rooms_guild_room_number_unique;
        ${definition};
      `);
      assert.throws(
        () => new AutoRoomDatabase({ database: connection }),
        /invalid room number unique index/
      );
      assert.equal(connection.pragma("user_version", { simple: true }), 2);
    } finally {
      connection.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("unversioned valid v2 schema preserves counter and room number before stamping", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-unversioned-v2-"));
  const filename = path.join(directory, "rooms.sqlite");
  let database = new AutoRoomDatabase({ filename });
  try {
    const configs = new SqliteGuildRoomConfigRepository(database);
    const rooms = new SqliteAutoRoomRepository(database);
    configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
    rooms.create(room({ roomNumber: 8 }));
    database.connection.prepare(
      "UPDATE guild_room_configs SET next_room_number = 9 WHERE guild_id = '100'"
    ).run();
    database.connection.exec("DROP TABLE auto_room_number_reservations");
    database.connection.pragma("user_version = 0");
    database.close();

    database = new AutoRoomDatabase({ filename });
    assert.equal(database.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(new SqliteGuildRoomConfigRepository(database).findByGuild("100").nextRoomNumber, 9);
    assert.equal(new SqliteAutoRoomRepository(database).findByChannel("200").roomNumber, 8);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unversioned malformed v2 shape fails without mutation or version stamp", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-unversioned-invalid-v2-"));
  const filename = path.join(directory, "rooms.sqlite");
  const database = new AutoRoomDatabase({ filename });
  const configs = new SqliteGuildRoomConfigRepository(database);
  const rooms = new SqliteAutoRoomRepository(database);
  configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  rooms.create(room({ roomNumber: 8 }));
  database.connection.prepare(
    "UPDATE guild_room_configs SET next_room_number = 9 WHERE guild_id = '100'"
  ).run();
  database.close();

  const connection = new Database(filename);
  try {
    connection.exec(`
      DROP INDEX auto_rooms_guild_room_number_unique;
      CREATE INDEX auto_rooms_guild_room_number_unique
        ON auto_rooms(guild_id, room_number)
        WHERE room_number IS NOT NULL;
      PRAGMA user_version = 0;
    `);
    assert.throws(
      () => new AutoRoomDatabase({ database: connection }),
      /invalid room number unique index/
    );
    assert.equal(connection.pragma("user_version", { simple: true }), 0);
    assert.equal(
      connection.prepare("SELECT next_room_number FROM guild_room_configs WHERE guild_id = '100'").get()
        .next_room_number,
      9
    );
    assert.equal(
      connection.prepare("SELECT room_number FROM auto_rooms WHERE channel_id = '200'").get().room_number,
      8
    );
  } finally {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("transactional deletion resets only after the last managed room", () => {
  const fixture = createFixture();
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  fixture.rooms.create(room({ roomNumber: 1 }));
  fixture.rooms.create(room({ channelId: "201", ownerId: "301", roomNumber: 2 }));
  fixture.database.connection.prepare(
    "UPDATE guild_room_configs SET next_room_number = 3 WHERE guild_id = '100'"
  ).run();

  assert.deepEqual(
    fixture.rooms.deleteByChannelAndResetNumbering("200", "100"),
    { deleted: true, reset: false }
  );
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 3);
  assert.deepEqual(
    fixture.rooms.deleteByChannelAndResetNumbering("201", "100"),
    { deleted: true, reset: true }
  );
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 1);
  fixture.database.close();
});

test("legacy null-number room blocks reset and active counter repair ignores null in max", () => {
  const fixture = createFixture();
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  fixture.rooms.create(room({ roomNumber: null }));
  fixture.database.connection.prepare(
    "UPDATE guild_room_configs SET next_room_number = 7 WHERE guild_id = '100'"
  ).run();

  assert.equal(fixture.configs.resetNumberingIfNoManagedRooms("100", 2), false);
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 7);
  fixture.database.close();
});

test("config upsert alone never resets numbering for active or empty guilds", () => {
  const fixture = createFixture();
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  fixture.database.connection.prepare(
    "UPDATE guild_room_configs SET next_room_number = 9 WHERE guild_id = '100'"
  ).run();
  fixture.configs.upsert({
    guildId: "100", triggerChannelId: "401", categoryId: "601",
    defaultNameTemplate: "Changed {number}", updatedAt: 2,
  });
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 9);
  fixture.rooms.create(room({ roomNumber: 8 }));
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "402", categoryId: "602", updatedAt: 3 });
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 9);
  fixture.database.close();
});

test("empty-guild reset is isolated from another guild", () => {
  const fixture = createFixture();
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  fixture.configs.upsert({ guildId: "101", triggerChannelId: "401", categoryId: "601", updatedAt: 1 });
  fixture.rooms.create(room({ guildId: "101", channelId: "201", ownerId: "301", roomNumber: 8 }));
  fixture.database.connection.exec(`
    UPDATE guild_room_configs SET next_room_number = 5 WHERE guild_id = '100';
    UPDATE guild_room_configs SET next_room_number = 9 WHERE guild_id = '101';
  `);

  assert.equal(fixture.configs.resetNumberingIfNoManagedRooms("100", 2), true);
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 1);
  assert.equal(fixture.configs.findByGuild("101").nextRoomNumber, 9);
  assert.equal(fixture.rooms.findByChannel("201").roomNumber, 8);
  fixture.database.close();
});

test("reservation blocks last-delete reset and finalizes safely across handles", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-delete-create-"));
  const filename = path.join(directory, "rooms.sqlite");
  const first = new AutoRoomDatabase({ filename });
  const second = new AutoRoomDatabase({ filename });
  try {
    const firstRooms = new SqliteAutoRoomRepository(first);
    const firstConfigs = new SqliteGuildRoomConfigRepository(first);
    const secondRooms = new SqliteAutoRoomRepository(second);
    const secondConfigs = new SqliteGuildRoomConfigRepository(second);
    firstConfigs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
    firstRooms.create(room({ roomNumber: 1 }));
    first.connection.prepare(
      "UPDATE guild_room_configs SET next_room_number = 2 WHERE guild_id = '100'"
    ).run();

    const inFlightNumber = secondConfigs.reserveNextRoomNumber("100", "in-flight", 2);
    secondConfigs.markNumberReservationChannel(
      "100", "in-flight", "201", "channel_created", 2
    );
    assert.equal(inFlightNumber, 2);
    assert.deepEqual(
      firstRooms.deleteByChannelAndResetNumbering("200", "100"),
      { deleted: true, reset: false }
    );
    secondRooms.createFromReservation(
      room({ channelId: "201", ownerId: "301", roomNumber: inFlightNumber }),
      "in-flight"
    );

    assert.equal(firstConfigs.reserveNextRoomNumber("100", "next", 3), 3);
    assert.equal(firstConfigs.findByGuild("100").nextRoomNumber, 4);
    assert.deepEqual(firstRooms.listAll().map((entry) => entry.roomNumber), [2]);
  } finally {
    second.close();
    first.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 migrates transactionally to v3 without changing rooms or counters", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-v2-v3-"));
  const filename = path.join(directory, "rooms.sqlite");
  let database = new AutoRoomDatabase({ filename });
  try {
    const configs = new SqliteGuildRoomConfigRepository(database);
    const rooms = new SqliteAutoRoomRepository(database);
    configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
    rooms.create(room({ roomNumber: 8 }));
    database.connection.prepare(
      "UPDATE guild_room_configs SET next_room_number = 9 WHERE guild_id = '100'"
    ).run();
    database.connection.exec("DROP TABLE auto_room_number_reservations; PRAGMA user_version = 2;");
    database.close();

    database = new AutoRoomDatabase({ filename });
    assert.equal(database.connection.pragma("user_version", { simple: true }), 5);
    assert.equal(new SqliteGuildRoomConfigRepository(database).findByGuild("100").nextRoomNumber, 9);
    assert.equal(new SqliteAutoRoomRepository(database).findByChannel("200").roomNumber, 8);
    assert.equal(
      database.connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
      0
    );
    database.migrate();
    assert.equal(database.connection.pragma("user_version", { simple: true }), 5);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed v3 reservation schema fails closed without version mutation", () => {
  const connection = new Database(":memory:");
  const valid = new AutoRoomDatabase({ database: connection });
  assert.ok(valid);
  connection.exec(`
    DROP TABLE auto_room_number_reservations;
    CREATE TABLE auto_room_number_reservations (
      reservation_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      room_number INTEGER NOT NULL CHECK(room_number >= 1),
      created_at INTEGER NOT NULL
    );
    PRAGMA user_version = 3;
  `);
  assert.throws(
    () => new AutoRoomDatabase({ database: connection }),
    /reservation unique constraint/
  );
  assert.equal(connection.pragma("user_version", { simple: true }), 3);
  connection.close();
});

test("v4 migrates every reservation state and field transactionally to v5", () => {
  const connection = new Database(":memory:");
  const database = new AutoRoomDatabase({ database: connection });
  new SqliteGuildRoomConfigRepository(database).upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1,
  });
  connection.exec(`
    DROP TABLE auto_room_number_reservations;
    CREATE TABLE auto_room_number_reservations (
      reservation_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      room_number INTEGER NOT NULL CHECK(room_number >= 1),
      created_at INTEGER NOT NULL,
      channel_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned')),
      updated_at INTEGER NOT NULL,
      UNIQUE(guild_id, room_number)
    );
    INSERT INTO auto_room_number_reservations VALUES
      ('r1', '100', 1, 10, NULL, 'reserved', 11),
      ('r2', '100', 2, 20, '900', 'channel_created', 21),
      ('r3', '100', 3, 30, '901', 'orphaned', 31);
    UPDATE guild_room_configs SET next_room_number = 4 WHERE guild_id = '100';
    PRAGMA user_version = 4;
  `);

  new AutoRoomDatabase({ database: connection });
  assert.equal(connection.pragma("user_version", { simple: true }), 5);
  assert.deepEqual(connection.prepare(`
    SELECT reservation_id, guild_id, room_number, created_at, channel_id, state, updated_at
    FROM auto_room_number_reservations ORDER BY room_number
  `).all(), [
    { reservation_id: "r1", guild_id: "100", room_number: 1, created_at: 10, channel_id: null, state: "reserved", updated_at: 11 },
    { reservation_id: "r2", guild_id: "100", room_number: 2, created_at: 20, channel_id: "900", state: "channel_created", updated_at: 21 },
    { reservation_id: "r3", guild_id: "100", room_number: 3, created_at: 30, channel_id: "901", state: "orphaned", updated_at: 31 },
  ]);
  assert.equal(new SqliteGuildRoomConfigRepository(database).findByGuild("100").nextRoomNumber, 4);
  new AutoRoomDatabase({ database: connection });
  assert.equal(connection.pragma("user_version", { simple: true }), 5);
  connection.close();
});

test("malformed v4 fails closed before rebuild and preserves reservation rows", () => {
  const connection = new Database(":memory:");
  new AutoRoomDatabase({ database: connection });
  connection.exec(`
    DROP TABLE auto_room_number_reservations;
    CREATE TABLE auto_room_number_reservations (
      reservation_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      room_number INTEGER NOT NULL CHECK(room_number >= 1),
      created_at INTEGER NOT NULL,
      channel_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created')),
      updated_at INTEGER NOT NULL,
      UNIQUE(guild_id, room_number)
    );
    INSERT INTO auto_room_number_reservations VALUES
      ('r1', '100', 1, 10, NULL, 'reserved', 11);
    PRAGMA user_version = 4;
  `);
  assert.throws(() => new AutoRoomDatabase({ database: connection }), /v4 reservation state constraint/);
  assert.equal(connection.pragma("user_version", { simple: true }), 4);
  assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count, 1);
  assert.equal(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auto_room_number_reservations_v4'").get(), undefined);
  connection.close();
});

test("exact v5-shape version-4 hybrid stamps metadata without rebuilding or losing data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-exact-hybrid-"));
  const filename = path.join(directory, "rooms.sqlite");
  createExactHybridFile(filename);
  const beforeConnection = new Database(filename);
  const before = recoverySnapshot(beforeConnection);
  beforeConnection.close();

  let recovered;
  try {
    recovered = new AutoRoomDatabase({ filename });
    const after = recoverySnapshot(recovered.connection);
    assert.equal(recovered.connection.pragma("user_version", { simple: true }), 5);
    assert.deepEqual(after.rooms, before.rooms);
    assert.deepEqual(after.grants, before.grants);
    assert.deepEqual(after.reservations, before.reservations);
    assert.deepEqual(after.schema, before.schema);
    assert.equal(after.reservationSql, before.reservationSql);
    assert.equal(after.reservationRootPage, before.reservationRootPage);
    assert.deepEqual(after.configs.map(({ next_room_number, ...row }) => row),
      before.configs.map(({ next_room_number, ...row }) => row));
    assert.deepEqual(after.configs.map((row) => [row.guild_id, row.next_room_number]), [
      ["100", 9], ["101", 20],
    ]);
    assert.deepEqual(recovered.connection.pragma("integrity_check"), [{ integrity_check: "ok" }]);
    assert.deepEqual(recovered.connection.pragma("foreign_key_check"), []);
    assert.equal(recovered.connection.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_v4'"
    ).get(), undefined);
    recovered.close();
    recovered = new AutoRoomDatabase({ filename });
    assert.deepEqual(recoverySnapshot(recovered.connection), after);
  } finally {
    recovered?.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("exact hybrid rollback preserves metadata rows schema and counter at every mutation checkpoint", () => {
  for (const checkpoint of ["beforeHybridValidation", "afterHybridCounterRepair", "beforeHybridVersionStamp"]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `auto-room-hybrid-rollback-${checkpoint}-`));
    const filename = path.join(directory, "rooms.sqlite");
    createExactHybridFile(filename);
    const connection = new Database(filename);
    const before = recoverySnapshot(connection);
    try {
      assert.throws(
        () => new AutoRoomDatabase({
          database: connection,
          migrationHooks: { [checkpoint]() { throw new Error(`injected-${checkpoint}`); } },
        }),
        (error) => error.code === "AUTO_ROOM_SCHEMA_INVALID"
      );
      assert.equal(connection.pragma("user_version", { simple: true }), 4);
      assert.deepEqual(recoverySnapshot(connection), before);
      assert.equal(connection.inTransaction, false);
    } finally {
      connection.close();
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("malformed and ambiguous version-4 hybrids fail closed without mutation", () => {
  const variants = [
    { name: "reordered-state", definition: "state TEXT NOT NULL CHECK(state IN ('reserved', 'orphaned', 'channel_created', 'cleaning'))" },
    { name: "extra-state", definition: "state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning', 'extra'))" },
    { name: "additional-state-check", definition: "state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning')) CHECK(state <> '')" },
    { name: "wrong-room-check", definition: "state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning'))", roomCheck: "CHECK(room_number > 0)" },
    { name: "wrong-state-type", definition: "state BLOB NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning'))" },
    { name: "nullable-state", definition: "state TEXT CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning'))" },
    { name: "extra-column", definition: "state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning'))", extraColumn: true },
    { name: "missing-unique", definition: "state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning'))", omitUnique: true },
  ];

  for (const variant of variants) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `auto-room-hybrid-${variant.name}-`));
    const filename = path.join(directory, "rooms.sqlite");
    createExactHybridFile(filename);
    const connection = new Database(filename);
    try {
      connection.exec(`
        DROP TABLE auto_room_number_reservations;
        CREATE TABLE auto_room_number_reservations (
          reservation_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          room_number INTEGER NOT NULL ${variant.roomCheck || "CHECK(room_number >= 1)"},
          created_at INTEGER NOT NULL,
          channel_id TEXT,
          ${variant.definition},
          updated_at INTEGER NOT NULL
          ${variant.extraColumn ? ", extra TEXT" : ""}
          ${variant.omitUnique ? "" : ", UNIQUE(guild_id, room_number)"}
        );
        INSERT INTO auto_room_number_reservations
          (reservation_id, guild_id, room_number, created_at, channel_id, state, updated_at) VALUES
          ('r1', '100', 5, 10, NULL, 'reserved', 11);
        PRAGMA user_version = 4;
      `);
      const before = recoverySnapshot(connection);
      assert.throws(
        () => new AutoRoomDatabase({ database: connection }),
        (error) => error.code === "AUTO_ROOM_SCHEMA_INVALID",
        variant.name
      );
      assert.equal(connection.pragma("user_version", { simple: true }), 4);
      assert.deepEqual(recoverySnapshot(connection), before);
      assert.equal(connection.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='auto_room_number_reservations_v4'"
      ).get(), undefined);
    } finally {
      connection.close();
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("exact hybrid recognizer rejects a noncanonical base-table shape", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-hybrid-base-shape-"));
  const filename = path.join(directory, "rooms.sqlite");
  createExactHybridFile(filename);
  const connection = new Database(filename);
  try {
    connection.exec("ALTER TABLE guild_room_configs ADD COLUMN unexpected TEXT");
    const before = recoverySnapshot(connection);
    assert.throws(
      () => new AutoRoomDatabase({ database: connection }),
      (error) => error.code === "AUTO_ROOM_SCHEMA_INVALID"
    );
    assert.equal(connection.pragma("user_version", { simple: true }), 4);
    assert.deepEqual(recoverySnapshot(connection), before);
  } finally {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("exact hybrid with constraint-violating stored data fails integrity validation and rolls back", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-hybrid-invalid-row-"));
  const filename = path.join(directory, "rooms.sqlite");
  createExactHybridFile(filename);
  const connection = new Database(filename);
  try {
    connection.pragma("ignore_check_constraints = ON");
    connection.prepare(
      "UPDATE auto_room_number_reservations SET state = 'invalid' WHERE reservation_id = 'r1'"
    ).run();
    connection.pragma("ignore_check_constraints = OFF");
    const before = recoverySnapshot(connection);
    assert.throws(
      () => new AutoRoomDatabase({ database: connection }),
      (error) => error.code === "AUTO_ROOM_SCHEMA_INVALID"
    );
    assert.equal(connection.pragma("user_version", { simple: true }), 4);
    assert.deepEqual(recoverySnapshot(connection), before);
  } finally {
    connection.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("concurrent processes serialize exact hybrid recovery and preserve one table", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-hybrid-process-"));
  const filename = path.join(directory, "rooms.sqlite");
  createExactHybridFile(filename);
  const beforeConnection = new Database(filename);
  const before = recoverySnapshot(beforeConnection);
  beforeConnection.close();
  const databaseModule = path.resolve(__dirname, "../../src/infrastructure/database/AutoRoomDatabase.js");
  const childSource = `
    const AutoRoomDatabase = require(process.env.DB_MODULE);
    const database = new AutoRoomDatabase({ filename: process.env.DB_FILE });
    database.close();
  `;
  try {
    const results = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve) => {
      const child = spawn(process.execPath, ["-e", childSource], {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...process.env, DB_MODULE: databaseModule, DB_FILE: filename },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stderr }));
    })));
    assert.deepEqual(results.map((result) => result.code), [0, 0, 0, 0], results.map((result) => result.stderr).join("\n"));
    const recovered = new AutoRoomDatabase({ filename });
    try {
      const after = recoverySnapshot(recovered.connection);
      assert.equal(recovered.connection.pragma("user_version", { simple: true }), 5);
      assert.deepEqual(after.rooms, before.rooms);
      assert.deepEqual(after.grants, before.grants);
      assert.deepEqual(after.reservations, before.reservations);
      assert.equal(after.reservationSql, before.reservationSql);
      assert.equal(after.reservationRootPage, before.reservationRootPage);
      assert.equal(recovered.connection.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='auto_room_number_reservations'"
      ).get().count, 1);
    } finally { recovered.close(); }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
test("v3 reservation validation rejects wrong declared column affinities without mutation", () => {
  const variants = [
    { column: "reservation_id", types: ["BLOB", "TEXT", "INTEGER", "INTEGER"] },
    { column: "guild_id", types: ["TEXT", "INTEGER", "INTEGER", "INTEGER"] },
    { column: "room_number", types: ["TEXT", "TEXT", "TEXT", "INTEGER"] },
    { column: "created_at", types: ["TEXT", "TEXT", "INTEGER", "TEXT"] },
  ];

  for (const { column, types } of variants) {
    const connection = new Database(":memory:");
    new AutoRoomDatabase({ database: connection });
    connection.exec(`
      DROP TABLE auto_room_number_reservations;
      CREATE TABLE auto_room_number_reservations (
        reservation_id ${types[0]} PRIMARY KEY,
        guild_id ${types[1]} NOT NULL,
        room_number ${types[2]} NOT NULL CHECK(room_number >= 1),
        created_at ${types[3]} NOT NULL,
        UNIQUE(guild_id, room_number)
      );
      INSERT INTO auto_room_number_reservations VALUES (1, 100, 1, 10);
      PRAGMA user_version = 3;
    `);
    assert.throws(
      () => new AutoRoomDatabase({ database: connection }),
      new RegExp(`${column} must declare type`)
    );
    assert.equal(connection.pragma("user_version", { simple: true }), 3);
    assert.equal(
      connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
      1
    );
    connection.close();
  }
});

test("reservation release is isolated and resets only after the guild becomes idle", () => {
  const fixture = createFixture();
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  assert.equal(fixture.configs.reserveNextRoomNumber("100", "first", 10), 1);
  assert.equal(fixture.configs.reserveNextRoomNumber("100", "second", 11), 2);
  assert.deepEqual(fixture.configs.releaseNumberReservation("100", "first"), {
    released: true, reset: false,
  });
  assert.equal(
    fixture.database.connection.prepare(
      "SELECT room_number FROM auto_room_number_reservations WHERE reservation_id = 'second'"
    ).get().room_number,
    2
  );
  assert.deepEqual(fixture.configs.releaseNumberReservation("100", "second"), {
    released: true, reset: true,
  });
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 1);
  fixture.database.close();
});

test("unbound reservation remains fenced across arbitrary time advances", () => {
  const fixture = createFixture();
  fixture.configs.upsert({ guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1 });
  fixture.configs.reserveNextRoomNumber("100", "lease", 100);

  assert.equal(fixture.configs.resetNumberingIfNoManagedRooms("100", 200, 50), false);
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 2);
  assert.equal(
    fixture.database.connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
    1
  );
  assert.equal(fixture.configs.resetNumberingIfNoManagedRooms("100", 300, 150), false);
  assert.equal(fixture.configs.findByGuild("100").nextRoomNumber, 2);
  assert.equal(
    fixture.database.connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
    1
  );
  fixture.database.close();
});

test("eight processes reserve unique durable numbers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-room-reservation-process-"));
  const filename = path.join(directory, "rooms.sqlite");
  const database = new AutoRoomDatabase({ filename });
  new SqliteGuildRoomConfigRepository(database).upsert({
    guildId: "100", triggerChannelId: "400", categoryId: "600", updatedAt: 1,
  });
  database.close();
  const databaseModule = path.resolve(__dirname, "../../src/infrastructure/database/AutoRoomDatabase.js");
  const repositoryModule = path.resolve(
    __dirname,
    "../../src/infrastructure/database/repositories/SqliteGuildRoomConfigRepository.js"
  );
  const childSource = `
    const Database = require(process.env.DB_MODULE);
    const Repository = require(process.env.REPO_MODULE);
    const database = new Database({ filename: process.env.DB_FILE });
    const number = new Repository(database).reserveNextRoomNumber(
      "100", process.env.RESERVATION_ID, Number(process.env.CREATED_AT)
    );
    process.stdout.write(String(number));
    database.close();
  `;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolve) => {
      const child = spawn(process.execPath, ["-e", childSource], {
        cwd: path.resolve(__dirname, "../.."),
        env: {
          ...process.env,
          DB_MODULE: databaseModule,
          REPO_MODULE: repositoryModule,
          DB_FILE: filename,
          RESERVATION_ID: `process-${index}`,
          CREATED_AT: String(10 + index),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    })));
    assert.deepEqual(results.map((result) => result.code), Array(8).fill(0), results.map((r) => r.stderr).join("\n"));
    assert.deepEqual(results.map((result) => Number(result.stdout)).sort((a, b) => a - b), [1,2,3,4,5,6,7,8]);
    const reopened = new AutoRoomDatabase({ filename });
    assert.equal(
      reopened.connection.prepare("SELECT COUNT(*) AS count FROM auto_room_number_reservations").get().count,
      8
    );
    assert.equal(new SqliteGuildRoomConfigRepository(reopened).findByGuild("100").nextRoomNumber, 9);
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
