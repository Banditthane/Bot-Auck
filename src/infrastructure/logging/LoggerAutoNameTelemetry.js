const AutoNameTelemetry = require("../../application/repositories/contracts/AutoNameTelemetry");

const SAFE_KEYS = new Set([
  "guildId", "userId", "actorId", "traceId", "jobId", "workerId", "shardId",
  "outcome", "code", "action", "durationMs", "scannedCount", "eligibleCount",
  "renamedCount", "skippedCount", "failedCount", "retryCount",
]);

class LoggerAutoNameTelemetry extends AutoNameTelemetry {
  constructor(logger) { super(); if (!logger) throw new TypeError("logger is required."); this.logger = logger; }
  info(event, context) { this._write("info", event, context); }
  warn(event, context) { this._write("warn", event, context); }
  error(event, context) { this._write("error", event, context); }
  _write(level, event, context = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(context || {})) {
      if (!SAFE_KEYS.has(key) || !["string", "number", "boolean"].includes(typeof value)) continue;
      safe[key] = typeof value === "string"
        ? value.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 64)
        : value;
    }
    const safeEvent = String(event || "auto_name_event").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64);
    this.logger[level](`Auto Name: ${safeEvent}`, safe);
  }
}
module.exports = LoggerAutoNameTelemetry;
module.exports.SAFE_KEYS = SAFE_KEYS;
