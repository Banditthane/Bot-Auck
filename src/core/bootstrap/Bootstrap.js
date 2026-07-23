require("module-alias/register");

const Container = require("@di/Container");

// infrastructure/config
const loadConfig = require("@infra/config");

//infrastructure/logger/logging
const Logger = require("@logger/Logger");

// core command dispatch
const CommandRegistry = require("@registry/CommandRegistry");
const ComponentRegistry = require("@registry/ComponentRegistry");
const InteractionRouter = require("@pipeline/InteractionRouter");
const ComponentRouter = require("@pipeline/ComponentRouter");

// command adapters
const commandManifest = require("@commands/manifest");
const InteractionResponder = require("@discord/InteractionResponder");
const autoRoleComponents = require("@commands/admin/auto-role/components");
const helpComponents = require("@commands/utility/help/components");

// Auto Voice Room composition
const AutoRoomDatabase = require("@db/AutoRoomDatabase");
const SqliteAutoRoomRepository = require("@db/repositories/SqliteAutoRoomRepository");
const SqliteGuildRoomConfigRepository = require("@db/repositories/SqliteGuildRoomConfigRepository");
const DiscordRoomGateway = require("@provider/discord/DiscordRoomGateway");
const DiscordModerationGateway = require("@provider/discord/DiscordModerationGateway");
const AutoNameDatabase = require("@db/AutoNameDatabase");
const SqliteAutoNameConfigRepository = require("@db/repositories/SqliteAutoNameConfigRepository");
const SqliteMemberCodeRepository = require("@db/repositories/SqliteMemberCodeRepository");
const SqliteAutoNameAuditRepository = require("@db/repositories/SqliteAutoNameAuditRepository");
const SqliteAutoNameScanQueue = require("@db/repositories/SqliteAutoNameScanQueue");
const SqliteAutoRoleConfigRepository = require("@db/repositories/SqliteAutoRoleConfigRepository");
const SqliteAutoRoleRuleRepository = require("@db/repositories/SqliteAutoRoleRuleRepository");
const SqliteAutoRoleAuditRepository = require("@db/repositories/SqliteAutoRoleAuditRepository");
const SqliteMemberAutomationJobRepository = require("@db/repositories/SqliteMemberAutomationJobRepository");
const SqliteMemberAutomationOperationRepository = require("@db/repositories/SqliteMemberAutomationOperationRepository");
const SqliteInteractionSessionRepository = require("@db/repositories/SqliteInteractionSessionRepository");
const DiscordNicknameGateway = require("@provider/discord/DiscordNicknameGateway");
const DiscordRoleGateway = require("@provider/discord/DiscordRoleGateway");
const LoggerAutoNameTelemetry = require("@logger/LoggerAutoNameTelemetry");
const InProcessAutoNameScanWorker = require("@infra/workers/InProcessAutoNameScanWorker");
const RegistryCommandCatalog = require("@infra/commandCatalog/RegistryCommandCatalog");
const AutoRoleComponentAdapter = require("@discord/adapters/AutoRoleComponentAdapter");
const HelpComponentAdapter = require("@discord/adapters/HelpComponentAdapter");
const HelpPresenter = require("@discord/presenters/HelpPresenter");

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
    const moderationGateway = new DiscordModerationGateway(container.resolve("client"));
    const autoNameDatabase = new AutoNameDatabase();
    const autoNameConfigRepository = new SqliteAutoNameConfigRepository(autoNameDatabase);
    const autoNameCodeRepository = new SqliteMemberCodeRepository(autoNameDatabase);
    const autoNameAuditRepository = new SqliteAutoNameAuditRepository(autoNameDatabase);
    const autoNameScanQueue = new SqliteAutoNameScanQueue(autoNameDatabase);
    const autoNameNicknameGateway = new DiscordNicknameGateway(container.resolve("client"));
    const autoRoleConfigRepository = new SqliteAutoRoleConfigRepository(autoNameDatabase);
    const autoRoleRuleRepository = new SqliteAutoRoleRuleRepository(autoNameDatabase);
    const autoRoleAuditRepository = new SqliteAutoRoleAuditRepository(autoNameDatabase);
    const memberAutomationJobRepository = new SqliteMemberAutomationJobRepository(autoNameDatabase);
    const memberAutomationOperationRepository = new SqliteMemberAutomationOperationRepository(autoNameDatabase);
    const interactionSessionRepository = new SqliteInteractionSessionRepository(autoNameDatabase);
    const memberRoleGateway = new DiscordRoleGateway(container.resolve("client"));
    const autoNameTelemetry = new LoggerAutoNameTelemetry(logger);

    /* COMMAND DISPATCH */
    const commandRegistry = new CommandRegistry();
    for (const descriptor of commandManifest) {
      commandRegistry.register(descriptor.name, descriptor.command, descriptor);
    }
    container.register("commandRegistry", commandRegistry);

    const commandCatalog = new RegistryCommandCatalog(commandRegistry);

    const servicesFactory = require("@services");
    container.register("services", servicesFactory(container, {
      roomRepository,
      configRepository,
      roomGateway,
      moderationGateway,
      autoNameConfigRepository,
      autoNameCodeRepository,
      autoNameAuditRepository,
      autoNameScanQueue,
      autoNameNicknameGateway,
      autoNameTelemetry,
      autoRoleConfigRepository,
      autoRoleRuleRepository,
      autoRoleAuditRepository,
      memberAutomationJobRepository,
      memberAutomationOperationRepository,
      interactionSessionRepository,
      memberRoleGateway,
      commandCatalog,
      logger,
    }));

    const services = container.resolve("services");
    const autoNameScanWorker = new InProcessAutoNameScanWorker({
      queue: autoNameScanQueue,
      scanService: services.autoNameScanService,
      workerId: `auto-name-${process.pid}`,
      telemetry: autoNameTelemetry,
    });
    container.register("autoNameScanWorker", autoNameScanWorker);
    container.register("autoRoleComponentAdapter", new AutoRoleComponentAdapter({
      sessionRepository: interactionSessionRepository,
    }));
    container.register("helpComponentAdapter", new HelpComponentAdapter({
      sessionRepository: interactionSessionRepository,
      helpService: services.commandHelpService,
      presenter: new HelpPresenter(),
    }));

    const componentRegistry = new ComponentRegistry();
    componentRegistry.register(autoRoleComponents);
    componentRegistry.register(helpComponents);
    container.register("componentRegistry", componentRegistry);

    const interactionRouter = new InteractionRouter({
      commandRegistry,
      container,
      logger,
      responder: new InteractionResponder(),
    });
    container.register("interactionRouter", interactionRouter);
    container.register("componentRouter", new ComponentRouter({
      componentRegistry,
      container,
      logger,
    }));

    return {
      start: async () => {
        autoNameScanWorker.start();
        try {
          await bot.start();
        } catch (error) {
          await autoNameScanWorker.stop();
          throw error;
        }
      },
    };
  }
}

module.exports = Bootstrap;
