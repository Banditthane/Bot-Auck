const { MessageFlags, PermissionFlagsBits } = require("discord.js");

const KNOWN_ROOM_ERRORS = new Set([
  "ROOM_VALIDATION",
  "ROOM_NOT_FOUND",
  "ROOM_FORBIDDEN",
  "ROOM_CONFLICT",
]);

const ROOM_HELP = [
  "## Auto Voice Room — คู่มือใช้งาน",
  "**เริ่มต้น (สำหรับแอดมิน)**",
  "1. ใช้ `/room-setup` แล้วเลือกห้อง Voice สำหรับสร้างห้องและ Category ปลายทาง",
  "2. บอทต้องมีสิทธิ์ Manage Channels และ Move Members",
  "",
  "**สร้างห้อง**",
  "1. เข้าห้อง Voice ที่แอดมินตั้งเป็นห้องสร้าง",
  "2. บอทจะสร้างห้องชั่วคราวแบบเรียงหมายเลข เช่น `ଘ 🍵 ～ﾉ « 1 »` แล้วปรับเป็น 2, 3, ... โดยอัตโนมัติ",
  "3. ผู้สร้างจะเป็นเจ้าของห้อง และห้องจะถูกลบเมื่อไม่มีสมาชิกเหลือ",
  "เทมเพลตต้องมี `{number}` เพื่อเปิดการเรียงหมายเลข; เทมเพลตเดิมที่ไม่มี `{number}` ยังใช้งานได้ตามเดิม",
  "",
  "**คำสั่งเจ้าของห้อง**",
  "• `/room panel` ดูสถานะห้อง",
  "• `/room lock` / `/room unlock` ล็อกหรือปลดล็อก",
  "• `/room hide` ซ่อนห้องจากผู้ไม่ได้รับเชิญ",
  "• `/room invite user:@user` อนุญาตสมาชิก",
  "• `/room deny user:@user` ถอนสิทธิ์สมาชิก",
  "• `/room kick user:@user` ตัดสมาชิกออกจากห้องเสียง",
  "• `/room limit number:5` จำกัดจำนวนสมาชิก (`0` = ไม่จำกัด)",
  "• `/room rename name:ชื่อห้อง` ยังใช้เปลี่ยนชื่อห้องได้หลังสร้าง",
  "• `/room transfer user:@user` โอนเจ้าของห้อง",
  "",
  "คำสั่งควบคุมต้องใช้ขณะอยู่ในห้องที่ระบบสร้าง ยกเว้น `/room help`",
].join("\n");

function hasManageChannels(interaction) {
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels));
}

function currentVoiceChannelId(interaction) {
  return interaction.member?.voice?.channelId ||
    interaction.guild?.members?.cache?.get?.(interaction.user?.id)?.voice?.channelId ||
    null;
}

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

function requireGuildContext(interaction) {
  const guildId = interaction.guildId;
  const actorId = interaction.user?.id;
  const channelId = currentVoiceChannelId(interaction);
  if (!guildId || !actorId) throw Object.assign(new Error("This command can only be used in a server."), { code: "ROOM_VALIDATION" });
  if (!channelId) throw Object.assign(new Error("Join your managed voice room first."), { code: "ROOM_VALIDATION" });
  return { guildId, actorId, channelId, adminOverride: hasManageChannels(interaction) };
}

function targetUserId(interaction) {
  return interaction.options.getUser("user", true).id;
}

class RoomCommandHandler {
  async execute({ interaction, container }) {
    await acknowledge(interaction);

    try {
      const subcommand = interaction.options.getSubcommand(true);
      if (subcommand === "help") {
        await respond(interaction, ROOM_HELP);
        return;
      }

      const service = container.resolve("services").autoRoomService;
      if (!service) throw new Error("Auto Voice Room service is unavailable.");
      const context = requireGuildContext(interaction);
      let content;

      switch (subcommand) {
        case "panel": {
          const room = service.getManagedRoom(context.channelId);
          if (!room || room.guildId !== context.guildId) {
            throw Object.assign(new Error("Join your managed voice room first."), { code: "ROOM_NOT_FOUND" });
          }
          if (room.ownerId !== context.actorId && !context.adminOverride) {
            throw Object.assign(new Error("Only the room owner or a server manager may view these controls."), { code: "ROOM_FORBIDDEN" });
          }
          content = [
            "Voice room controls",
            `Owner: <@${room.ownerId}>`,
            `Mode: ${room.mode}`,
            `Limit: ${room.userLimit === 0 ? "unlimited" : room.userLimit}`,
          ].join("\n");
          break;
        }
        case "lock":
          await service.setMode({ ...context, mode: "locked" });
          content = "Voice room locked.";
          break;
        case "unlock":
          await service.setMode({ ...context, mode: "open" });
          content = "Voice room unlocked.";
          break;
        case "hide":
          await service.setMode({ ...context, mode: "hidden" });
          content = "Voice room hidden from uninvited members.";
          break;
        case "invite": {
          const userId = targetUserId(interaction);
          await service.inviteUser({ ...context, userId });
          content = `<@${userId}> may now connect to this room.`;
          break;
        }
        case "deny": {
          const userId = targetUserId(interaction);
          await service.denyUser({ ...context, userId });
          content = `<@${userId}> can no longer connect to this room.`;
          break;
        }
        case "kick": {
          const userId = targetUserId(interaction);
          await service.kickUser({ ...context, userId });
          content = `<@${userId}> was disconnected from this voice room.`;
          break;
        }
        case "limit": {
          const userLimit = interaction.options.getInteger("number", true);
          await service.setLimit({ ...context, userLimit });
          content = userLimit === 0 ? "Voice room limit removed." : `Voice room limit set to ${userLimit}.`;
          break;
        }
        case "rename": {
          const result = await service.rename({
            ...context,
            name: interaction.options.getString("name", true),
          });
          content = `Voice room renamed to **${result.name}**.`;
          break;
        }
        case "transfer": {
          const userId = targetUserId(interaction);
          await service.transfer({ ...context, userId });
          content = `Voice room ownership transferred to <@${userId}>.`;
          break;
        }
        default:
          throw Object.assign(new Error("Unsupported room action."), { code: "ROOM_VALIDATION" });
      }

      await respond(interaction, content);
    } catch (error) {
      if (KNOWN_ROOM_ERRORS.has(error?.code)) {
        await respond(interaction, error.message);
        return;
      }
      throw error;
    }
  }
}

module.exports = new RoomCommandHandler();
module.exports.RoomCommandHandler = RoomCommandHandler;
module.exports.acknowledge = acknowledge;
module.exports.respond = respond;
module.exports.ROOM_HELP = ROOM_HELP;
