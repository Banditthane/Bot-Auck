const { PermissionFlagsBits } = require("discord.js");
const NicknameGateway = require("../../../application/repositories/contracts/NicknameGateway");
const { AUTO_NAME_ERROR_CODES: CODES, AutoNameStateError } = require("../../../domain/errors/AutoNameErrors");

class DiscordNicknameGateway extends NicknameGateway {
  constructor(client) { super(); this.client = client; }

  async getMemberFacts({ guildId, userId, actorId = null, requiredRoleId }) {
    const guild = await this._guild(guildId);
    const targetPromise = this._member(guild, userId);
    const actorPromise = actorId === userId ? targetPromise : actorId ? this._member(guild, actorId) : null;
    const [target, actor, bot, role] = await Promise.all([
      targetPromise,
      actorPromise,
      this._member(guild, this.client.user.id),
      requiredRoleId ? this._role(guild, requiredRoleId) : null,
    ]);
    if (!target) return null;
    return {
      guildId,
      userId,
      actorId,
      botId: this.client.user.id,
      ownerId: guild.ownerId,
      actorHasManageNicknames: Boolean(actor?.permissions?.has?.(PermissionFlagsBits.ManageNicknames)),
      actorIsOwner: Boolean(actor && actor.id === guild.ownerId),
      actorRoleComparison: actor ? compareRoles(actor, target) : 0,
      botHasManageNicknames: Boolean(bot?.permissions?.has?.(PermissionFlagsBits.ManageNicknames)),
      botRoleComparison: bot ? compareRoles(bot, target) : 0,
      targetIsBot: Boolean(target.user?.bot),
      targetIsOwner: target.id === guild.ownerId,
      targetHasRequiredRole: Boolean(requiredRoleId && target.roles?.cache?.has?.(requiredRoleId)),
      targetManageable: Boolean(target.manageable),
      username: String(target.user?.username || ""),
      displayName: String(target.displayName || target.user?.globalName || target.user?.username || ""),
      currentNickname: target.nickname || null,
      roleName: role?.name || "",
      hasAutoName: false,
    };
  }

  async getRoleFacts({ guildId, roleId }) {
    const guild = await this._guild(guildId);
    const role = await this._role(guild, roleId);
    return role ? { guildId, roleId: role.id, exists: true, name: role.name, position: Number(role.position) || 0,
      managed: Boolean(role.managed) } : { guildId, roleId, exists: false, name: "", position: 0, managed: false };
  }

  async listMembersPage({ guildId, after = null, limit = 1000 }) {
    const guild = await this._guild(guildId);
    const bounded = Math.max(1, Math.min(1000, Number.isInteger(limit) ? limit : 1000));
    const collection = await guild.members.list({ after: after || undefined, limit: bounded, cache: false });
    const members = [...collection.values()].map((member) => ({
      userId: member.id,
      bot: Boolean(member.user?.bot),
      username: String(member.user?.username || ""),
      displayName: String(member.displayName || member.user?.globalName || member.user?.username || ""),
      currentNickname: member.nickname || null,
      roleIds: [...(member.roles?.cache?.keys?.() || [])],
    }));
    return { members, nextCursor: members.length === bounded ? members.at(-1)?.userId || null : null };
  }

  async setNickname({ guildId, userId, nickname, reason }) {
    const guild = await this._guild(guildId);
    const member = await this._member(guild, userId);
    if (!member) throw new AutoNameStateError("Member was not found.", CODES.INELIGIBLE);
    try {
      await member.setNickname(nickname, String(reason || "Auto Name assignment").slice(0, 512));
      return true;
    } catch (error) {
      throw providerError(error);
    }
  }

  async _guild(guildId) {
    try {
      const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId);
      if (!guild) throw new Error("Guild not found.");
      return guild;
    } catch (error) { throw providerError(error); }
  }

  async _member(guild, userId) {
    try { return await guild.members.fetch({ user: userId, force: true }); }
    catch (error) { if (error?.code === 10007 || error?.status === 404) return null; throw providerError(error); }
  }

  async _role(guild, roleId) {
    try { return await guild.roles.fetch(roleId); }
    catch (error) { if (error?.code === 10011 || error?.status === 404) return null; throw providerError(error); }
  }
}

function compareRoles(member, target) {
  return Number(member?.roles?.highest?.comparePositionTo?.(target?.roles?.highest)) || 0;
}
function providerError(error) {
  return new AutoNameStateError("Discord could not complete the Auto Name operation.", CODES.PROVIDER_FAILURE, {
    providerCode: String(error?.code ?? error?.status ?? "UNKNOWN").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64) || "UNKNOWN",
  });
}
module.exports = DiscordNicknameGateway;
module.exports.providerError = providerError;
