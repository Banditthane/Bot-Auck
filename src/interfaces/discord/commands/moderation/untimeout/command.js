const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a member timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option
      .setName("target")
      .setDescription("Member to remove timeout from")
      .setRequired(true))
    .addStringOption((option) => option
      .setName("reason")
      .setDescription("Audit log reason")
      .setMaxLength(512)
      .setRequired(false)),

  execute: (context) => handler.execute(context),
};
