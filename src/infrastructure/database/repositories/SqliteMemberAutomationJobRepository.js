class SqliteMemberAutomationJobRepository {
  constructor(database) {
    this.db = database.connection;
  }

  async enqueueUnique(value) {
    const id = value.jobId || `${value.jobType || "job"}-${Date.now()}`;
    this.db.prepare(`
      INSERT INTO member_automation_jobs (
        id, guild_id, job_type, status, scope_id, options_json, cursor, created_by, trace_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'queued', ?, ?, NULL, ?, ?, ?, ?)
    `).run(id, value.guildId, value.jobType, value.scopeId ?? null, JSON.stringify(value.options || {}),
      value.createdBy, value.traceId ?? null, value.createdAt ?? Date.now(), value.createdAt ?? Date.now());
    return this.getStatus({ guildId: value.guildId, jobId: id });
  }

  async getStatus({ guildId, jobId = null, jobType = null }) {
    const row = jobId
      ? this.db.prepare("SELECT * FROM member_automation_jobs WHERE guild_id = ? AND id = ?").get(guildId, jobId)
      : this.db.prepare("SELECT * FROM member_automation_jobs WHERE guild_id = ? AND (? IS NULL OR job_type = ?) ORDER BY created_at DESC LIMIT 1").get(guildId, jobType, jobType);
    return row && map(row);
  }

  async heartbeat() {}
  async saveProgress({ jobId, workerId, cursor, totals, now = Date.now() }) {
    this.db.prepare(`
      UPDATE member_automation_jobs SET status='running', cursor=?, processed_count=processed_count+?,
        success_count=success_count+?, skipped_count=skipped_count+?, failed_count=failed_count+?,
        lease_owner=?, lease_until=?, started_at=COALESCE(started_at, ?), updated_at=? WHERE id=?
    `).run(cursor, totals.processedMembers || 0, totals.successCount || 0, totals.skippedCount || 0, totals.failedCount || 0,
      workerId, now + 30000, now, now, jobId);
  }
  async complete({ jobId, now = Date.now() }) {
    this.db.prepare("UPDATE member_automation_jobs SET status='completed', completed_at=?, updated_at=? WHERE id=?").run(now, now, jobId);
  }
  async fail({ jobId, errorCode, now = Date.now() }) {
    this.db.prepare("UPDATE member_automation_jobs SET status='failed', last_error_code=?, completed_at=?, updated_at=? WHERE id=?").run(errorCode, now, now, jobId);
  }
}

function map(row) {
  return { jobId: row.id, guildId: row.guild_id, jobType: row.job_type, status: row.status, scopeId: row.scope_id,
    options: JSON.parse(row.options_json || "{}"), cursor: row.cursor, createdBy: row.created_by, traceId: row.trace_id };
}

module.exports = SqliteMemberAutomationJobRepository;
