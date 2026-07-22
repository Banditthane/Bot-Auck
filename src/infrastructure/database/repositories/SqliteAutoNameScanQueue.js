const { randomUUID } = require("crypto");
const AutoNameScanQueue = require("../../../application/repositories/contracts/AutoNameScanQueue");

const MAX_RETRIES = 5;
function mapJob(row, created = undefined) {
  if (!row) return null;
  const job = {
    id: row.id, guildId: row.guild_id, status: row.status, missingOnly: Boolean(row.missing_only),
    force: Boolean(row.force), dryRun: Boolean(row.dry_run), subsetRoleId: row.subset_role_id,
    cursorUserId: row.cursor_user_id, scannedCount: row.scanned_count, eligibleCount: row.eligible_count,
    renamedCount: row.renamed_count, skippedCount: row.skipped_count, failedCount: row.failed_count,
    retryCount: row.retry_count, leaseOwner: row.lease_owner, leaseUntil: row.lease_until,
    lastErrorCode: row.last_error_code, createdBy: row.created_by, createdAt: row.created_at,
    startedAt: row.started_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    traceId: row.id,
  };
  return created === undefined ? job : { ...job, created };
}

class SqliteAutoNameScanQueue extends AutoNameScanQueue {
  constructor(database, { idFactory = randomUUID, clock = { now: () => Date.now() }, leaseMs = 30000,
    maxRetries = MAX_RETRIES } = {}) {
    super();
    this.db = database.connection || database;
    this.idFactory = idFactory; this.clock = clock; this.leaseMs = leaseMs; this.maxRetries = maxRetries;
  }

