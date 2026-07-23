const { context, reason, respond, runModeration, targetId } = require("../shared");

class KickHandler {
  async execute({ interaction, container }) {
    await runModeration(interaction, async () => {
      const service = container.resolve("services").moderationService;
      const result = await service.kick({
        ...context(interaction),
        targetId: targetId(interaction),
        reason: reason(interaction),
      });
      await respond(interaction, `<@${result.targetId}> was kicked.`);
    });
  }
}

module.exports = new KickHandler();
module.exports.KickHandler = KickHandler;
