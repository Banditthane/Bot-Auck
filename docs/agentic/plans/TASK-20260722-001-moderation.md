# Execution Plan — TASK-20260722-001 Discord Guild Moderation

## Status and planning boundary

**PLANNER COMPLETE — AWAITING HOST APPROVAL AND USER DECISIONS.**

This document is an implementation plan only. No production code, dependency, Discord command deployment, OAuth setting, production data, or existing Auto Voice Room behavior is changed by the Planner.

Plan baseline requested by Host: `main` at `d0ff4dacedc03ac5d689121d4e50e0df51896f68`.

## Scope

### Recommended Phase 1

Add five independent, guild-level Discord slash commands:

1. `/ban`
2. `/kick`
3. `/unban`
4. `/timeout`
5. `/untimeout`

All five commands are guild-only, acknowledge ephemerally, perform authorization again at runtime, pass a bounded audit reason where Discord supports it, and create secret-free structured application logs.

### Deferred

- `/warn`: defer until warning semantics, persistence, retention, DM behavior, and audit visibility are approved. A notice-only command would be easy to mistake for a durable moderation record.
- Warning/case persistence, warning history, dedicated moderation audit channel, automatic target DMs, localization framework, bulk moderation, scheduled timeout expiry jobs, and OAuth/verification changes.

### Explicit non-goals

- Do not alter `/room`, `AutoRoomService`, `DiscordRoomGateway`, Auto Voice Room repositories, or `/room kick` behavior. `/room kick` only disconnects a user from a managed voice channel. New `/kick` removes a member from the guild and must use a separate command, service, gateway, policy, and tests.
- Do not deploy commands or contact Discord while implementing or validating this task.
- Do not add packages; `discord.js` v14.27.0 and `node:test` already provide the required surface.

## Verified repository findings

- Commands are split into `command.js` metadata and `handler.js` adapters beneath `src/interfaces/discord/commands/`.
- `CommandRegistry` dispatches strictly by top-level `interaction.commandName`; therefore `/kick` and `/room kick` do not collide.
- `Bootstrap.initialize()` creates the Discord client, composes services/gateways, then registers each command once.
- `src/application/services/index.js` exposes a single `services` object resolved by handlers.
- `src/scripts/deploy-commands.js` replaces the entire guild command set and currently includes exactly `/ping`, `/room`, and `/room-setup`; moderation definitions must be added to the same complete set and verified without executing deployment.
- `InteractionRouter` and `InteractionResponder` already contain uncaught failures and emit generic ephemeral responses. Known moderation denials still need explicit user-safe mapping in moderation handlers.
- Logger calls accept structured context, but the concrete logger currently prints only the message. The moderation implementation must still pass sanitized context for compatible/test loggers and must never include tokens, raw exception messages/stacks, message content, or unbounded reasons.
- Existing deterministic tests use `node:test`; `npm test` intentionally exits with an error.
- Installed `discord.js` v14.27.0 uses `deleteMessageSeconds` for bans and documents the supported inclusive range as 0 through 604800 seconds (7 days). Deprecated `deleteMessageDays` must not be used.
- The baseline has no moderation domain, service, gateway contract, provider, persistence, or moderation test directory.

## Proposed exact slash-command schemas

The following is the recommended default schema. Items marked **DECISION REQUIRED** must be approved by Host/user before Coder dispatch; approval of this plan may explicitly constitute approval of these defaults.

| Command | Default member permission | Options in order | Runtime operation |
|---|---|---|---|
| `/ban` | `BanMembers` | `target`: user, required; `reason`: string, optional, max 512; `delete-messages`: string, optional, choices `none=0`, `1-hour=3600`, `6-hours=21600`, `12-hours=43200`, `1-day=86400`, `3-days=259200`, `7-days=604800`, default `0` | `guild.bans.create(targetId, { deleteMessageSeconds, reason })` |
| `/kick` | `KickMembers` | `target`: user, required; `reason`: string, optional, max 512 | resolve current guild member, then guild-member kick with reason |
| `/unban` | `BanMembers` | `user-id`: string, required, min 17/max 20 and runtime `/^\d{17,20}$/`; `reason`: string, optional, max 512 | verify/fetch the guild ban, then remove it with reason |
| `/timeout` | `ModerateMembers` | `target`: user, required; `duration`: string, required, choices `5-minutes=300`, `10-minutes=600`, `1-hour=3600`, `6-hours=21600`, `12-hours=43200`, `1-day=86400`, `3-days=259200`, `7-days=604800`, `14-days=1209600`, `28-days=2419200`; `reason`: string, optional, max 512 | set communication-disabled-until to `now + durationSeconds` |
| `/untimeout` | `ModerateMembers` | `target`: user, required; `reason`: string, optional, max 512 | clear communication-disabled-until |

