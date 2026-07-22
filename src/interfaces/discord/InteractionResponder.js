const { MessageFlags } = require("discord.js");

const UNKNOWN_COMMAND_MESSAGE = "Unknown command.";
const COMMAND_FAILED_MESSAGE = "Command failed. Please try again.";

class InteractionResponder {
  async unknownCommand(interaction) {
    await this.respond(interaction, UNKNOWN_COMMAND_MESSAGE);
  }

  async commandFailed(interaction) {
    await this.respond(interaction, COMMAND_FAILED_MESSAGE);
  }

  async respond(interaction, content) {
    if (interaction.replied) {
      await interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.deferred) {
      await interaction.editReply({ content });
      return;
    }

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = InteractionResponder;
