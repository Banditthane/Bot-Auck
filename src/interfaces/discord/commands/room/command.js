const { SlashCommandBuilder } = require("discord.js");
const roomHandler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("room")
    .setDescription("Manage your temporary voice room")
    .addSubcommand((command) => command
      .setName("help")
      .setDescription("Show the Auto Voice Room usage guide"))
    .addSubcommand((command) => command
      .setName("panel")
      .setDescription("Show the current room settings"))
    .addSubcommand((command) => command
      .setName("lock")
      .setDescription("Prevent uninvited members from connecting"))
    .addSubcommand((command) => command
      .setName("unlock")
      .setDescription("Allow members to connect"))
    .addSubcommand((command) => command
      .setName("hide")
      .setDescription("Hide the room from uninvited members"))
    .addSubcommand((command) => command
      .setName("invite")
      .setDescription("Allow a member to connect")
      .addUserOption((option) => option
        .setName("user")
        .setDescription("Member to allow")
        .setRequired(true)))
    .addSubcommand((command) => command
      .setName("deny")
      .setDescription("Prevent a member from connecting")
      .addUserOption((option) => option
        .setName("user")
        .setDescription("Member to deny")
        .setRequired(true)))
    .addSubcommand((command) => command
      .setName("kick")
      .setDescription("Disconnect a member from this voice room")
      .addUserOption((option) => option
        .setName("user")
        .setDescription("Member to disconnect")
        .setRequired(true)))
    .addSubcommand((command) => command
      .setName("limit")
      .setDescription("Set the room user limit (0 means unlimited)")
      .addIntegerOption((option) => option
        .setName("number")
        .setDescription("User limit from 0 to 99")
        .setMinValue(0)
        .setMaxValue(99)
        .setRequired(true)))
    .addSubcommand((command) => command
      .setName("rename")
      .setDescription("Rename the room")
      .addStringOption((option) => option
        .setName("name")
        .setDescription("New room name")
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true)))
    .addSubcommand((command) => command
      .setName("transfer")
      .setDescription("Transfer ownership to a member in this room")
      .addUserOption((option) => option
        .setName("user")
        .setDescription("New room owner")
        .setRequired(true))),

  execute: (context) => roomHandler.execute(context),
};
