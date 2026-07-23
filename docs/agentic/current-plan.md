# Member Automation Plan — Auto Name, Auto Role, Command Help

Status: **PLANNER COMPLETE — HOST APPROVE/REJECT REQUIRED.** No coding, migration, deployment, or merge is authorized.

## 1. Current Repository Findings

Inspected real `main` at `de094ac479ff6c45eb42412896c796481de0591f` (ahead origin by 6).

**PASS / exists**

- Auto Name now has domain, DTOs/contracts, services, SQLite v1/repositories, Discord nickname gateway, telemetry adapter, persistent scan worker, `/autoname`, member add/update events, DI/Bootstrap/deploy wiring, and interface/composition tests.
- `node --test test\auto-name\*.test.js` passed **53/53** during this planning inspection. This is deterministic local evidence only.
- Existing command set is ping, room, room-setup, five moderation commands and autoname. EventLoader recursively discovers event `.js` files.
- Discord.js `14.27.0`; `GuildMembers` intent is present in source; REST member pagination is available.
- Auto Name runtime DB plus WAL/SHM now exist as untracked files. AutoRoom WAL/SHM are modified. They are user/runtime data and must not be touched blindly.

**NEEDS-FIX / missing for new scope**

- No Auto Role domain, schema, services, gateway, rules, command, worker/jobs, audit or tests.
- No `/help`, command catalog, rich command metadata, presenters, component registry/router or persistent component session.
- Current CommandRegistry stores name -> handler and cannot list rich metadata. Bootstrap and deploy script manually repeat command imports/lists.
- `interactionCreate.js` routes chat-input commands only. Component routing must be added outside this file.
- `/autoname` currently defaults to `ManageNicknames`; new brief requires setup/template/scan/repair/enable/disable to be Guild Owner or Administrator. Discord default permissions apply to the whole top-level command, not individual subcommands: setting Administrator hides preview/config/status too. Recommended default is Administrator for the entire group, with the tradeoff explicitly accepted.
- Verification service contains comments only. No authoritative Level, Message Count, Verification Status, or Membership Duration repositories/events were found: **ARCHITECTURE DECISION REQUIRED** for these conditions.
- Host-reported live `/autoname` deployment timeout was not reproduced here. Current network/deploy/live command state is **UNKNOWN**; do not conflate it with deterministic code status.

## 2. Scope And Decision Gates

Ready to implement now:

- Auto Role rules for triggers `MEMBER_JOIN`, `ROLE_ADDED`, `MANUAL_SCAN`, `MANUAL_REPAIR`, based only on current Discord role IDs.
- Multiple required/excluded/target/remove role IDs, priority, stopOnMatch, enabled state, audit, dry-run, persistent scans, idempotency, hierarchy and exclusive-group policies.
- Default conflict policy `SKIP_IF_CONFLICT`.
- Application Orchestrator coordination: Auto Role then Auto Name; neither service imports/calls the other.
- Rich command manifest/catalog, embed presenters, `/help`, persistent owned sessions and component routing.

Decision required before corresponding production enablement:

- Level/message-count/verification/membership-duration condition data sources.
- True multi-host database/queue: local SQLite supports same-host processes, not separate local disks. PostgreSQL/Redis/BullMQ adapter choice is **ARCHITECTURE DECISION REQUIRED**.
- Role removal policy and whether explicit removeRoleIds may remove roles not created by automation. Default: no removal except an explicitly approved conflict policy; SKIP_IF_CONFLICT.
- Audit/session retention and personal-data access.
- Entire `/autoname` Administrator visibility tradeoff.
- Help language/content ownership and whether unavailable-but-local commands are shown.
- Strict visual disabling of expired ephemeral components after process crash. Security expiry is persistent; visual disable is best effort unless storing a sensitive interaction token is approved.

## 3. Proposed Architecture And ADRs

Dependency direction remains Interfaces -> Application -> Domain; Infrastructure implements Application ports.

