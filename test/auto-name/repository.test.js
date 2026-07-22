const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Database = require("better-sqlite3");
const AutoNameDatabase = require("../../src/infrastructure/database/AutoNameDatabase");
const ConfigRepository = require("../../src/infrastructure/database/repositories/SqliteAutoNameConfigRepository");
const CodeRepository = require("../../src/infrastructure/database/repositories/SqliteMemberCodeRepository");
const AuditRepository = require("../../src/infrastructure/database/repositories/SqliteAutoNameAuditRepository");
const AutoNameConfig = require("../../src/domain/entities/AutoNameConfig");
const MemberCode = require("../../src/domain/entities/MemberCode");

const GUILD = "10000000000000001";
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-name-repo-"));
  const filename = path.join(directory, "auto-name.sqlite");
  const database = new AutoNameDatabase({ filename });
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, filename, database, configs: new ConfigRepository(database), codes: new CodeRepository(database), audits: new AuditRepository(database) };
}
function config(overrides = {}) {
  return { guildId: GUILD, enabled: true, requiredRoleId: "20000000000000001", template: "{code}",
    codeLength: 6, createdAt: 100, updatedAt: 100, ...overrides };
}

test("schema v1 creates only dedicated Auto Name tables and exact active index", (t) => {
  const { database } = fixture(t);
  assert.equal(database.connection.pragma("user_version", { simple: true }), 1);
  const tables = database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["auto_name_audit_logs", "auto_name_scan_jobs", "guild_auto_name_configs", "guild_member_codes", "guild_member_counters"]);
  assert.equal(tables.some((name) => name.includes("auto_room")), false);
  const index = database.connection.pragma("index_list(auto_name_scan_jobs)").find((entry) => entry.name === "auto_name_one_active_scan_per_guild");
  assert.equal(index.unique, 1); assert.equal(index.partial, 1);
});

test("malformed or unsupported schemas fail closed without stamping", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-name-bad-"));
  const filename = path.join(directory, "bad.sqlite");
  const raw = new Database(filename);
  raw.exec("CREATE TABLE guild_member_codes(guild_id TEXT); PRAGMA user_version=0");
  raw.close();
  assert.throws(() => new AutoNameDatabase({ filename }), /Unversioned/);
  const inspect = new Database(filename, { readonly: true });
  assert.equal(inspect.pragma("user_version", { simple: true }), 0);
  inspect.close(); fs.rmSync(directory, { recursive: true, force: true });
});

test("config repository returns entities and refuses unsafe code-length decrease", (t) => {
  const { configs, codes } = fixture(t);
  const stored = configs.upsert(config());
  assert.ok(stored instanceof AutoNameConfig);
  const allocated = codes.getOrAllocate({ guildId: GUILD, userId: "30000000000000001", codeLength: 6, now: 200 });
  assert.ok(allocated instanceof MemberCode);
  assert.equal(allocated.memberNumber.value, 1);
  assert.throws(() => configs.upsert(config({ codeLength: 0 })), /1\.\.12/);
  configs.setEnabled(GUILD, false, 300);
  assert.equal(configs.findByGuild(GUILD).enabled, false);
});

test("allocation is permanent, monotonic, isolated by guild, and survives reopen", (t) => {
  const fx = fixture(t);
  fx.configs.upsert(config());
  const first = fx.codes.getOrAllocate({ guildId: GUILD, userId: "30000000000000001", codeLength: 6, now: 1 });
  const repeated = fx.codes.getOrAllocate({ guildId: GUILD, userId: "30000000000000001", codeLength: 6, now: 2 });
  const second = fx.codes.getOrAllocate({ guildId: GUILD, userId: "30000000000000002", codeLength: 6, now: 3 });
  const other = fx.codes.getOrAllocate({ guildId: "10000000000000002", userId: "30000000000000001", codeLength: 6, now: 4 });
  assert.equal(first.memberNumber.value, 1); assert.equal(repeated.memberNumber.value, 1);
  assert.equal(second.memberNumber.value, 2); assert.equal(other.memberNumber.value, 1);
  assert.deepEqual(fx.codes.getGuildAllocationStats(GUILD), { guildId: GUILD, allocatedCount: 2, maximumMemberNumber: 2, nextNumber: 3 });
  const secondHandle = new AutoNameDatabase({ filename: fx.filename });
  assert.equal(new CodeRepository(secondHandle).findByGuildUser(GUILD, "30000000000000001").memberNumber.value, 1);
  secondHandle.close();
});

