const { AUTO_ROLE_ERROR_CODES: CODES, AutoRoleValidationError } = require("../errors/AutoRoleErrors");
class RoleRulePriority {
  constructor(value = 0) { if (!Number.isInteger(value) || value < 0 || value > 1000) throw new AutoRoleValidationError("Rule priority must be an integer from 0 to 1000.", CODES.VALIDATION); this.value = value; Object.freeze(this); }
}
module.exports = RoleRulePriority;
