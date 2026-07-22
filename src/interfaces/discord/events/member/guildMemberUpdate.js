function roleIds(member) {
  return new Set(member?.roles?.cache?.keys?.() || []);
}

function safeCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || "")) ? error.code : "AUTO_NAME_EVENT_FAILURE";
}

module.exports = {
  name: "guildMemberUpdate",
  async execute({ container, args }) {
    const [before, member] = args || [];
    const guildId = member?.guild?.id;
    const userId = member?.id;
    if (!guildId || !userId || member.user?.bot) return;
    const previous = roleIds(before);
    if (![...roleIds(member)].some((id) => !previous.has(id))) return;
    try {
      const services = container.resolve("services");
      const orchestrator = services?.memberAutomationOrchestrator;
      if (orchestrator) await orchestrator.handle({ guildId, userId, actorId: null, trigger: "ROLE_ADDED", source: "role-add", traceId: `role:${guildId}:${userId}`.slice(0, 64) });
      else if (services?.autoNameService) await services.autoNameService.assign({ guildId, userId, actorId: null, source: "role-add", traceId: `role:${guildId}:${userId}`.slice(0, 64) });
    } catch (error) {
      try { container.resolve("logger")?.warn("auto_name_member_update_failed", { guildId, userId, code: safeCode(error) }); } catch (_ignored) {}
    }
  },
};
