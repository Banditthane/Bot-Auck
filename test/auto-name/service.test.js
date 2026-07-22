const test = require("node:test");
const assert = require("node:assert/strict");
const AutoNameService = require("../../src/application/services/AutoNameService");
const AutoNameTemplateService = require("../../src/application/services/AutoNameTemplateService");
const AutoNameScanService = require("../../src/application/services/AutoNameScanService");
const AutoNameConfig = require("../../src/domain/entities/AutoNameConfig");
const MemberCode = require("../../src/domain/entities/MemberCode");
const { AUTO_NAME_ERROR_CODES: CODES, AUTO_NAME_RESULT_CODES: RESULTS } = require("../../src/domain/errors/AutoNameErrors");

const IDS = { guildId: "10000000000000001", actorId: "10000000000000002", userId: "10000000000000003", roleId: "10000000000000004" };
const allowedFacts = {
  actorHasManageNicknames: true, actorIsOwner: false, actorRoleComparison: 1,
  targetIsBot: false, targetIsOwner: false, targetHasRequiredRole: true,
  botHasManageNicknames: true, botRoleComparison: 1, targetManageable: true,
  username: "user", displayName: "User", roleName: "Member", currentNickname: null,
};

function fixture() {
  let config = new AutoNameConfig({ guildId: IDS.guildId, requiredRoleId: IDS.roleId, template: "{code}", codeLength: 6, createdAt: 1, updatedAt: 1 });
  let code = null;
  const calls = { allocate: 0, nickname: [], audit: [], facts: [], queue: [] };
  const configRepository = {
    async findByGuild() { return config; },
    async upsert(value) { config = value; return value; },
    async setEnabled(_guildId, enabled, now) { config = new AutoNameConfig({ ...config, enabled, updatedAt: now }); return config; },
  };
  const codeRepository = {
    async findByGuildUser() { return code; },
    async getOrAllocate({ guildId, userId }) { calls.allocate += 1; code ||= new MemberCode({ guildId, userId, memberNumber: 1, createdAt: 2, updatedAt: 2 }); return code; },
    async getGuildAllocationStats() { return { maximumMemberNumber: code?.memberNumber.value || 0 }; },
  };
  const gateway = {
    facts: { ...allowedFacts },
    async getMemberFacts(input) { calls.facts.push(input); return { ...this.facts }; },
    async getRoleFacts() { return { exists: true, name: "Member" }; },
    async setNickname(input) { calls.nickname.push(input); this.facts.currentNickname = input.nickname; },
    async listMembersPage() { return { members: [{ userId: IDS.userId, roleIds: [IDS.roleId] }], nextCursor: null }; },
  };
  const auditRepository = { async append(row) { calls.audit.push(row); } };
  const service = new AutoNameService({
    configRepository, codeRepository, auditRepository, nicknameGateway: gateway,
    templateService: new AutoNameTemplateService(), clock: { now: () => 10 },
    auditIdFactory: () => "audit-1", traceIdFactory: () => "trace-1",
  });
  return { service, configRepository, codeRepository, auditRepository, gateway, calls, getConfig: () => config, getCode: () => code };
}

test("configure validates fresh actor/role facts and freezes defaults", async () => {
  const fx = fixture();
  const result = await fx.service.configure({ guildId: IDS.guildId, actorId: IDS.actorId, requiredRoleId: IDS.roleId });
  assert.equal(result.code, RESULTS.CONFIGURED);
  assert.equal(result.config.codeLength, 6);
  assert.equal(result.config.template.value.includes("{code}"), true);
  assert.equal(fx.calls.facts.length, 1);
});

