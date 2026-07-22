const EvaluateAutoRoleDto = require("../dto/EvaluateAutoRoleDto");
const { assertSnowflake } = require("../dto/CreateAutoRoleRuleDto");
const { matchesRule, sortRules, buildRoleChangePlan } = require("../../domain/policies/AutoRolePolicy");
const { AUTO_ROLE_ERROR_CODES: CODES, AUTO_ROLE_RESULT_CODES: RESULTS, AutoRoleAuthorizationError, AutoRoleStateError } = require("../../domain/errors/AutoRoleErrors");
class AutoRoleService {
  constructor({ configRepository, ruleRepository, auditRepository, operationRepository, memberRoleGateway, clock = { now: () => Date.now() }, operationIdFactory = () => "operation", auditIdFactory = () => "audit" }) { if (!configRepository || !ruleRepository || !auditRepository || !operationRepository || !memberRoleGateway) throw new TypeError("AutoRoleService requires repositories and memberRoleGateway."); this.configs=configRepository; this.rules=ruleRepository; this.audit=auditRepository; this.operations=operationRepository; this.gateway=memberRoleGateway; this.clock=clock; this.operationIdFactory=operationIdFactory; this.auditIdFactory=auditIdFactory; }
  async configure({ guildId, actorId, removalSemantics = false }) {
    assertSnowflake(guildId, "guildId"); assertSnowflake(actorId, "actorId"); await this._authorize(guildId, actorId);
    const previous = await this.configs.findByGuild(guildId); const now = this.clock.now();
    const config = { guildId, enabled: previous?.enabled ?? true, removalSemantics: Boolean(removalSemantics), createdAt: previous?.createdAt ?? now, updatedAt: now };
    await this.configs.upsert(config); return { ok: true, code: RESULTS.CONFIGURED, config };
  }
  async getConfig({ guildId, actorId }) { assertSnowflake(guildId, "guildId"); assertSnowflake(actorId, "actorId"); await this._authorize(guildId, actorId); const config = await this.configs.findByGuild(guildId); if (!config) throw new AutoRoleStateError("Auto Role is not configured.", CODES.CONFIG_NOT_FOUND); return { ok: true, code: RESULTS.CONFIG_READ, config }; }
  async setEnabled({ guildId, actorId, enabled }) { assertSnowflake(guildId, "guildId"); assertSnowflake(actorId, "actorId"); await this._authorize(guildId, actorId); if (!await this.configs.findByGuild(guildId)) throw new AutoRoleStateError("Auto Role is not configured.", CODES.CONFIG_NOT_FOUND); const config = await this.configs.setEnabled(guildId, Boolean(enabled), this.clock.now()); return { ok: true, code: enabled ? RESULTS.ENABLED : RESULTS.DISABLED, config }; }
  async evaluate(input) { const dto=input instanceof EvaluateAutoRoleDto?input:new EvaluateAutoRoleDto(input); const config=await this.configs.findByGuild(dto.guildId); if(!config) throw new AutoRoleStateError("Auto Role is not configured.",CODES.CONFIG_NOT_FOUND); if(!config.enabled) throw new AutoRoleStateError("Auto Role is disabled.",CODES.DISABLED); const facts=await this.gateway.getMemberFacts({guildId:dto.guildId,userId:dto.userId,actorId:dto.actorId}); if(facts.targetIsBot||facts.targetIsOwner) return {ok:true,code:RESULTS.SKIPPED,plans:[],facts}; const rules=sortRules(await this.rules.listByGuildTrigger(dto.guildId,dto.trigger)); const plans=[]; for(const rule of rules){ if(!matchesRule(rule,{trigger:dto.trigger,currentRoleIds:facts.currentRoleIds})) continue; const plan=buildRoleChangePlan(rule,facts,{removalSemantics:Boolean(config.removalSemantics),groupRoleIds:facts.exclusiveGroupRoleIds?.[rule.exclusiveGroup]||[],owningPriorityByRole:facts.owningPriorityByRole||{}}); plans.push(plan); if(rule.stopOnMatch) break; } return {ok:true,code:RESULTS.PLAN_READY,plans,facts,dto}; }
  async evaluateAndApply(input) { const evaluated=await this.evaluate(input); const dto=evaluated.dto || (input instanceof EvaluateAutoRoleDto?input:new EvaluateAutoRoleDto(input)); if(dto.dryRun) return {...evaluated,code:RESULTS.DRY_RUN}; const results=[]; for(const plan of evaluated.plans) results.push(await this.applyPlan(plan,{actorId:dto.actorId,traceId:dto.traceId})); return {...evaluated,code:results.some((r)=>r.code===CODES.OPERATION_PARTIAL)?CODES.OPERATION_PARTIAL:RESULTS.APPLIED,results}; }
  async applyPlan(plan, { actorId = null, traceId = "" } = {}) {
    if (!plan.changed) return { ok: true, code: plan.reasonCode === "ALREADY_ASSIGNED" ? RESULTS.ALREADY_ASSIGNED : RESULTS.SKIPPED, plan };
    const initial = await this.gateway.getMemberFacts({ guildId: plan.guildId, userId: plan.userId, actorId });
    const manageable = new Set(initial.manageableRoleIds || []);
    if ([...plan.addRoleIds, ...plan.removeRoleIds].some((id) => !manageable.has(id))) throw new AutoRoleStateError("One or more roles cannot be managed safely.", CODES.UNMANAGEABLE);
    const operationId = this.operationIdFactory(); const now = this.clock.now();
    await this.operations.create({ operationId, guildId: plan.guildId, userId: plan.userId, source: "AUTO_ROLE", traceId, expectedAddRoleIds: plan.addRoleIds, expectedRemoveRoleIds: plan.removeRoleIds, status: "RUNNING", createdAt: now, updatedAt: now });
    const added = []; const removed = [];
    try {
      for (const roleId of plan.addRoleIds) {
        const fresh = await this.gateway.getMemberFacts({ guildId: plan.guildId, userId: plan.userId, actorId });
        if (fresh.currentRoleIds?.includes(roleId)) continue;
        if (!fresh.manageableRoleIds?.includes(roleId)) throw new AutoRoleStateError("Role is no longer manageable.", CODES.UNMANAGEABLE);
        await this.gateway.addRole({ guildId: plan.guildId, userId: plan.userId, roleId, reason: "Member Automation Auto Role" });
        added.push(roleId); await this._audit(plan, roleId, "ADD", "SUCCESS", actorId, traceId);
      }
      for (const roleId of plan.removeRoleIds) {
        const fresh = await this.gateway.getMemberFacts({ guildId: plan.guildId, userId: plan.userId, actorId });
        if (!fresh.currentRoleIds?.includes(roleId)) continue;
        if (!fresh.manageableRoleIds?.includes(roleId)) throw new AutoRoleStateError("Role is no longer manageable.", CODES.UNMANAGEABLE);
        await this.gateway.removeRole({ guildId: plan.guildId, userId: plan.userId, roleId, reason: "Member Automation Auto Role conflict resolution" });
        removed.push(roleId); await this._audit(plan, roleId, "REMOVE", "SUCCESS", actorId, traceId);
      }
      await this.gateway.refetchMember({ guildId: plan.guildId, userId: plan.userId });
      await this.operations.updateStatus(operationId, "COMPLETED", this.clock.now());
      return { ok: true, code: RESULTS.APPLIED, plan, operationId };
    } catch (error) {
      let compensationFailed = false;
      for (const roleId of added.reverse()) { try { await this.gateway.removeRole({ guildId: plan.guildId, userId: plan.userId, roleId, reason: "Member Automation compensation" }); } catch (_compensation) { compensationFailed = true; } }
      const status = compensationFailed || removed.length ? "PARTIAL_CONFLICT" : "FAILED_COMPENSATED";
      await this.operations.updateStatus(operationId, status, this.clock.now(), String(error?.code || "AUTO_ROLE_TRANSIENT").slice(0, 64));
      return { ok: false, code: status === "PARTIAL_CONFLICT" ? CODES.OPERATION_PARTIAL : String(error?.code || CODES.TRANSIENT), plan, operationId };
    }
  }  async _authorize(guildId, actorId) { const facts = await this.gateway.getActorFacts({ guildId, actorId }); if (!facts?.actorIsOwner && !facts?.actorIsAdministrator) throw new AutoRoleAuthorizationError("Guild owner or Administrator is required.", CODES.FORBIDDEN); }  async _audit(plan,roleId,action,result,actorId,traceId){await this.audit.append({id:this.auditIdFactory(),guildId:plan.guildId,userId:plan.userId,ruleId:plan.ruleId,action,roleId,result,actorId,traceId,createdAt:this.clock.now()});}
}
module.exports=AutoRoleService; module.exports.AUTO_ROLE_SERVICE_METHODS=Object.freeze(["configure","getConfig","setEnabled","evaluate","evaluateAndApply","applyPlan"]);