Every definition must set the least-privilege default member permission above and disable DM use. Guild-scoped deployment is not sufficient by itself: each handler must reject `!interaction.inGuild()` or missing guild/member context before resolving the service.

Use a constant fallback audit reason such as `No reason provided` only if Discord requires/benefits from a reason; otherwise omission may remain `undefined`. In either case normalize whitespace, reject empty-after-trim explicit input, and cap the final value at 512 characters before the provider call. Never append unsanitized user display names or internal error details.

## Permission and hierarchy policy

### Shared checks for target-member commands

For `/ban`, `/kick`, `/timeout`, and `/untimeout`, perform all checks before mutation:

1. Guild context exists.
2. Actor has the command-specific permission (`BanMembers`, `KickMembers`, or `ModerateMembers`) at execution time. `Administrator` may satisfy Discord's permission evaluation, but command visibility alone is never authorization.
3. Bot's effective guild-member permissions include the same required permission.
4. Target resolves to a current guild member. For `/ban`, Phase 1 intentionally uses a user option but requires current membership so actor and bot hierarchy can be proven; banning an arbitrary non-member ID is out of scope.
5. Reject actor targeting self.
6. Reject the bot user/bot guild member as target.
7. Reject the guild owner as target.
8. Unless the actor is the guild owner, require `actor.roles.highest.comparePositionTo(target.roles.highest) > 0`; equal roles deny.
9. Require `botMember.roles.highest.comparePositionTo(target.roles.highest) > 0`; equal roles deny. The bot being guild owner is not assumed.
10. Check the Discord capability relevant to the operation (`target.bannable`, `target.kickable`, or `target.moderatable`) as a final provider-aware guard.

The service/domain policy must return typed denial codes rather than Discord error text. Handlers map codes to concise ephemeral messages; logs record command, guild ID, actor ID, target ID, outcome/denial code, and Discord error code only. IDs are operational identifiers, not secrets, but reasons and user-provided content must not be logged.

### `/unban`

- Actor and bot both require `BanMembers` at runtime.
- Validate the snowflake before any Discord API request.
- Self/bot/owner and role hierarchy checks do not apply to a user who is no longer a guild member; do not invent cached hierarchy.
- Require proof that the ID is currently banned. Map unknown ban to a safe `not currently banned` response and do not call remove.

### Command-specific state checks

- `/timeout`: deny targets already timed out to an equal or later instant only if the product chooses no-op semantics; recommended default is update/extend to the requested duration from execution time and report success.
- `/untimeout`: recommended default is idempotent user-safe denial (`target is not timed out`) with no provider mutation.
- Discord API rejection after policy checks is an operational failure, not authorization success; return generic retry/admin guidance and log only the sanitized Discord code.

## Architecture and dependency direction

Maintain `interfaces -> application -> domain`; infrastructure implements application ports and is injected at composition root.

```text
moderation command metadata + handlers (interfaces)
                 |
                 v
ModerationService + ModerationGateway contract (application)
                 |
                 v
ModerationPolicy / typed moderation errors (domain)

DiscordModerationGateway (infrastructure) --implements--> ModerationGateway
                 ^
                 |
Bootstrap/service factory inject concrete gateway and logger
```

### Proposed boundaries

