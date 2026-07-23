const { ModerationError, ModerationErrorCodes } = require("@errors/ModerationErrors");

class ModerationPolicy {
  assertTargetMemberActionAllowed(facts) {
    if (!facts?.guildId || !facts?.actorId || !facts?.botId) {
      throw new ModerationError(ModerationErrorCodes.GUILD_ONLY, "This command can only be used in a server.");
    }
    if (!facts.actorHasPermission) {
      throw new ModerationError(ModerationErrorCodes.ACTOR_PERMISSION, "You do not have permission to use this command.");
    }
    if (!facts.botHasPermission) {
      throw new ModerationError(ModerationErrorCodes.BOT_PERMISSION, "I do not have the required moderation permission.");
    }
    if (!facts.targetIsMember) {
      throw new ModerationError(ModerationErrorCodes.TARGET_NOT_MEMBER, "That user is not a current server member.");
    }
    if (facts.targetId === facts.actorId) {
      throw new ModerationError(ModerationErrorCodes.TARGET_SELF, "You cannot target yourself.");
    }
    if (facts.targetId === facts.botId) {
      throw new ModerationError(ModerationErrorCodes.TARGET_BOT, "You cannot target this bot.");
    }
    if (facts.targetId === facts.ownerId) {
      throw new ModerationError(ModerationErrorCodes.TARGET_OWNER, "You cannot target the server owner.");
    }
    if (facts.actorId !== facts.ownerId && !(facts.actorRolePosition > facts.targetRolePosition)) {
      throw new ModerationError(ModerationErrorCodes.ACTOR_HIERARCHY, "Your highest role must be above the target member.");
    }
    if (!(facts.botRolePosition > facts.targetRolePosition)) {
      throw new ModerationError(ModerationErrorCodes.BOT_HIERARCHY, "My highest role must be above the target member.");
    }
    if (!facts.targetCapability) {
      throw new ModerationError(ModerationErrorCodes.TARGET_NOT_CAPABLE, "Discord does not allow me to moderate that member.");
    }
  }

  assertUnbanAllowed(facts) {
    if (!facts?.guildId || !facts?.actorId) {
      throw new ModerationError(ModerationErrorCodes.GUILD_ONLY, "This command can only be used in a server.");
    }
    if (!facts.actorHasPermission) {
      throw new ModerationError(ModerationErrorCodes.ACTOR_PERMISSION, "You do not have permission to use this command.");
    }
    if (!facts.botHasPermission) {
      throw new ModerationError(ModerationErrorCodes.BOT_PERMISSION, "I do not have the required ban permission.");
    }
    if (!facts.isBanned) {
      throw new ModerationError(ModerationErrorCodes.NOT_BANNED, "That user is not currently banned.");
    }
  }
}

module.exports = ModerationPolicy;