```text
Discord events/commands/components
  -> MemberAutomationOrchestrator / AutoRole services / AutoName services / Help service
  -> pure entities, plans, policies, metadata entries
  -> repositories/gateways/catalog/job/session/operation ports
  <- SQLite adapters, Discord adapters, registry catalog, presenters
```

**ADR-01 Coordination — choose Application Orchestrator.** It receives both independently configurable services. Join flow evaluates Auto Role, applies a role plan, refetches facts, then invokes Auto Name if enabled/eligible. Alternatives: event bus/domain event. Orchestrator is deterministic and needs no new broker; risk is a longer use case, mitigated by typed step results. AutoRoleService never imports AutoNameService.

**ADR-02 Jobs — shared logical and physical model.** Add `member_automation_jobs` and migrate Auto Name scan jobs into it during DB v1->v2. Both scan services use `MemberAutomationJobRepository`. This avoids two lease implementations/status semantics. Migration is additive/copy-validated and cannot run live without backup/Host gate.

**ADR-03 Command source of truth — command manifest.** A single manifest imports each command object and supplies category/security/help metadata. Bootstrap registers manifest descriptors; deploy maps the same descriptors to `data.toJSON()`; RegistryCommandCatalog reads runtime registry. Descriptions/options come from SlashCommandBuilder JSON, enriched fields exist only in manifest.

**ADR-04 Role operations — saga, not false atomicity.** Discord cannot atomically add/remove multiple roles. Service computes an immutable RoleChangePlan; gateway executes ordered steps; a persisted operation records correlation/expected role diff. Compensation and repair handle partial failure.

## 4. Exact Files To Create

| Exact path(s) | Layer | Responsibility | Dependencies | Reason |
|---|---|---|---|---|
| `src/domain/entities/AutoRoleRule.js`; `RoleChangePlan.js`; `CommandHelpEntry.js` | Domain | rule invariants, immutable add/remove plan, help entry | value objects only | pure models |
| `src/domain/valueObjects/AutoRoleTrigger.js`; `RoleConflictPolicy.js`; `RoleRulePriority.js` | Domain | frozen enums/bounds | none | reject invalid rules |
| `src/domain/policies/AutoRolePolicy.js`; `CommandVisibilityPolicy.js` | Domain | rule/conflict/visibility decisions | entities/errors | pure policy |
| `src/domain/errors/AutoRoleErrors.js`; `CommandHelpErrors.js` | Domain | stable safe codes | none | boundaries |
| `src/application/dto/CreateAutoRoleRuleDto.js`; `UpdateAutoRoleRuleDto.js`; `EvaluateAutoRoleDto.js`; `ScanAutoRoleDto.js`; `GetCommandHelpDto.js` | Application | validate primitive inputs | domain values | no interactions |
| `src/application/repositories/contracts/AutoRoleConfigRepository.js`; `AutoRoleRuleRepository.js`; `AutoRoleAuditRepository.js`; `MemberRoleGateway.js`; `MemberAutomationJobRepository.js`; `MemberAutomationOperationRepository.js`; `InteractionSessionRepository.js`; `CommandCatalog.js` | Ports | storage/provider/catalog/session contracts | primitives/entities | adapter independence |
| `src/application/services/AutoRoleRuleService.js`; `AutoRoleService.js`; `AutoRoleScanService.js`; `MemberAutomationOrchestrator.js`; `CommandHelpService.js` | Application | CRUD/evaluate/apply/scan/coordinate/help | injected ports/policies | pure use cases |
| `src/infrastructure/database/repositories/SqliteAutoRoleConfigRepository.js`; `SqliteAutoRoleRuleRepository.js`; `SqliteAutoRoleAuditRepository.js`; `SqliteMemberAutomationJobRepository.js`; `SqliteMemberAutomationOperationRepository.js`; `SqliteInteractionSessionRepository.js` | Infrastructure | SQLite adapters | AutoNameDatabase connection | v2 persistence |
| `src/infrastructure/providers/discord/DiscordMemberRoleGateway.js` | Infrastructure | fresh facts, paged members, role add/remove/refetch | discord.js client | provider boundary |
| `src/infrastructure/workers/InProcessMemberAutomationWorker.js` | Infrastructure | lease/heartbeat/bounded job execution | job port/services/timers | same-host Phase 1 |
| `src/infrastructure/commandCatalog/RegistryCommandCatalog.js` | Infrastructure | registry -> help entries | CommandRegistry | help source |
| `src/interfaces/discord/commands/manifest.js` | Composition manifest | one command list plus metadata | command modules | eliminate duplicate lists |
| `src/interfaces/discord/commands/admin/auto-role/command.js`; `handler.js`; `components.js` | Interface | autorole metadata/thin handler/session UI | services/presenters/discord.js | command group |
| `src/interfaces/discord/commands/utility/help/command.js`; `handler.js`; `components.js` | Interface | help command/navigation | help service/presenter | help UX |
| `src/interfaces/discord/presenters/EmbedPresenter.js`; `AutoNamePresenter.js`; `AutoRolePresenter.js`; `HelpPresenter.js` | Interface | result DTO -> embeds/components | discord.js builders | no embeds in services |
| `src/interfaces/discord/adapters/HelpComponentAdapter.js`; `AutoRoleComponentAdapter.js` | Interface | validate custom ID/guild/owner/expiry | session repo/services | safe components |
| `src/core/registry/ComponentRegistry.js`; `src/core/pipeline/ComponentRouter.js` | Core | register/route components | adapters/responder/logger | keep event thin |
| `docs/adr/member-automation-coordination.md`; `docs/adr/member-automation-jobs.md`; `docs/adr/command-metadata.md` | Docs | decisions/alternatives/risks | plan evidence | durable ADRs |
| `test/member-automation/domain.test.js`; `repositories.test.js`; `services.test.js`; `orchestrator-events.test.js`; `scan-worker.test.js`; `commands-components.test.js`; `test/command-help/catalog-service.test.js`; `presenters.test.js`; `navigation.test.js`; `test/member-automation/composition-deploy.test.js` | Tests | deterministic matrix | fakes/temp SQLite | validation |

