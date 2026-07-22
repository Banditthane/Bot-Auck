function safeCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || "")) ? error.code : "AUTO_NAME_EVENT_FAILURE";
}

module.exports = {
  name: "guildMemberAdd",
  async execute({ container, args }) {
    const member = args?.[0];
    const guildId = member?.guild?.id;
    const userId = member?.id;
    if (!guildId || !userId || member.user?.bot) return;
    try {
      const service = container.resolve("services")?.autoNameService;
      if (!service) return;
      await service.assign({ guildId, userId, actorId: null, source: "join", traceId: `join:${guildId}:${userId}`.slice(0, 64) });
    } catch (error) {
      try { container.resolve("logger")?.warn("auto_name_member_add_failed", { guildId, userId, code: safeCode(error) }); } catch (_ignored) {}
    }
  },
};
