require("module-alias/register");

const {
  createStartupErrorPayload,
  formatStartupFailure,
} = require("@shared/errors/StartupErrorSanitizer");

async function startShard({ initialize } = {}) {
  const initializeApp = initialize || (() => require("@bootstrap/Bootstrap").initialize());
  const app = await initializeApp();
  await app.start();
  return app;
}

function reportShardFailure(error, { processRef = process, logger = console } = {}) {
  const payload = createStartupErrorPayload(error, { phase: "bootstrap" });
  logger.error(formatStartupFailure("[Shard]", payload));
  if (typeof processRef.send === "function") {
    try {
      processRef.send(payload);
    } catch {
      // A closed IPC channel must not replace or expose the root failure.
    }
  }
  processRef.exitCode = 1;
  return payload;
}

async function main(dependencies = {}) {
  try {
    return await startShard(dependencies);
  } catch (error) {
    reportShardFailure(error, dependencies);
    return null;
  }
}

if (require.main === module) void main();

module.exports = { startShard, reportShardFailure, main };
