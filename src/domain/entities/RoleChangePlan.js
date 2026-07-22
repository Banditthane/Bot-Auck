class RoleChangePlan {
  constructor({ guildId, userId, ruleId, addRoleIds = [], removeRoleIds = [], reasonCode = "MATCHED" }) {
    this.guildId = guildId; this.userId = userId; this.ruleId = ruleId;
    this.addRoleIds = Object.freeze([...new Set(addRoleIds)]);
    this.removeRoleIds = Object.freeze([...new Set(removeRoleIds)].filter((id) => !this.addRoleIds.includes(id)));
    this.reasonCode = reasonCode; Object.freeze(this);
  }
  get changed() { return this.addRoleIds.length > 0 || this.removeRoleIds.length > 0; }
}
module.exports = RoleChangePlan;
