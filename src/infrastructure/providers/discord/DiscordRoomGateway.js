const {
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");
const { permissionsForMode } = require("../../../domain/policies/RoomPermissionPolicy");

const OWNER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MoveMembers,
];
const BOT_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MoveMembers,
];

function normalizeError(error) {
  if (error?.code === 10003) {
    const mapped = new Error("Discord channel does not exist.");
    mapped.code = "UNKNOWN_CHANNEL";
    mapped.cause = error;
    return mapped;
  }
  return error;
}

class DiscordRoomGateway {
  constructor(client) {
    this.client = client;
  }

  async getGuild(guildId) {
    return this.client.guilds.cache.get(guildId) || this.client.guilds.fetch(guildId);
  }

  listVisibleGuildIds() {
    return [...this.client.guilds.cache.keys()];
  }

  async getChannelSnapshot({ guildId, channelId }) {
    try {
      const guild = await this.getGuild(guildId);
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
      if (!channel) return null;

      const members = channel.isVoiceBased()
        ? [...channel.members.values()].map((member) => ({
          id: member.id,
          bot: Boolean(member.user?.bot),
        }))
        : [];
      const botOverwrite = channel.permissionOverwrites?.cache?.get(this.client.user.id);
      const managedMarker = Boolean(
        botOverwrite?.allow?.has(PermissionFlagsBits.ManageChannels) &&
        botOverwrite?.allow?.has(PermissionFlagsBits.MoveMembers)
      );

      return {
        id: channel.id,
        guildId: channel.guildId,
        parentId: channel.parentId,
        isVoice: channel.type === ChannelType.GuildVoice,
        managedMarker,
        members,
      };
    } catch (error) {
      const mapped = normalizeError(error);
      if (mapped.code === "UNKNOWN_CHANNEL") return null;
      throw mapped;
    }
  }

  async createRoom({
    guildId, categoryId, name, userLimit, ownerId, moderatorRoleId = null, mode = "open",
  }) {
    const guild = await this.getGuild(guildId);
    const everyone = permissionsForMode(mode);
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      userLimit,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [
            ...(everyone.viewChannel === true ? [PermissionFlagsBits.ViewChannel] : []),
            ...(everyone.connect === true ? [PermissionFlagsBits.Connect] : []),
          ],
          deny: [
            ...(everyone.viewChannel === false ? [PermissionFlagsBits.ViewChannel] : []),
            ...(everyone.connect === false ? [PermissionFlagsBits.Connect] : []),
          ],
        },
        { id: ownerId, allow: OWNER_ALLOW },
        ...(moderatorRoleId ? [{
          id: moderatorRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
          ],
        }] : []),
        { id: this.client.user.id, allow: BOT_ALLOW },
      ],
      reason: "Auto Voice Room: join-to-create",
    });
    return { channelId: channel.id };
  }

  async deleteRoom({ guildId, channelId, reason = "Auto Voice Room cleanup" }) {
    try {
      const guild = await this.getGuild(guildId);
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
      if (!channel) return false;
      await channel.delete(reason);
      return true;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async moveMember({ guildId, userId, channelId }) {
    const guild = await this.getGuild(guildId);
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
    await member.voice.setChannel(channelId, "Auto Voice Room move");
  }

  async disconnectMember({ guildId, userId, expectedChannelId }) {
    const guild = await this.getGuild(guildId);
    const member = await guild.members.fetch({ user: userId, force: true });
    if (member.voice.channelId !== expectedChannelId) {
      const error = new Error("Target user is no longer in the expected voice channel.");
      error.code = "TARGET_MOVED";
      throw error;
    }
    await member.voice.disconnect("Removed from managed Auto Voice Room");
  }

  async setRoomMode({ guildId, channelId, mode }) {
    const guild = await this.getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel) throw Object.assign(new Error("Discord channel does not exist."), { code: "UNKNOWN_CHANNEL" });
    const permissions = permissionsForMode(mode);
    await channel.permissionOverwrites.edit(guild.id, {
      ViewChannel: permissions.viewChannel,
      Connect: permissions.connect,
    }, { reason: `Auto Voice Room mode: ${mode}` });
  }

  async setUserAccess({ guildId, channelId, userId, access }) {
    const guild = await this.getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel) throw Object.assign(new Error("Discord channel does not exist."), { code: "UNKNOWN_CHANNEL" });

    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: access === "allowed" ? true : null,
      Connect: access === "allowed",
    }, { reason: `Auto Voice Room access: ${access}` });
  }

  async setUserLimit({ guildId, channelId, userLimit }) {
    const guild = await this.getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel) throw Object.assign(new Error("Discord channel does not exist."), { code: "UNKNOWN_CHANNEL" });
    await channel.setUserLimit(userLimit, "Auto Voice Room owner control");
  }

  async renameRoom({ guildId, channelId, name }) {
    const guild = await this.getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel) throw Object.assign(new Error("Discord channel does not exist."), { code: "UNKNOWN_CHANNEL" });
    await channel.setName(name, "Auto Voice Room owner control");
  }

  async transferOwnership({ guildId, channelId, oldOwnerId, newOwnerId }) {
    const guild = await this.getGuild(guildId);
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
    if (!channel) throw Object.assign(new Error("Discord channel does not exist."), { code: "UNKNOWN_CHANNEL" });
    const snapshot = (id) => {
      const overwrite = channel.permissionOverwrites.cache.get(id);
      return overwrite ? {
        id: overwrite.id,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
      } : null;
    };
    const previousOldOwner = snapshot(oldOwnerId);
    const previousNewOwner = snapshot(newOwnerId);
    const toOptions = (overwrite) => {
      const options = {};
      const seen = new Set();
      for (const [name, flag] of Object.entries(PermissionFlagsBits)) {
        const key = flag.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        options[name] = (overwrite.allow & flag) === flag
          ? true
          : (overwrite.deny & flag) === flag ? false : null;
      }
      return options;
    };
    const restore = async (id, overwrite) => {
      if (overwrite) {
        await channel.permissionOverwrites.edit(
          id,
          toOptions(overwrite),
          { reason: "Auto Voice Room ownership transfer rollback" }
        );
      } else {
        await channel.permissionOverwrites.delete(
          id,
          "Auto Voice Room ownership transfer rollback"
        );
      }
    };
    try {
      await channel.permissionOverwrites.edit(newOwnerId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        MoveMembers: true,
      }, { reason: "Auto Voice Room ownership transfer" });
      await channel.permissionOverwrites.delete(oldOwnerId, "Auto Voice Room ownership transfer");
    } catch (error) {
      try {
        await restore(oldOwnerId, previousOldOwner);
        await restore(newOwnerId, previousNewOwner);
      } catch (compensationError) {
        error.compensationError = compensationError;
      }
      throw error;
    }
  }

  async validateConfig({ guildId, triggerChannelId, categoryId }) {
    const guild = await this.getGuild(guildId);
    const [trigger, category] = await Promise.all([
      guild.channels.cache.get(triggerChannelId) || guild.channels.fetch(triggerChannelId),
      guild.channels.cache.get(categoryId) || guild.channels.fetch(categoryId),
    ]);
    return Boolean(
      trigger && category &&
      trigger.guildId === guildId && category.guildId === guildId &&
      trigger.type === ChannelType.GuildVoice && category.type === ChannelType.GuildCategory
    );
  }
}

module.exports = DiscordRoomGateway;
module.exports.normalizeError = normalizeError;
