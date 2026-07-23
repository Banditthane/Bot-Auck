const { MessageFlags } = require("discord.js");
const { ModerationErrorCodes } = require("@errors/ModerationErrors");

const SAFE_MESSAGES = Object.freeze({
  [ModerationErrorCodes.GUILD_ONLY]: "This command can only be used in a server.",
  [ModerationErrorCodes.INVALID_INPUT]: "Check the command input and try again.",
  [ModerationErrorCodes.ACTOR_PERMISSION]: "You do not have permission to use this moderation command.",
  [ModerationErrorCodes.BOT_PERMISSION]: "I do not have the required moderation permission.",
  [ModerationErrorCodes.TARGET_NOT_MEMBER]: "That user is not a current server member.",
  [ModerationErrorCodes.TARGET_SELF]: "You cannot target yourself.",
  [ModerationErrorCodes.TARGET_BOT]: "You cannot target this bot.",
  [ModerationErrorCodes.TARGET_OWNER]: "You cannot target the server owner.",
  [ModerationErrorCodes.ACTOR_HIERARCHY]: "Your highest role must be above the target member.",
  [ModerationErrorCodes.BOT_HIERARCHY]: "My highest role must be above the target member.",
  [ModerationErrorCodes.TARGET_NOT_CAPABLE]: "Discord does not allow me to moderate that member.",
  [ModerationErrorCodes.NOT_BANNED]: "That user is not currently banned.",
  [ModerationErrorCodes.NOT_TIMED_OUT]: "That member is not timed out.",
  [ModerationErrorCodes.PROVIDER_FAILURE]: "Discord rejected the moderation action. Check my role and permissions, then try again.",
});

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

function context(interaction) {
  return {
    guildId: interaction.guildId,
    actorId: interaction.user?.id,
  };
}

function targetId(interaction) {
  return interaction.options.getUser("target", true).id;
}

function reason(interaction) {
  return interaction.options.getString("reason", false) ?? undefined;
}

function safeMessage(error) {
  return SAFE_MESSAGES[error?.code] ?? "Moderation action failed.";
}

async function runModeration(interaction, operation) {
  await acknowledge(interaction);
  try {
    await operation();
  } catch (error) {
    if (SAFE_MESSAGES[error?.code]) {
      await respond(interaction, safeMessage(error));
      return;
    }
    throw error;
  }
}

module.exports = { acknowledge, respond, context, targetId, reason, runModeration };
