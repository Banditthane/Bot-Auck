# Validation Report — Ephemeral Deprecation Retest

Date: 2026-07-21 (Asia/Bangkok)  
Role: Validation Agent  
Focused verdict: **PASS / READY FOR REVIEWER**  
Overall release verdict: **NO-GO (global/live gates remain)**

No production code was changed by the validator. Only this report was updated. No live Discord interaction was performed.

## Focused result

The narrow deprecation remediation passes. All four previously ephemeral response sites now use the imported `MessageFlags.Ephemeral` symbol:

| File/behavior | Actual option |
|---|---|
| Ping fresh defer | `{ flags: MessageFlags.Ephemeral }` |
| Ping replied follow-up | `{ content, flags: MessageFlags.Ephemeral }` |
| Responder fresh reply | `{ content, flags: MessageFlags.Ephemeral }` |
| Responder replied follow-up | `{ content, flags: MessageFlags.Ephemeral }` |

Repository search found no active `ephemeral:` response option and no `flags: 64` literal under `src`. The unrelated numeric `64` in router diagnostic truncation is not a message flag.

Runtime inspection verified:

```text
discord.js version             : 14.27.0
MessageFlags.Ephemeral value   : 64
source imports symbol          : PASS
hardcoded flag value           : NONE
```

## SDK-backed deprecation checks

Actual Discord.js `ChatInputCommandInteraction` response implementations were invoked against a fake REST transport, without network:

- SDK `deferReply({ flags: MessageFlags.Ephemeral })`: PASS
- SDK `reply({ content, flags: MessageFlags.Ephemeral })`: PASS
- Serialized SDK data flag: 64 for both
- Captured process warnings after event-loop turn: 0
- Deprecated ephemeral warning: NONE

The same SDK calls ran in a separate `node --throw-deprecation` process and exited 0.

Discord.js 14.27.0 source emits the relevant warning only when the `ephemeral` property is present in defer/reply options. No such property remains in the active project response paths.

Live warning status: **UNKNOWN / NOT RUN**. The SDK-backed offline result passes, but no connected Client interaction was available to capture production runtime warnings.

## Ping handler state matrix

| Initial state | Calls | Result |
|---|---|---|
| fresh | one flags-based defer, then one edit | PASS |
| deferred | one edit | PASS |
| replied only | one flags-based follow-up | PASS |
| deferred + replied | one edit | PASS |

- Exactly one initial acknowledgement when fresh: PASS
- No repeated acknowledgement when already acknowledged: PASS
- Ping service called exactly once per case: PASS
- Fresh/replied flag object used imported runtime value: PASS

## InteractionResponder state matrix

Both `unknownCommand()` and `commandFailed()` were tested across all four state combinations (8 cases):

| Initial state | Response |
|---|---|
| fresh | `reply` with `MessageFlags.Ephemeral` |
| deferred | `editReply` |
| replied only | `followUp` with `MessageFlags.Ephemeral` |
| deferred + replied | `followUp` with `MessageFlags.Ephemeral` |

Exact safe public messages remained unchanged. Every case invoked exactly one response method.

## `/ping` metrics regression

The real handler/service integration retained the same diagnostic content and metrics:

```text
Gateway             : 9 ms
REST API            : 15 ms
Round Trip          : 25 ms
CPU                 : 10%
Memory              : 50 MB
Uptime              : 1m 0s
Servers             : 1
Users (memberships) : 1,234
Commands            : 1
discord.js          : v14.27.0
Node.js             : v24.15.0
Status              : Healthy
```

- Lifecycle: flags defer then edit
- Output length: 395
- Code fences: paired
- Content/metric semantics: unchanged

## Syntax/module/dependency regression

| Check | Result |
|---|---|
| `node --check` handler | PASS |
| `node --check` responder | PASS |
| Fresh handler/responder module load | PASS |
| Fresh Bootstrap initialization/start contract | PASS |
| `npm ls --depth=0` | PASS; discord.js 14.27.0 |
| `npm ci --dry-run` | PASS |

## Global gates (separate)

| Check | Result |
|---|---|
| `npm test` | FAIL; placeholder exits 1 |
| `npm run lint` | NOT COVERED; missing script |
| `npm run typecheck` | NOT COVERED; missing script |
| Automated coverage/integration suite | NOT COVERED |
| Trusted Git baseline/exact diff | UNKNOWN |
| Live connected warning capture and `/ping` | UNKNOWN / NOT RUN |

These global/live limitations do not reopen the focused fix but continue to block release approval.

## Commands and actual results

```text
Get-Content <ping handler and InteractionResponder>
  -> inspected current implementation

rg <ephemeral/flags/reply paths under src>
  -> four MessageFlags.Ephemeral sites; no ephemeral boolean or hardcoded flag

node <actual Discord.js SDK defer/reply with fake REST and warning capture>
  -> PASS; warning count 0; serialized flags 64

node --throw-deprecation <same SDK-backed calls>
  -> PASS; exit 0

node <PingHandler four-state matrix>
  -> PASS; exactly-once acknowledgement/service call

node <InteractionResponder unknown/error eight-case matrix>
  -> PASS; exactly one response each

node <real PingHandler/PingService regression>
  -> PASS; output length 395 and content unchanged

node --check <two changed files>
  -> PASS

node <fresh handler/responder/Bootstrap integration>
  -> PASS

npm.cmd test
  -> FAIL exit 1; placeholder

npm.cmd run lint / npm.cmd run typecheck
  -> FAIL; scripts missing

npm.cmd ls --depth=0 / npm.cmd ci --dry-run
  -> PASS
```

## Recommendation

**Focused deprecation fix: READY FOR REVIEWER.** Symbolic flags, warning-free SDK serialization, throw-deprecation execution, response-state matrices, exactly-once behavior, metrics output, syntax, and module integration all pass. **Overall release remains NO-GO** until separate automated test/lint/typecheck, trusted baseline, and controlled live Discord gates are resolved.
