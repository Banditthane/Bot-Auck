const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoname")
    .setDescription("Configure and manage automatic member names")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("setup").setDescription("Configure Auto Name")
      .addRoleOption((option) => option.setName("required-role").setDescription("Role required for automatic names").setRequired(true))
      .addStringOption((option) => option.setName("template").setDescription("Nickname template containing {code}").setMinLength(1).setMaxLength(100))
      .addIntegerOption((option) => option.setName("code-length").setDescription("Number of digits in member codes").setMinValue(1).setMaxValue(12)))
    .addSubcommand((sub) => sub.setName("template").setDescription("Update the nickname template")
      .addStringOption((option) => option.setName("template").setDescription("Nickname template containing {code}").setMinLength(1).setMaxLength(100).setRequired(true)))
    .addSubcommand((sub) => sub.setName("preview").setDescription("Preview a generated nickname")
      .addUserOption((option) => option.setName("member").setDescription("Member to preview")))
    .addSubcommand((sub) => sub.setName("scan").setDescription("Queue a server member scan")
      .addBooleanOption((option) => option.setName("missing-only").setDescription("Only assign members without a code"))
      .addBooleanOption((option) => option.setName("force").setDescription("Re-evaluate existing assignments"))
      .addBooleanOption((option) => option.setName("dry-run").setDescription("Preview without changing nicknames")))
    .addSubcommand((sub) => sub.setName("scan-status").setDescription("Show the current scan status"))
    .addSubcommand((sub) => sub.setName("repair").setDescription("Queue or perform a repair")
      .addUserOption((option) => option.setName("member").setDescription("Single member to repair"))
      .addRoleOption((option) => option.setName("role").setDescription("Role subset to repair"))
      .addBooleanOption((option) => option.setName("dry-run").setDescription("Preview without changing nicknames")))
    .addSubcommand((sub) => sub.setName("enable").setDescription("Enable Auto Name"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable Auto Name"))
    .addSubcommand((sub) => sub.setName("config").setDescription("Show Auto Name configuration")),
  execute: (context) => handler.execute(context),
};
