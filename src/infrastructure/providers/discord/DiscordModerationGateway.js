const { PermissionFlagsBits } = require("discord.js");
const ModerationGateway = require("@contracts/ModerationGateway");
const { ModerationError, ModerationErrorCodes } = require("@errors/ModerationErrors");

const PERMISSION_FLAGS = Object.freeze({
  BanMembers: PermissionFlagsBits.BanMembers,
  KickMembers: PermissionFlagsBits.KickMembers,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
});

class DiscordModerationGateway extends ModerationGateway {
  constructor(client) {
    super();
    this.client = client;
  }

  async getTargetMemberFacts({ guildId, actorId, targetId, requiredPermission, capability }) {
    const guild = await this.fetchGuild(guildId);
    const [actor, target, bot] = await Promise.all([
      this.fetchMember(guild, actorId),
      this.fetchMember(guild, targetId),
      this.fetchMember(guild, this.client.user.id),
    ]);
    const permission = PERMISSION_FLAGS[requiredPermission];

    return {
      guildId,
      actorId,
      botId: this.client.user.id,
      ownerId: guild.ownerId,
      targetId,
      targetIsMember: Boolean(target),
      actorHasPermission: Boolean(actor?.permissions?.has?.(permission)),
      botHasPermission: Boolean(bot?.permissions?.has?.(permission)),
      actorRolePosition: rolePosition(actor),
      botRolePosition: rolePosition(bot),
      targetRolePosition: rolePosition(target),
      targetCapability: Boolean(target?.[capability]),
      targetTimedOut: Boolean(target?.communicationDisabledUntilTimestamp && target.communicationDisabledUntilTimestamp > Date.now()),
    };
  }

  async getUnbanFacts({ guildId, actorId, userId }) {
    const guild = await this.fetchGuild(guildId);
    const [actor, bot, ban] = await Promise.all([
      this.fetchMember(guild, actorId),
      this.fetchMember(guild, this.client.user.id),
      this.fetchBan(guild, userId),
    ]);
    return {
      guildId,
      actorId,
      actorHasPermission: Boolean(actor?.permissions?.has?.(PermissionFlagsBits.BanMembers)),
      botHasPermission: Boolean(bot?.permissions?.has?.(PermissionFlagsBits.BanMembers)),
      isBanned: Boolean(ban),
    };
  }

  async banMember({ guildId, targetId, deleteMessageSeconds, reason }) {
    const guild = await this.fetchGuild(guildId);
    return this.wrapProvider(() => guild.bans.create(targetId, { deleteMessageSeconds, reason }));
  }

  async kickMember({ guildId, targetId, reason }) {
    const guild = await this.fetchGuild(guildId);
    const member = await this.fetchMember(guild, targetId);
    return this.wrapProvider(() => member.kick(reason));
  }

  async timeoutMember({ guildId, targetId, until, reason }) {
    const guild = await this.fetchGuild(guildId);
    const member = await this.fetchMember(guild, targetId);
    return this.wrapProvider(() => member.timeout(until.getTime(), reason));
  }

  async untimeoutMember({ guildId, targetId, reason }) {
    const guild = await this.fetchGuild(guildId);
    const member = await this.fetchMember(guild, targetId);
    return this.wrapProvider(() => member.timeout(null, reason));
  }

  async unbanUser({ guildId, userId, reason }) {
    const guild = await this.fetchGuild(guildId);
    return this.wrapProvider(() => guild.bans.remove(userId, reason));
  }

  async fetchGuild(guildId) {
    const guild = this.client.guilds.cache.get(guildId) ?? await this.client.guilds.fetch(guildId);
    if (!guild) throw new ModerationError(ModerationErrorCodes.GUILD_ONLY, "Server is unavailable.");
    return guild;
  }

  async fetchMember(guild, userId) {
    try {
      return guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
    } catch (error) {
      if (error?.code === 10007 || error?.status === 404) return null;
      throw error;
    }
  }

  async fetchBan(guild, userId) {
    try {
      return await guild.bans.fetch(userId);
    } catch (error) {
      if (error?.code === 10026 || error?.status === 404) return null;
      throw error;
    }
  }

  async wrapProvider(operation) {
    try {
      return await operation();
    } catch (error) {
      throw new ModerationError(
        ModerationErrorCodes.PROVIDER_FAILURE,
        "Discord rejected the moderation action. Check my role and permissions, then try again.",
        { providerCode: sanitizeCode(error?.code ?? error?.status ?? error?.cause?.code) }
      );
    }
  }
}

function rolePosition(member) {
  return Number(member?.roles?.highest?.position) || 0;
}

function sanitizeCode(value) {
  return String(value ?? "UNKNOWN").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64) || "UNKNOWN";
}

module.exports = DiscordModerationGateway;
