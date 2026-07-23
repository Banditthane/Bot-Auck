const { PermissionsBitField } = require("discord.js");

class DiscordRoleGateway {
  constructor(client) {
    this.client = client;
  }

  async getActorFacts({ guildId, actorId }) {
    if (!actorId) return { actorIsOwner: false, actorIsAdministrator: false };
    const guild = await this._guild(guildId);
    const member = await guild.members.fetch(actorId);
    return {
      actorIsOwner: guild.ownerId === actorId,
      actorIsAdministrator: member.permissions.has(PermissionsBitField.Flags.Administrator),
    };
  }

  async getMemberFacts({ guildId, userId }) {
    const guild = await this._guild(guildId);
    const member = await guild.members.fetch(userId);
    const botMember = await guild.members.fetchMe();
    const botTop = botMember.roles.highest.position;
    const manageableRoleIds = guild.roles.cache
      .filter((role) => role.id !== guild.id && !role.managed && role.position < botTop)
      .map((role) => role.id);
    return {
      userId,
      currentRoleIds: [...member.roles.cache.keys()].filter((id) => id !== guild.id),
      manageableRoleIds,
      targetIsBot: Boolean(member.user?.bot),
      targetIsOwner: guild.ownerId === userId,
      exclusiveGroupRoleIds: {},
      owningPriorityByRole: {},
    };
  }

  async listMembersPage({ guildId, after = null, limit = 100 }) {
    const guild = await this._guild(guildId);
    const members = await guild.members.list({ after: after || "0", limit: Math.min(Math.max(limit, 1), 1000) });
    const values = [...members.values()];
    return {
      members: values.filter((member) => !member.user?.bot).map((member) => ({ userId: member.id })),
      nextCursor: values.length > 0 ? values[values.length - 1].id : null,
    };
  }

  async addRole({ guildId, userId, roleId, reason }) {
    const member = await (await this._guild(guildId)).members.fetch(userId);
    await member.roles.add(roleId, reason || "Auto Role");
  }

  async removeRole({ guildId, userId, roleId, reason }) {
    const member = await (await this._guild(guildId)).members.fetch(userId);
    await member.roles.remove(roleId, reason || "Auto Role");
  }

  async refetchMember({ guildId, userId }) {
    return (await this._guild(guildId)).members.fetch({ user: userId, force: true });
  }

  async _guild(guildId) {
    const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId);
    if (!guild) throw new Error("Guild unavailable.");
    return guild;
  }
}

module.exports = DiscordRoleGateway;
