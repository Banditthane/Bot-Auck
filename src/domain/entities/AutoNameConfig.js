const AutoNameTemplate = require("../valueObjects/AutoNameTemplate");
const MemberNumber = require("../valueObjects/MemberNumber");

class AutoNameConfig {
  constructor({ guildId, enabled = true, requiredRoleId, template, codeLength = 6, createdAt, updatedAt }) {
    if (!guildId || !requiredRoleId) throw new TypeError("guildId and requiredRoleId are required.");
    this.guildId = guildId;
    this.enabled = Boolean(enabled);
    this.requiredRoleId = requiredRoleId;
    this.template = template instanceof AutoNameTemplate ? template : new AutoNameTemplate(template);
    this.codeLength = MemberNumber.assertCodeLength(codeLength);
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    Object.freeze(this);
  }
}
module.exports = AutoNameConfig;
