const AutoNameAuditRepository = require("../../../application/repositories/contracts/AutoNameAuditRepository");
function mapAudit(row) {
  if (!row) return null;
  return { id: row.id, guildId: row.guild_id, userId: row.user_id, oldNickname: row.old_nickname,
    newNickname: row.new_nickname, action: row.action, actorId: row.actor_id, traceId: row.trace_id, createdAt: row.created_at };
}
class SqliteAutoNameAuditRepository extends AutoNameAuditRepository {
  constructor(database) { super(); this.db = database.connection || database; }
  append(input) {
    this.db.prepare(`INSERT INTO auto_name_audit_logs
      (id,guild_id,user_id,old_nickname,new_nickname,action,actor_id,trace_id,created_at)
      VALUES (@id,@guildId,@userId,@oldNickname,@newNickname,@action,@actorId,@traceId,@createdAt)`).run({
      ...input, oldNickname: input.oldNickname ?? null, newNickname: input.newNickname ?? null,
      actorId: input.actorId ?? null, createdAt: input.createdAt ?? Date.now(),
    });
    return mapAudit(this.db.prepare("SELECT * FROM auto_name_audit_logs WHERE id=?").get(input.id));
  }
  listRecentByGuild(guildId, limit = 50) {
    const bounded = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 50));
    return this.db.prepare(`SELECT * FROM auto_name_audit_logs WHERE guild_id=?
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(guildId, bounded).map(mapAudit);
  }
}
module.exports = SqliteAutoNameAuditRepository;
