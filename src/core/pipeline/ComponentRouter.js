class ComponentRouter {
  constructor({ componentRegistry, container, logger }) {
    this.componentRegistry = componentRegistry;
    this.container = container;
    this.logger = logger;
  }

  async route(interaction) {
    try {
      const handled = await this.componentRegistry.route(interaction, this.container);
      if (!handled && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "This component is no longer available.", flags: 64 });
      }
    } catch (error) {
      this.logger?.error?.("Component handler failed", { code: safe(error?.code) });
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Component action failed.", flags: 64 });
      }
    }
  }
}

function safe(value) {
  return /^[A-Z0-9_]{1,64}$/.test(String(value || "")) ? value : "UNKNOWN";
}

module.exports = ComponentRouter;
