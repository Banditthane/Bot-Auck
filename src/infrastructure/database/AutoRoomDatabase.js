const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const AutoRoomDatabaseError = require("./AutoRoomDatabaseError");

const V1_COLUMNS = Object.freeze({
  auto_rooms: [
    "channel_id", "guild_id", "owner_id", "trigger_channel_id", "mode", "user_limit",
    "pin_hash", "system_marker", "created_at", "updated_at", "last_renamed_at",
  ],
  room_grants: ["channel_id", "user_id", "access", "expires_at"],
  guild_room_configs: [
    "guild_id", "trigger_channel_id", "category_id", "log_channel_id", "moderator_role_id",
    "default_name_template", "default_user_limit", "empty_delete_delay_seconds", "enabled",
    "created_at", "updated_at",
  ],
});

const V2_COLUMNS = Object.freeze({
  auto_rooms: [...V1_COLUMNS.auto_rooms, "room_number"],
  room_grants: V1_COLUMNS.room_grants,
  guild_room_configs: [...V1_COLUMNS.guild_room_configs, "next_room_number"],
});

const V3_COLUMNS = Object.freeze({
  ...V2_COLUMNS,
  auto_room_number_reservations: ["reservation_id", "guild_id", "room_number", "created_at"],
});
const V4_COLUMNS = Object.freeze({
  ...V2_COLUMNS,
  auto_room_number_reservations: [
    "reservation_id", "guild_id", "room_number", "created_at",
    "channel_id", "state", "updated_at",
  ],
});
const V5_COLUMNS = V4_COLUMNS;

const RESERVATION_STATES = Object.freeze({
  V4: Object.freeze(["reserved", "channel_created", "orphaned"]),
  V5: Object.freeze(["reserved", "channel_created", "orphaned", "cleaning"]),
});

const REQUIRED_LEGACY_COLUMNS = Object.freeze({
  auto_rooms: ["channel_id", "guild_id", "owner_id", "trigger_channel_id"],
  room_grants: ["channel_id", "user_id", "access"],
  guild_room_configs: ["guild_id", "trigger_channel_id", "category_id"],
});

