const RoleChangePlan = require("../entities/RoleChangePlan");
function matchesRule(rule, { trigger, currentRoleIds }) {
  if (!rule.enabled || rule.deletedAt || rule.trigger !== trigger) return false;
  const roles = new Set(currentRoleIds || []);
  return rule.requiredRoleIds.every((id) => roles.has(id)) && !rule.excludedRoleIds.some((id) => roles.has(id));
}
function sortRules(rules) { return [...rules].sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId)); }
function buildRoleChangePlan(rule, facts, { removalSemantics = false, groupRoleIds = [], owningPriorityByRole = {} } = {}) {
  const current = new Set(facts.currentRoleIds || []);
  const missing = rule.targetRoleIds.filter((id) => !current.has(id));
  if (missing.length === 0) return new RoleChangePlan({ guildId: rule.guildId, userId: facts.userId, ruleId: rule.ruleId, reasonCode: "ALREADY_ASSIGNED" });
  let removals = removalSemantics ? rule.removeRoleIds.filter((id) => current.has(id)) : [];
  const conflicts = rule.exclusiveGroup ? groupRoleIds.filter((id) => current.has(id) && !rule.targetRoleIds.includes(id)) : [];
  if (conflicts.length) {
    if (rule.conflictPolicy === "SKIP_IF_CONFLICT" || rule.conflictPolicy === "KEEP_EXISTING") return new RoleChangePlan({ guildId: rule.guildId, userId: facts.userId, ruleId: rule.ruleId, reasonCode: "CONFLICT_SKIPPED" });
    if (rule.conflictPolicy === "REPLACE_LOWER_PRIORITY" && conflicts.some((id) => (owningPriorityByRole[id] ?? Infinity) >= rule.priority)) return new RoleChangePlan({ guildId: rule.guildId, userId: facts.userId, ruleId: rule.ruleId, reasonCode: "CONFLICT_PRIORITY_SKIPPED" });
    removals = [...removals, ...conflicts];
  }
  return new RoleChangePlan({ guildId: rule.guildId, userId: facts.userId, ruleId: rule.ruleId, addRoleIds: missing, removeRoleIds: removals });
}
module.exports = { matchesRule, sortRules, buildRoleChangePlan };