## 5. Exact Files To Modify

| Exact path | Layer | Responsibility/change | Dependencies | Reason |
|---|---|---|---|---|
| `src/infrastructure/database/AutoNameDatabase.js` | Infrastructure | transactional v1->v2 Member Automation schema | better-sqlite3 | preserve existing DB |
| `src/infrastructure/database/repositories/SqliteAutoNameScanQueue.js` | Infrastructure | adapt Auto Name jobs to shared job port/table | v2 DB | ADR-02 |
| `src/application/services/index.js` | Composition factory | construct new services | injected ports | DI |
| `src/core/bootstrap/Bootstrap.js` | Composition | construct repos/gateways/catalog/worker/routers; lifecycle | client/container | integration |
| `src/core/registry/CommandRegistry.js` | Core | descriptor registration, `list()`, backward-compatible get | manifest | help/catalog |
| `src/interfaces/discord/events/client/interactionCreate.js` | Interface | delegate chat vs component router only | two routers | integration point |
| `src/interfaces/discord/events/member/guildMemberAdd.js`; `guildMemberUpdate.js` | Interface | invoke orchestrator and persisted loop correlation | orchestrator/operation port | coordination |
| `src/interfaces/discord/commands/admin/auto-name/command.js`; `handler.js` | Interface | Administrator default/runtime, presenter results | service/presenter | new security/embed rule |
| `src/scripts/deploy-commands.js` | Script | consume manifest, preserve complete set | manifest | one source; never execute in coding |
| `.env.example` | Config docs | non-secret DB/worker/session limits | none | operations |
| `test/auto-name/commands-events.test.js`; `composition-deploy.test.js`; `test/auto-voice-room/composition-deploy.test.js` | Tests | new admin/manifest/orchestrator regression | fakes | backward compatibility |

These shared files are already dirty: service factory, Bootstrap, deploy script and Auto Voice composition test. Integration owner alone edits them. Do not rewrite Moderation or AutoRoom.

## 6. Database V2, Contracts, Migration And Rollback

Add transactionally to the existing dedicated Auto Name DB:

