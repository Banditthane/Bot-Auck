const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a Discord user ID")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName("user-id")
      .setDescription("Discord user ID to unban")
      .setMinLength(17)
      .setMaxLength(20)
      .setRequired(true))
    .addStringOption((option) => option
      .setName("reason")
      .setDescription("Audit log reason")
      .setMaxLength(512)
      .setRequired(false)),

  execute: (context) => handler.execute(context),
};
