const MemberCodeRepository = require("../../../application/repositories/contracts/MemberCodeRepository");
const MemberCode = require("../../../domain/entities/MemberCode");

function mapCode(row) {
  if (!row) return null;
  return new MemberCode({ guildId: row.guild_id, userId: row.user_id, memberNumber: row.member_number,
    createdAt: row.created_at, updatedAt: row.updated_at });
}

class SqliteMemberCodeRepository extends MemberCodeRepository {
  constructor(database) { super(); this.db = database.connection || database; }
  findByGuildUser(guildId, userId) {
    return mapCode(this.db.prepare("SELECT * FROM guild_member_codes WHERE guild_id=? AND user_id=?").get(guildId, userId));
  }

  getOrAllocate(input) {
    const { guildId, userId, codeLength } = input;
    if (!Number.isInteger(codeLength) || codeLength < 1 || codeLength > 12) throw new RangeError("codeLength must be 1..12.");
    const now = input.now ?? input.updatedAt ?? input.createdAt ?? Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.findByGuildUser(guildId, userId);
      if (existing) { this.db.exec("COMMIT"); return existing; }
      this.db.prepare(`INSERT INTO guild_member_counters(guild_id,next_number,updated_at) VALUES (?,1,?)
        ON CONFLICT(guild_id) DO NOTHING`).run(guildId, now);
      const next = this.db.prepare("SELECT next_number FROM guild_member_counters WHERE guild_id=?").get(guildId).next_number;
      if (next > (10 ** codeLength) - 1) {
        throw Object.assign(new Error("Member code space is exhausted."), { code: "AUTO_NAME_CODE_EXHAUSTED" });
      }
      this.db.prepare(`INSERT INTO guild_member_codes(guild_id,user_id,member_number,created_at,updated_at)
        VALUES (?,?,?,?,?)`).run(guildId, userId, next, now, now);
      this.db.prepare("UPDATE guild_member_counters SET next_number=?,updated_at=? WHERE guild_id=?")
        .run(next + 1, now, guildId);
      this.db.exec("COMMIT");
      return this.findByGuildUser(guildId, userId);
    } catch (error) { if (this.db.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  getGuildAllocationStats(guildId) {
    const stats = this.db.prepare(`SELECT COUNT(*) AS allocated_count,MAX(member_number) AS maximum_member_number
      FROM guild_member_codes WHERE guild_id=?`).get(guildId);
    const counter = this.db.prepare("SELECT next_number FROM guild_member_counters WHERE guild_id=?").get(guildId);
    return { guildId, allocatedCount: stats.allocated_count, maximumMemberNumber: stats.maximum_member_number ?? 0,
      nextNumber: counter?.next_number ?? 1 };
  }
}
module.exports = SqliteMemberCodeRepository;