test("assignment allocates once, mutates nickname once, audits, then becomes idempotent", async () => {
  const fx = fixture();
  const input = { ...IDS, source: "repair", traceId: "trace" };
  assert.equal((await fx.service.assign(input)).code, RESULTS.ASSIGNED);
  assert.equal((await fx.service.assign(input)).code, RESULTS.ALREADY_CORRECT);
  assert.equal(fx.calls.allocate, 1);
  assert.equal(fx.calls.nickname.length, 1);
  assert.equal(fx.calls.audit.length, 1);
  assert.equal(fx.calls.audit[0].newNickname, "000001");
});

test("missing-only scan uses stored member code even when gateway says no Auto Name", async () => {
  const fx = fixture();
  await fx.service.assign({ ...IDS, source: "repair" });
  fx.gateway.facts.currentNickname = "manually changed";
  fx.gateway.facts.hasAutoName = false;
  const result = await fx.service.assign({ ...IDS, source: "scan", missingOnly: true });
  assert.equal(result.code, RESULTS.ALREADY_CORRECT);
  assert.equal(fx.calls.nickname.length, 1);
});
test("dry run never allocates, renames, or audits", async () => {
  const fx = fixture();
  const result = await fx.service.assign({ ...IDS, source: "scan", dryRun: true });
  assert.equal(result.code, RESULTS.DRY_RUN_WOULD_ALLOCATE);
  assert.equal(fx.calls.allocate, 0);
  assert.equal(fx.calls.nickname.length, 0);
  assert.equal(fx.calls.audit.length, 0);
});

test("policy denial occurs before allocation or nickname mutation", async () => {
  const fx = fixture();
  fx.gateway.facts.targetHasRequiredRole = false;
  await assert.rejects(fx.service.assign({ ...IDS, source: "repair" }), (error) => error.code === CODES.INELIGIBLE);
  assert.equal(fx.calls.allocate, 0);
  assert.equal(fx.calls.nickname.length, 0);
});

test("nickname success is not repeated when persistent audit write fails", async () => {
  const fx = fixture();
  fx.auditRepository.append = async () => { throw new Error("raw secret stack"); };
  const result = await fx.service.assign({ ...IDS, source: "repair" });
  assert.equal(result.code, RESULTS.ASSIGNED);
  assert.equal(result.auditWarning, CODES.AUDIT_WRITE_FAILED);
  assert.equal((await fx.service.assign({ ...IDS, source: "repair" })).code, RESULTS.ALREADY_CORRECT);
  assert.equal(fx.calls.nickname.length, 1);
});

test("decreasing code length fails when allocated maximum no longer fits", async () => {
  const fx = fixture();
  fx.codeRepository.getGuildAllocationStats = async () => ({ maximumMemberNumber: 100 });
  await assert.rejects(fx.service.configure({ ...IDS, requiredRoleId: IDS.roleId, template: "{code}", codeLength: 2 }), (error) => error.code === CODES.CODE_EXHAUSTED);
});

test("scan enqueue authorizes fresh actor facts and rejects conflicting flags", async () => {
  const fx = fixture();
  const queue = {
    async enqueueUnique(job) { fx.calls.queue.push(job); return { id: "job", ...job }; },
    async getStatus(input) { return input; },
  };
  const scans = new AutoNameScanService({ scanQueue: queue, nicknameGateway: fx.gateway, autoNameService: fx.service, configRepository: fx.configRepository });
  const result = await scans.enqueue({ guildId: IDS.guildId, actorId: IDS.actorId, missingOnly: false, force: true });
  assert.equal(result.code, RESULTS.SCAN_QUEUED);
  assert.equal(fx.calls.queue[0].createdBy, IDS.actorId);
  await assert.rejects(scans.enqueue({ guildId: IDS.guildId, actorId: IDS.actorId, missingOnly: true, force: true }), (error) => error.code === CODES.VALIDATION);
});