- `domain/policies/ModerationPolicy.js`: pure decisions over primitive facts (IDs, owner flag, permission booleans, role comparison integers, capability boolean); no discord.js imports.
- `domain/errors/ModerationErrors.js`: typed validation/authorization/state errors with stable codes suitable for handler mapping.
- `application/repositories/contracts/ModerationGateway.js`: abstract port for fetching member/ban facts and performing ban, kick, timeout, untimeout, and unban; no command interaction objects.
- `application/services/ModerationService.js`: validates primitive DTOs, invokes pure policy, calls the gateway, bounds reason/duration/delete seconds, and emits structured result/log outcome. It must not receive `interaction` or format Discord replies.
- `infrastructure/providers/discord/DiscordModerationGateway.js`: converts Discord guild/member objects into primitive facts and performs discord.js mutations. Normalize provider errors to stable codes while retaining sanitized Discord code as cause metadata.
- `interfaces/discord/commands/moderation/<command>/`: definitions parse options and handlers translate interaction context to DTOs, defer once using `MessageFlags.Ephemeral`, resolve `services.moderationService`, and map known codes to safe copy.
- Composition files only wire the new gateway/service/commands; they do not contain policy.

Do not reuse `MemberService` without first changing its contract: it is currently not a moderation use case. A dedicated service/port keeps the new capability out of Auto Voice Room and avoids leaking discord.js objects into inner layers.

## Workstreams and file ownership

Parallel work is safe only after the contracts and DTO/result codes below are frozen. No two owners may edit the same file.

### Workstream A — policy, use case, provider (Coder A)

Own only:

- `src/domain/errors/ModerationErrors.js` (new)
- `src/domain/policies/ModerationPolicy.js` (new)
- `src/application/repositories/contracts/ModerationGateway.js` (new)
- `src/application/services/ModerationService.js` (new)
- `src/infrastructure/providers/discord/DiscordModerationGateway.js` (new)
- `test/moderation/policy-service.test.js` (new)
- `test/moderation/discord-gateway.test.js` (new)

Deliver a short contract fixture/document in test names or exported constants defining service methods (`ban`, `kick`, `unban`, `timeout`, `untimeout`) and stable result/error codes before Workstream B begins.

### Workstream B — Discord command adapters (Coder B)

Own only:

- `src/interfaces/discord/commands/moderation/ban/{command.js,handler.js}` (new)
- `src/interfaces/discord/commands/moderation/kick/{command.js,handler.js}` (new)
- `src/interfaces/discord/commands/moderation/unban/{command.js,handler.js}` (new)
- `src/interfaces/discord/commands/moderation/timeout/{command.js,handler.js}` (new)
- `src/interfaces/discord/commands/moderation/untimeout/{command.js,handler.js}` (new)
- `test/moderation/commands.test.js` (new)

Do not edit service/provider/composition files and do not add `/warn`.

### Workstream C — composition and complete-set deployment metadata (Integration owner only)

Own only:

- `src/application/services/index.js`
- `src/core/bootstrap/Bootstrap.js`
- `src/scripts/deploy-commands.js`
- `test/moderation/composition-deploy.test.js` (new)

Integrate after A and B. Register each new top-level command exactly once, instantiate `DiscordModerationGateway` after the client exists, inject it into `ModerationService`, and extend the complete guild deployment body without executing it.

### Workstream D — independent review and test

- Reviewer owns no production edits during review. Focus on permission bypass, hierarchy sign/equality, owner/self/bot targeting, interaction acknowledgement, error leakage, audit reason bounds, and `/kick` versus `/room kick` isolation.
- Tester owns test evidence only unless Host dispatches a separate fix task. Run targeted and full deterministic suites with no token/network/deployment.

## Dependency graph and integration order

```text
User/Host decision gate
        |
        v
A1: freeze DTOs, error codes, policy, gateway port
        |-----------------------|
        v                       v
A2: service/provider/tests   B: command definitions/handlers/tests
        |                       |
        +-----------+-----------+
                    v
C: service factory + Bootstrap + deploy body + composition tests
                    |
                    v
Reviewer -> fix loop if needed -> Tester -> Host approval
```

Integration order: A contract slice, remaining A and B in parallel, then A before B if contract changed, then C, targeted tests, full Auto Voice Room regression, Reviewer, corrections, independent Tester. No merge to `main` and no command deployment without Host/user authorization.

## Deterministic test strategy

All tests use fakes/stubs and local objects; no REST/gateway connection, token, production database, or clock sleep.

### Command metadata and handlers

