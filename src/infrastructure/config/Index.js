const Env = require("./Env");
const DiscordConfig = require("./DiscordConfig");

function loadConfig() {
  const env = Env.load();

  return {
    env,
    discord: new DiscordConfig(env),
  };
}

module.exports = loadConfig;
