const { SlashCommandBuilder } = require("discord.js"); const handler = require("./handler");
module.exports = { data: new SlashCommandBuilder().setName("help").setDescription("Browse available commands").setDMPermission(true).addStringOption((o) => o.setName("command").setDescription("Command name").setMaxLength(32)), execute: (context) => handler.execute(context) };
