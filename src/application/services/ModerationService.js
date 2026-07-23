const ModerationPolicy = require("@policies/ModerationPolicy");
const { ModerationError, ModerationErrorCodes } = require("@errors/ModerationErrors");

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const MAX_REASON_LENGTH = 512;
const BAN_DELETE_SECONDS = new Set([0, 3600, 21600, 43200, 86400, 259200, 604800]);
const TIMEOUT_SECONDS = new Set([300, 600, 3600, 21600, 43200, 86400, 259200, 604800, 1209600, 2419200]);

class ModerationService {
  constructor({ gateway, logger, policy = new ModerationPolicy(), now = () => Date.now() }) {
    if (!gateway) throw new TypeError("Moderation gateway is required.");
    this.gateway = gateway;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.policy = policy;
    this.now = now;
  }

  async ban(input) {
    const dto = this.targetDto(input);
    const deleteMessageSeconds = this.choice(input.deleteMessageSeconds, BAN_DELETE_SECONDS, "Invalid ban message deletion window.");
    const facts = await this.gateway.getTargetMemberFacts({ ...dto, requiredPermission: "BanMembers", capability: "bannable" });
    this.policy.assertTargetMemberActionAllowed(facts);
    await this.gateway.banMember({ ...dto, deleteMessageSeconds });
    return this.result("ban", dto);
  }

  async kick(input) {
    const dto = this.targetDto(input);
    const facts = await this.gateway.getTargetMemberFacts({ ...dto, requiredPermission: "KickMembers", capability: "kickable" });
    this.policy.assertTargetMemberActionAllowed(facts);
    await this.gateway.kickMember(dto);
    return this.result("kick", dto);
  }

  async timeout(input) {
    const dto = this.targetDto(input);
    const durationSeconds = this.choice(input.durationSeconds, TIMEOUT_SECONDS, "Invalid timeout duration.");
    const facts = await this.gateway.getTargetMemberFacts({ ...dto, requiredPermission: "ModerateMembers", capability: "moderatable" });
    this.policy.assertTargetMemberActionAllowed(facts);
    const until = new Date(this.now() + durationSeconds * 1000);
    await this.gateway.timeoutMember({ ...dto, until });
    return this.result("timeout", dto, { until });
  }

  async untimeout(input) {
    const dto = this.targetDto(input);
    const facts = await this.gateway.getTargetMemberFacts({ ...dto, requiredPermission: "ModerateMembers", capability: "moderatable" });
    this.policy.assertTargetMemberActionAllowed(facts);
    if (!facts.targetTimedOut) {
      throw new ModerationError(ModerationErrorCodes.NOT_TIMED_OUT, "That member is not timed out.");
    }
    await this.gateway.untimeoutMember(dto);
    return this.result("untimeout", dto);
  }

  async unban(input) {
    const dto = {
      guildId: this.requiredString(input.guildId, "Guild is required."),
      actorId: this.requiredSnowflake(input.actorId, "Actor is required."),
      userId: this.requiredSnowflake(input.userId, "User ID must be a valid Discord ID."),
      reason: this.reason(input.reason),
    };
    const facts = await this.gateway.getUnbanFacts(dto);
    this.policy.assertUnbanAllowed(facts);
    await this.gateway.unbanUser(dto);
    return this.result("unban", { ...dto, targetId: dto.userId });
  }

  targetDto(input) {
    return {
      guildId: this.requiredString(input.guildId, "Guild is required."),
      actorId: this.requiredSnowflake(input.actorId, "Actor is required."),
      targetId: this.requiredSnowflake(input.targetId, "Target is required."),
      reason: this.reason(input.reason),
    };
  }

  requiredString(value, message) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ModerationError(ModerationErrorCodes.GUILD_ONLY, message);
    }
    return value.trim();
  }

  requiredSnowflake(value, message) {
    if (typeof value !== "string" || !SNOWFLAKE_PATTERN.test(value.trim())) {
      throw new ModerationError(ModerationErrorCodes.INVALID_INPUT, message);
    }
    return value.trim();
  }

  reason(value) {
    if (value == null) return undefined;
    if (typeof value !== "string") {
      throw new ModerationError(ModerationErrorCodes.INVALID_INPUT, "Reason must be text.");
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      throw new ModerationError(ModerationErrorCodes.INVALID_INPUT, "Reason cannot be empty.");
    }
    return normalized.slice(0, MAX_REASON_LENGTH);
  }

  choice(value, choices, message) {
    const number = Number(value);
    if (!Number.isInteger(number) || !choices.has(number)) {
      throw new ModerationError(ModerationErrorCodes.INVALID_INPUT, message);
    }
    return number;
  }

  result(command, input, extra = {}) {
    this.logger.info("Moderation command completed.", {
      command,
      guildId: input.guildId,
      actorId: input.actorId,
      targetId: input.targetId,
    });
    return { command, targetId: input.targetId, ...extra };
  }
}

module.exports = ModerationService;
module.exports.BAN_DELETE_SECONDS = BAN_DELETE_SECONDS;
module.exports.TIMEOUT_SECONDS = TIMEOUT_SECONDS;
