const { assertSnowflake } = require("./CreateAutoRoleRuleDto");
const AutoRoleTrigger = require("../../domain/valueObjects/AutoRoleTrigger");
class EvaluateAutoRoleDto {
  constructor(input = {}) { this.guildId = assertSnowflake(input.guildId, "guildId"); this.userId = assertSnowflake(input.userId, "userId"); this.actorId = input.actorId == null ? null : assertSnowflake(input.actorId, "actorId"); this.trigger = new AutoRoleTrigger(input.trigger).value; this.dryRun = Boolean(input.dryRun); this.traceId = String(input.traceId || "").slice(0, 64); Object.freeze(this); }
}
module.exports = EvaluateAutoRoleDto;
