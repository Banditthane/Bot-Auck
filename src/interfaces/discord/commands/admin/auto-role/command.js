const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const handler = require("./handler");
const triggers = [{ name: "Member join", value: "MEMBER_JOIN" }, { name: "Role added", value: "ROLE_ADDED" }, { name: "Manual scan", value: "MANUAL_SCAN" }, { name: "Manual repair", value: "MANUAL_REPAIR" }];
module.exports = { data: new SlashCommandBuilder().setName("autorole").setDescription("Configure and manage automatic roles").setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName("setup").setDescription("Configure Auto Role"))
  .addSubcommand((s) => s.setName("rule-create").setDescription("Create a rule").addStringOption((o) => o.setName("name").setDescription("Rule name").setRequired(true).setMaxLength(64)).addStringOption((o) => o.setName("trigger").setDescription("Trigger").setRequired(true).addChoices(...triggers)).addRoleOption((o) => o.setName("target-role").setDescription("First target role").setRequired(true)).addIntegerOption((o) => o.setName("priority").setDescription("Rule priority").setMinValue(-1000).setMaxValue(1000)))
  .addSubcommand((s) => s.setName("rule-edit").setDescription("Edit a rule").addStringOption((o) => o.setName("rule-id").setDescription("Rule ID").setRequired(true)))
  .addSubcommand((s) => s.setName("rule-delete").setDescription("Delete a rule").addStringOption((o) => o.setName("rule-id").setDescription("Rule ID").setRequired(true)))
  .addSubcommand((s) => s.setName("rule-enable").setDescription("Enable a rule").addStringOption((o) => o.setName("rule-id").setDescription("Rule ID").setRequired(true)))
  .addSubcommand((s) => s.setName("rule-disable").setDescription("Disable a rule").addStringOption((o) => o.setName("rule-id").setDescription("Rule ID").setRequired(true)))
  .addSubcommand((s) => s.setName("rule-list").setDescription("List rules"))
  .addSubcommand((s) => s.setName("rule-view").setDescription("View a rule").addStringOption((o) => o.setName("rule-id").setDescription("Rule ID").setRequired(true)))
  .addSubcommand((s) => s.setName("scan").setDescription("Queue a member scan").addStringOption((o) => o.setName("rule-id").setDescription("Optional rule ID")).addBooleanOption((o) => o.setName("missing-only").setDescription("Only missing roles")).addBooleanOption((o) => o.setName("dry-run").setDescription("Preview only")).addBooleanOption((o) => o.setName("force").setDescription("Force re-evaluation")))
  .addSubcommand((s) => s.setName("scan-status").setDescription("Show scan status"))
  .addSubcommand((s) => s.setName("repair").setDescription("Repair one member").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addBooleanOption((o) => o.setName("dry-run").setDescription("Preview only")))
  .addSubcommand((s) => s.setName("preview").setDescription("Preview role changes").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)))
  .addSubcommand((s) => s.setName("config").setDescription("Show configuration")), execute: (context) => handler.execute(context) };
