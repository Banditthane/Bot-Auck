const test = require("node:test");
const assert = require("node:assert/strict");
const AutoNameTemplate = require("../../src/domain/valueObjects/AutoNameTemplate");
const MemberNumber = require("../../src/domain/valueObjects/MemberNumber");
const AutoNameConfig = require("../../src/domain/entities/AutoNameConfig");
const MemberCode = require("../../src/domain/entities/MemberCode");
const { assertMemberEligible } = require("../../src/domain/policies/AutoNamePolicy");
const { AUTO_NAME_ERROR_CODES: CODES } = require("../../src/domain/errors/AutoNameErrors");

test("default template is mandatory-code, NFC, and six-digit render fits Discord", () => {
  const template = new AutoNameTemplate();
  assert.equal(template.value, "⦅ ¹⁾ ☠ ₍₈ ⦆ ⥊ « 𓆩{code}𓆪 »");
  const rendered = template.render({ code: "000001" });
  assert.equal(rendered.length, 28);
  assert.equal(rendered.normalize("NFC"), rendered);
});

test("template allows only the four frozen variables and requires code", () => {
  const value = new AutoNameTemplate("{code}-{username}-{displayName}-{role}");
  assert.deepEqual(value.variables, ["code", "username", "displayName", "role"]);
  assert.throws(() => new AutoNameTemplate("{username}"), (error) => error.code === CODES.TEMPLATE_INVALID);
  assert.throws(() => new AutoNameTemplate("{code}-{unknown}"), (error) => error.code === CODES.TEMPLATE_INVALID);
  assert.throws(() => new AutoNameTemplate("{code"), (error) => error.code === CODES.TEMPLATE_INVALID);
});

test("template normalizes NFC and rejects controls and bidi controls", () => {
  assert.equal(new AutoNameTemplate("e\u0301-{code}").value, "é-{code}");
  for (const unsafe of ["\n", "\u0000", "\u202e", "\u2066"]) {
    assert.throws(() => new AutoNameTemplate(`x${unsafe}{code}`), (error) => error.code === CODES.TEMPLATE_INVALID);
  }
  assert.throws(() => new AutoNameTemplate("{code}").render({ code: "1\u202e" }), (error) => error.code === CODES.TEMPLATE_INVALID);
});

test("render measures UTF-16 units including astral characters and never truncates", () => {
  assert.equal(new AutoNameTemplate("{code}").render({ code: "😀".repeat(16) }).length, 32);
  assert.throws(
    () => new AutoNameTemplate("{code}").render({ code: "😀".repeat(16) + "x" }),
    (error) => error.code === CODES.RENDER_TOO_LONG
  );
});

test("member numbers are positive, bounded, and padded without changing storage", () => {
  const number = new MemberNumber(42);
  assert.equal(number.value, 42);
  assert.equal(number.format(6), "000042");
  assert.throws(() => new MemberNumber(0), (error) => error.code === CODES.VALIDATION);
  assert.throws(() => number.format(1), (error) => error.code === CODES.CODE_EXHAUSTED);
  assert.throws(() => MemberNumber.assertCodeLength(13), (error) => error.code === CODES.VALIDATION);
});

test("entities retain validated template and permanent member number", () => {
  const config = new AutoNameConfig({ guildId: "g", requiredRoleId: "r", codeLength: 6 });
  const code = new MemberCode({ guildId: "g", userId: "u", memberNumber: 7 });
  assert.equal(config.template.value.includes("{code}"), true);
  assert.equal(code.display(config.codeLength), "000007");
});

test("policy requires role, bot permissions, strict hierarchy and manageable target", () => {
  const allowed = {
    targetIsBot: false, targetIsOwner: false, targetHasRequiredRole: true,
    botHasManageNicknames: true, botRoleComparison: 1, targetManageable: true,
    actorHasManageNicknames: true, actorIsOwner: false, actorRoleComparison: 1,
  };
  assert.equal(assertMemberEligible(allowed, { actorRequired: true }), true);
  for (const change of [
    { targetIsBot: true }, { targetIsOwner: true }, { targetHasRequiredRole: false },
    { botHasManageNicknames: false }, { botRoleComparison: 0 }, { targetManageable: false },
    { actorHasManageNicknames: false }, { actorRoleComparison: 0 },
  ]) assert.throws(() => assertMemberEligible({ ...allowed, ...change }, { actorRequired: true }));
  assert.equal(assertMemberEligible({ ...allowed, actorIsOwner: true, actorRoleComparison: -1 }, { actorRequired: true }), true);
});

test("domain and application Auto Name modules contain no forbidden adapter imports", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const roots = ["src/domain", "src/application/dto", "src/application/services", "src/application/repositories/contracts"];
  const files = roots.flatMap((root) => fs.readdirSync(path.resolve(__dirname, "../..", root), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.includes("AutoName"))
    .map((entry) => path.resolve(__dirname, "../..", root, entry.name)));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /discord\.js|better-sqlite3|infrastructure\/|process\.|Logger/);
  }
});
