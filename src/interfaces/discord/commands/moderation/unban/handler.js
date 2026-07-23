const { context, reason, respond, runModeration } = require("../shared");

class UnbanHandler {
  async execute({ interaction, container }) {
    await runModeration(interaction, async () => {
      const service = container.resolve("services").moderationService;
      const result = await service.unban({
        ...context(interaction),
        userId: interaction.options.getString("user-id", true),
        reason: reason(interaction),
      });
      await respond(interaction, `<@${result.targetId}> was unbanned.`);
    });
  }
}

module.exports = new UnbanHandler();
module.exports.UnbanHandler = UnbanHandler;
