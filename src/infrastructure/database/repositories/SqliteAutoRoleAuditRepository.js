class SqliteAutoRoleAuditRepository {
  constructor(database) {
    this.db = database.connection;
  }

  async append(value) {
    this.db.prepare(`
      INSERT INTO auto_role_audit_logs (id, guild_id, user_id, rule_id, action, role_id, result, actor_id, trace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(value.id, value.guildId, value.userId, value.ruleId ?? null, value.action, value.roleId ?? null,
      value.result, value.actorId ?? null, value.traceId ?? null, value.createdAt ?? Date.now());
  }

  async listRecentByGuild(guildId, limit = 25) {
    return this.db.prepare("SELECT * FROM auto_role_audit_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(guildId, limit);
  }
}

module.exports = SqliteAutoRoleAuditRepository;
