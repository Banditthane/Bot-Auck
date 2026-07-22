const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const TABLES = Object.freeze({
  guild_auto_name_configs: ["guild_id", "enabled", "required_role_id", "template", "code_length", "created_at", "updated_at"],
  guild_member_codes: ["guild_id", "user_id", "member_number", "created_at", "updated_at"],
  guild_member_counters: ["guild_id", "next_number", "updated_at"],
  auto_name_audit_logs: ["id", "guild_id", "user_id", "old_nickname", "new_nickname", "action", "actor_id", "trace_id", "created_at"],
  auto_name_scan_jobs: [
    "id", "guild_id", "status", "missing_only", "force", "dry_run", "subset_role_id", "cursor_user_id",
    "scanned_count", "eligible_count", "renamed_count", "skipped_count", "failed_count", "retry_count",
    "lease_owner", "lease_until", "last_error_code", "created_by", "created_at", "started_at", "updated_at", "completed_at",
  ],
});

const SCHEMA = `
CREATE TABLE guild_auto_name_configs (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  required_role_id TEXT NOT NULL,
  template TEXT NOT NULL,
  code_length INTEGER NOT NULL CHECK(code_length BETWEEN 1 AND 12),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE guild_member_codes (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_number INTEGER NOT NULL CHECK(member_number >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id, user_id),
  UNIQUE(guild_id, member_number)
);
CREATE TABLE guild_member_counters (
  guild_id TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL CHECK(next_number >= 1),
  updated_at INTEGER NOT NULL
);
CREATE TABLE auto_name_audit_logs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  old_nickname TEXT,
  new_nickname TEXT,
  action TEXT NOT NULL CHECK(action IN ('join', 'role-add', 'repair', 'scan')),
  actor_id TEXT,
  trace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX auto_name_audit_guild_time ON auto_name_audit_logs(guild_id, created_at);
CREATE TABLE auto_name_scan_jobs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  missing_only INTEGER NOT NULL CHECK(missing_only IN (0, 1)),
  force INTEGER NOT NULL CHECK(force IN (0, 1)),
  dry_run INTEGER NOT NULL CHECK(dry_run IN (0, 1)),
  subset_role_id TEXT,
  cursor_user_id TEXT,
  scanned_count INTEGER NOT NULL DEFAULT 0 CHECK(scanned_count >= 0),
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK(eligible_count >= 0),
  renamed_count INTEGER NOT NULL DEFAULT 0 CHECK(renamed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 10),
  lease_owner TEXT,
  lease_until INTEGER,
  last_error_code TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK(NOT(missing_only = 1 AND force = 1)),
  CHECK(status != 'running' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX auto_name_one_active_scan_per_guild
  ON auto_name_scan_jobs(guild_id) WHERE status IN ('queued', 'running');
PRAGMA user_version = 1;
`;

class AutoNameDatabase {
  constructor({ filename, database } = {}) {
    this.filename = filename || process.env.AUTO_NAME_DB_PATH || path.resolve(__dirname, "../../../data/auto-name.sqlite");
    if (database) {
      this.connection = database;
      this.ownsConnection = false;
    } else {
      if (this.filename !== ":memory:") fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      this.connection = new Database(this.filename);
      this.ownsConnection = true;
    }
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 5000");
    try {
      if (this.filename !== ":memory:") this.connection.pragma("journal_mode = WAL");
      this.migrate();
    } catch (error) {
      if (this.ownsConnection && this.connection.open) this.connection.close();
      throw error;
    }
  }

  migrate() {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const version = this.connection.pragma("user_version", { simple: true });
      if (version > 1) throw new Error(`Unsupported Auto Name database version ${version}.`);
      if (version === 0) {
        const existing = Object.keys(TABLES).filter((table) => this._tableExists(table));
        if (existing.length > 0) throw new Error("Unversioned Auto Name database contains managed tables.");
        this.connection.exec(SCHEMA);
      }
      this.validate();
      this.connection.exec("COMMIT");
    } catch (error) {
      if (this.connection.inTransaction) this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  validate() {
    if (this.connection.pragma("user_version", { simple: true }) !== 1) throw new Error("Auto Name schema version is invalid.");
    for (const [table, expected] of Object.entries(TABLES)) {
      if (!this._tableExists(table)) throw new Error(`Auto Name schema is missing ${table}.`);
      const actual = this.connection.pragma(`table_info(${table})`).map((column) => column.name);
      if (actual.length !== expected.length || expected.some((name, index) => actual[index] !== name)) {
        throw new Error(`Auto Name schema has invalid columns for ${table}.`);
      }
    }
    const codeIndexes = this.connection.pragma("index_list(guild_member_codes)").filter((index) => index.unique === 1)
      .map((index) => this.connection.pragma(`index_info(${index.name})`).map((column) => column.name).join(","));
    if (!codeIndexes.includes("guild_id,user_id") || !codeIndexes.includes("guild_id,member_number")) {
      throw new Error("Auto Name member-code uniqueness constraints are invalid.");
    }
    const active = this.connection.pragma("index_list(auto_name_scan_jobs)")
      .find((index) => index.name === "auto_name_one_active_scan_per_guild");
    const activeSql = this.connection.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
      .get("auto_name_one_active_scan_per_guild")?.sql?.replace(/\s+/g, " ") || "";
    if (active?.unique !== 1 || active?.partial !== 1 || !/status IN \('queued', 'running'\)/i.test(activeSql)) {
      throw new Error("Auto Name active-scan index is invalid.");
    }
    const integrity = this.connection.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("Auto Name database integrity check failed.");
  }

  _tableExists(table) {
    return Boolean(this.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }

  close() {
    if (this.ownsConnection && this.connection.open) this.connection.close();
  }
}

module.exports = AutoNameDatabase;
module.exports.SCHEMA = SCHEMA;
module.exports.TABLES = TABLES;
