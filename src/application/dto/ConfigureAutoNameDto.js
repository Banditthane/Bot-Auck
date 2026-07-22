const AutoNameTemplate = require("../../domain/valueObjects/AutoNameTemplate");
const MemberNumber = require("../../domain/valueObjects/MemberNumber");
const { AUTO_NAME_ERROR_CODES: CODES, AutoNameValidationError } = require("../../domain/errors/AutoNameErrors");

const SNOWFLAKE = /^\d{17,20}$/;
function id(value, field) {
  if (typeof value !== "string" || !SNOWFLAKE.test(value)) throw new AutoNameValidationError(`${field} is invalid.`, CODES.VALIDATION);
  return value;
}

class ConfigureAutoNameDto {
  constructor(input = {}) {
    this.guildId = id(input.guildId, "guildId");
    this.actorId = id(input.actorId, "actorId");
    this.requiredRoleId = id(input.requiredRoleId, "requiredRoleId");
    this.template = new AutoNameTemplate(input.template).value;
    this.codeLength = MemberNumber.assertCodeLength(input.codeLength ?? 6);
    this.traceId = String(input.traceId || "").slice(0, 64);
    Object.freeze(this);
  }
}
module.exports = ConfigureAutoNameDto;
module.exports.assertSnowflake = id;