const V1_SCHEMA = `
  CREATE TABLE IF NOT EXISTS auto_rooms (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    trigger_channel_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('open', 'locked', 'hidden')),
    user_limit INTEGER NOT NULL DEFAULT 0 CHECK (user_limit BETWEEN 0 AND 99),
    pin_hash TEXT,
    system_marker TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_renamed_at INTEGER,
    UNIQUE (guild_id, owner_id)
  );

  CREATE TABLE IF NOT EXISTS room_grants (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('allowed', 'denied')),
    expires_at INTEGER,
    PRIMARY KEY (channel_id, user_id),
    FOREIGN KEY (channel_id) REFERENCES auto_rooms(channel_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS guild_room_configs (
    guild_id TEXT PRIMARY KEY,
    trigger_channel_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    log_channel_id TEXT,
    moderator_role_id TEXT,
    default_name_template TEXT NOT NULL DEFAULT '{displayName}''s room',
    default_user_limit INTEGER NOT NULL DEFAULT 0 CHECK (default_user_limit BETWEEN 0 AND 99),
    empty_delete_delay_seconds INTEGER NOT NULL DEFAULT 5 CHECK (empty_delete_delay_seconds BETWEEN 0 AND 300),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

class AutoRoomDatabase {
  constructor({ filename, database, migrationHooks = {} } = {}) {
    this.filename = filename || process.env.AUTO_ROOM_DB_PATH || path.resolve(
      __dirname,
      "../../../data/auto-voice-rooms.sqlite"
    );

    if (database) {
      this.connection = database;
      this.ownsConnection = false;
    } else {
      if (this.filename !== ":memory:") {
        fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      }
      this.connection = new Database(this.filename);
      this.ownsConnection = true;
    }

    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 5000");
    this.migrationHooks = migrationHooks;
    if (this.filename !== ":memory:") {
      enableWalWithBusyRetry(this.connection, 5000);
    }
    this.migrate();
  }

  migrate() {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const currentVersion = this.connection.pragma("user_version", { simple: true });
      this._migrateLocked(currentVersion);
      this.connection.exec("COMMIT");
    } catch (error) {
      if (this.connection.inTransaction) this.connection.exec("ROLLBACK");
      if (error instanceof AutoRoomDatabaseError || /^SQLITE_(BUSY|LOCKED)/.test(error?.code || "")) {
        throw error;
      }
      throw new AutoRoomDatabaseError(error?.message, { cause: error });
    }
  }

  _migrateLocked(currentVersion) {
    if (currentVersion > 5) {
      throw new Error(`Unsupported Auto Voice Room database version ${currentVersion}.`);
    }
    if (currentVersion === 5) {
      this._validateV5Schema();
      this._repairRoomNumberCounters();
      return;
    }
    if (currentVersion === 4) {
      this._migrateVersion4Locked();
      return;
    }
    if (currentVersion === 3) {
      this._validateV3Schema();
      this._migrateV3ToV4Locked();
      this._migrateV4ToV5Locked();
      return;
    }
    if (currentVersion === 2) {
      this._validateV2Schema();
      this._migrateV2ToV3Locked();
      this._migrateV3ToV4Locked();
      this._migrateV4ToV5Locked();
      return;
    }
    if (currentVersion === 1) {
      this._validateV1Schema();
      this._migrateV1ToV2Locked();
      this._migrateV2ToV3Locked();
      this._migrateV3ToV4Locked();
      this._migrateV4ToV5Locked();
      return;
    }

    const existing = Object.keys(V1_COLUMNS).filter((table) => this._tableExists(table));
    const hasCompleteV5Columns = Object.entries(V5_COLUMNS).every(([table, expected]) => (
      this._tableExists(table) && expected.every((column) => this._tableColumns(table).has(column))
    ));
    if (hasCompleteV5Columns) {
      this._validateV5Schema();
      this._repairRoomNumberCounters();
      this.connection.pragma("user_version = 5");
      return;
    }
    if (this._tableExists("auto_room_number_reservations")) {
      throw new Error("Cannot migrate unversioned database with an incomplete or invalid v3 schema.");
    }
    const hasV2OnlyColumn = (
      (this._tableExists("auto_rooms") && this._tableColumns("auto_rooms").has("room_number")) ||
      (this._tableExists("guild_room_configs") &&
        this._tableColumns("guild_room_configs").has("next_room_number"))
    );
    const hasCompleteV2Columns = Object.entries(V2_COLUMNS).every(([table, expected]) => (
      this._tableExists(table) && expected.every((column) => this._tableColumns(table).has(column))
    ));

    if (hasCompleteV2Columns) {
      this._validateV2Schema();
      this._migrateV2ToV3Locked();
      this._migrateV3ToV4Locked();
      this._migrateV4ToV5Locked();
      return;
    }
    if (hasV2OnlyColumn) {
      throw new Error("Cannot migrate unversioned database with an incomplete or invalid v2 schema.");
    }

    for (const table of existing) {
      const columns = this._tableColumns(table);
      const missingRequired = REQUIRED_LEGACY_COLUMNS[table].filter((column) => !columns.has(column));
      if (missingRequired.length > 0) {
        throw new Error(
          `Cannot migrate legacy ${table}: missing required columns ${missingRequired.join(", ")}.`
        );
      }
    }
    // Any unversioned table is rebuilt so v1 constraints are not falsely assumed
    // merely because a legacy table happened to use the same column names.
    const requiresRebuild = existing.length > 0;

    if (requiresRebuild) this._rebuildLegacyTables(existing);
    this.connection.exec(V1_SCHEMA);
    this._validateV1Schema();
    this.connection.pragma("user_version = 1");
    this._migrateV1ToV2Locked();
    this._migrateV2ToV3Locked();
    this._migrateV3ToV4Locked();
    this._migrateV4ToV5Locked();
  }

  _migrateVersion4Locked() {
    this._validateV4Shape();
    const stateShape = this._classifyReservationStateConstraint();
    if (stateShape === "v4") {
      this._validateV4Schema();
      this._migrateV4ToV5Locked();
      return;
    }
    if (stateShape !== "v5") {
      throw new AutoRoomDatabaseError("Database schema v4 reservation state constraint is invalid.");
    }

    this._checkpoint("beforeHybridValidation");
    this._validateExactV5Schema();
    this._repairRoomNumberCounters();
    this._checkpoint("afterHybridCounterRepair");
    this._validateExactV5Schema();
    this._checkpoint("beforeHybridVersionStamp");
    this.connection.pragma("user_version = 5");
  }

  _migrateV1ToV2Locked() {
    this.connection.exec(`
      ALTER TABLE guild_room_configs ADD COLUMN next_room_number
        INTEGER NOT NULL DEFAULT 1 CHECK(next_room_number >= 1);
      ALTER TABLE auto_rooms ADD COLUMN room_number
        INTEGER CHECK(room_number IS NULL OR room_number >= 1);
      CREATE UNIQUE INDEX auto_rooms_guild_room_number_unique
        ON auto_rooms(guild_id, room_number)
        WHERE room_number IS NOT NULL;
    `);
    this._repairRoomNumberCounters();
    this._validateV2Schema();
    this.connection.pragma("user_version = 2");
  }

  _migrateV2ToV3Locked() {
    this.connection.exec(`
      CREATE TABLE auto_room_number_reservations (
        reservation_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        room_number INTEGER NOT NULL CHECK(room_number >= 1),
        created_at INTEGER NOT NULL,
        UNIQUE(guild_id, room_number)
      );
    `);
    this._repairRoomNumberCounters();
    this._validateV3Schema();
    this.connection.pragma("user_version = 3");
  }

  _migrateV3ToV4Locked() {
    this.connection.exec(`
      ALTER TABLE auto_room_number_reservations
        ADD COLUMN channel_id TEXT;
      ALTER TABLE auto_room_number_reservations
        ADD COLUMN state TEXT NOT NULL DEFAULT 'reserved'
          CHECK(state IN ('reserved', 'channel_created', 'orphaned'));
      ALTER TABLE auto_room_number_reservations
        ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
      UPDATE auto_room_number_reservations SET updated_at = created_at;
    `);
    this._validateV4Schema();
    this.connection.pragma("user_version = 4");
  }

  _migrateV4ToV5Locked() {
    this.connection.exec(`
      ALTER TABLE auto_room_number_reservations
        RENAME TO auto_room_number_reservations_v4;
      CREATE TABLE auto_room_number_reservations (
        reservation_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        room_number INTEGER NOT NULL CHECK(room_number >= 1),
        created_at INTEGER NOT NULL,
        channel_id TEXT,
        state TEXT NOT NULL CHECK(state IN ('reserved', 'channel_created', 'orphaned', 'cleaning')),
        updated_at INTEGER NOT NULL,
        UNIQUE(guild_id, room_number)
      );
      INSERT INTO auto_room_number_reservations (
        reservation_id, guild_id, room_number, created_at, channel_id, state, updated_at
      ) SELECT
        reservation_id, guild_id, room_number, created_at, channel_id, state, updated_at
      FROM auto_room_number_reservations_v4;
      DROP TABLE auto_room_number_reservations_v4;
    `);
    this._validateV5Schema();
    this._repairRoomNumberCounters();
    this.connection.pragma("user_version = 5");
  }

  _repairRoomNumberCounters() {
    const reservedNext = this._tableExists("auto_room_number_reservations")
      ? `COALESCE((
          SELECT MAX(auto_room_number_reservations.room_number) + 1
          FROM auto_room_number_reservations
          WHERE auto_room_number_reservations.guild_id = guild_room_configs.guild_id
        ), 1)`
      : "1";
    this.connection.exec(`
      UPDATE guild_room_configs
      SET next_room_number = MAX(
        next_room_number,
        COALESCE((
          SELECT MAX(auto_rooms.room_number) + 1
          FROM auto_rooms
          WHERE auto_rooms.guild_id = guild_room_configs.guild_id
            AND auto_rooms.room_number IS NOT NULL
        ), 1),
        ${reservedNext}
      )
    `);
  }

  _tableExists(table) {
    return Boolean(this.connection.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table));
  }

  _tableColumns(table) {
    return new Set(this.connection.pragma(`table_info(${table})`).map((column) => column.name));
  }

  _validateV1Schema() {
    for (const [table, expectedColumns] of Object.entries(V1_COLUMNS)) {
      if (!this._tableExists(table)) throw new Error(`Database schema v1 is missing table ${table}.`);
      const columns = this._tableColumns(table);
      const missing = expectedColumns.filter((column) => !columns.has(column));
      if (missing.length > 0) {
        throw new Error(`Database schema v1 table ${table} is missing ${missing.join(", ")}.`);
      }
    }
    const roomInfo = this.connection.pragma("table_info(auto_rooms)");
    if (roomInfo.find((column) => column.name === "channel_id")?.pk !== 1) {
      throw new Error("Database schema v1 auto_rooms.channel_id is not a primary key.");
    }
    const uniqueIndexes = this.connection.pragma("index_list(auto_rooms)")
      .filter((index) => index.unique)
      .map((index) => this.connection.pragma(`index_info(${index.name})`).map((entry) => entry.name).join(","));
    if (!uniqueIndexes.includes("guild_id,owner_id")) {
      throw new Error("Database schema v1 is missing the guild/owner unique constraint.");
    }
    const grantForeignKey = this.connection.pragma("foreign_key_list(room_grants)").find((entry) => (
      entry.table === "auto_rooms" && entry.from === "channel_id" &&
      entry.to === "channel_id" && entry.on_delete === "CASCADE"
    ));
    if (!grantForeignKey) {
      throw new Error("Database schema v1 is missing the room grant cascade foreign key.");
    }
  }

  _validateV2Schema() {
    this._validateV1Schema();
    for (const [table, expectedColumns] of Object.entries(V2_COLUMNS)) {
      const columns = this._tableColumns(table);
      const missing = expectedColumns.filter((column) => !columns.has(column));
      if (missing.length > 0) {
        throw new Error(`Database schema v2 table ${table} is missing ${missing.join(", ")}.`);
      }
    }
    const indexName = "auto_rooms_guild_room_number_unique";
    const indexMetadata = this.connection.pragma("index_list(auto_rooms)")
      .find((entry) => entry.name === indexName);
    const indexColumns = indexMetadata
      ? this.connection.pragma(`index_info(${indexName})`).map((entry) => entry.name)
      : [];
    const indexDefinition = this.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = 'auto_rooms'"
    ).get(indexName);
    const normalizedSql = indexDefinition?.sql?.replace(/\s+/g, " ").trim().replace(/;$/, "") || "";
    if (
      indexMetadata?.unique !== 1 || indexMetadata?.partial !== 1 ||
      indexColumns.length !== 2 || indexColumns[0] !== "guild_id" ||
      indexColumns[1] !== "room_number" ||
      !/\bWHERE room_number IS NOT NULL$/i.test(normalizedSql)
    ) {
      throw new Error("Database schema v2 has an invalid room number unique index.");
    }
  }

  _validateV3Schema() {
    this._validateV2Schema();
    const table = "auto_room_number_reservations";
    if (!this._tableExists(table)) {
      throw new Error("Database schema v3 is missing table auto_room_number_reservations.");
    }
    const info = this.connection.pragma(`table_info(${table})`);
    const columns = info.map((column) => column.name);
    if (
      columns.length !== V3_COLUMNS[table].length ||
      !V3_COLUMNS[table].every((column, index) => columns[index] === column)
    ) {
      throw new Error("Database schema v3 reservation table has invalid columns.");
    }
    const expectedTypes = {
      reservation_id: "TEXT",
      guild_id: "TEXT",
      room_number: "INTEGER",
      created_at: "INTEGER",
    };
    for (const [column, expectedType] of Object.entries(expectedTypes)) {
      const actualType = String(info.find((entry) => entry.name === column)?.type || "")
        .trim().toUpperCase();
      if (actualType !== expectedType) {
        throw new Error(
          `Database schema v3 reservation ${column} must declare type ${expectedType}.`
        );
      }
    }
    if (info.find((column) => column.name === "reservation_id")?.pk !== 1) {
      throw new Error("Database schema v3 reservation_id is not a primary key.");
    }
    for (const column of ["guild_id", "room_number", "created_at"]) {
      if (info.find((entry) => entry.name === column)?.notnull !== 1) {
        throw new Error(`Database schema v3 reservation ${column} must be NOT NULL.`);
      }
    }
    const hasGuildNumberUnique = this.connection.pragma(`index_list(${table})`)
      .filter((index) => index.unique === 1)
      .some((index) => {
        const indexColumns = this.connection.pragma(`index_info(${index.name})`)
          .map((entry) => entry.name);
        return indexColumns.length === 2 && indexColumns[0] === "guild_id" &&
          indexColumns[1] === "room_number";
      });
    if (!hasGuildNumberUnique) {
      throw new Error("Database schema v3 is missing the guild/room reservation unique constraint.");
    }
    const tableDefinition = this.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table)?.sql?.replace(/\s+/g, " ") || "";
    if (!/CHECK\s*\(\s*room_number\s*>=\s*1\s*\)/i.test(tableDefinition)) {
      throw new Error("Database schema v3 reservation room_number constraint is invalid.");
    }
  }

  _validateV4Schema() {
    this._validateV4Shape();
    if (this._classifyReservationStateConstraint() !== "v4") {
      throw new Error("Database schema v4 reservation state constraint is invalid.");
    }
  }

  _validateV5Schema() {
    this._validateV4Shape();
    if (this._classifyReservationStateConstraint() !== "v5") {
      throw new Error("Database schema v5 reservation state constraint is invalid.");
    }
  }

  _validateExactV5Schema() {
    this._validateV5Schema();
    this._validateExactBaseShape();
    const integrity = this.connection.pragma("integrity_check");
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("Database integrity check failed.");
    }
    if (this.connection.pragma("foreign_key_check").length !== 0) {
      throw new Error("Database foreign key check failed.");
    }
  }

  _validateV4Shape() {
    this._validateV2Schema();
    const original = this.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auto_room_number_reservations'"
    ).get()?.sql;
    if (!original) throw new Error("Database schema reservation table is missing.");
    const normalized = original.replace(/\s+/g, " ");
    const table = "auto_room_number_reservations";
    const info = this.connection.pragma(`table_info(${table})`);
    const expected = V5_COLUMNS[table];
    if (info.length !== expected.length || !expected.every((name, index) => info[index].name === name)) throw new Error("Database schema v5 reservation table has invalid columns.");
    const types = { reservation_id: "TEXT", guild_id: "TEXT", room_number: "INTEGER", created_at: "INTEGER", channel_id: "TEXT", state: "TEXT", updated_at: "INTEGER" };
    for (const [name, type] of Object.entries(types)) if (String(info.find((entry) => entry.name === name)?.type || "").toUpperCase() !== type) throw new Error(`Database schema v5 reservation ${name} must declare type ${type}.`);
    if (info.find((entry) => entry.name === "reservation_id")?.pk !== 1) throw new Error("Database schema v5 reservation_id is not a primary key.");
    for (const name of ["guild_id", "room_number", "created_at", "state", "updated_at"]) if (info.find((entry) => entry.name === name)?.notnull !== 1) throw new Error(`Database schema v5 reservation ${name} must be NOT NULL.`);
    const unique = this.connection.pragma(`index_list(${table})`).filter((index) => index.unique === 1).some((index) => { const columns = this.connection.pragma(`index_info(${index.name})`).map((entry) => entry.name); return columns.length === 2 && columns[0] === "guild_id" && columns[1] === "room_number"; });
    if (!unique) throw new Error("Database schema v5 is missing the guild/room reservation unique constraint.");
    const roomNumberChecks = extractCheckExpressions(normalized)
      .filter((expression) => /\broom_number\b/i.test(expression));
    if (
      roomNumberChecks.length !== 1 ||
      normalizeCheck(roomNumberChecks[0]) !== "check(room_number>=1)"
    ) throw new Error("Database schema v5 reservation room_number constraint is invalid.");
  }

  _classifyReservationStateConstraint() {
    const sql = this.connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auto_room_number_reservations'"
    ).get()?.sql || "";
    const stateChecks = extractCheckExpressions(sql).filter((expression) => /\bstate\b/i.test(expression));
    if (stateChecks.length !== 1) return "invalid";
    const match = stateChecks[0].match(/^CHECK\s*\(\s*state\s+IN\s*\((.*)\)\s*\)$/i);
    if (!match) return "invalid";
    const values = [...match[1].matchAll(/'([^']*)'/g)].map((entry) => entry[1]);
    const residue = match[1].replace(/'[^']*'/g, "").replace(/[\s,]/g, "");
    if (residue) return "invalid";
    if (sameValues(values, RESERVATION_STATES.V4)) return "v4";
    if (sameValues(values, RESERVATION_STATES.V5)) return "v5";
    return "invalid";
  }

  _validateExactBaseShape() {
    const shapes = {
      auto_rooms: {
        columns: V2_COLUMNS.auto_rooms,
        types: ["TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "INTEGER", "TEXT", "TEXT", "INTEGER", "INTEGER", "INTEGER", "INTEGER"],
        notnull: [0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0],
        pk: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      room_grants: {
        columns: V2_COLUMNS.room_grants,
        types: ["TEXT", "TEXT", "TEXT", "INTEGER"],
        notnull: [1, 1, 1, 0],
        pk: [1, 2, 0, 0],
      },
      guild_room_configs: {
        columns: V2_COLUMNS.guild_room_configs,
        types: ["TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "INTEGER", "INTEGER", "INTEGER", "INTEGER", "INTEGER", "INTEGER"],
        notnull: [0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1],
        pk: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    };
    for (const [table, expected] of Object.entries(shapes)) {
      const info = this.connection.pragma(`table_info(${table})`);
      if (info.length !== expected.columns.length) throw new Error(`Database schema table ${table} has invalid columns.`);
      info.forEach((column, index) => {
        if (
          column.name !== expected.columns[index] ||
          String(column.type).trim().toUpperCase() !== expected.types[index] ||
          column.notnull !== expected.notnull[index] || column.pk !== expected.pk[index]
        ) throw new Error(`Database schema table ${table} has an invalid declaration.`);
      });
    }
    const requiredChecks = {
      auto_rooms: [
        "check(modein('open','locked','hidden'))",
        "check(user_limitbetween0and99)",
        "check(room_numberisnullorroom_number>=1)",
      ],
      room_grants: ["check(accessin('allowed','denied'))"],
      guild_room_configs: [
        "check(default_user_limitbetween0and99)",
        "check(empty_delete_delay_secondsbetween0and300)",
        "check(enabledin(0,1))",
        "check(next_room_number>=1)",
      ],
    };
    for (const [table, expectedChecks] of Object.entries(requiredChecks)) {
      const sql = this.connection.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table)?.sql || "";
      const actualChecks = extractCheckExpressions(sql).map(normalizeCheck);
      for (const expected of expectedChecks) {
        if (actualChecks.filter((check) => check === expected).length !== 1) {
          throw new Error(`Database schema table ${table} has an invalid CHECK constraint.`);
        }
      }
    }
  }

  _checkpoint(name) {
    const hook = this.migrationHooks?.[name];
    if (typeof hook === "function") hook();
  }
  _rebuildLegacyTables(existing) {
    const legacyNames = new Set(existing);
    for (const table of ["room_grants", "guild_room_configs", "auto_rooms"]) {
      if (legacyNames.has(table)) {
        this.connection.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy_v0`);
      }
    }
    this.connection.exec(V1_SCHEMA);

    const expression = (columns, name, fallback) => columns.has(name) ? name : fallback;
    if (legacyNames.has("auto_rooms")) {
      const columns = this._tableColumns("auto_rooms_legacy_v0");
      this.connection.exec(`
        INSERT INTO auto_rooms (
          channel_id, guild_id, owner_id, trigger_channel_id, mode, user_limit, pin_hash,
          system_marker, created_at, updated_at, last_renamed_at
        ) SELECT
          channel_id, guild_id, owner_id, trigger_channel_id,
          ${expression(columns, "mode", "'open'")},
          ${expression(columns, "user_limit", "0")},
          ${expression(columns, "pin_hash", "NULL")},
          ${expression(columns, "system_marker", "'auto_voice_room:v1'")},
          ${expression(columns, "created_at", "0")},
          ${expression(columns, "updated_at", expression(columns, "created_at", "0"))},
          ${expression(columns, "last_renamed_at", "NULL")}
        FROM auto_rooms_legacy_v0
      `);
    }
    if (legacyNames.has("guild_room_configs")) {
      const columns = this._tableColumns("guild_room_configs_legacy_v0");
      this.connection.exec(`
        INSERT INTO guild_room_configs (
          guild_id, trigger_channel_id, category_id, log_channel_id, moderator_role_id,
          default_name_template, default_user_limit, empty_delete_delay_seconds, enabled,
          created_at, updated_at
        ) SELECT
          guild_id, trigger_channel_id, category_id,
          ${expression(columns, "log_channel_id", "NULL")},
          ${expression(columns, "moderator_role_id", "NULL")},
          ${expression(columns, "default_name_template", "'{displayName}''s room'")},
          ${expression(columns, "default_user_limit", "0")},
          ${expression(columns, "empty_delete_delay_seconds", "5")},
          ${expression(columns, "enabled", "1")},
          ${expression(columns, "created_at", "0")},
          ${expression(columns, "updated_at", expression(columns, "created_at", "0"))}
        FROM guild_room_configs_legacy_v0
      `);
    }
    if (legacyNames.has("room_grants")) {
      const columns = this._tableColumns("room_grants_legacy_v0");
      this.connection.exec(`
        INSERT INTO room_grants (channel_id, user_id, access, expires_at)
        SELECT channel_id, user_id, access, ${expression(columns, "expires_at", "NULL")}
        FROM room_grants_legacy_v0
        WHERE channel_id IN (SELECT channel_id FROM auto_rooms)
      `);
    }

    for (const table of ["room_grants", "guild_room_configs", "auto_rooms"]) {
      if (legacyNames.has(table)) this.connection.exec(`DROP TABLE ${table}_legacy_v0`);
    }
  }

  transaction(fn) {
    return this.connection.transaction(fn);
  }

  close() {
    if (this.ownsConnection && this.connection.open) {
      this.connection.close();
    }
  }
}

