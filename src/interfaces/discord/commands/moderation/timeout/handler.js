const { context, reason, respond, runModeration, targetId } = require("../shared");

class TimeoutHandler {
  async execute({ interaction, container }) {
    await runModeration(interaction, async () => {
      const service = container.resolve("services").moderationService;
      const result = await service.timeout({
        ...context(interaction),
        targetId: targetId(interaction),
        durationSeconds: Number(interaction.options.getString("duration", true)),
        reason: reason(interaction),
      });
      await respond(interaction, `<@${result.targetId}> was timed out.`);
    });
  }
}

module.exports = new TimeoutHandler();
module.exports.TimeoutHandler = TimeoutHandler;