test("every resumed scan batch revalidates actor and coordinates bounded work through ports", async () => {
  const fx = fixture();
  const queueCalls = [];
  const queue = {
    async heartbeat(value) { queueCalls.push(["heartbeat", value]); },
    async saveProgress(value) { queueCalls.push(["progress", value]); },
    async complete(value) { queueCalls.push(["complete", value]); },
  };
  const scans = new AutoNameScanService({ scanQueue: queue, nicknameGateway: fx.gateway, autoNameService: fx.service, configRepository: fx.configRepository, clock: { now: () => 20 } });
  const beforeFacts = fx.calls.facts.length;
  const result = await scans.processLeasedBatch({
    job: { id: "job", guildId: IDS.guildId, createdBy: IDS.actorId, cursorUserId: null, subsetRoleId: IDS.roleId, dryRun: false, traceId: "scan" },
    workerId: "worker", batchSize: 25, concurrency: 2,
  });
  assert.equal(result.code, RESULTS.SCAN_BATCH_PROCESSED);
  assert.ok(fx.calls.facts.length >= beforeFacts + 2);
  assert.deepEqual(queueCalls.map(([name]) => name), ["heartbeat", "progress", "complete"]);
});

test("getConfig and updateTemplate authorize fresh actor facts inside the service", async () => {
  const fx = fixture();
  const read = await fx.service.getConfig({ guildId: IDS.guildId, actorId: IDS.actorId });
  assert.equal(read.code, RESULTS.CONFIG_READ);
  const updated = await fx.service.updateTemplate({
    guildId: IDS.guildId, actorId: IDS.actorId, template: "member-{code}", traceId: "trace",
  });
  assert.equal(updated.code, RESULTS.TEMPLATE_UPDATED);
  assert.equal(updated.config.template.value, "member-{code}");
  assert.equal(updated.config.requiredRoleId, IDS.roleId);
  fx.gateway.facts.actorHasManageNicknames = false;
  await assert.rejects(
    fx.service.getConfig({ guildId: IDS.guildId, actorId: IDS.actorId }),
    (error) => error.code === CODES.FORBIDDEN
  );
  await assert.rejects(
    fx.service.updateTemplate({ guildId: IDS.guildId, actorId: IDS.actorId, template: "{code}" }),
    (error) => error.code === CODES.FORBIDDEN
  );
});

test("preview authorizes actor and returns labelled sample-code state without allocation", async () => {
  const fx = fixture();
  const preview = await fx.service.preview({ guildId: IDS.guildId, userId: IDS.userId, actorId: IDS.actorId });
  assert.equal(preview.code, RESULTS.PREVIEW_RENDERED);
  assert.equal(preview.nickname, "000001");
  assert.equal(preview.sampleCode, true);
  assert.equal(fx.calls.allocate, 0);
  fx.gateway.facts.actorHasManageNicknames = false;
  await assert.rejects(
    fx.service.preview({ guildId: IDS.guildId, userId: IDS.userId, actorId: IDS.actorId }),
    (error) => error.code === CODES.FORBIDDEN
  );
});

test("scan status authorizes fresh actor before reading queue", async () => {
  const fx = fixture();
  const queueCalls = [];
  const queue = { async getStatus(input) { queueCalls.push(input); return { id: "job" }; } };
  const scans = new AutoNameScanService({
    scanQueue: queue, nicknameGateway: fx.gateway, autoNameService: fx.service,
    configRepository: fx.configRepository,
  });
  assert.deepEqual(await scans.getStatus({ guildId: IDS.guildId, actorId: IDS.actorId }), { id: "job" });
  assert.equal(queueCalls.length, 1);
  fx.gateway.facts.actorHasManageNicknames = false;
  await assert.rejects(
    scans.getStatus({ guildId: IDS.guildId, actorId: IDS.actorId }),
    (error) => error.code === CODES.FORBIDDEN
  );
  assert.equal(queueCalls.length, 1);
});

