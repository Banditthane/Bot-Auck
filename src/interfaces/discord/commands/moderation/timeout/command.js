const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option
      .setName("target")
      .setDescription("Member to timeout")
      .setRequired(true))
    .addStringOption((option) => option
      .setName("duration")
      .setDescription("Timeout duration")
      .setRequired(true)
      .addChoices(
        { name: "5 minutes", value: "300" },
        { name: "10 minutes", value: "600" },
        { name: "1 hour", value: "3600" },
        { name: "6 hours", value: "21600" },
        { name: "12 hours", value: "43200" },
        { name: "1 day", value: "86400" },
        { name: "3 days", value: "259200" },
        { name: "7 days", value: "604800" },
        { name: "14 days", value: "1209600" },
        { name: "28 days", value: "2419200" }
      ))
    .addStringOption((option) => option
      .setName("reason")
      .setDescription("Audit log reason")
      .setMaxLength(512)
      .setRequired(false)),

  execute: (context) => handler.execute(context),
};
