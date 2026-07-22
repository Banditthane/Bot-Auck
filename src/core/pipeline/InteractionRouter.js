class InteractionRouter {
  constructor({ commandRegistry, container, logger, responder }) {
    this.commandRegistry = commandRegistry;
    this.container = container;
    this.logger = logger;
    this.responder = responder;
  }

  async route(interaction) {
    const handler = this.commandRegistry.get(interaction.commandName);

    if (!handler) {
      try {
        await this.responder.unknownCommand(interaction);
      } catch (error) {
        this.logFailure("Unknown command response failed", interaction, error);
      }
      return;
    }

    try {
      await handler.execute({ interaction, container: this.container });
    } catch (error) {
      this.logFailure("Command handler failed", interaction, error);

      try {
        await this.responder.commandFailed(interaction);
      } catch (responseError) {
        this.logFailure(
          "Command failure response failed",
          interaction,
          responseError
        );
      }
    }
  }

  logFailure(message, interaction, error) {
    const metadata = {
      commandName: sanitizeDiagnostic(interaction?.commandName, "UNKNOWN"),
      errorType: sanitizeDiagnostic(error?.name, "Error"),
      errorCode: sanitizeDiagnostic(
        error?.code ?? error?.cause?.code,
        "UNKNOWN"
      ),
    };

    this.logger.error(
      `${message}: ${metadata.commandName} ` +
        `[${metadata.errorType}:${metadata.errorCode}]`,
      metadata
    );
  }
}

function sanitizeDiagnostic(value, fallback) {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }

  const sanitized = String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return sanitized.slice(0, 64) || fallback;
}

module.exports = InteractionRouter;