test("scan prefilters persisted required role and forwards force to assignment", async () => {
  const fx = fixture();
  const assignments = [];
  fx.gateway.listMembersPage = async () => ({
    members: [
      { userId: IDS.userId, roleIds: [IDS.roleId] },
      { userId: "10000000000000005", roleIds: [] },
    ],
    nextCursor: null,
  });
  const queue = { async heartbeat() {}, async saveProgress() {}, async complete() {} };
  const scans = new AutoNameScanService({
    scanQueue: queue, nicknameGateway: fx.gateway,
    autoNameService: { async assign(input) { assignments.push(input); return { code: RESULTS.ALREADY_CORRECT }; } },
    configRepository: fx.configRepository,
  });
  const result = await scans.processLeasedBatch({
    job: { id: "job", guildId: IDS.guildId, createdBy: IDS.actorId, missingOnly: false,
      force: true, dryRun: false, subsetRoleId: null, cursorUserId: null },
    workerId: "worker",
  });
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].force, true);
  assert.equal(result.totals.scannedCount, 2);
  assert.equal(result.totals.skippedCount, 2);
  assert.equal(result.totals.failedCount, 0);
});

test("scan propagates retryable member errors but accounts permanent errors", async () => {
  const fx = fixture();
  const queueCalls = [];
  const queue = {
    async heartbeat() { queueCalls.push("heartbeat"); },
    async saveProgress() { queueCalls.push("progress"); },
    async complete() { queueCalls.push("complete"); },
  };
  const job = { id: "job", guildId: IDS.guildId, createdBy: IDS.actorId, missingOnly: false,
    force: false, dryRun: false, subsetRoleId: null, cursorUserId: null };
  const retrying = new AutoNameScanService({
    scanQueue: queue, nicknameGateway: fx.gateway,
    autoNameService: { async assign() { throw Object.assign(new Error("rate limited"), { code: CODES.RATE_LIMIT, retryable: true }); } },
    configRepository: fx.configRepository,
  });
  await assert.rejects(
    retrying.processLeasedBatch({ job, workerId: "worker" }),
    (error) => error.code === CODES.RATE_LIMIT
  );
  assert.deepEqual(queueCalls, []);

  const permanent = new AutoNameScanService({
    scanQueue: queue, nicknameGateway: fx.gateway,
    autoNameService: { async assign() { throw Object.assign(new Error("permanent"), { code: CODES.PERMANENT }); } },
    configRepository: fx.configRepository,
  });
  const result = await permanent.processLeasedBatch({ job, workerId: "worker" });
  assert.equal(result.totals.failedCount, 1);
  assert.deepEqual(queueCalls, ["heartbeat", "progress", "complete"]);
});
test("scan counts policy-ineligible members as skipped instead of failed", async () => {
  const fx = fixture();
  const queue = { async heartbeat() {}, async saveProgress() {}, async complete() {} };
  const scans = new AutoNameScanService({
    scanQueue: queue, nicknameGateway: fx.gateway,
    autoNameService: { async assign() { throw Object.assign(new Error("ineligible"), { code: CODES.INELIGIBLE }); } },
    configRepository: fx.configRepository,
  });
  const result = await scans.processLeasedBatch({
    job: { id: "job", guildId: IDS.guildId, createdBy: IDS.actorId, missingOnly: false,
      force: false, dryRun: false, subsetRoleId: null, cursorUserId: null },
    workerId: "worker",
  });
  assert.equal(result.totals.skippedCount, 1);
  assert.equal(result.totals.failedCount, 0);
});
test("service contracts expose stable method lists and conservative limits", () => {
  assert.deepEqual(AutoNameService.AUTO_NAME_SERVICE_METHODS, ["configure", "getConfig", "updateTemplate", "setEnabled", "assign", "preview"]);
  assert.deepEqual(AutoNameScanService.AUTO_NAME_SCAN_SERVICE_METHODS, ["enqueue", "getStatus", "processLeasedBatch"]);
  assert.equal(AutoNameScanService.DEFAULT_BATCH_SIZE, 25);
  assert.equal(AutoNameScanService.DEFAULT_CONCURRENCY, 2);
});
