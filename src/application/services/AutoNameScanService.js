const ScanAutoNameDto = require("../dto/ScanAutoNameDto");
const { assertActorAuthorized } = require("../../domain/policies/AutoNamePolicy");
const { AUTO_NAME_ERROR_CODES: CODES, AUTO_NAME_RESULT_CODES: RESULTS, AutoNameStateError } = require("../../domain/errors/AutoNameErrors");

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 2;

class AutoNameScanService {
  constructor({ scanQueue, nicknameGateway, autoNameService, configRepository, telemetry, clock = { now: () => Date.now() } }) {
    if (!scanQueue || !nicknameGateway || !autoNameService || !configRepository) throw new TypeError("AutoNameScanService requires queue, gateway, service, and config repository.");
    this.queue = scanQueue;
    this.gateway = nicknameGateway;
    this.autoNames = autoNameService;
    this.configs = configRepository;
    this.telemetry = telemetry || { info() {}, warn() {}, error() {} };
    this.clock = clock;
  }

  async enqueue(input) {
    const dto = input instanceof ScanAutoNameDto ? input : new ScanAutoNameDto(input);
    const config = await this.configs.findByGuild(dto.guildId);
    if (!config) throw new AutoNameStateError("Auto Name is not configured.", CODES.CONFIG_NOT_FOUND);
    const actorFacts = await this.gateway.getMemberFacts({ guildId: dto.guildId, userId: dto.actorId, actorId: dto.actorId, requiredRoleId: config?.requiredRoleId });
    assertActorAuthorized(actorFacts);
    const job = await this.queue.enqueueUnique({ ...dto, createdBy: dto.actorId, createdAt: this.clock.now() });
    return { ok: true, code: RESULTS.SCAN_QUEUED, job };
  }

  getStatus({ guildId, jobId = null }) { return this.queue.getStatus({ guildId, jobId }); }

  async processLeasedBatch({ job, workerId, batchSize = DEFAULT_BATCH_SIZE, concurrency = DEFAULT_CONCURRENCY }) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new RangeError("batchSize must be 1..100.");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new RangeError("concurrency must be 1..4.");
    const config = await this.configs.findByGuild(job.guildId);
    if (!config) throw new AutoNameStateError("Auto Name is not configured.", CODES.CONFIG_NOT_FOUND);
    const actorFacts = await this.gateway.getMemberFacts({ guildId: job.guildId, userId: job.createdBy, actorId: job.createdBy, requiredRoleId: config?.requiredRoleId });
    assertActorAuthorized(actorFacts);
    const page = await this.gateway.listMembersPage({ guildId: job.guildId, after: job.cursorUserId, limit: batchSize });
    const members = page.members || [];
    const totals = { scannedCount: members.length, eligibleCount: 0, renamedCount: 0, skippedCount: 0, failedCount: 0 };
    for (let offset = 0; offset < members.length; offset += concurrency) {
      const chunk = members.slice(offset, offset + concurrency);
      const results = await Promise.all(chunk.map(async (member) => {
        if (job.subsetRoleId && !member.roleIds?.includes(job.subsetRoleId)) return "skipped";
        try {
          const result = await this.autoNames.assign({ guildId: job.guildId, userId: member.userId, actorId: job.createdBy, source: "scan", dryRun: job.dryRun, missingOnly: job.missingOnly, traceId: job.traceId });
          totals.eligibleCount += 1;
          return result.code === RESULTS.ASSIGNED ? "renamed" : "skipped";
        } catch (_error) { return "failed"; }
      }));
      for (const result of results) totals[`${result}Count`] += 1;
      await this.queue.heartbeat({ jobId: job.id, workerId, now: this.clock.now() });
    }
    const cursorUserId = page.nextCursor || null;
    await this.queue.saveProgress({ jobId: job.id, workerId, cursorUserId, totals, now: this.clock.now() });
    if (!cursorUserId) await this.queue.complete({ jobId: job.id, workerId, now: this.clock.now() });
    return { ok: true, code: RESULTS.SCAN_BATCH_PROCESSED, cursorUserId, totals };
  }
}

module.exports = AutoNameScanService;
module.exports.DEFAULT_BATCH_SIZE = DEFAULT_BATCH_SIZE;
module.exports.DEFAULT_CONCURRENCY = DEFAULT_CONCURRENCY;
module.exports.AUTO_NAME_SCAN_SERVICE_METHODS = Object.freeze(["enqueue", "getStatus", "processLeasedBatch"]);
