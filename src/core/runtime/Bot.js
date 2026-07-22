const { Client } = require("discord.js");
const EventLoader = require("./EventLoader");

function createBot(container) {
  const config = container.resolve("config");
  const logger = container.resolve("logger");

  const client = new Client(config.discord.getClientOptions());
  container.register("client", client);

  async function start() {
    try {
      EventLoader.load(client, container);
      await client.login(config.discord.getToken());
      logger.info("✅ Bot logged in successfully");
    } catch (error) {
      logger.error("❌ Failed to start bot", error);
      throw error;
    }
  }
  return { start };
}

module.exports = createBot;

/* 
create discord client
load container
load events
login bot
 */

/* const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { loadEvents } = require("./EventLoader");

// const DevLogger = require("@logging/DevLogger");
// const logger = new DevLogger();

class Bot {
  constructor({ container }) {
    this.container = container;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
      ],
    });

    // inject client เข้า container
    this.container.register("client", this.client);
  }

  async start() {
    const logger = this.container.resolve("logger"); //ดึง logger จาก container
    loadEvents(this.client, this.container); //โหลด event handlers
    await this.client.login(process.env.TOKEN); //เชื่อมต่อ Discord Gateway
    // logger.info("Logging into Discord...");
  }
}
module.exports = Bot; */
/* 
const { Client, GatewayIntentBits, Partials } = require("discord.js");

const loadEvents = require("./EventLoader");

class Bot {
  constructor(container) {
    this.container = container;

    const config = container.get("config");

    this.client = new Client({
      intents: config.discord.intents,
      partials: config.discord.partials,
    });

    // inject client เข้า DI
    this.container.register("client", this.client);
  }

  async start() {
    const logger = this.container.get("logger");
    const config = this.container.get("config");

    // ======================================================
    // Load Events (Adapter Layer)
    // ======================================================
    loadEvents(this.client, this.container);

    // ======================================================
    // Lifecycle Events
    // ======================================================
    this.client.once("ready", () => {
      logger.info(`✅ Logged in as ${this.client.user.tag}`);
    });

    this.client.on("error", (err) => {
      logger.error("Client error", err);
    });

    // ======================================================
    // Login
    // ======================================================
    await this.client.login(config.discord.token);
  }

  async stop() {
    const logger = this.container.get("logger");

    await this.client.destroy();
    logger.info("🛑 Bot stopped");
  }
}

module.exports = Bot;
 */
