class SqliteAutoRoleConfigRepository {
  constructor(database) {
    this.db = database.connection;
  }

  async findByGuild(guildId) {
    const row = this.db.prepare("SELECT * FROM auto_role_configs WHERE guild_id = ?").get(guildId);
    return row && map(row);
  }

  async upsert(value) {
    const now = value.updatedAt ?? Date.now();
    const createdAt = value.createdAt ?? now;
    this.db.prepare(`
      INSERT INTO auto_role_configs (guild_id, enabled, removal_semantics, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        enabled=excluded.enabled,
        removal_semantics=excluded.removal_semantics,
        updated_at=excluded.updated_at
    `).run(value.guildId, value.enabled === false ? 0 : 1, value.removalSemantics ? 1 : 0, createdAt, now);
    return this.findByGuild(value.guildId);
  }

  async setEnabled(guildId, enabled, updatedAt = Date.now()) {
    this.db.prepare("UPDATE auto_role_configs SET enabled = ?, updated_at = ? WHERE guild_id = ?")
      .run(enabled ? 1 : 0, updatedAt, guildId);
    return this.findByGuild(guildId);
  }
}

function map(row) {
  return { guildId: row.guild_id, enabled: Boolean(row.enabled), removalSemantics: Boolean(row.removal_semantics), createdAt: row.created_at, updatedAt: row.updated_at };
}

module.exports = SqliteAutoRoleConfigRepository;
