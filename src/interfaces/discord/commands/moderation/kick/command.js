const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((option) => option
      .setName("target")
      .setDescription("Member to kick")
      .setRequired(true))
    .addStringOption((option) => option
      .setName("reason")
      .setDescription("Audit log reason")
      .setMaxLength(512)
      .setRequired(false)),

  execute: (context) => handler.execute(context),
};