- `guild_auto_role_configs(guild_id PK,enabled,removal_semantics,created_at,updated_at)`.
- `auto_role_rules(rule_id PK,guild_id,name,enabled,trigger,priority,exclusive_group,conflict_policy DEFAULT SKIP_IF_CONFLICT,stop_on_match,created_by,created_at,updated_at,deleted_at)`; partial `UNIQUE(guild_id,name) WHERE deleted_at IS NULL`; index guild/enabled/trigger/priority.
- Four link tables `auto_role_rule_required_roles`, `excluded_roles`, `target_roles`, `remove_roles`: FK rule cascade and `PRIMARY KEY(rule_id,role_id)`. Store Discord Role IDs only.
- `auto_role_audit_logs(id PK,guild_id,user_id,rule_id,action,role_id,result,actor_id,trace_id,error_code,created_at)`; indexes guild/time and rule/time.
- `member_automation_jobs(job_id PK,guild_id,job_type,status,scope_id,options_json,cursor,total_members,processed_members,success_count,skipped_count,failed_count,retry_count,lease_owner,lease_until,last_error_code,created_by,trace_id,timestamps)`; boolean/count CHECKs; partial unique active index by guild/job_type/scope.
- `member_automation_operations(operation_id PK,guild_id,user_id,source,trace_id,expected_add_json,expected_remove_json,status,expires_at,timestamps)`; index guild/user/expiry.
- `interaction_sessions(session_id PK,session_type,guild_id,owner_id,state_json,status,message_id,expires_at,timestamps)`; index owner/expiry.

Migration v1->v2: stop all bot writers; SQLite backup API; rehearse on a disposable copy; `BEGIN IMMEDIATE`; validate v1; create v2 tables; copy every `auto_name_scan_jobs` row to shared jobs as `AUTO_NAME_SCAN` preserving IDs/status/counts/cursor/lease; switch adapter; validate counts/digests/integrity/foreign keys; stamp v2 last; commit. Keep the old table renamed `auto_name_scan_jobs_v1_backup` for one release or until Host approves removal. Reopen must be idempotent. Any error rolls back.

Rollback: stop workers/processes, preserve failed DB set, restore verified consistent backup with no open handles; never mix/delete WAL/SHM generations. No live migration until Reviewer/Test copy rehearsal and explicit Host approval.

## 7. Auto Role Evaluation, Conflict And Runtime Flows

Rules are loaded by guild/trigger, enabled only, ordered priority descending then ruleId for determinism. Required roles are ALL; any excluded role denies. stopOnMatch stops after the first matched rule. Existing target roles return `ALREADY_ASSIGNED` and never call Discord. Each target is evaluated separately and summarized assigned/existing/failed.

Before each mutation, fresh gateway facts verify: target not bot/owner; bot has ManageRoles; role not managed/everyone; every add/remove role is below bot highest role; rule/config still enabled; target current roles. Commands also require owner/Administrator.

Exclusive policy:

- `SKIP_IF_CONFLICT` default: no group mutation.
- `KEEP_EXISTING`: keep current group role and skip incoming target.
- `REPLACE_LOWER_PRIORITY`: replace only when incoming rule outranks current owning rule.
- `REPLACE_ALL_IN_GROUP`: explicitly approved removal of all other group roles.
- Exclusive rules must have exactly one target role. Never remove outside group or explicit removeRoleIds.

Saga: persist operation -> add desired role -> remove approved old roles -> refetch -> complete/audit. If removal fails after add, try removing newly added role; if compensation fails, mark `PARTIAL_CONFLICT`, audit every role result and enqueue repair. Discord has no true transaction; never report atomic success falsely.

Flows:

- Join: orchestrator loads MEMBER_JOIN rules, evaluates/applies, refetches, then Auto Name if separately enabled.
- Role added: adapter diffs old/new, checks persisted operation correlation, evaluates only affected ROLE_ADDED rules. Bot-caused correlated events are not recursively re-applied; orchestrator already performs Auto Name continuation.
- Manual scan/repair: admin enqueues; worker pages members, filters, processes bounded concurrency, persists progress/retry/status. Handler never loops server members.
- Cache is optimization only; DB rules/jobs/operations and gateway refetch are sources of truth.

