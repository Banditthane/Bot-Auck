const { assertSnowflake } = require("./ConfigureAutoNameDto");
const { AUTO_NAME_ERROR_CODES: CODES, AutoNameValidationError } = require("../../domain/errors/AutoNameErrors");

const SOURCES = Object.freeze(["join", "role-add", "repair", "scan"]);
class AssignAutoNameDto {
  constructor(input = {}) {
    this.guildId = assertSnowflake(input.guildId, "guildId");
    this.userId = assertSnowflake(input.userId, "userId");
    this.actorId = input.actorId == null ? null : assertSnowflake(input.actorId, "actorId");
    this.source = input.source || "repair";
    if (!SOURCES.includes(this.source)) throw new AutoNameValidationError("Assignment source is invalid.", CODES.VALIDATION);
    this.dryRun = Boolean(input.dryRun);
    this.missingOnly = Boolean(input.missingOnly);
    this.traceId = String(input.traceId || "").slice(0, 64);
    Object.freeze(this);
  }
}
module.exports = AssignAutoNameDto;
module.exports.ASSIGNMENT_SOURCES = SOURCES;
