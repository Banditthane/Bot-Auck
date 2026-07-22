const { AUTO_ROLE_ERROR_CODES: CODES, AutoRoleValidationError } = require("../errors/AutoRoleErrors");
const AUTO_ROLE_TRIGGERS = Object.freeze(["MEMBER_JOIN", "ROLE_ADDED", "MANUAL_SCAN", "MANUAL_REPAIR"]);
class AutoRoleTrigger {
  constructor(value) { if (!AUTO_ROLE_TRIGGERS.includes(value)) throw new AutoRoleValidationError("Unsupported Auto Role trigger.", CODES.VALIDATION); this.value = value; Object.freeze(this); }
}
module.exports = AutoRoleTrigger;
module.exports.AUTO_ROLE_TRIGGERS = AUTO_ROLE_TRIGGERS;
