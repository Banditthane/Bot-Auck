require("module-alias/register");

const Container = require("@di/Container");

// infrastructure/config
const loadConfig = require("@infra/config");

//infrastructure/logger/logging
const Logger = require("@logger/Logger");

// core command dispatch
const CommandRegistry = require("@registry/CommandRegistry");
const InteractionRouter = require("@pipeline/InteractionRouter");

// command adapters
const pingCommand = require("@commands/utility/ping/command");
const InteractionResponder = require("@discord/InteractionResponder");

// Auto Voice Room composition
const AutoRoomDatabase = require("@db/AutoRoomDatabase");
const SqliteAutoRoomRepository = require("@db/repositories/SqliteAutoRoomRepository");
const SqliteGuildRoomConfigRepository = require("@db/repositories/SqliteGuildRoomConfigRepository");
const DiscordRoomGateway = require("@provider/discord/DiscordRoomGateway");
const roomCommand = require("@commands/room/command");
const roomSetupCommand = require("@commands/admin/room-setup/command");

//runtime
const createBot = require("@runtime/Bot");

class Bootstrap {
  static async initialize() {
    const container = new Container();

    /* CONFIG */
    const config = loadConfig();
    container.register("config", config);

    /* LOGGER */
    const logger = new Logger(config);
    container.register("logger", logger);

    /* BOT/CLIENT - the Discord gateway requires the registered client. */
    const bot = createBot(container);

    /* SERVICES (DI READY) */
    const autoRoomDatabase = new AutoRoomDatabase();
    const roomRepository = new SqliteAutoRoomRepository(autoRoomDatabase);
    const configRepository = new SqliteGuildRoomConfigRepository(autoRoomDatabase);
    const roomGateway = new DiscordRoomGateway(container.resolve("client"));
    const servicesFactory = require("@services");
    container.register("services", servicesFactory(container, {
      roomRepository,
      configRepository,
      roomGateway,
      logger,
    }));

    /* COMMAND DISPATCH */
    const commandRegistry = new CommandRegistry();
    commandRegistry.register(pingCommand.data.name, pingCommand);
    commandRegistry.register(roomCommand.data.name, roomCommand);
    commandRegistry.register(roomSetupCommand.data.name, roomSetupCommand);
    container.register("commandRegistry", commandRegistry);

    const interactionRouter = new InteractionRouter({
      commandRegistry,
      container,
      logger,
      responder: new InteractionResponder(),
    });
    container.register("interactionRouter", interactionRouter);

    return {
      start: () => bot.start(),
    };
  }
}

module.exports = Bootstrap;
