const { AUTO_ROLE_ERROR_CODES: CODES, AutoRoleValidationError } = require("../errors/AutoRoleErrors");
const ROLE_CONFLICT_POLICIES = Object.freeze(["SKIP_IF_CONFLICT", "KEEP_EXISTING", "REPLACE_LOWER_PRIORITY", "REPLACE_ALL_IN_GROUP"]);
class RoleConflictPolicy {
  constructor(value = "SKIP_IF_CONFLICT") { if (!ROLE_CONFLICT_POLICIES.includes(value)) throw new AutoRoleValidationError("Unsupported role conflict policy.", CODES.VALIDATION); this.value = value; Object.freeze(this); }
}
module.exports = RoleConflictPolicy;
module.exports.ROLE_CONFLICT_POLICIES = ROLE_CONFLICT_POLICIES;