  enqueueUnique(input) {
    const now = input.createdAt ?? this.clock.now();
    const active = this._active(input.guildId);
    if (active) return mapJob(active, false);
    const id = input.id || this.idFactory();
    try {
      this.db.prepare(`INSERT INTO auto_name_scan_jobs
        (id,guild_id,status,missing_only,force,dry_run,subset_role_id,created_by,created_at,updated_at)
        VALUES (?,?, 'queued', ?,?,?,?,?,?,?)`).run(id, input.guildId, input.missingOnly === false ? 0 : 1,
        input.force ? 1 : 0, input.dryRun ? 1 : 0, input.subsetRoleId ?? null, input.createdBy, now, now);
      return mapJob(this._byId(id), true);
    } catch (error) {
      if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const winner = this._active(input.guildId);
        if (winner) return mapJob(winner, false);
      }
      throw error;
    }
  }

  claimNext({ workerId, now = this.clock.now(), leaseMs = this.leaseMs }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`UPDATE auto_name_scan_jobs SET status='failed',lease_owner=NULL,lease_until=NULL,
        last_error_code='AUTO_NAME_RETRY_EXHAUSTED',updated_at=?,completed_at=?
        WHERE status='running' AND lease_until < ? AND retry_count >= ?`).run(now, now, now, this.maxRetries);
      this.db.prepare(`UPDATE auto_name_scan_jobs SET status='queued',retry_count=retry_count+1,
        lease_owner=NULL,lease_until=NULL,last_error_code='AUTO_NAME_LEASE_EXPIRED',updated_at=?
        WHERE status='running' AND lease_until < ? AND retry_count < ?`).run(now, now, this.maxRetries);
      let row = this.db.prepare(`SELECT * FROM auto_name_scan_jobs WHERE status='running'
        AND lease_owner=? AND lease_until>=? ORDER BY started_at,id LIMIT 1`).get(workerId, now);
      if (!row) {
        row = this.db.prepare("SELECT * FROM auto_name_scan_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").get();
        if (row) {
          const changed = this.db.prepare(`UPDATE auto_name_scan_jobs SET status='running',lease_owner=?,lease_until=?,
            started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='queued'`)
            .run(workerId, now + leaseMs, now, now, row.id).changes;
          row = changed === 1 ? this._byId(row.id) : null;
        }
      }
      this.db.exec("COMMIT");
      return mapJob(row);
    } catch (error) { if (this.db.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  heartbeat({ jobId, workerId, now = this.clock.now(), leaseMs = this.leaseMs }) {
    return this.db.prepare(`UPDATE auto_name_scan_jobs SET lease_until=?,updated_at=?
      WHERE id=? AND status='running' AND lease_owner=? AND lease_until>=?`)
      .run(now + leaseMs, now, jobId, workerId, now).changes === 1;
  }

  saveProgress({ jobId, workerId, cursorUserId, totals = {}, now = this.clock.now() }) {
    const changed = this.db.prepare(`UPDATE auto_name_scan_jobs SET cursor_user_id=?,
      scanned_count=scanned_count+?,eligible_count=eligible_count+?,renamed_count=renamed_count+?,
      skipped_count=skipped_count+?,failed_count=failed_count+?,updated_at=?
      WHERE id=? AND status='running' AND lease_owner=? AND lease_until>=?`).run(cursorUserId ?? null,
      totals.scannedCount ?? 0, totals.eligibleCount ?? 0, totals.renamedCount ?? 0,
      totals.skippedCount ?? 0, totals.failedCount ?? 0, now, jobId, workerId, now).changes;
    if (changed !== 1) throw Object.assign(new Error("Scan lease was lost."), { code: "AUTO_NAME_LEASE_LOST" });
    return mapJob(this._byId(jobId));
  }

  complete({ jobId, workerId, now = this.clock.now() }) {
    const changed = this.db.prepare(`UPDATE auto_name_scan_jobs SET status='completed',lease_owner=NULL,lease_until=NULL,
      updated_at=?,completed_at=? WHERE id=? AND status='running' AND lease_owner=? AND lease_until>=?`)
      .run(now, now, jobId, workerId, now).changes;
    if (changed !== 1) throw Object.assign(new Error("Scan lease was lost."), { code: "AUTO_NAME_LEASE_LOST" });
    return mapJob(this._byId(jobId));
  }

  fail({ jobId, workerId, errorCode = "AUTO_NAME_SCAN_FAILED", retryable = false, now = this.clock.now() }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const job = this.db.prepare(`SELECT * FROM auto_name_scan_jobs WHERE id=? AND status='running'
        AND lease_owner=? AND lease_until>=?`).get(jobId, workerId, now);
      if (!job) throw Object.assign(new Error("Scan lease was lost."), { code: "AUTO_NAME_LEASE_LOST" });
      const retry = retryable && job.retry_count < this.maxRetries;
      this.db.prepare(`UPDATE auto_name_scan_jobs SET status=?,retry_count=retry_count+?,lease_owner=NULL,
        lease_until=NULL,last_error_code=?,updated_at=?,completed_at=? WHERE id=?`).run(
        retry ? "queued" : "failed", retry ? 1 : 0,
        String(errorCode).replace(/[^A-Z0-9_]/g, "_").slice(0, 64), now, retry ? null : now, jobId);
      this.db.exec("COMMIT");
      return mapJob(this._byId(jobId));
    } catch (error) { if (this.db.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  getStatus({ guildId, jobId = null }) {
    const row = jobId ? this.db.prepare("SELECT * FROM auto_name_scan_jobs WHERE id=? AND guild_id=?").get(jobId, guildId)
      : this.db.prepare(`SELECT * FROM auto_name_scan_jobs WHERE guild_id=? ORDER BY
        CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,updated_at DESC,id DESC LIMIT 1`).get(guildId);
    return mapJob(row);
  }

  _byId(id) { return this.db.prepare("SELECT * FROM auto_name_scan_jobs WHERE id=?").get(id); }
  _active(guildId) { return this.db.prepare("SELECT * FROM auto_name_scan_jobs WHERE guild_id=? AND status IN ('queued','running') LIMIT 1").get(guildId); }
}
module.exports = SqliteAutoNameScanQueue;
module.exports.MAX_RETRIES = MAX_RETRIES;
