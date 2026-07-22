const { assertSnowflake } = require("./ConfigureAutoNameDto");
const { AUTO_NAME_ERROR_CODES: CODES, AutoNameValidationError } = require("../../domain/errors/AutoNameErrors");

class ScanAutoNameDto {
  constructor(input = {}) {
    this.guildId = assertSnowflake(input.guildId, "guildId");
    this.actorId = assertSnowflake(input.actorId, "actorId");
    this.missingOnly = input.missingOnly !== false;
    this.force = Boolean(input.force);
    this.dryRun = Boolean(input.dryRun);
    this.subsetRoleId = input.subsetRoleId == null ? null : assertSnowflake(input.subsetRoleId, "subsetRoleId");
    this.traceId = String(input.traceId || "").slice(0, 64);
    if (this.missingOnly && this.force) throw new AutoNameValidationError("missingOnly and force cannot both be true.", CODES.VALIDATION);
    Object.freeze(this);
  }
}
module.exports = ScanAutoNameDto;
