require("module-alias/register");

const Bootstrap = require("@bootstrap/Bootstrap");

async function startShard() {
  const app = await Bootstrap.initialize();
  await app.start();
}

startShard().catch((error) => {
  const errorCode = error?.code ?? error?.cause?.code ?? "UNKNOWN";
  console.error(`[Shard] Startup failed (${errorCode}).`);
  process.exitCode = 1;
});
