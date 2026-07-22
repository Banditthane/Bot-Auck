/* ======================================================
โหลดค่า ENV จากไฟล์ .env
====================================================== */
require("dotenv").config();

/* ======================================================
Discord.js Imports
====================================================== */
const path = require("path");
const { ShardingManager } = require("discord.js");

/* ======================================================
Validate ENV
====================================================== */
const TOKEN = process.env.TOKEN;

// ? Check TOKEN
if (!TOKEN) {
  throw new Error("❌ ระบบหา TOKEN ไม่เจอ");
}

/* ======================================================
Sharding Manager
====================================================== */
const manager = new ShardingManager(path.join(__dirname, "Shard.js"), {
  token: TOKEN,
  totalShards: "auto", //คำนวณจำนวน shard อัตโนมัติ
  respawn: true, //รีสตาร์ท shard อัตโนมัติถ้าล่ม
});

/* ======================================================
Logging
====================================================== */
// เมื่อ shard ถูกสร้าง
manager.on("shardCreate", (shard) => {
  console.log(`[ShardManager] Spawned shard ${shard.id}`);
});

/* ======================================================
Start All Shards
====================================================== */
function findErrorCode(error) {
  let currentError = error;

  while (currentError) {
    if (currentError.code) {
      return currentError.code;
    }

    currentError = currentError.cause;
  }

  return "UNKNOWN";
}

function describeStartupError(error) {
  const errorCode = findErrorCode(error);
  const status = error?.status ?? error?.response?.status;

  if (errorCode === "UND_ERR_CONNECT_TIMEOUT") {
    return `[ShardManager] Discord connection timed out (${errorCode}). Check DNS, firewall, VPN, or proxy access to discord.com:443.`;
  }

  if (status === 401 || errorCode === 401) {
    return "[ShardManager] Discord rejected the bot credentials (HTTP 401). Check TOKEN configuration.";
  }

  return `[ShardManager] Startup failed (${errorCode}). Check the error details and runtime configuration.`;
}

async function start() {
  try {
    await manager.spawn();
  } catch (error) {
    console.error(describeStartupError(error));
    process.exitCode = 1;
  }
}

start();
