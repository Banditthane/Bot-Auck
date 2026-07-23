const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) => option
      .setName("target")
      .setDescription("Member to ban")
      .setRequired(true))
    .addStringOption((option) => option
      .setName("reason")
      .setDescription("Audit log reason")
      .setMaxLength(512)
      .setRequired(false))
    .addStringOption((option) => option
      .setName("delete-messages")
      .setDescription("How much recent message history to delete")
      .setRequired(false)
      .addChoices(
        { name: "none", value: "0" },
        { name: "1 hour", value: "3600" },
        { name: "6 hours", value: "21600" },
        { name: "12 hours", value: "43200" },
        { name: "1 day", value: "86400" },
        { name: "3 days", value: "259200" },
        { name: "7 days", value: "604800" }
      )),

  execute: (context) => handler.execute(context),
};
