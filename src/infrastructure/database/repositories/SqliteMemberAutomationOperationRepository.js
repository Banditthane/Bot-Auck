class SqliteMemberAutomationOperationRepository {
  constructor(database) {
    this.db = database.connection;
  }

  async create(value) {
    const id = value.id || value.operationId;
    this.db.prepare(`
      INSERT INTO member_automation_operations (id, guild_id, user_id, rule_id, status, expected_json, actor_id, trace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, value.guildId, value.userId, value.ruleId ?? null, value.status || "RUNNING",
      JSON.stringify(value.expected || {
        addRoleIds: value.expectedAddRoleIds || [],
        removeRoleIds: value.expectedRemoveRoleIds || [],
      }), value.actorId ?? null, value.traceId ?? null, value.createdAt ?? Date.now(), value.createdAt ?? Date.now());
  }

  async updateStatus(id, status, updatedAt = Date.now()) {
    this.db.prepare("UPDATE member_automation_operations SET status = ?, updated_at = ? WHERE id = ?").run(status, updatedAt, id);
  }

  async findActiveByGuildUser(guildId, userId) {
    return this.db.prepare("SELECT * FROM member_automation_operations WHERE guild_id = ? AND user_id = ? AND status = 'RUNNING' LIMIT 1").get(guildId, userId) || null;
  }
}

module.exports = SqliteMemberAutomationOperationRepository;
