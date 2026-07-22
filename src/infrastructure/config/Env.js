class Env {
  static load() {
    return {
      TOKEN: process.env.TOKEN,
      CLIENT_ID: process.env.CLIENT_ID,
      GUILD_ID: process.env.GUILD_ID,
      NODE_ENV: process.env.NODE_ENV || "development",
    };
  }
}

module.exports = Env;
