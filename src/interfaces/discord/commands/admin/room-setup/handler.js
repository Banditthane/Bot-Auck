const { MessageFlags, PermissionFlagsBits } = require("discord.js");

const DEFAULT_NUMBERED_NAME_TEMPLATE = "ଘ 🍵 ～ﾉ « {number} »";

async function acknowledge(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

async function respond(interaction, content) {
  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }
  if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

class RoomSetupHandler {
  async execute({ interaction, container }) {
    await acknowledge(interaction);

    if (!interaction.guildId) {
      await respond(interaction, "This command can only be used in a server.");
      return;
    }
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels)) {
      await respond(interaction, "Manage Channels permission is required.");
      return;
    }

    const service = container.resolve("services").autoRoomService;
    if (!service) throw new Error("Auto Voice Room service is unavailable.");

    try {
      const trigger = interaction.options.getChannel("trigger", true);
      const category = interaction.options.getChannel("category", false);
      const categoryId = category?.id || trigger.parentId || null;
      if (!categoryId) {
        throw Object.assign(
          new Error("Select a category, or move the trigger voice channel into a category first."),
          { code: "ROOM_VALIDATION" }
        );
      }
      const logChannel = interaction.options.getChannel("log-channel", false);
      const moderatorRole = interaction.options.getRole("moderator-role", false);
      const requestedNameTemplate = interaction.options.getString("name-template", false);
      const existingConfig = requestedNameTemplate == null
        ? service.getGuildConfig(interaction.guildId)
        : null;
      const configured = await service.configureGuild({
        guildId: interaction.guildId,
        triggerChannelId: trigger.id,
        categoryId,
        logChannelId: logChannel?.id || null,
        moderatorRoleId: moderatorRole?.id || null,
        defaultNameTemplate: requestedNameTemplate ??
          existingConfig?.defaultNameTemplate ??
          DEFAULT_NUMBERED_NAME_TEMPLATE,
        defaultUserLimit: interaction.options.getInteger("default-limit", false) ?? 0,
        emptyDeleteDelaySeconds: interaction.options.getInteger("delete-delay", false) ?? 5,
        enabled: true,
      });

      await respond(
        interaction,
        `Auto Voice Room enabled. Join <#${configured.triggerChannelId}> to create a room in <#${configured.categoryId}>.`
      );
    } catch (error) {
      if (error?.code === "ROOM_VALIDATION") {
        await respond(interaction, error.message);
        return;
      }
      throw error;
    }
  }
}

module.exports = new RoomSetupHandler();
module.exports.RoomSetupHandler = RoomSetupHandler;
module.exports.DEFAULT_NUMBERED_NAME_TEMPLATE = DEFAULT_NUMBERED_NAME_TEMPLATE;
