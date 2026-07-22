# Quality Review Report — Ephemeral Deprecation Fix

Date: 2026-07-21 (Asia/Bangkok)  
Review type: Narrow first review; findings only; production implementation not modified  
Focused fix decision: **APPROVED / NO FINDINGS**  
Full candidate integration: **REJECTED due to pre-existing unrelated HIGH finding**  
Overall release: **NO-GO due to separate global/live gates**

## Focused review outcome

The narrow replacement of deprecated `ephemeral: true` options with `flags: MessageFlags.Ephemeral` is correct for installed discord.js 14.27.0. No BLOCKER, HIGH, MEDIUM, or LOW finding was identified in the two reviewed production files.

The four affected response payloads use the imported SDK symbol, lifecycle branches and call counts are unchanged, `editReply` remains flag-free, and no active deprecated boolean or hardcoded message-flag value exists under `src`.

## Findings

**None for the narrow ephemeral deprecation fix.**

## File-level verification

### `src/interfaces/discord/commands/utility/ping/handler.js`

- **Line 3:** imports `MessageFlags` from the existing `discord.js` dependency; no dependency/version change was made.
- **Line 122:** fresh interaction performs exactly one `deferReply({ flags: MessageFlags.Ephemeral })`.
- **Line 156:** replied-only interaction performs exactly one `followUp({ content, flags: MessageFlags.Ephemeral })`.
- **Line 159:** deferred/final response remains `editReply({ content })`; no visibility flag is incorrectly added after acknowledgement.
- Metric collection, service input, output content, timeout behavior, and branch conditions are unchanged by this narrow remediation.

### `src/interfaces/discord/InteractionResponder.js`

- **Line 1:** imports `MessageFlags` from `discord.js` at the interface boundary.
- **Lines 16-20:** an already replied interaction receives exactly one flags-based ephemeral follow-up.
- **Lines 24-25:** a deferred interaction receives exactly one flag-free edit.
- **Lines 29-32:** a fresh interaction receives exactly one flags-based ephemeral initial reply.
- Unknown-command and command-failure public messages remain unchanged.

## Independent evidence

- Installed API reports `discord.js` version `14.27.0` and `MessageFlags.Ephemeral === 64`.
- Installed discord.js source documents flags-based defer/reply and emits the cited deprecation warning only when the legacy `ephemeral` property is supplied. Installed typings accept `MessageFlags.Ephemeral` for interaction response flags.
- Production search under `src` found exactly four `MessageFlags.Ephemeral` uses and zero active `ephemeral:` options.
- Production search found no `flags: 64` or equivalent hardcoded bit expression. `InteractionRouter.js:62` still contains numeric `64`, but it is the existing diagnostic string-length cap, not a message flag.
- Independent handler matrix passed all four initial states:
  - fresh: one flags-based defer, then one edit;
  - deferred only: one edit;
  - replied only: one flags-based follow-up;
  - deferred and replied: one edit.
- The ping service was invoked exactly once in every handler case.
- Independent responder matrix passed both `unknownCommand` and `commandFailed` across fresh, deferred, replied-only, and deferred-plus-replied states: eight cases, exactly one response method per case.
- Both changed files passed `node --check` and fresh module execution under `node --throw-deprecation` completed without a deprecation failure in the exercised fake interaction paths.
- Manifest and lock remain aligned on `discord.js` `^14.27.0` / `14.27.0`; no dependency drift was introduced.

## Scope assessment

The current contents match the plan's permitted edits: one import and two option-property replacements in each of the two owned files. No active deprecated option remains elsewhere in the production tree.

Exact before/after scope remains **UNKNOWN**, not PASS, because the repository still has no trusted Git baseline and project paths remain untracked. Therefore the claim that only these two files changed cannot be independently established from Git history, although no out-of-scope behavior change was observed in the inspected current snapshot.

## Live status

Connected Discord behavior and live warning absence remain **UNKNOWN / NOT RUN**. Offline/static and deterministic checks support the remediation, but they do not prove that a real connected Client emits no warning or that live ephemeral visibility is correct. No live interaction or deployment was performed by this reviewer.

## Pre-existing unrelated candidate finding

This narrow approval does not close or reclassify the previously reported deployment restore defect:

### HIGH — Restore accepts an arbitrary, insufficiently validated backup file

- **Owner:** Coder B
- **File:** `src/scripts/deploy-commands.js`
- **Line:** 88-109
- **Status:** OPEN; outside the two-file deprecation-fix scope
- **Problem:** Restore accepts an arbitrary resolved path, validates only a top-level array, lacks target application/guild binding and per-command schema validation, and does not preserve the current remote inventory before destructive PUT.
- **Impact:** A stale, wrong-target, tampered, empty, or invalid array can replace the complete target guild command collection.
- **Recommendation:** Retain the prior report requirements for backup-directory containment, versioned target-bound envelopes, per-command validation, current-inventory backup, and target-specific confirmation before full candidate integration.

## Global release blockers — separate

| Severity | Evidence | Blocker |
|---|---|---|
| BLOCKER | `package.json:6` | `npm test` remains a failing placeholder; no persistent trusted test/integration suite exists. |
| BLOCKER | `package.json:5-9` | Lint/typecheck scripts and coverage evidence remain absent. |
| BLOCKER | Git metadata | No trusted baseline exists, so exact diff and ownership compliance cannot be proven. |
| BLOCKER | Live environment | Connected warning capture, Client ready, safe live deploy/restore, and live `/ping` remain UNKNOWN. |

## Approval decision

**The narrow ephemeral deprecation fix is APPROVED with no findings.** It may proceed to integration with respect to this defect only.

**Full candidate integration remains REJECTED** until the pre-existing HIGH restore finding is closed. **Release remains NO-GO** until the separate global and live blockers have objective evidence.
