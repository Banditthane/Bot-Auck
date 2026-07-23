const { context, reason, respond, runModeration, targetId } = require("../shared");

class UntimeoutHandler {
  async execute({ interaction, container }) {
    await runModeration(interaction, async () => {
      const service = container.resolve("services").moderationService;
      const result = await service.untimeout({
        ...context(interaction),
        targetId: targetId(interaction),
        reason: reason(interaction),
      });
      await respond(interaction, `<@${result.targetId}> timeout was removed.`);
    });
  }
}

module.exports = new UntimeoutHandler();
module.exports.UntimeoutHandler = UntimeoutHandler;