module.exports = AutoRoomDatabase;

function sameValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function extractCheckExpressions(sql) {
  const expressions = [];
  const upper = sql.toUpperCase();
  let offset = 0;
  while (offset < sql.length) {
    const checkAt = upper.indexOf("CHECK", offset);
    if (checkAt === -1) break;
    let cursor = checkAt + 5;
    while (/\s/.test(sql[cursor] || "")) cursor += 1;
    if (sql[cursor] !== "(") { offset = cursor; continue; }
    let depth = 0;
    let quoted = false;
    for (let end = cursor; end < sql.length; end += 1) {
      const character = sql[end];
      if (character === "'") {
        if (quoted && sql[end + 1] === "'") { end += 1; continue; }
        quoted = !quoted;
      } else if (!quoted && character === "(") depth += 1;
      else if (!quoted && character === ")") {
        depth -= 1;
        if (depth === 0) {
          expressions.push(sql.slice(checkAt, end + 1).replace(/\s+/g, " ").trim());
          offset = end + 1;
          break;
        }
      }
    }
    if (offset <= checkAt) break;
  }
  return expressions;
}

function normalizeCheck(expression) {
  return expression.replace(/\s+/g, "").toLowerCase();
}

function enableWalWithBusyRetry(connection, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      if (connection.pragma("journal_mode", { simple: true }) !== "wal") {
        connection.pragma("journal_mode = WAL");
      }
      return;
    } catch (error) {
      if (!/^SQLITE_(BUSY|LOCKED)/.test(error?.code || "") || Date.now() >= deadline) throw error;
      Atomics.wait(signal, 0, 0, 25);
    }
  }
}
