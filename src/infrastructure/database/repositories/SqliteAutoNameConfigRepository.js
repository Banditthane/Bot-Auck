const AutoNameConfigRepository = require("../../../application/repositories/contracts/AutoNameConfigRepository");
const AutoNameConfig = require("../../../domain/entities/AutoNameConfig");

function mapConfig(row) {
  if (!row) return null;
  return new AutoNameConfig({ guildId: row.guild_id, enabled: Boolean(row.enabled), requiredRoleId: row.required_role_id,
    template: row.template, codeLength: row.code_length, createdAt: row.created_at, updatedAt: row.updated_at });
}

class SqliteAutoNameConfigRepository extends AutoNameConfigRepository {
  constructor(database) { super(); this.db = database.connection || database; }
  findByGuild(guildId) { return mapConfig(this.db.prepare("SELECT * FROM guild_auto_name_configs WHERE guild_id=?").get(guildId)); }

  upsert(input) {
    const now = input.updatedAt ?? Date.now();
    const codeLength = input.codeLength ?? 6;
    if (!Number.isInteger(codeLength) || codeLength < 1 || codeLength > 12) throw new RangeError("codeLength must be 1..12.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.findByGuild(input.guildId);
      const maximum = this.db.prepare("SELECT MAX(member_number) AS maximum FROM guild_member_codes WHERE guild_id=?")
        .get(input.guildId).maximum ?? 0;
      if (maximum > (10 ** codeLength) - 1) {
        throw Object.assign(new Error("Allocated member codes do not fit codeLength."), { code: "AUTO_NAME_CODE_EXHAUSTED" });
      }
      this.db.prepare(`INSERT INTO guild_auto_name_configs
        (guild_id,enabled,required_role_id,template,code_length,created_at,updated_at)
        VALUES (@guildId,@enabled,@requiredRoleId,@template,@codeLength,@createdAt,@updatedAt)
        ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,required_role_id=excluded.required_role_id,
          template=excluded.template,code_length=excluded.code_length,updated_at=excluded.updated_at`).run({
        guildId: input.guildId, enabled: input.enabled === false ? 0 : 1,
        requiredRoleId: input.requiredRoleId, template: input.template?.value || input.template, codeLength,
        createdAt: existing?.createdAt ?? input.createdAt ?? now, updatedAt: now,
      });
      this.db.exec("COMMIT");
      return this.findByGuild(input.guildId);
    } catch (error) { if (this.db.inTransaction) this.db.exec("ROLLBACK"); throw error; }
  }

  setEnabled(guildId, enabled, updatedAt = Date.now()) {
    this.db.prepare("UPDATE guild_auto_name_configs SET enabled=?,updated_at=? WHERE guild_id=?")
      .run(enabled ? 1 : 0, updatedAt, guildId);
    return this.findByGuild(guildId);
  }
}
module.exports = SqliteAutoNameConfigRepository;