- Assert exact names, descriptions, option order/types/required flags/length bounds/choices, DM disabled, and decimal `default_member_permissions` per command.
- Assert `/kick` is a top-level command while `/room` still contains its existing `kick` subcommand unchanged.
- Assert non-guild invocation is rejected before service resolution.
- Assert actor permission denial and missing bot permission denial never invoke mutation.
- Assert each handler defers exactly once with `MessageFlags.Ephemeral`, edits the deferred reply on success/known denial/API failure, and never uses deprecated `ephemeral: true`.
- Assert parsing passes primitive IDs/seconds/reason only; no interaction/member objects enter the service.

### Policy/service matrix for every applicable command

- Success with actor target and bot role positions strictly greater than target.
- Missing actor permission, missing bot permission, self-target, bot-target, guild-owner target, actor lower/equal role, bot lower/equal role, and false bannable/kickable/moderatable capability.
- Malformed/missing ID, empty/overlong reason, unsupported delete-message value, and timeout outside fixed choices/maximum.
- `/unban` malformed ID and not-banned state.
- `/untimeout` target not timed out; `/timeout` extension semantics using an injected/fake clock so the exact resulting timestamp is deterministic.
- Verify no gateway mutation after any validation or policy denial.

### Provider/API failures and logging

- Fake Discord success calls assert exact `deleteMessageSeconds`, reason, target, and timeout timestamp/null.
- Fake rejected promises for missing permission, unknown member/ban, unknown guild, rate limit/server failure, and generic error; assert normalized stable code and sanitized Discord code only.
- Assert responses contain no token, stack, raw exception message, internal object dump, or unexpected identifier.
- Assert structured logs contain command/outcome/guild/actor/target/provider code but omit reason and secrets.

### Composition/deployment and regression

- Service factory creates `ModerationService` from injected gateway/logger.
- Bootstrap creates client before Discord gateway, registers all eight top-level commands exactly once, and preserves `/room` registration.
- Stubbed `deployCommands` submits all eight local commands in deterministic order and still requires `--confirm-replace`; test the body only, never execute network deployment.
- Existing Auto Voice Room suite remains green and the source/metadata snapshot for `/room kick` is unchanged.

## Risks and mitigations

| Risk | Impact | Mitigation/review gate |
|---|---|---|
| Command visibility mistaken for authorization | Unauthorized moderation | Runtime actor and bot checks for every request; denial tests |
| Incorrect role comparison or equality | Moderator can act upward/sideways | Pure policy with lower/equal/greater matrix for actor and bot |
| User option resolves a user but not a current member | Hierarchy cannot be proven | Phase 1 requires current member for target-member commands |
| Bot permission changes between check and mutation | Discord API failure | Treat checks as advisory and map provider rejection safely |
| Unban has no member role hierarchy | False security if hierarchy is invented | Permission plus current-ban proof only; explicitly documented |
| Ban history deletion erases too much | Irrecoverable message deletion | Fixed allowlist, default 0, confirm exact seconds passed |
| Timeout duration overflow/API limit | Invalid or unexpectedly long timeout | Fixed choices capped at 28 days; injected-clock boundary tests |
| Duplicate acknowledge or exposed errors | Broken UX/information leak | One ephemeral defer/edit path and sanitized code mapping |
| Complete-set deployment omits existing command | Existing slash command disappears | Deterministic exact-body test including all old commands; no deployment in task |
| Shared composition conflicts during parallel coding | Lost registration/wiring | Integration owner alone edits three shared files |
| `/kick` confused with `/room kick` | Guild member removed unexpectedly or voice feature regresses | Separate top-level module/service/gateway and explicit regression tests |
| Logger cannot currently render context | Insufficient production audit evidence | Phase 1 supplies structured context to logger contract; dedicated sink/channel remains a decision |

## UNKNOWN decisions and required user decisions

Coding must not begin until Host/user either approves the recommended defaults or supplies replacements:

