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
  auto_role_configs: ["guild_id", "enabled", "removal_semantics", "created_at", "updated_at"],
  auto_role_rules: [
    "rule_id", "guild_id", "name", "enabled", "trigger", "required_role_ids", "excluded_role_ids", "target_role_ids",
    "remove_role_ids", "priority", "exclusive_group", "conflict_policy", "stop_on_match", "created_by", "created_at",
    "updated_at", "deleted_at",
  ],
  auto_role_audit_logs: ["id", "guild_id", "user_id", "rule_id", "action", "role_id", "result", "actor_id", "trace_id", "created_at"],
  member_automation_jobs: [
    "id", "guild_id", "job_type", "status", "scope_id", "options_json", "cursor", "total_count", "processed_count",
    "success_count", "skipped_count", "failed_count", "retry_count", "lease_owner", "lease_until", "last_error_code",
    "created_by", "trace_id", "created_at", "started_at", "updated_at", "completed_at",
  ],
  member_automation_operations: ["id", "guild_id", "user_id", "rule_id", "status", "expected_json", "actor_id", "trace_id", "created_at", "updated_at"],
  interaction_sessions: ["session_id", "guild_id", "owner_id", "kind", "status", "payload_json", "expires_at", "created_at", "updated_at"],
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

const SCHEMA_V2 = `
CREATE TABLE auto_role_configs (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  removal_semantics INTEGER NOT NULL CHECK(removal_semantics IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE auto_role_rules (
  rule_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  trigger TEXT NOT NULL CHECK(trigger IN ('MEMBER_JOIN', 'ROLE_ADDED', 'MANUAL_SCAN', 'MANUAL_REPAIR')),
  required_role_ids TEXT NOT NULL,
  excluded_role_ids TEXT NOT NULL,
  target_role_ids TEXT NOT NULL,
  remove_role_ids TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 1000),
  exclusive_group TEXT,
  conflict_policy TEXT NOT NULL CHECK(conflict_policy IN ('SKIP_IF_CONFLICT', 'KEEP_EXISTING', 'REPLACE_LOWER_PRIORITY', 'REPLACE_ALL_IN_GROUP')),
  stop_on_match INTEGER NOT NULL CHECK(stop_on_match IN (0, 1)),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX auto_role_rules_guild_trigger ON auto_role_rules(guild_id, trigger, enabled, priority);
CREATE TABLE auto_role_audit_logs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rule_id TEXT,
  action TEXT NOT NULL,
  role_id TEXT,
  result TEXT NOT NULL,
  actor_id TEXT,
  trace_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX auto_role_audit_guild_time ON auto_role_audit_logs(guild_id, created_at);
CREATE TABLE member_automation_jobs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  scope_id TEXT,
  options_json TEXT NOT NULL,
  cursor TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 10),
  lease_owner TEXT,
  lease_until INTEGER,
  last_error_code TEXT,
  created_by TEXT NOT NULL,
  trace_id TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK(status != 'running' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX member_automation_one_active_job
  ON member_automation_jobs(guild_id, job_type, COALESCE(scope_id, '')) WHERE status IN ('queued', 'running');
CREATE TABLE member_automation_operations (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rule_id TEXT,
  status TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  actor_id TEXT,
  trace_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX member_automation_operations_lookup ON member_automation_operations(guild_id, user_id, status);
CREATE TABLE interaction_sessions (
  session_id TEXT PRIMARY KEY,
  guild_id TEXT,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CANCELLED', 'EXPIRED', 'COMPLETED')),
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX interaction_sessions_owner ON interaction_sessions(owner_id, status, expires_at);
PRAGMA user_version = 2;
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
      if (version > 2) throw new Error(`Unsupported Auto Name database version ${version}.`);
      if (version === 0) {
        const existing = Object.keys(TABLES).filter((table) => this._tableExists(table));
        if (existing.length > 0) throw new Error("Unversioned Auto Name database contains managed tables.");
        this.connection.exec(SCHEMA);
      }
      if (version <= 1) this.migrateToV2();
      this.validate();
      this.connection.exec("COMMIT");
    } catch (error) {
      if (this.connection.inTransaction) this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  validate() {
    if (this.connection.pragma("user_version", { simple: true }) !== 2) throw new Error("Auto Name schema version is invalid.");
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

  migrateToV2() {
    this.connection.exec(SCHEMA_V2);
  }

  close() {
    if (this.ownsConnection && this.connection.open) this.connection.close();
  }
}

module.exports = AutoNameDatabase;
module.exports.SCHEMA = SCHEMA;
module.exports.SCHEMA_V2 = SCHEMA_V2;
module.exports.TABLES = TABLES;
