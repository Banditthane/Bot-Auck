const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");

require("module-alias/register");

const banCommand = require("../../src/interfaces/discord/commands/moderation/ban/command");
const kickCommand = require("../../src/interfaces/discord/commands/moderation/kick/command");
const unbanCommand = require("../../src/interfaces/discord/commands/moderation/unban/command");
const timeoutCommand = require("../../src/interfaces/discord/commands/moderation/timeout/command");
const untimeoutCommand = require("../../src/interfaces/discord/commands/moderation/untimeout/command");
const roomCommand = require("../../src/interfaces/discord/commands/room/command");
const { ModerationError } = require("../../src/domain/errors/ModerationErrors");
const { ModerationErrorCodes } = require("../../src/domain/errors/ModerationErrors");

function interactionFor(command, values = {}) {
  const calls = { defer: [], edit: [], follow: [] };
  return {
    calls,
    interaction: {
      guildId: values.guildId ?? "10000000000000000",
      user: { id: values.actorId ?? "20000000000000000" },
      deferred: false,
      replied: values.replied ?? false,
      options: {
        getUser: () => ({ id: values.targetId ?? "50000000000000000" }),
        getString(name) {
          return {
            reason: values.reason ?? null,
            "delete-messages": values.deleteMessages ?? null,
            duration: values.duration ?? "300",
            "user-id": values.userId ?? "60000000000000000",
          }[name] ?? null;
        },
      },
      async deferReply(payload) { calls.defer.push(payload); this.deferred = true; },
      async editReply(payload) { calls.edit.push(payload); },
      async followUp(payload) { calls.follow.push(payload); },
    },
  };
}

test("moderation command metadata is guild-only and /kick is separate from /room kick", () => {
  const commands = [
    [banCommand, PermissionFlagsBits.BanMembers],
    [kickCommand, PermissionFlagsBits.KickMembers],
    [unbanCommand, PermissionFlagsBits.BanMembers],
    [timeoutCommand, PermissionFlagsBits.ModerateMembers],
    [untimeoutCommand, PermissionFlagsBits.ModerateMembers],
  ];
  assert.deepEqual(commands.map(([command]) => command.data.name), ["ban", "kick", "unban", "timeout", "untimeout"]);
  for (const [command, permission] of commands) {
    const json = command.data.toJSON();
    assert.equal(json.dm_permission, false);
    assert.equal(json.default_member_permissions, permission.toString());
  }
  assert.ok(roomCommand.data.toJSON().options.some((option) => option.name === "kick"));
});

test("ban handler defers ephemerally once and passes primitive DTO", async () => {
  const { interaction, calls } = interactionFor("ban", { deleteMessages: "86400", reason: "cleanup" });
  const serviceCalls = [];
  const container = { resolve: () => ({ moderationService: {
    async ban(input) {
      serviceCalls.push(input);
      return { targetId: input.targetId };
    },
  } }) };

  await banCommand.execute({ interaction, container });

  assert.deepEqual(calls.defer, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(calls.edit[0].content, "<@50000000000000000> was banned.");
  assert.deepEqual(serviceCalls, [{
    guildId: "10000000000000000",
    actorId: "20000000000000000",
    targetId: "50000000000000000",
    reason: "cleanup",
    deleteMessageSeconds: 86400,
  }]);
});

test("handlers map known moderation errors to safe ephemeral replies", async () => {
  const { interaction, calls } = interactionFor("kick");
  const container = { resolve: () => ({ moderationService: {
    async kick() {
      throw new ModerationError(ModerationErrorCodes.ACTOR_PERMISSION, "raw internal reason");
    },
  } }) };

  await kickCommand.execute({ interaction, container });

  assert.equal(calls.defer.length, 1);
  assert.equal(calls.edit.length, 1);
  assert.match(calls.edit[0].content, /permission/i);
  assert.doesNotMatch(calls.edit[0].content, /raw internal/);
});

test("timeout untimeout and unban handlers call their service methods", async () => {
  const invocations = [];
  const container = { resolve: () => ({ moderationService: {
    async timeout(input) { invocations.push(["timeout", input]); return { targetId: input.targetId }; },
    async untimeout(input) { invocations.push(["untimeout", input]); return { targetId: input.targetId }; },
    async unban(input) { invocations.push(["unban", input]); return { targetId: input.userId }; },
  } }) };

  await timeoutCommand.execute({ interaction: interactionFor("timeout", { duration: "3600" }).interaction, container });
  await untimeoutCommand.execute({ interaction: interactionFor("untimeout").interaction, container });
  await unbanCommand.execute({ interaction: interactionFor("unban", { userId: "70000000000000000" }).interaction, container });

  assert.equal(invocations[0][0], "timeout");
  assert.equal(invocations[0][1].durationSeconds, 3600);
  assert.equal(invocations[1][0], "untimeout");
  assert.equal(invocations[2][0], "unban");
  assert.equal(invocations[2][1].userId, "70000000000000000");
});
