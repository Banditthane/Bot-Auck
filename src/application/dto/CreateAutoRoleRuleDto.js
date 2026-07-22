const AutoRoleRule = require("../../domain/entities/AutoRoleRule");
const { AUTO_ROLE_ERROR_CODES: CODES, AutoRoleValidationError } = require("../../domain/errors/AutoRoleErrors");
const SNOWFLAKE = /^\d{17,20}$/;
function snowflake(value, field) { if (typeof value !== "string" || !SNOWFLAKE.test(value)) throw new AutoRoleValidationError(`${field} is invalid.`, CODES.VALIDATION); return value; }
function roleIds(values, field) { if (!Array.isArray(values)) throw new AutoRoleValidationError(`${field} must be an array.`, CODES.VALIDATION); return values.map((id) => snowflake(id, field)); }
class CreateAutoRoleRuleDto {
  constructor(input = {}) {
    this.ruleId = String(input.ruleId || ""); this.guildId = snowflake(input.guildId, "guildId"); this.actorId = snowflake(input.actorId, "actorId");
    this.name = input.name; this.enabled = input.enabled !== false; this.trigger = input.trigger; this.priority = input.priority ?? 0;
    this.exclusiveGroup = input.exclusiveGroup || null; this.conflictPolicy = input.conflictPolicy || "SKIP_IF_CONFLICT"; this.stopOnMatch = Boolean(input.stopOnMatch);
    this.requiredRoleIds = roleIds(input.requiredRoleIds || [], "requiredRoleIds"); this.excludedRoleIds = roleIds(input.excludedRoleIds || [], "excludedRoleIds");
    this.targetRoleIds = roleIds(input.targetRoleIds || [], "targetRoleIds"); this.removeRoleIds = roleIds(input.removeRoleIds || [], "removeRoleIds");
    new AutoRoleRule({ ...this, createdBy: this.actorId }); Object.freeze(this);
  }
}
module.exports = CreateAutoRoleRuleDto; module.exports.assertSnowflake = snowflake; module.exports.assertRoleIds = roleIds;
