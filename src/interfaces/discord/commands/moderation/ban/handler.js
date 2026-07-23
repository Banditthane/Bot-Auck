const { context, reason, respond, runModeration, targetId } = require("../shared");

class BanHandler {
  async execute({ interaction, container }) {
    await runModeration(interaction, async () => {
      const service = container.resolve("services").moderationService;
      const result = await service.ban({
        ...context(interaction),
        targetId: targetId(interaction),
        reason: reason(interaction),
        deleteMessageSeconds: Number(interaction.options.getString("delete-messages", false) ?? 0),
      });
      await respond(interaction, `<@${result.targetId}> was banned.`);
    });
  }
}

module.exports = new BanHandler();
module.exports.BanHandler = BanHandler;
