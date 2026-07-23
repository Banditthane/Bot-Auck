class SqliteInteractionSessionRepository {
  constructor(database) {
    this.db = database.connection;
  }

  async create(value) {
    const now = value.createdAt ?? Date.now();
    this.db.prepare(`
      INSERT INTO interaction_sessions (session_id, guild_id, owner_id, kind, status, payload_json, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(value.sessionId, value.guildId ?? null, value.ownerId, value.kind, value.status || "ACTIVE",
      JSON.stringify(value.payload || {}), value.expiresAt, now, now);
    return this.findById(value.sessionId);
  }

  async findById(sessionId) {
    const row = this.db.prepare("SELECT * FROM interaction_sessions WHERE session_id = ?").get(sessionId);
    return row && { sessionId: row.session_id, guildId: row.guild_id, ownerId: row.owner_id, kind: row.kind,
      status: row.status, payload: JSON.parse(row.payload_json || "{}"), expiresAt: row.expires_at,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async updateStatus(sessionId, status, updatedAt = Date.now()) {
    this.db.prepare("UPDATE interaction_sessions SET status = ?, updated_at = ? WHERE session_id = ?").run(status, updatedAt, sessionId);
  }
}

module.exports = SqliteInteractionSessionRepository;