### Required Additional Analysis Checklist

1. **Auto Role Rule Evaluation:** enabled trigger match, priority-desc/ruleId order, ALL-required, ANY-excluded, stopOnMatch.
2. **Existing Role Detection:** fresh IDs; existing targets return ALREADY_ASSIGNED without API.
3. **Role Conflict Resolution:** frozen four policies; SKIP_IF_CONFLICT default; immutable change plan.
4. **Role Hierarchy Validation:** bot ManageRoles, non-managed roles, strict bot-role superiority before every step.
5. **Role Event Loop Protection:** persisted correlated operation is truth; optional TTL cache only optimizes.
6. **Bulk Role Scan Strategy:** persistent lease, REST pages, bounded batch/concurrency/retry, handler enqueue only.
7. **Auto Name And Auto Role Coordination:** Application Orchestrator, independent enablement, no service-to-service import.
8. **Shared Member Automation Job Model:** v2 shared table/port, copy-migrate Auto Name jobs, PostgreSQL adapter later.
9. **Embed Presenter Architecture:** interfaces only; application returns result DTOs.
10. **Command Metadata Source Of Truth:** one manifest consumed by registry, deployment and Help catalog.
11. **Help Navigation And Component Routing:** ComponentRegistry/Router plus thin adapters, not logic in interactionCreate.
12. **Help Permission Filtering:** effective permission UX filter; every command handler reauthorizes.
13. **Discord Interaction Timeout Handling:** defer immediately; long work enqueues; component/session expiry is bounded.
14. **Component Session Ownership:** persisted guild+owner+expiry validation on every action.
15. **Pagination Strategy:** stable sorted catalog/rules, bounded page size and clamped previous/next.
16. **Backward Compatibility:** registry keeps name/get execution behavior while descriptors/list are added; exact manifest/deploy regression prevents command loss.
## 8. Commands, Sessions, Embeds And Help

`/autorole` subcommands: setup, rule-create, rule-edit, rule-delete, rule-enable, rule-disable, rule-list, rule-view, scan, scan-status, repair, preview, config. Top-level default Administrator, DM disabled; handler rechecks guild owner OR Administrator and bot ManageRoles.

Create/edit begins with minimal options (name, trigger, first target, priority) then an ephemeral multi-step session: modal for text/numbers; Role Select menus for multiple required/excluded/target/remove IDs; select for conflict policy; buttons confirm/cancel. Session is persisted, owned by invoker+guild, expires (recommended 15 minutes), and critical state is never memory-only.

`/autorole scan rule:<id> missing-only dry-run force`; repair accepts member or rule subset; both enqueue where work may be large.

Manifest descriptor:

```js
{ command, name, category, guildOnly, defaultMemberPermissions,
  requiredBotPermissions, usage, examples, relatedCommands,
  availability, help: { visible, order } }
```

Registry stores descriptors and lists them; deployment and Help consume the same manifest. Backward-compatible command execution uses descriptor.command.execute.

`/help command:<name optional>` is guild-capable and available to all. Home categories: Administration, Moderation, Room, Utility, Member Automation. Detail derives command name/description/subcommands/options from builder JSON plus manifest usage/security/examples/relations/availability. Visibility policy filters by effective user permissions; this is UX only and handlers always reauthorize.

Component custom IDs use bounded `ma:<kind>:<sessionId>:<action>`; adapters validate format, guild, owner, expiry and current admin permission. Help supports category/command selects, home/previous/next/refresh. Pagination clamps bounds. On expiry, action is denied and components are disabled when the interaction/message token is still usable; after process crash visual disable is UNKNOWN but persisted expiry still prevents control.

Presenters alone import EmbedBuilder/components and produce Success, Error, Permission, Config, Rule List/Detail, Preview, Scan Progress/Result, Help Home/Category/Detail. They show trace ID for safe errors but never stack, SQL, token, path or raw error.

## 9. Dependency, DI, Security, Concurrency And Failure Rules

