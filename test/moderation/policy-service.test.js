const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");

const ModerationPolicy = require("../../src/domain/policies/ModerationPolicy");
const ModerationService = require("../../src/application/services/ModerationService");
const { ModerationErrorCodes } = require("../../src/domain/errors/ModerationErrors");

function allowedFacts(overrides = {}) {
  return {
    guildId: "10000000000000000",
    actorId: "20000000000000000",
    botId: "30000000000000000",
    ownerId: "40000000000000000",
    targetId: "50000000000000000",
    targetIsMember: true,
    actorHasPermission: true,
    botHasPermission: true,
    actorRolePosition: 30,
    botRolePosition: 40,
    targetRolePosition: 20,
    targetCapability: true,
    targetTimedOut: true,
    ...overrides,
  };
}

function assertPolicyDenial(overrides, code) {
  assert.throws(
    () => new ModerationPolicy().assertTargetMemberActionAllowed(allowedFacts(overrides)),
    (error) => error.code === code
  );
}

test("moderation policy denies unsafe targets before mutation", () => {
  assertPolicyDenial({ actorHasPermission: false }, ModerationErrorCodes.ACTOR_PERMISSION);
  assertPolicyDenial({ botHasPermission: false }, ModerationErrorCodes.BOT_PERMISSION);
  assertPolicyDenial({ targetIsMember: false }, ModerationErrorCodes.TARGET_NOT_MEMBER);
  assertPolicyDenial({ targetId: "20000000000000000" }, ModerationErrorCodes.TARGET_SELF);
  assertPolicyDenial({ targetId: "30000000000000000" }, ModerationErrorCodes.TARGET_BOT);
  assertPolicyDenial({ targetId: "40000000000000000" }, ModerationErrorCodes.TARGET_OWNER);
  assertPolicyDenial({ actorRolePosition: 20 }, ModerationErrorCodes.ACTOR_HIERARCHY);
  assertPolicyDenial({ botRolePosition: 20 }, ModerationErrorCodes.BOT_HIERARCHY);
  assertPolicyDenial({ targetCapability: false }, ModerationErrorCodes.TARGET_NOT_CAPABLE);
});

test("moderation service validates inputs, normalizes reason, and calls ban gateway", async () => {
  const calls = [];
  const service = new ModerationService({
    gateway: {
      async getTargetMemberFacts(input) {
        calls.push(["facts", input]);
        return allowedFacts();
      },
      async banMember(input) { calls.push(["ban", input]); },
    },
    logger: { info() {} },
  });

  await service.ban({
    guildId: "10000000000000000",
    actorId: "20000000000000000",
    targetId: "50000000000000000",
    deleteMessageSeconds: 3600,
    reason: "  spam   links  ",
  });

  assert.equal(calls[0][1].requiredPermission, "BanMembers");
  assert.equal(calls[0][1].capability, "bannable");
  assert.equal(calls[1][1].deleteMessageSeconds, 3600);
  assert.equal(calls[1][1].reason, "spam links");
});

test("moderation service prevents mutation after validation and policy failures", async () => {
  let mutated = false;
  const service = new ModerationService({
    gateway: {
      async getTargetMemberFacts() { return allowedFacts({ actorRolePosition: 20 }); },
      async kickMember() { mutated = true; },
    },
  });

  await assert.rejects(
    service.kick({
      guildId: "10000000000000000",
      actorId: "20000000000000000",
      targetId: "50000000000000000",
    }),
    (error) => error.code === ModerationErrorCodes.ACTOR_HIERARCHY
  );
  assert.equal(mutated, false);

  await assert.rejects(
    service.ban({
      guildId: "10000000000000000",
      actorId: "20000000000000000",
      targetId: "50000000000000000",
      deleteMessageSeconds: 123,
    }),
    (error) => error.code === ModerationErrorCodes.INVALID_INPUT
  );
});

test("timeout uses an injected clock and untimeout requires an existing timeout", async () => {
  const calls = [];
  const service = new ModerationService({
    now: () => 1000,
    gateway: {
      async getTargetMemberFacts(input) {
        return allowedFacts({ targetTimedOut: input.requiredPermission === "ModerateMembers" && input.targetId.endsWith("1") });
      },
      async timeoutMember(input) { calls.push(input); },
      async untimeoutMember(input) { calls.push(input); },
    },
  });

  await service.timeout({
    guildId: "10000000000000000",
    actorId: "20000000000000000",
    targetId: "50000000000000001",
    durationSeconds: 300,
  });
  assert.equal(calls[0].until.getTime(), 301000);

  await assert.rejects(
    service.untimeout({
      guildId: "10000000000000000",
      actorId: "20000000000000000",
      targetId: "50000000000000002",
    }),
    (error) => error.code === ModerationErrorCodes.NOT_TIMED_OUT
  );
});

test("unban validates raw user ID and requires current ban proof", async () => {
  let removed = false;
  const service = new ModerationService({
    gateway: {
      async getUnbanFacts() {
        return {
          guildId: "10000000000000000",
          actorId: "20000000000000000",
          actorHasPermission: true,
          botHasPermission: true,
          isBanned: false,
        };
      },
      async unbanUser() { removed = true; },
    },
  });

  await assert.rejects(
    service.unban({ guildId: "10000000000000000", actorId: "20000000000000000", userId: "not-id" }),
    (error) => error.code === ModerationErrorCodes.INVALID_INPUT
  );
  await assert.rejects(
    service.unban({ guildId: "10000000000000000", actorId: "20000000000000000", userId: "50000000000000000" }),
    (error) => error.code === ModerationErrorCodes.NOT_BANNED
  );
  assert.equal(removed, false);
});
