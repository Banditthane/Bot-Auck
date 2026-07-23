const { PermissionFlagsBits } = require("discord.js");

const pingCommand = require("./utility/ping/command");
const helpCommand = require("./utility/help/command");
const roomCommand = require("./room/command");
const roomSetupCommand = require("./admin/room-setup/command");
const autoNameCommand = require("./admin/auto-name/command");
const autoRoleCommand = require("./admin/auto-role/command");
const banCommand = require("./moderation/ban/command");
const kickCommand = require("./moderation/kick/command");
const unbanCommand = require("./moderation/unban/command");
const timeoutCommand = require("./moderation/timeout/command");
const untimeoutCommand = require("./moderation/untimeout/command");

const ADMINISTRATOR = PermissionFlagsBits.Administrator.toString();
const MANAGE_NICKNAMES = PermissionFlagsBits.ManageNicknames.toString();
const MODERATE_MEMBERS = PermissionFlagsBits.ModerateMembers.toString();
const BAN_MEMBERS = PermissionFlagsBits.BanMembers.toString();
const KICK_MEMBERS = PermissionFlagsBits.KickMembers.toString();

module.exports = Object.freeze([
  { name: "ping", command: pingCommand, category: "Utility", security: "Everyone", help: { visible: true, order: 10 } },
  { name: "help", command: helpCommand, category: "Utility", security: "Everyone", help: { visible: true, order: 20 } },
  { name: "room", command: roomCommand, category: "Room", security: "Room member controls", help: { visible: true, order: 30 } },
  { name: "room-setup", command: roomSetupCommand, category: "Administration", security: "Administrator", defaultMemberPermissions: ADMINISTRATOR, help: { visible: true, order: 40 } },
  { name: "autoname", command: autoNameCommand, category: "Member Automation", security: "Manage Nicknames", defaultMemberPermissions: MANAGE_NICKNAMES, help: { visible: true, order: 50 } },
  { name: "autorole", command: autoRoleCommand, category: "Member Automation", security: "Administrator", defaultMemberPermissions: ADMINISTRATOR, help: { visible: true, order: 60 } },
  { name: "ban", command: banCommand, category: "Moderation", security: "Ban Members", defaultMemberPermissions: BAN_MEMBERS, help: { visible: true, order: 70 } },
  { name: "kick", command: kickCommand, category: "Moderation", security: "Kick Members", defaultMemberPermissions: KICK_MEMBERS, help: { visible: true, order: 80 } },
  { name: "unban", command: unbanCommand, category: "Moderation", security: "Ban Members", defaultMemberPermissions: BAN_MEMBERS, help: { visible: true, order: 90 } },
  { name: "timeout", command: timeoutCommand, category: "Moderation", security: "Moderate Members", defaultMemberPermissions: MODERATE_MEMBERS, help: { visible: true, order: 100 } },
  { name: "untimeout", command: untimeoutCommand, category: "Moderation", security: "Moderate Members", defaultMemberPermissions: MODERATE_MEMBERS, help: { visible: true, order: 110 } },
]);
