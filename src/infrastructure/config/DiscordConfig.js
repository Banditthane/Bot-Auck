class DiscordConfig {
  constructor(env) {
    this.env = env;
  }

  getToken() {
    return this.env.TOKEN;
  }

  getClientId() {
    return this.env.CLIENT_ID;
  }

  getGuildId() {
    return this.env.GUILD_ID;
  }

  getClientOptions() {
    return {
      intents: ["Guilds", "GuildMembers", "GuildMessages", "MessageContent", "GuildVoiceStates"],
      partials: ["Channel", "Message", "Reaction", "User", "GuildMember"],
    };
  }
}

module.exports = DiscordConfig;
