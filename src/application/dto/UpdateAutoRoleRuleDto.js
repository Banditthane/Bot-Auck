const { assertSnowflake, assertRoleIds } = require("./CreateAutoRoleRuleDto");
const AutoRoleTrigger = require("../../domain/valueObjects/AutoRoleTrigger");
const RoleConflictPolicy = require("../../domain/valueObjects/RoleConflictPolicy");
const RoleRulePriority = require("../../domain/valueObjects/RoleRulePriority");
class UpdateAutoRoleRuleDto {
  constructor(input = {}) {
    this.guildId = assertSnowflake(input.guildId, "guildId"); this.actorId = assertSnowflake(input.actorId, "actorId"); this.ruleId = String(input.ruleId || ""); this.changes = {};
    if (input.name !== undefined) this.changes.name = input.name;
    if (input.enabled !== undefined) this.changes.enabled = Boolean(input.enabled);
    if (input.trigger !== undefined) this.changes.trigger = new AutoRoleTrigger(input.trigger).value;
    if (input.priority !== undefined) this.changes.priority = new RoleRulePriority(input.priority).value;
    if (input.conflictPolicy !== undefined) this.changes.conflictPolicy = new RoleConflictPolicy(input.conflictPolicy).value;
    if (input.exclusiveGroup !== undefined) this.changes.exclusiveGroup = input.exclusiveGroup;
    if (input.stopOnMatch !== undefined) this.changes.stopOnMatch = Boolean(input.stopOnMatch);
    for (const field of ["requiredRoleIds", "excludedRoleIds", "targetRoleIds", "removeRoleIds"]) if (input[field] !== undefined) this.changes[field] = assertRoleIds(input[field], field);
    Object.freeze(this.changes); Object.freeze(this);
  }
}
module.exports = UpdateAutoRoleRuleDto;