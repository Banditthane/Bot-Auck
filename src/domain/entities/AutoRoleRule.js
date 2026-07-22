const AutoRoleTrigger = require("../valueObjects/AutoRoleTrigger");
const RoleConflictPolicy = require("../valueObjects/RoleConflictPolicy");
const RoleRulePriority = require("../valueObjects/RoleRulePriority");
const { AUTO_ROLE_ERROR_CODES: CODES, AutoRoleValidationError } = require("../errors/AutoRoleErrors");
function unique(values = []) { return Object.freeze([...new Set(values)]); }
class AutoRoleRule {
  constructor(input = {}) {
    if (!input.ruleId || !input.guildId || typeof input.name !== "string" || !input.name.trim()) throw new AutoRoleValidationError("ruleId, guildId, and name are required.", CODES.VALIDATION);
    this.ruleId = input.ruleId; this.guildId = input.guildId; this.name = input.name.trim();
    this.enabled = input.enabled !== false; this.trigger = new AutoRoleTrigger(input.trigger).value;
    this.priority = new RoleRulePriority(input.priority).value; this.conflictPolicy = new RoleConflictPolicy(input.conflictPolicy).value;
    this.exclusiveGroup = input.exclusiveGroup?.trim() || null; this.stopOnMatch = Boolean(input.stopOnMatch);
    this.requiredRoleIds = unique(input.requiredRoleIds); this.excludedRoleIds = unique(input.excludedRoleIds);
    this.targetRoleIds = unique(input.targetRoleIds); this.removeRoleIds = unique(input.removeRoleIds);
    if (this.targetRoleIds.length < 1) throw new AutoRoleValidationError("At least one target role is required.", CODES.VALIDATION);
    if (this.exclusiveGroup && this.targetRoleIds.length !== 1) throw new AutoRoleValidationError("Exclusive rules require exactly one target role.", CODES.VALIDATION);
    if (this.targetRoleIds.some((id) => this.removeRoleIds.includes(id))) throw new AutoRoleValidationError("A role cannot be both added and removed.", CODES.VALIDATION);
    this.createdBy = input.createdBy || null; this.createdAt = input.createdAt; this.updatedAt = input.updatedAt; this.deletedAt = input.deletedAt || null;
    Object.freeze(this);
  }
}
module.exports = AutoRoleRule;