test("code length cannot shrink below an existing allocated number", (t) => {
  const { database, configs, codes } = fixture(t);
  configs.upsert(config({ codeLength: 2 }));
  database.connection.prepare("INSERT INTO guild_member_counters(guild_id,next_number,updated_at) VALUES (?,?,?)")
    .run(GUILD, 10, 1);
  assert.equal(codes.getOrAllocate({ guildId: GUILD, userId: "30000000000000001", codeLength: 2, now: 2 }).memberNumber.value, 10);
  assert.throws(() => configs.upsert(config({ codeLength: 1, updatedAt: 3 })),
    (error) => error.code === "AUTO_NAME_CODE_EXHAUSTED");
  assert.equal(configs.findByGuild(GUILD).codeLength, 2);
});
test("allocation exhaustion rolls back counter and member insert", (t) => {
  const { database, codes } = fixture(t);
  database.connection.prepare("INSERT INTO guild_member_counters(guild_id,next_number,updated_at) VALUES (?,10,0)").run(GUILD);
  assert.throws(() => codes.getOrAllocate({ guildId: GUILD, userId: "30000000000000001", codeLength: 1, now: 1 }),
    (error) => error.code === "AUTO_NAME_CODE_EXHAUSTED");
  assert.equal(codes.findByGuildUser(GUILD, "30000000000000001"), null);
  assert.equal(codes.getGuildAllocationStats(GUILD).nextNumber, 10);
});

test("two handles serialize allocations with unique guild numbers", (t) => {
  const fx = fixture(t);
  const otherDb = new AutoNameDatabase({ filename: fx.filename });
  const other = new CodeRepository(otherDb);
  const results = [];
  for (let index = 0; index < 20; index += 1) {
    const repo = index % 2 ? fx.codes : other;
    results.push(repo.getOrAllocate({ guildId: GUILD, userId: String(30000000000000001n + BigInt(index)), codeLength: 6, now: index }).memberNumber.value);
  }
  assert.deepEqual([...results].sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  otherDb.close();
});

test("multiple processes allocate unique permanent numbers", async (t) => {
  const fx = fixture(t);
  fx.database.close();
  const modulePath = path.resolve(__dirname, "../../src/infrastructure/database/AutoNameDatabase.js");
  const repoPath = path.resolve(__dirname, "../../src/infrastructure/database/repositories/SqliteMemberCodeRepository.js");
  const source = `const DB=require(process.argv[1]);const Repo=require(process.argv[2]);const db=new DB({filename:process.argv[3]});` +
    `const value=new Repo(db).getOrAllocate({guildId:'${GUILD}',userId:process.argv[4],codeLength:6,now:1}).memberNumber.value;` +
    `db.close();process.stdout.write(String(value));`;
  const outputs = await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source, modulePath, repoPath, fx.filename, String(40000000000000001n + BigInt(index))], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = ""; child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(Number(out)) : reject(new Error(err)));
  })));
  const reopened = new AutoNameDatabase({ filename: fx.filename });
  assert.deepEqual(outputs.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  reopened.close();
});

test("audit repository persists bounded recent records and action constraints", (t) => {
  const { audits } = fixture(t);
  for (let index = 0; index < 3; index += 1) audits.append({ id: `audit-${index}`, guildId: GUILD,
    userId: "30000000000000001", oldNickname: null, newNickname: `name-${index}`, action: "scan",
    actorId: "40000000000000001", traceId: "trace", createdAt: index });
  assert.deepEqual(audits.listRecentByGuild(GUILD, 2).map((entry) => entry.id), ["audit-2", "audit-1"]);
  assert.throws(() => audits.append({ id: "bad", guildId: GUILD, userId: "u", action: "raw-action", traceId: "t", createdAt: 4 }), /CHECK/);
});
