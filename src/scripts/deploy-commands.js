require("dotenv/config");
require("module-alias/register");

const { REST, Routes } = require("discord.js");
const Env = require("@infra/config/Env");
const pingCommand = require("@commands/utility/ping/command");
const roomCommand = require("@commands/room/command");
const roomSetupCommand = require("@commands/admin/room-setup/command");

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const CONFIRM_REPLACEMENT_FLAG = "--confirm-replace";

function sanitizeCommandName(name) {
  const sanitized = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return sanitized || "unknown";
}

function loadDeploymentConfig(env = Env.load()) {
  const token = typeof env.TOKEN === "string" ? env.TOKEN.trim() : "";
  const clientId = typeof env.CLIENT_ID === "string" ? env.CLIENT_ID.trim() : "";
  const guildId = typeof env.GUILD_ID === "string" ? env.GUILD_ID.trim() : "";

  if (!token) {
    throw new Error("TOKEN is required for command deployment.");
  }
  if (!SNOWFLAKE_PATTERN.test(clientId)) {
    throw new Error("CLIENT_ID must be a valid Discord snowflake.");
  }
  if (!SNOWFLAKE_PATTERN.test(guildId)) {
    throw new Error("GUILD_ID must be a valid Discord snowflake.");
  }

  return { token, clientId, guildId };
}

async function deployCommands({ env, rest, confirmReplacement = false } = {}) {
  if (!confirmReplacement) {
    const error = new Error(
      `Guild command replacement requires ${CONFIRM_REPLACEMENT_FLAG}.`
    );
    error.code = "REPLACEMENT_CONFIRMATION_REQUIRED";
    throw error;
  }

  const config = loadDeploymentConfig(env);
  const client = rest ?? new REST({ version: "10" }).setToken(config.token);
  const route = Routes.applicationGuildCommands(config.clientId, config.guildId);
  const body = [
    pingCommand.data.toJSON(),
    roomCommand.data.toJSON(),
    roomSetupCommand.data.toJSON(),
  ];

  await client.put(route, { body });
  return {
    count: body.length,
    scope: "guild",
    commandNames: body.map((command) => sanitizeCommandName(command.name)),
  };
}

function getErrorCode(error) {
  return error?.code ?? error?.status ?? error?.cause?.code ?? "UNKNOWN";
}

if (require.main === module) {
  const confirmReplacement = process.argv.slice(2).includes(CONFIRM_REPLACEMENT_FLAG);

  console.warn(
    "[CommandDeploy] WARNING: this operation replaces the guild's complete command collection with the local /ping, /room, and /room-setup commands."
  );

  deployCommands({ confirmReplacement })
    .then(({ count, commandNames }) => {
      console.log(
        `[CommandDeploy] Replaced the guild command collection with ${count} local commands: ${commandNames.join(", ")}.`
      );
    })
    .catch((error) => {
      console.error(`[CommandDeploy] Operation stopped (${getErrorCode(error)}).`);
      process.exitCode = 1;
    });
}

module.exports = { deployCommands, loadDeploymentConfig, sanitizeCommandName };
