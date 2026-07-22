const { SlashCommandBuilder } = require("discord.js");
const pingHandler = require("./handler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  execute: (context) => pingHandler.execute(context),
};