- No application/domain import of discord.js, SQLite, Redis/BullMQ, process/cluster or concrete logger.
- Services receive repositories/gateways/job/session/operation/catalog/clock/id/telemetry by DI.
- Auto Role and Auto Name enable independently. Only orchestrator coordinates.
- Role IDs are validated snowflakes; names are display only.
- Unique/transaction/lease constraints handle same-host shards/processes. Persistent operation records are loop protection source; short cache may optimize but never decide truth.
- Rate limit honors retry-after; retry bounded/classified. Lease loss stops work. Permanent hierarchy/managed-role denial skips/audits.
- Session state JSON and job options use versioned allowlisted schema; no arbitrary executable content.
- Admin default metadata never replaces runtime owner/Admin checks.
- Audit retention, removal semantics, multi-host adapters and missing condition sources gate production features.

## 10. Test Matrix And Validation Commands

Auto Role tests: existing target; partial missing targets; required incomplete; excluded present; managed/equal/higher role; bot/owner; disabled rule; deterministic priority/stopOnMatch; all conflict policies; add/remove partial failure and compensation; audit; dry-run; no duplicate API; loop correlation; join/role-added/manual triggers; Auto Name after required role; lease/resume/multiprocess.

Help/component tests: home; direct autorole detail; general user hides admin; admin sees it; invisible metadata hidden; manifest equals registry/deploy; other user denied; wrong guild/custom ID denied; expiry denied/disabled; pagination bounds; refresh permission recheck; presenter tests without API; no raw error.

Migration tests: pristine v1->v2, populated Auto Name jobs preserved, concurrent opens, rollback injection, malformed fail-closed, idempotent reopen, all rows/counters unchanged.

```powershell
node --test test\member-automation\*.test.js
node --test test\command-help\*.test.js
node --test test\auto-name\*.test.js
node --test test\auto-voice-room\*.test.js
node --test test\moderation\*.test.js
node --test test\startup\*.test.js
node --check src\application\services\AutoRoleService.js
node --check src\application\services\AutoRoleRuleService.js
node --check src\application\services\AutoRoleScanService.js
node --check src\application\services\MemberAutomationOrchestrator.js
node --check src\application\services\CommandHelpService.js
node --check src\infrastructure\providers\discord\DiscordMemberRoleGateway.js
node --check src\interfaces\discord\commands\admin\auto-role\command.js
node --check src\interfaces\discord\commands\utility\help\command.js
node --check src\core\registry\CommandRegistry.js
node --check src\core\pipeline\ComponentRouter.js
node --check src\core\bootstrap\Bootstrap.js
node --check src\scripts\deploy-commands.js
git diff --check
```

Also run `node --check` for every new/modified JS file and boundary grep tests. `npm test` intentionally fails. No deploy/live DB/network in deterministic validation. All new-suite/full-regression results are **UNKNOWN** until Tester runs.

## 11. Ownership And 19 Implementation Phases

Ownership: Coder A owns Auto Role Domain/Application/contracts/unit tests. Coder B owns v2 DB/repos/jobs/operations/sessions/migration tests. Coder C owns Discord gateway, commands/components/presenters/help adapters and interface tests. Integration owner alone owns manifest, registries/routers, service factory, Bootstrap, deploy script and dirty composition tests. Reviewer owns findings only; Tester owns evidence/temp copies only; Merge Agent integrates only after Host approval and never merges main without explicit user authority.

