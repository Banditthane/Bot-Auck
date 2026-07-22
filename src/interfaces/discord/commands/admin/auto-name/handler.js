const { MessageFlags, PermissionFlagsBits } = require("discord.js");

const SAFE_ERRORS = Object.freeze({
  AUTO_NAME_VALIDATION: "Check the command options and try again.",
  AUTO_NAME_TEMPLATE_INVALID: "The template is invalid. Include {code} and check its length.",
  AUTO_NAME_RENDER_TOO_LONG: "That template can produce a nickname longer than Discord allows.",
  AUTO_NAME_CONFIG_NOT_FOUND: "Auto Name has not been configured for this server.",
  AUTO_NAME_DISABLED: "Auto Name is currently disabled.",
  AUTO_NAME_FORBIDDEN: "You do not have permission to manage Auto Name.",
  AUTO_NAME_INELIGIBLE: "That member is not eligible for Auto Name.",
  AUTO_NAME_UNMANAGEABLE: "I cannot manage that member's nickname.",
  AUTO_NAME_CODE_EXHAUSTED: "No member codes are available with the configured length.",
  AUTO_NAME_SCAN_CONFLICT: "A scan is already active for this server.",
  AUTO_NAME_PROVIDER_FAILURE: "Discord rejected the operation. Check my role and permissions.",
});

function option(interaction, method, name) {
  return interaction.options[method](name, false);
}

async function acknowledge(interaction) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function respond(interaction, content) {
  if (interaction.deferred) return interaction.editReply({ content });
  if (interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function traceId(interaction) {
  return String(interaction.id || `autoname:${interaction.guildId}:${interaction.user?.id}`).slice(0, 64);
}

function formatStatus(status) {
  if (!status) return "No Auto Name scan is currently recorded.";
  const job = status.job || status;
  const state = String(job.status || "unknown").slice(0, 32);
  const scanned = Number.isSafeInteger(job.scannedCount) ? job.scannedCount : 0;
  const renamed = Number.isSafeInteger(job.renamedCount) ? job.renamedCount : 0;
  const failed = Number.isSafeInteger(job.failedCount) ? job.failedCount : 0;
  return `Scan status: ${state}. Scanned ${scanned}, renamed ${renamed}, failed ${failed}.`;
}

function formatConfig(result) {
  const config = result?.config || result;
  if (!config) return "Auto Name configuration is unavailable.";
  const enabled = config.enabled ? "enabled" : "disabled";
  const roleId = /^\d{5,25}$/.test(String(config.requiredRoleId || "")) ? config.requiredRoleId : "not set";
  const codeLength = Number.isInteger(config.codeLength) ? config.codeLength : "unknown";
  const template = String(config.template?.value || config.template || "").replace(/[\r\n`]/g, " ").slice(0, 100);
  return `Auto Name is ${enabled}. Required role: ${roleId === "not set" ? roleId : `<@&${roleId}>`}. Code length: ${codeLength}. Template: \`${template}\``;
}

class AutoNameHandler {
  async execute({ interaction, container }) {
    await acknowledge(interaction);
    if (interaction.inGuild?.() !== true || !interaction.guildId) {
      await respond(interaction, "This command can only be used in a server.");
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageNicknames)) {
      await respond(interaction, "You need Manage Nicknames permission to use this command.");
      return;
    }
    const guildId = interaction.guildId;
    const actorId = interaction.user?.id;
    if (!actorId) {
      await respond(interaction, "Unable to identify the command actor.");
      return;
    }
    try {
      const services = container.resolve("services");
      const autoNames = services.autoNameService;
      const scans = services.autoNameScanService;
      const subcommand = interaction.options.getSubcommand(true);
      const common = { guildId, actorId, traceId: traceId(interaction) };
      let result;
      switch (subcommand) {
        case "setup": {
          const role = option(interaction, "getRole", "required-role");
          result = await autoNames.configure({ ...common, requiredRoleId: role?.id, template: option(interaction, "getString", "template") ?? "{code} {displayName}", codeLength: option(interaction, "getInteger", "code-length") ?? 4 });
          await respond(interaction, "Auto Name configuration saved.");
          return;
        }
        case "template":
          result = await autoNames.updateTemplate({ ...common, template: option(interaction, "getString", "template") });
          await respond(interaction, "Auto Name template updated."); return;
        case "preview": {
          const member = option(interaction, "getUser", "member");
          result = await autoNames.preview({ guildId, actorId, userId: member?.id || actorId });
          await respond(interaction, `Preview: ${String(result?.nickname || "unavailable").replace(/[\r\n]/g, " ").slice(0, 32)}`); return;
        }
        case "scan":
          result = await scans.enqueue({ ...common, missingOnly: option(interaction, "getBoolean", "missing-only") ?? true, force: option(interaction, "getBoolean", "force") ?? false, dryRun: option(interaction, "getBoolean", "dry-run") ?? false });
          await respond(interaction, "Auto Name scan queued."); return;
        case "scan-status":
          result = await scans.getStatus({ guildId, actorId });
          await respond(interaction, formatStatus(result)); return;
        case "repair": {
          const member = option(interaction, "getUser", "member");
          const role = option(interaction, "getRole", "role");
          const dryRun = option(interaction, "getBoolean", "dry-run") ?? false;
          if (Boolean(member) === Boolean(role)) {
            await respond(interaction, "Choose exactly one member or role to repair."); return;
          }
          if (member) {
            await autoNames.assign({ ...common, userId: member.id, source: "repair", dryRun, missingOnly: false });
            await respond(interaction, dryRun ? "Member repair preview completed." : "Member repair completed."); return;
          }
          await scans.enqueue({ ...common, missingOnly: false, force: true, dryRun, subsetRoleId: role.id });
          await respond(interaction, "Role repair scan queued."); return;
        }
        case "enable":
        case "disable":
          await autoNames.setEnabled({ ...common, enabled: subcommand === "enable" });
          await respond(interaction, `Auto Name ${subcommand}d.`); return;
        case "config":
          result = await autoNames.getConfig({ guildId, actorId });
          await respond(interaction, formatConfig(result)); return;
        default:
          await respond(interaction, "Unknown Auto Name command.");
      }
    } catch (error) {
      await respond(interaction, SAFE_ERRORS[error?.code] || "Auto Name operation failed. Try again later.");
    }
  }
}

module.exports = new AutoNameHandler();
module.exports.AutoNameHandler = AutoNameHandler;
module.exports.SAFE_ERRORS = SAFE_ERRORS;
