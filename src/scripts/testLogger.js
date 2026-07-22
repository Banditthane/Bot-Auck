const DevLogger = require("../infrastructure/logging/DevLogger");

const logger = new DevLogger();

logger.info("Bot started");
logger.warn("Rate limit warning");
logger.error("Database connection failed");
logger.debug("InteractionCreate event");
logger.dev("Testing dev log");