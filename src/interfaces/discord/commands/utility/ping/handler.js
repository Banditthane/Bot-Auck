const os = require("os");
const { performance } = require("perf_hooks");
const { MessageFlags, version: discordVersion } = require("discord.js");

function safeCall(callback) {
  try {
    return callback();
  } catch {
    return undefined;
  }
}

function sumFiniteNonNegative(values) {
  if (!Array.isArray(values)) return undefined;
  let total = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    total += value;
  }
  return total;
}

class PingHandler {
  constructor(dependencies = {}) {
    if (typeof dependencies === "function") dependencies = { monotonicNow: dependencies };

    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.wallNow = dependencies.wallNow ?? (() => Date.now());
    this.cpuUsage = dependencies.cpuUsage ?? ((start) => process.cpuUsage(start));
    this.memoryUsage = dependencies.memoryUsage ?? (() => process.memoryUsage());
    this.uptime = dependencies.uptime ?? (() => process.uptime());
    this.cpuCount = dependencies.cpuCount ?? (() => {
      const available = typeof os.availableParallelism === "function" ? os.availableParallelism() : undefined;
      return available ?? os.cpus().length;
    });
    this.discordVersion = dependencies.discordVersion ?? discordVersion;
    this.nodeVersion = dependencies.nodeVersion ?? process.version;
    this.ipcTimeoutMs = dependencies.ipcTimeoutMs ?? 1500;
    this.setTimeout = dependencies.setTimeout ?? setTimeout;
    this.clearTimeout = dependencies.clearTimeout ?? clearTimeout;
  }

  async withTimeout(promise) {
    let timeout;
    const timeoutPromise = new Promise((resolve) => {
      timeout = this.setTimeout(() => resolve(undefined), this.ipcTimeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      this.clearTimeout(timeout);
    }
  }

  getLocalCounts(client) {
    const cache = client?.guilds?.cache;
    if (!cache || typeof cache.size !== "number" || typeof cache.values !== "function") {
      return { serverCount: undefined, userMembershipCount: undefined };
    }

    let memberships = 0;
    for (const guild of cache.values()) {
      if (typeof guild?.memberCount !== "number" || !Number.isFinite(guild.memberCount) || guild.memberCount < 0) {
        return { serverCount: cache.size, userMembershipCount: undefined };
      }
      memberships += guild.memberCount;
    }
    return { serverCount: cache.size, userMembershipCount: memberships };
  }

  async getGuildCounts(client) {
    const shard = client?.shard;
    if (!shard || typeof shard.fetchClientValues !== "function" || typeof shard.broadcastEval !== "function") {
      return this.getLocalCounts(client);
    }

    try {
      const result = await this.withTimeout(Promise.all([
        shard.fetchClientValues("guilds.cache.size"),
        shard.broadcastEval((shardClient) =>
          shardClient.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0)
        ),
      ]));
      if (!result) return { serverCount: undefined, userMembershipCount: undefined };
      return {
        serverCount: sumFiniteNonNegative(result[0]),
        userMembershipCount: sumFiniteNonNegative(result[1]),
      };
    } catch {
      return { serverCount: undefined, userMembershipCount: undefined };
    }
  }

  getCommandCount(container) {
    return safeCall(() => {
      const registry = container.resolve("commandRegistry");
      return registry?.commands instanceof Map ? registry.commands.size : undefined;
    });
  }

  calculateCpuPercent(cpuDelta, elapsedMs) {
    const count = safeCall(this.cpuCount);
    const microseconds = cpuDelta?.user + cpuDelta?.system;
    if (
      typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs <= 0 ||
      typeof microseconds !== "number" || !Number.isFinite(microseconds) || microseconds < 0 ||
      typeof count !== "number" || !Number.isFinite(count) || count <= 0
    ) return undefined;
    return Math.min(100, Math.max(0, (microseconds / (elapsedMs * 1000 * count)) * 100));
  }

  async execute({ interaction, container }) {
    const wasDeferred = interaction.deferred === true;
    const wasReplied = interaction.replied === true;
    let restMs;
    let roundTripMs;
    let cpuPercent;

    if (!wasDeferred && !wasReplied) {
      const startedAt = safeCall(this.monotonicNow);
      const cpuStart = safeCall(() => this.cpuUsage());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const acknowledgedAt = safeCall(this.monotonicNow);
      const acknowledgedWallTime = safeCall(this.wallNow);

      if (Number.isFinite(startedAt) && Number.isFinite(acknowledgedAt) && acknowledgedAt >= startedAt) {
        restMs = acknowledgedAt - startedAt;
        const cpuDelta = cpuStart === undefined ? undefined : safeCall(() => this.cpuUsage(cpuStart));
        cpuPercent = this.calculateCpuPercent(cpuDelta, restMs);
      }
      if (
        Number.isFinite(acknowledgedWallTime) && Number.isFinite(interaction.createdTimestamp) &&
        acknowledgedWallTime >= interaction.createdTimestamp
      ) {
        roundTripMs = acknowledgedWallTime - interaction.createdTimestamp;
      }
    }

    const counts = await this.getGuildCounts(interaction.client);
    const services = container.resolve("services");
    const memory = safeCall(this.memoryUsage);
    const content = services.pingService.execute({
      gatewayMs: interaction.client?.ws?.ping,
      restMs,
      roundTripMs,
      cpuPercent,
      memoryBytes: memory?.rss,
      uptimeSeconds: safeCall(this.uptime),
      ...counts,
      commandCount: this.getCommandCount(container),
      discordVersion: this.discordVersion,
      nodeVersion: this.nodeVersion,
    });

    if (wasReplied && !wasDeferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.editReply({ content });
  }
}

module.exports = new PingHandler();
module.exports.PingHandler = PingHandler;
