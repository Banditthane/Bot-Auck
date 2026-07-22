const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const LABEL_WIDTH = 20;

function finiteNonNegative(value, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : undefined;
}

function rounded(value) {
  const normalized = finiteNonNegative(value);
  return normalized === undefined ? undefined : Math.round(normalized);
}

function formatLatency(value) {
  const normalized = rounded(value);
  return normalized === undefined ? "unavailable" : `${NUMBER_FORMAT.format(normalized)} ms`;
}

function formatCpu(value) {
  const normalized = finiteNonNegative(value, Number.MAX_VALUE);
  if (normalized === undefined) return "unavailable";
  const clamped = Math.min(100, normalized);
  return normalized > 100
    ? `${NUMBER_FORMAT.format(clamped)}% (capped)`
    : `${NUMBER_FORMAT.format(clamped)}%`;
}

function formatMemory(bytes) {
  const normalized = finiteNonNegative(bytes);
  return normalized === undefined
    ? "unavailable"
    : `${NUMBER_FORMAT.format(Math.round(normalized / 1024 / 1024))} MB`;
}

function formatUptime(seconds) {
  const normalized = finiteNonNegative(seconds);
  if (normalized === undefined) return "unavailable";

  let remaining = Math.floor(normalized);
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatCount(value) {
  const normalized = rounded(value);
  return normalized === undefined ? "unavailable" : NUMBER_FORMAT.format(normalized);
}

function formatVersion(value) {
  if (typeof value !== "string" || value.trim() === "") return "unavailable";
  const version = value.trim();
  if (version.length > 32 || !/^v?[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) {
    return "unavailable";
  }
  return version.startsWith("v") ? version : `v${version}`;
}

function computeStatus({ gatewayMs, restMs, roundTripMs, cpuPercent }) {
  const gateway = finiteNonNegative(gatewayMs);
  const rest = finiteNonNegative(restMs);
  const roundTrip = finiteNonNegative(roundTripMs);
  const cpu = finiteNonNegative(cpuPercent, Number.MAX_VALUE);

  if (
    (gateway !== undefined && gateway >= 1000) ||
    (rest !== undefined && rest >= 3000) ||
    (roundTrip !== undefined && roundTrip >= 3000) ||
    (cpu !== undefined && cpu >= 95)
  ) {
    return { emoji: "🔴", label: "Unhealthy" };
  }

  if (
    gateway !== undefined && rest !== undefined && roundTrip !== undefined && cpu !== undefined &&
    gateway < 200 && rest < 500 && roundTrip < 1000 && cpu < 80
  ) {
    return { emoji: "🟢", label: "Healthy" };
  }

  return { emoji: "🟡", label: "Degraded" };
}

function row(label, value) {
  return `• ${label.padEnd(LABEL_WIDTH)}: ${value}`;
}

class PingService {
  execute(metrics = {}) {
    const status = computeStatus(metrics);
    const lines = [
      "🏓 Pong!",
      "",
      "```",
      "📡 Connection",
      row("Gateway", formatLatency(metrics.gatewayMs)),
      row("REST API", formatLatency(metrics.restMs)),
      row("Round Trip", formatLatency(metrics.roundTripMs)),
      "",
      "💻 System",
      row("CPU", formatCpu(metrics.cpuPercent)),
      row("Memory", formatMemory(metrics.memoryBytes)),
      row("Uptime", formatUptime(metrics.uptimeSeconds)),
      "",
      "🤖 Bot",
      row("Servers", formatCount(metrics.serverCount)),
      row("Users (memberships)", formatCount(metrics.userMembershipCount)),
      row("Commands", formatCount(metrics.commandCount)),
      row("discord.js", formatVersion(metrics.discordVersion)),
      row("Node.js", formatVersion(metrics.nodeVersion)),
      "",
      `${status.emoji} Status: ${status.label}`,
      "```",
    ];

    const content = lines.join("\n");
    if (content.length < 2000) return content;

    return [
      "🏓 Pong!",
      "",
      "```",
      "Diagnostics unavailable: rendered output exceeded the safe Discord length.",
      "",
      `${status.emoji} Status: ${status.label}`,
      "```",
    ].join("\n");
  }
}

module.exports = PingService;
module.exports.computeStatus = computeStatus;
