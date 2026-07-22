const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const roomSetupHandler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("room-setup")
    .setDescription("Configure automatic temporary voice rooms")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) => option
      .setName("trigger")
      .setDescription("Voice channel members join to create a room")
      .addChannelTypes(ChannelType.GuildVoice)
      .setRequired(true))
    .addChannelOption((option) => option
      .setName("category")
      .setDescription("Optional; defaults to the trigger voice channel's category")
      .addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption((option) => option
      .setName("log-channel")
      .setDescription("Optional channel for future operational logs")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((option) => option
      .setName("moderator-role")
      .setDescription("Optional moderator role recorded in configuration"))
    .addStringOption((option) => option
      .setName("name-template")
      .setDescription("Optional template; use {number} for auto numbering or {displayName} for the owner")
      .setMinLength(1)
      .setMaxLength(100))
    .addIntegerOption((option) => option
      .setName("default-limit")
      .setDescription("Default room user limit (0 means unlimited)")
      .setMinValue(0)
      .setMaxValue(99))
    .addIntegerOption((option) => option
      .setName("delete-delay")
      .setDescription("Seconds to wait before deleting an empty room")
      .setMinValue(0)
      .setMaxValue(300)),

  execute: (context) => roomSetupHandler.execute(context),
};
