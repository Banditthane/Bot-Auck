const AutoNameConfig = require("../../domain/entities/AutoNameConfig");
const MemberCode = require("../../domain/entities/MemberCode");
const ConfigureAutoNameDto = require("../dto/ConfigureAutoNameDto");
const AssignAutoNameDto = require("../dto/AssignAutoNameDto");
const { assertActorAuthorized, assertMemberEligible } = require("../../domain/policies/AutoNamePolicy");
const {
  AUTO_NAME_ERROR_CODES: CODES,
  AUTO_NAME_RESULT_CODES: RESULTS,
  AutoNameError,
  AutoNameStateError,
} = require("../../domain/errors/AutoNameErrors");

class AutoNameService {
  constructor({ configRepository, codeRepository, auditRepository, nicknameGateway, templateService, telemetry, clock = { now: () => Date.now() }, auditIdFactory = () => "audit", traceIdFactory = () => "trace" }) {
    if (!configRepository || !codeRepository || !auditRepository || !nicknameGateway || !templateService) {
      throw new TypeError("AutoNameService requires repositories, nicknameGateway, and templateService.");
    }
    this.configs = configRepository;
    this.codes = codeRepository;
    this.audit = auditRepository;
    this.gateway = nicknameGateway;
    this.templates = templateService;
    this.telemetry = telemetry || { info() {}, warn() {}, error() {} };
    this.clock = clock;
    this.auditIdFactory = auditIdFactory;
    this.traceIdFactory = traceIdFactory;
  }

  async configure(input) {
    const dto = input instanceof ConfigureAutoNameDto ? input : new ConfigureAutoNameDto(input);
    const [actorFacts, roleFacts] = await Promise.all([
      this.gateway.getMemberFacts({ guildId: dto.guildId, userId: dto.actorId, actorId: dto.actorId, requiredRoleId: dto.requiredRoleId }),
      this.gateway.getRoleFacts({ guildId: dto.guildId, roleId: dto.requiredRoleId }),
    ]);
    assertActorAuthorized(actorFacts);
    if (!roleFacts?.exists) throw new AutoNameStateError("Required role was not found.", CODES.VALIDATION);
    const previous = await this.configs.findByGuild(dto.guildId);
    if (previous && previous.codeLength > dto.codeLength) {
      const stats = await this.codes.getGuildAllocationStats(dto.guildId);
      if ((stats?.maximumMemberNumber || 0) > (10 ** dto.codeLength) - 1) {
        throw new AutoNameStateError("Existing member codes do not fit the requested length.", CODES.CODE_EXHAUSTED);
      }
    }
    const now = this.clock.now();
    const config = new AutoNameConfig({
      guildId: dto.guildId, enabled: previous?.enabled ?? true, requiredRoleId: dto.requiredRoleId,
      template: dto.template, codeLength: dto.codeLength, createdAt: previous?.createdAt ?? now, updatedAt: now,
    });
    await this.configs.upsert(config);
    this.telemetry.info("auto_name_configured", { guildId: dto.guildId, actorId: dto.actorId, outcome: RESULTS.CONFIGURED });
    return { ok: true, code: RESULTS.CONFIGURED, config };
  }

  async setEnabled({ guildId, actorId, enabled, traceId }) {
    const current = await this._config(guildId);
    const dto = new ConfigureAutoNameDto({
      guildId, actorId, requiredRoleId: current.requiredRoleId,
      template: current.template.value || current.template,
      codeLength: current.codeLength, traceId,
    });
    const facts = await this.gateway.getMemberFacts({ guildId: dto.guildId, userId: dto.actorId, actorId: dto.actorId, requiredRoleId: dto.requiredRoleId });
    assertActorAuthorized(facts);
    const config = await this.configs.setEnabled(dto.guildId, Boolean(enabled), this.clock.now());
    return { ok: true, code: enabled ? RESULTS.ENABLED : RESULTS.DISABLED, config };
  }

