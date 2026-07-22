const { assertSnowflake } = require("./CreateAutoRoleRuleDto");
const { AUTO_ROLE_ERROR_CODES: CODES, AutoRoleValidationError } = require("../../domain/errors/AutoRoleErrors");
class ScanAutoRoleDto {
  constructor(input = {}) { this.guildId = assertSnowflake(input.guildId, "guildId"); this.actorId = assertSnowflake(input.actorId, "actorId"); this.ruleId = input.ruleId == null ? null : String(input.ruleId); this.missingOnly = input.missingOnly !== false; this.force = Boolean(input.force); this.dryRun = Boolean(input.dryRun); if (this.missingOnly && this.force) throw new AutoRoleValidationError("missingOnly and force cannot both be true.", CODES.VALIDATION); this.traceId = String(input.traceId || "").slice(0, 64); Object.freeze(this); }
}
module.exports = ScanAutoRoleDto;
