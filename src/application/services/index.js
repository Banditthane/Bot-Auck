const MemberService = require("./MemberService");
const PingService = require("./ping.service");
const AutoRoomService = require("./AutoRoomService");
const ModerationService = require("./ModerationService");
const AutoNameTemplateService = require("./AutoNameTemplateService");
const AutoNameService = require("./AutoNameService");
const AutoNameScanService = require("./AutoNameScanService");
const AutoRoleRuleService = require("./AutoRoleRuleService");
const AutoRoleService = require("./AutoRoleService");
const AutoRoleScanService = require("./AutoRoleScanService");
const MemberAutomationOrchestrator = require("./MemberAutomationOrchestrator");
const CommandHelpService = require("./CommandHelpService");

function createServices(container, autoRoomDependencies) {
  if (!autoRoomDependencies) {
    throw new TypeError("Auto Voice Room dependencies are required.");
  }

  const autoNameTemplateService = new AutoNameTemplateService();
  const autoNameService = autoRoomDependencies.autoNameConfigRepository
    ? new AutoNameService({
      configRepository: autoRoomDependencies.autoNameConfigRepository,
      codeRepository: autoRoomDependencies.autoNameCodeRepository,
      auditRepository: autoRoomDependencies.autoNameAuditRepository,
      nicknameGateway: autoRoomDependencies.autoNameNicknameGateway,
      templateService: autoNameTemplateService,
      telemetry: autoRoomDependencies.autoNameTelemetry,
    })
    : undefined;

  const autoRoleRuleService = autoRoomDependencies.autoRoleRuleRepository && autoRoomDependencies.memberRoleGateway
    ? new AutoRoleRuleService({
      ruleRepository: autoRoomDependencies.autoRoleRuleRepository,
      memberRoleGateway: autoRoomDependencies.memberRoleGateway,
    })
    : undefined;
  const autoRoleService = autoRoomDependencies.autoRoleConfigRepository && autoRoomDependencies.autoRoleRuleRepository
    ? new AutoRoleService({
      configRepository: autoRoomDependencies.autoRoleConfigRepository,
      ruleRepository: autoRoomDependencies.autoRoleRuleRepository,
      auditRepository: autoRoomDependencies.autoRoleAuditRepository,
      operationRepository: autoRoomDependencies.memberAutomationOperationRepository,
      memberRoleGateway: autoRoomDependencies.memberRoleGateway,
      operationIdFactory: () => `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      auditIdFactory: () => `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    })
    : undefined;
  const autoRoleScanService = autoRoleService && autoRoomDependencies.memberAutomationJobRepository
    ? new AutoRoleScanService({
      jobRepository: autoRoomDependencies.memberAutomationJobRepository,
      memberRoleGateway: autoRoomDependencies.memberRoleGateway,
      autoRoleService,
    })
    : undefined;
  const memberAutomationOrchestrator = autoRoleService && autoNameService && autoRoomDependencies.memberRoleGateway
    ? new MemberAutomationOrchestrator({
      autoRoleService,
      autoNameService,
      memberRoleGateway: autoRoomDependencies.memberRoleGateway,
      operationRepository: autoRoomDependencies.memberAutomationOperationRepository,
    })
    : undefined;
  const commandHelpService = autoRoomDependencies.commandCatalog
    ? new CommandHelpService({ commandCatalog: autoRoomDependencies.commandCatalog })
    : undefined;

  return {
    memberService: new MemberService(),
    pingService: new PingService(),
    moderationService: autoRoomDependencies.moderationGateway
      ? new ModerationService({
        gateway: autoRoomDependencies.moderationGateway,
        logger: autoRoomDependencies.logger || container.resolve("logger"),
      })
      : undefined,
    autoRoomService: new AutoRoomService({
      ...autoRoomDependencies,
      logger: autoRoomDependencies.logger || container.resolve("logger"),
    }),
    autoNameTemplateService,
    autoNameService,
    autoNameScanService: autoNameService && autoRoomDependencies.autoNameScanQueue
      ? new AutoNameScanService({
        scanQueue: autoRoomDependencies.autoNameScanQueue,
        nicknameGateway: autoRoomDependencies.autoNameNicknameGateway,
        autoNameService,
        configRepository: autoRoomDependencies.autoNameConfigRepository,
        telemetry: autoRoomDependencies.autoNameTelemetry,
      })
      : undefined,
    autoRoleRuleService,
    autoRoleService,
    autoRoleScanService,
    memberAutomationOrchestrator,
    commandHelpService,
  };
}

module.exports = createServices;