  async assign(input) {
    const dto = input instanceof AssignAutoNameDto ? input : new AssignAutoNameDto(input);
    const config = await this._config(dto.guildId);
    if (!config.enabled) throw new AutoNameStateError("Auto Name is disabled.", CODES.DISABLED);
    const facts = await this.gateway.getMemberFacts({
      guildId: dto.guildId, userId: dto.userId, actorId: dto.actorId,
      requiredRoleId: config.requiredRoleId,
    });
    assertMemberEligible(facts, { actorRequired: Boolean(dto.actorId) });
    if (dto.missingOnly && facts.hasAutoName) {
      return { ok: true, code: RESULTS.ALREADY_CORRECT, guildId: dto.guildId, userId: dto.userId };
    }
    const existing = await this.codes.findByGuildUser(dto.guildId, dto.userId);
    if (dto.dryRun && !existing) {
      return { ok: true, code: RESULTS.DRY_RUN_WOULD_ALLOCATE, guildId: dto.guildId, userId: dto.userId };
    }
    const stored = existing || await this.codes.getOrAllocate({
      guildId: dto.guildId, userId: dto.userId, codeLength: config.codeLength, now: this.clock.now(),
    });
    const memberCode = stored instanceof MemberCode ? stored : new MemberCode(stored);
    const nickname = this.templates.render({
      template: config.template.value || config.template,
      memberNumber: memberCode.memberNumber,
      codeLength: config.codeLength,
      username: facts.username,
      displayName: facts.displayName,
      role: facts.roleName,
    });
    if (facts.currentNickname === nickname) {
      return { ok: true, code: RESULTS.ALREADY_CORRECT, guildId: dto.guildId, userId: dto.userId };
    }
    if (dto.dryRun) return { ok: true, code: RESULTS.DRY_RUN_WOULD_ASSIGN, guildId: dto.guildId, userId: dto.userId };

    await this.gateway.setNickname({ guildId: dto.guildId, userId: dto.userId, nickname, reason: "Auto Name assignment" });
    const traceId = dto.traceId || this.traceIdFactory();
    let auditWarning = null;
    try {
      await this.audit.append({
        id: this.auditIdFactory(), guildId: dto.guildId, userId: dto.userId,
        oldNickname: facts.currentNickname, newNickname: nickname, action: dto.source,
        actorId: dto.actorId, traceId, createdAt: this.clock.now(),
      });
    } catch (_error) {
      auditWarning = CODES.AUDIT_WRITE_FAILED;
      this.telemetry.error("auto_name_audit_write_failed", { guildId: dto.guildId, userId: dto.userId, traceId, code: auditWarning });
    }
    this.telemetry.info("auto_name_assigned", { guildId: dto.guildId, userId: dto.userId, traceId, outcome: RESULTS.ASSIGNED });
    return { ok: true, code: RESULTS.ASSIGNED, guildId: dto.guildId, userId: dto.userId, auditWarning };
  }

  async preview({ guildId, userId }) {
    const config = await this._config(guildId);
    const facts = await this.gateway.getMemberFacts({ guildId, userId, actorId: null, requiredRoleId: config.requiredRoleId });
    const existing = await this.codes.findByGuildUser(guildId, userId);
    return this.templates.render({
      template: config.template.value || config.template, memberNumber: existing?.memberNumber?.value || existing?.memberNumber || 1,
      codeLength: config.codeLength, username: facts.username, displayName: facts.displayName, role: facts.roleName,
    });
  }

  async _config(guildId) {
    const found = await this.configs.findByGuild(guildId);
    if (!found) throw new AutoNameStateError("Auto Name is not configured.", CODES.CONFIG_NOT_FOUND);
    return found instanceof AutoNameConfig ? found : new AutoNameConfig(found);
  }
}

module.exports = AutoNameService;
module.exports.AUTO_NAME_SERVICE_METHODS = Object.freeze(["configure", "setEnabled", "assign", "preview"]);