| Phase | Files/steps | Validation / expected result | Rollback point |
|---|---|---|---|
| 1 Inspect Registry/Router/Loader | current core; freeze manifest/router seams | source tests; documented baseline | docs only |
| 2 Auto Name Domain/Contracts | existing files; freeze 53-pass behavior | auto-name domain/service | no change unless admin contract approved |
| 3 Auto Name SQLite | v2 design/migration fixtures | copy migration preserves all v1 | restore fixture |
| 4 Auto Name Services | preserve existing APIs; orchestrator port use | 53 tests remain green | revert coordination hunk |
| 5 Auto Role Domain/Contracts | rule/plan/VO/policy/errors/DTO/ports | pure unit tests | remove new files |
| 6 Auto Role SQLite | v2 tables/repos/audit | temp DB/concurrent/malformed tests | revert adapter; backup |
| 7 Auto Role Services | CRUD/evaluate/saga/scan | isolated service tests | revert services |
| 8 Discord Gateways | nickname regression + role gateway | fake Discord tests | remove role adapter |
| 9 Orchestrator | join/role-added sequence | Auto Role -> Auto Name test | revert orchestrator |
| 10 Auto Name Commands | Administrator/presenters | metadata/handler tests | revert interface hunk |
| 11 Auto Role Commands | group + persistent config UI | command/session tests | remove new command |
| 12 Events/Loop Protection | events + operation correlation | loop/race tests | revert event hunks |
| 13 Shared Bulk Jobs | migrate adapter/worker/job table | lease/resume/allocation tests | DB backup/adapter revert |
| 14 Embed Presenters | four presenters | snapshots/field/security tests | remove presenters |
| 15 Metadata/Help Service | manifest/catalog/domain/service | registry=deploy=help tests | retain old registry API |
| 16 Help Navigation | help/components/router/sessions | owner/expiry/pages tests | unregister help |
| 17 DI/Bootstrap | shared integration files/lifecycle | composition + syntax | revert only integration hunks |
| 18 Unit/Integration Tests | all new and regressions | exact pass counts/exit codes | no runtime effect |
| 19 Diagnostics/Migration/Docs | ADRs, backup rehearsal, runbook | diff/secret/copy validation | restore verified backup |

Order: 1 -> 5 -> 6/7 -> 8 -> 9 -> 10/11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17 -> 18 -> 19, while Phases 2-4 are regression gates. Host approves each dispatch boundary.

## 12. Risks, UNKNOWN And Prohibited Changes

Risks: Discord role operations are non-atomic; partial compensation may fail. Exclusive-group ownership can be ambiguous; enforce one target for exclusive rules. Shared-job migration touches an existing runtime DB and requires stop/backup/rehearsal. Component expiry visual state may outlive process. Manifest migration may drop old commands if incomplete. Help visibility can drift from actual deployed state. Dirty Auto Name/Moderation/AutoRoom integration can be overwritten.

UNKNOWN/decisions: all non-role data sources; live intents/permissions; live deploy/network timeout; guild/member scale; PostgreSQL/Redis; removal policy; audit/session retention; help language/content owner; actual deployed command set; component-token persistence; live migration.

Prohibited: touch/delete current DB/WAL/SHM; role-name identifiers; direct AutoRole->AutoName import/call; application infrastructure imports; in-memory-only critical sessions/counters/jobs; unbounded scans/retries; cache as truth; EmbedBuilder in services/domain/repos; business rules in handlers/events; dependency additions without approval; token/raw errors; deploy; merge main; rewrite AutoRoom/Moderation.

## 13. Definition Of Done And Host Handoff

- Auto Name and Auto Role enable independently; orchestrator coordinates safely.
- Multiple rules/targets, existing detection, hierarchy, priority, exclusion, conflicts, stopOnMatch, repair/audit and loop protection pass.
- Shared scans are persistent, paged, bounded, resumable and multi-process tested.
- Default removal is SKIP_IF_CONFLICT until explicitly changed.
- Embed presentation is outside services.
- Help home/direct detail/categories/pagination/permission filtering/session ownership/expiry read the single manifest/registry truth.
- Owner/Admin rules exist in definitions and handlers; bot permissions are runtime checked.
- DB v2 copy rehearsal preserves all Auto Name rows/jobs and rollback is proven.
- New suites and full regressions pass independently; Reviewer has no blockers; Tester records evidence.
- Live deploy/migration/Discord behavior remains UNKNOWN until separately authorized.
- No main merge/deploy occurs from this plan.

Planner verdict: **READY FOR HOST APPROVE/REJECT**, not ready for Coder dispatch until Host resolves or accepts defaults for removal policy, DB/job migration, Administrator visibility, retention and multi-host scope.