1. **`/warn` semantics:** recommended defer from Phase 1. Alternatives are notice-only or durable case record; durable warnings require schema, retention, query/delete policy, and audit access design.
2. **Warnings/cases persistence and retention:** not applicable while `/warn` is deferred. No schema change in Phase 1.
3. **Audit destination:** recommended structured application logs only for Phase 1; dedicated channel is later work. Confirm whether this is acceptable given the current logger does not render context.
4. **Target DMs:** recommended do not attempt in Phase 1. If enabled later, moderation success must not depend on DM success and DM failure must be a non-secret secondary outcome.
5. **Timeout UX/bounds:** recommended fixed choices listed above, maximum 28 days, duration measured from provider execution time. Confirm choices and extension/no-op semantics.
6. **Ban message deletion:** installed library proves 0..604800 seconds. Recommended fixed choices listed above with default 0; confirm product-visible labels.
7. **Localization:** recommended English operational copy for Phase 1 because existing replies are mixed English/Thai and no localization framework exists. Confirm English, Thai, or a separately scoped localization design.
8. **Unban input:** recommended raw Discord user ID as required by task. No user lookup/autocomplete or OAuth identity mapping.

No approval is inferred merely from repository structure.

## Acceptance criteria

### Coder

- Implements only the five approved Phase 1 commands and the owned files/boundaries above; no `/warn`, dependencies, OAuth, database, Auto Voice Room, or unrelated refactor.
- Exact approved metadata schemas serialize correctly and commands are guild-only with least-privilege defaults.
- Runtime actor permission, bot permission, owner/self/bot, strict actor/bot hierarchy, current-member capability, input, and state checks all occur before mutation.
- All mutations pass bounded supported values and bounded audit reason where supported.
- Known failures yield typed codes and safe ephemeral replies; unknown failures remain contained by the existing router.
- New deterministic tests cover the full success/denial/invalid/API-failure matrix and `/room kick` separation.

### Reviewer

- Confirms dependency direction and that discord.js objects do not cross into domain/application service DTOs.
- Confirms every bypass and race-of-permission check fails safely, comparisons use strict greater-than, and `/unban` does not claim unavailable hierarchy guarantees.
- Confirms no secret/reason/raw error leakage and no double interaction acknowledgement.
- Confirms command deployment body remains complete and no deployment/data mutation occurred.
- Returns PASS or blocking findings with file/line evidence; no merge recommendation while user decisions remain unresolved.

### Tester

- Runs targeted moderation tests, the entire moderation directory, and the existing Auto Voice Room regression suite.
- Runs syntax checks for every added/modified production JavaScript file.
- Records exact command, pass/fail counts, exit codes, and environment; distinguishes deterministic evidence from live Discord.
- Reports live Discord behavior as **UNKNOWN** unless a separately authorized smoke test actually occurs.

### Product acceptance

- Authorized moderators can perform each approved operation on a strictly lower eligible member (or a currently banned ID for `/unban`).
- Unauthorized, invalid, unsafe-hierarchy, unsafe-target, and inapplicable-state attempts perform no mutation and return user-safe ephemeral feedback.
- Discord failures perform no false-success response and expose no internal details.
- `/room kick` behavior and all existing Auto Voice Room tests remain unchanged.
- No `/warn` behavior is advertised or registered until its semantics are approved.

## Required validation commands

Run from repository root on the integrated candidate. PowerShell path separators match the existing repository evidence.

```powershell
node --test test\moderation\policy-service.test.js
node --test test\moderation\discord-gateway.test.js
node --test test\moderation\commands.test.js
node --test test\moderation\composition-deploy.test.js
node --test test\moderation\*.test.js
node --test test\auto-voice-room\*.test.js
node --check src\application\services\ModerationService.js
node --check src\infrastructure\providers\discord\DiscordModerationGateway.js
node --check src\application\services\index.js
node --check src\core\bootstrap\Bootstrap.js
node --check src\scripts\deploy-commands.js
```

Also run `node --check` once for each new moderation `command.js` and `handler.js`. Do **not** use `npm test` (it intentionally fails), and do **not** run `npm run deploy:commands -- --confirm-replace` during deterministic validation because that contacts Discord and replaces the guild command collection.

## Handoff

Host must approve or reject this plan and explicitly resolve the decision gate before dispatching Coders. If approved: freeze Workstream A contracts, run A/B with the ownership above, integrate through C, then dispatch Reviewer and Tester in order. No deployment or merge to `main` is authorized by this plan.
