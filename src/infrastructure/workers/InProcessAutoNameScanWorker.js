const RETRYABLE_CODES = new Set(["AUTO_NAME_RATE_LIMIT", "AUTO_NAME_TRANSIENT", "SQLITE_BUSY", "SQLITE_LOCKED", "UND_ERR_CONNECT_TIMEOUT"]);

class InProcessAutoNameScanWorker {
  constructor({ queue, scanService, workerId, telemetry, clock = { now: () => Date.now() },
    timers = { setTimeout, clearTimeout }, pollIntervalMs = 1000, batchSize = 25, concurrency = 2 } = {}) {
    if (!queue || !scanService || !workerId) throw new TypeError("queue, scanService, and workerId are required.");
    if (typeof scanService.processLeasedBatch !== "function") throw new TypeError("scanService.processLeasedBatch is required.");
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new RangeError("batchSize must be 1..100.");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new RangeError("concurrency must be 1..4.");
    this.queue = queue; this.scanService = scanService; this.workerId = workerId;
    this.telemetry = telemetry || { info() {}, warn() {}, error() {} };
    this.clock = clock; this.timers = timers; this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize; this.concurrency = concurrency;
    this.running = false; this.timer = null; this.inFlight = null;
  }

  start() {
    if (this.running) return false;
    this.running = true;
    this._schedule(0);
    return true;
  }

  async runOnce() {
    if (!this.running) return false;
    const job = await this.queue.claimNext({ workerId: this.workerId, now: this.clock.now() });
    if (!job || !this.running) return false;
    try {
      await this.scanService.processLeasedBatch({ job, workerId: this.workerId,
        batchSize: this.batchSize, concurrency: this.concurrency });
      this.telemetry.info("auto_name_scan_batch_processed", { guildId: job.guildId, jobId: job.id, workerId: this.workerId });
    } catch (error) {
      const code = String(error?.code || "AUTO_NAME_SCAN_FAILED").replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
      try {
        await this.queue.fail({ jobId: job.id, workerId: this.workerId, errorCode: code,
          retryable: error?.retryable === true || RETRYABLE_CODES.has(error?.code), now: this.clock.now() });
      } catch (leaseError) {
        if (leaseError?.code !== "AUTO_NAME_LEASE_LOST") throw leaseError;
      }
      this.telemetry.warn("auto_name_scan_batch_failed", { guildId: job.guildId, jobId: job.id, workerId: this.workerId, code });
    }
    return true;
  }

  async stop() {
    this.running = false;
    if (this.timer !== null) { this.timers.clearTimeout(this.timer); this.timer = null; }
    if (this.inFlight) await this.inFlight;
  }

  _schedule(delay) {
    if (!this.running || this.timer !== null) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (!this.running) return;
      this.inFlight = this.runOnce().catch((error) => {
        const code = String(error?.code || "AUTO_NAME_WORKER_FAILURE").replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
        this.telemetry.error("auto_name_worker_poll_failed", { workerId: this.workerId, code });
      }).finally(() => {
        this.inFlight = null;
        this._schedule(this.pollIntervalMs);
      });
    }, delay);
  }
}
module.exports = InProcessAutoNameScanWorker;
module.exports.RETRYABLE_CODES = RETRYABLE_CODES;
