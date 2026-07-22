module.exports = {
  name: "voiceStateUpdate",

  async execute({ container, args }) {
    const [oldState, newState] = args;
    const member = newState?.member || oldState?.member;
    if (!member || member.user?.bot) return;

    const guildId = newState?.guild?.id || oldState?.guild?.id;
    const userId = member.id;
    const oldChannelId = oldState?.channelId || null;
    const newChannelId = newState?.channelId || null;
    if (!guildId || !userId || oldChannelId === newChannelId) return;

    const logger = container.resolve("logger");
    const services = container.resolve("services");
    if (!services.autoRoomService) {
      logger.warn("Auto Voice Room event ignored: service is not registered.");
      return;
    }

    try {
      await services.autoRoomService.handleVoiceStateChange({
        guildId,
        userId,
        displayName: member.displayName || member.user?.username || "Member",
        bot: false,
        oldChannelId,
        newChannelId,
      });
    } catch (error) {
      logger.error("Auto Voice Room voice-state handling failed", {
        guildId,
        userId,
        code: error?.code,
      });
    }
  },
};
