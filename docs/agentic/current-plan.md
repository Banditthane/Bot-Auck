# Executable Recovery Plan — TASK-20260722-002

## Status

**PLANNER COMPLETE — AWAITING HOST APPROVAL. ALL EXECUTION RESULTS REMAIN UNKNOWN.**

Baseline inspected: `main` at `d6a926eb7ee2cf42e9ff2e7f1dc8c6a7de5e68ae`.

This is a plan only. The Planner did not open the runtime SQLite database, run migrations, modify WAL/SHM, start the bot, contact Discord, change dependencies, or edit production/business logic.

## Root-cause hierarchy

### Primary startup blocker — verified from repository plus Host evidence

1. `Bootstrap.initialize()` constructs `AutoRoomDatabase` before `app.start()`/Discord ready.
2. `AutoRoomDatabase.migrate()` opens `BEGIN IMMEDIATE`, reads `PRAGMA user_version`, and routes version 4 directly through `_validateV4Schema()`.
3. The v4 validator accepts only `state IN ('reserved', 'channel_created', 'orphaned')`.
4. Host's read-only evidence says the live table has the v5 state CHECK including `cleaning`, while metadata remains `user_version=4` and one `reserved` row exists.
5. The exact error `Database schema v4 reservation state constraint is invalid.` therefore occurs before Discord Client ready. The child reports only `UNKNOWN`, exits, and the manager eventually reports downstream `ShardingReadyTimeout`.

The schema/metadata mismatch is the first deterministic blocker. `ShardingReadyTimeout` is a symptom, not an independent root cause.

### Secondary network issue — separate and intermittent

- `src/Index.js` uses `totalShards: "auto"`; discord.js must call the authenticated gateway-bot REST endpoint to discover the recommended shard count before spawning.
- Host recorded an intermittent `UND_ERR_CONNECT_TIMEOUT` on that discord.js/undici path, while separate public/authenticated diagnostics succeeded and reported one recommended shard.
- This can block manager startup before a child is created, but changing shard selection cannot repair the database and must not be presented as the database fix.
- Current long-term frequency, proxy/VPN interaction, DNS family behavior, and reproducibility under a supported Node LTS runtime are **UNKNOWN**.

### Diagnostic masking — verified from repository

- `src/Shard.js` prints only `error.code ?? error.cause?.code ?? "UNKNOWN"`; schema errors are plain `Error` objects without a code.
- `src/Index.js` sees the manager-level timeout rather than the earlier child root cause and does not retain a sanitized startup-error message from the child.
- Respawn can repeat the failure and add noise while preserving neither a stable root-error code nor a causal summary.

## Scope

### Phase 1 recovery/fix

1. Add a narrowly defined, transactional recognition path for an exact valid-v5 reservation schema whose `user_version` is 4.
2. Preserve every room, grant, guild config, reservation field/state, and counter; metadata repair may raise a lagging counter but never decrement one.
3. Reject every partial, ambiguous, or malformed hybrid without mutation.
4. Add stable startup error codes and bounded sanitized child-to-manager diagnostics.
5. Make shard count explicitly configurable with a validated default of `1`, avoiding the optional recommended-shard REST lookup for this currently one-shard bot.
6. Provide deterministic recovery tests and a controlled copy-first runbook.

### Non-goals/prohibited changes

- No blind deletion, rename, replacement, or direct hand-edit of `.sqlite`, `-wal`, or `-shm` files.
- No dropping reservations, resetting reservation state, lowering/resetting counters, replaying room creation, or deleting orphan/channel records.
- No changes to Auto Voice Room business behavior, command behavior/deployment, OAuth, production guild data, Discord permissions, or moderation work.
- No package/dependency or lockfile upgrade. Node/runtime changes require separate evidence and approval.
- No automatic backup of the live database from general bot startup; operations own backup/restore.
- No live bot start, Discord deployment, or merge to `main` until deterministic/copy validation passes and Host explicitly authorizes it.

## Recovery/migration strategy

### Recommendation: production migration recognizer, not a one-time metadata repair tool

Implement the repair in `AutoRoomDatabase` because:

- the application already owns versioned, transactional, automatic migrations;
- the observed state can be classified exactly as valid v5 schema plus stale v4 metadata;
- all deployed copies that reached this same state need the same deterministic behavior;
- a one-off script would duplicate private validators/migration rules and creates a greater risk of operator stamping an unvalidated database;
- startup must remain fail-closed for any state outside the exact recognizer.

This recommendation does **not** authorize migration of the live file. First prove the code against generated fixtures and a SQLite-consistent backup copy, then obtain Host authorization for controlled startup.

### Exact classifier and transaction order

Refactor reservation validation into structural checks plus an exact state-CHECK classifier. Do not branch by catching or matching an error message.

For `currentVersion === 4`, while holding the existing `BEGIN IMMEDIATE` transaction:

1. Validate all v1/v2 base tables, declared column types/order/nullability, primary key, `(guild_id, room_number)` unique constraint, `room_number >= 1` CHECK, and reservation row constraint validity.
2. Classify the reservation state CHECK as exactly one of:
   - canonical v4: `reserved`, `channel_created`, `orphaned`;
   - canonical v5: the same set plus `cleaning`;
   - invalid/ambiguous.
3. Canonical v4: run the existing table-rebuild v4-to-v5 migration.
4. Exact canonical v5 with metadata 4: validate with the full v5 validator, run only monotonic counter repair, then set `PRAGMA user_version = 5`. Do not rebuild/copy/drop the reservation table.
5. Invalid/ambiguous: throw a stable schema error before any DDL/DML/version change.
6. Commit only after post-repair `_validateV5Schema()` and counter invariants pass. Any failure rolls the complete transaction back.

For `currentVersion === 5`, retain full v5 validation and monotonic counter repair. For versions 0–3, retain their existing migration path and add regression coverage. Versions above 5 remain unsupported and fail closed.

### Data-preservation invariants

Before and after an exact hybrid repair, assert equality of:

- every row and column in `auto_rooms`, `room_grants`, and `auto_room_number_reservations`;
- every guild-config field except `next_room_number` may only increase when below `max(active room number, reserved room number) + 1`;
- reservation IDs, guild IDs, room numbers, timestamps, nullable channel IDs, and states including `cleaning`;
- row counts, primary/unique constraints, foreign keys, and `PRAGMA integrity_check`/`foreign_key_check` results;
- no temporary migration table left behind.

Metadata may change only from 4 to 5 for the exact recognized hybrid. A failed repair preserves version 4, all rows/counters, and schema SQL byte-for-byte as observed through `sqlite_master`.

### Idempotency and concurrency

- First exact-hybrid open performs the metadata repair under `BEGIN IMMEDIATE`.
- Concurrent openers wait under the configured 5000 ms busy timeout; after the first commit they observe version 5 and validate normally.
- Reopen performs no schema rebuild and preserves rows/counters.
- A lock timeout is a safe failure and must never trigger fallback stamping or deletion.
- Tests must use separate SQLite handles/processes and a temporary file, not only `:memory:`.

## Startup diagnostics strategy

### Stable error classification

Introduce a small shared startup-error sanitizer and stable internal codes. Database validation/migration failures use a code such as `AUTO_ROOM_SCHEMA_INVALID`; lock exhaustion uses its sanitized SQLite code; network timeout remains `UND_ERR_CONNECT_TIMEOUT`; unknown errors remain `STARTUP_UNKNOWN`.

Expose only:

- allowlisted/stable code;
- bounded, single-line, control-character-stripped operational message;
- startup phase (`database`, `bootstrap`, `discord-login`, or `shard-manager`) where known.

Never include token, environment values, DB filename, SQL, row content, stack, request headers, authorization data, raw Discord response body, or arbitrary `error.message` from unknown errors.

### Child-to-manager propagation

- `src/Shard.js` sanitizes the root/cause chain, logs one clear child failure, sends a small typed IPC payload to its parent when `process.send` exists, and exits non-zero.
- `src/Index.js` attaches a message listener to each created shard, accepts only the expected typed payload, sanitizes again, and stores the latest startup failure by shard ID.
- When `manager.spawn()` rejects with a downstream ready timeout, the manager output leads with the retained child root (`AUTO_ROOM_SCHEMA_INVALID`) and then names `ShardingReadyTimeout` as downstream.
- If no trusted child payload exists, retain the existing safe manager-level classification.
- Unit tests exercise formatting and IPC handlers without spawning Discord or loading `.env` secrets. Refactor startup entrypoints behind `require.main === module` or injectable functions so importing tests has no side effect.

## Narrow shard/network strategy

### Recommended default

Replace unconditional `totalShards: "auto"` with a validated `SHARD_COUNT` configuration:

- absent -> numeric `1`;
- present -> positive safe integer within a conservative bound defined by the implementation;
- invalid -> fail before manager creation with `SHARD_COUNT_INVALID` and no token output.

Use the numeric value in `ShardingManager`. This removes only the recommended-count preflight implicated in the intermittent timeout. It does not bypass the network required for gateway login and does not claim to solve the database crash or every timeout.

Host evidence reports Discord currently recommends one shard, so default `1` is the least-complex recovery choice. Auto-discovery/retry can be a later separately tested feature if scale requires it. Do not add a custom REST retry loop now: it adds startup delay/complexity and does not help the schema error.

Keep Node `v24.15.0`, discord.js `14.27.0`, and nested undici `6.27.0` unchanged in Phase 1. Whether another Node LTS changes timeout frequency is **UNKNOWN** and should be tested later with a controlled runtime matrix rather than assumed.

## Workstreams and exact ownership

No owner edits outside its list. Workstreams A and B can run in parallel after error-code/payload names are frozen in the approved plan.

### Workstream A — schema classification and preservation (Coder A)

Own:

- `src/infrastructure/database/AutoRoomDatabase.js`
- `src/infrastructure/database/AutoRoomDatabaseError.js` (new, if a typed error is used)
- `test/auto-voice-room/repository.test.js`

Deliver exact-hybrid recognition, stable schema codes, preservation assertions, malformed rejection, concurrency, and idempotency tests. Do not open or copy the live database.

### Workstream B — startup/shard diagnostics and configuration (Coder B)

Own:

- `src/Shard.js`
- `src/Index.js`
- `src/shared/errors/StartupErrorSanitizer.js` (new)
- `.env.example` (only add non-secret `SHARD_COUNT=1` documentation)
- `test/startup/startup-errors.test.js` (new)
- `test/startup/shard-config.test.js` (new)

Deliver side-effect-free test seams, typed/sanitized IPC propagation, numeric shard configuration, and timeout-vs-child-root reporting. Do not alter token validation or contact Discord.

### Workstream C — integration owner

Own no additional production files. Integrate A then B, resolve only contract-name mismatches in the owning branch, and run all deterministic validation. If a shared change becomes necessary, Host must assign it explicitly before editing.

### Reviewer

No production ownership during review. Review transaction boundaries, exact schema classification, counter monotonicity, raw-error leakage, IPC trust boundary, side effects on module import, and separation of schema/network causes.

### Tester

Own test evidence and disposable temp/copy artifacts only. Do not modify source DB/WAL/SHM. Controlled copy validation and live startup are separate gates; live startup requires explicit Host authorization.

## Dependency graph and integration order

```text
Host approves plan and stable error/IPC names
          |                         |
          v                         v
Workstream A: DB recovery      Workstream B: startup diagnostics/config
          |                         |
          +------------+------------+
                       v
             Integrate A then B
                       v
       Generated-fixture deterministic tests
                       v
             Reviewer -> fix loop
                       v
        Tester full regression evidence
                       v
    Stop writers + SQLite-consistent backup
                       v
       Recovery rehearsal on backup copy
                       v
            Host authorization gate
                       v
       Controlled live start (no deploy)
```

## Deterministic test matrix

### Schema/recovery

1. Pristine canonical v4 with all three v4 states -> v5; preserve every field/row and raise counter only when required.
2. Existing canonical v5 -> validate/reopen without rebuild or data change.
3. Exact hybrid: v5 columns/CHECK plus `user_version=4`, including `reserved`, `channel_created`, `orphaned`, and `cleaning` rows across guilds -> metadata 5, every row preserved, counters monotonic.
4. Observed minimal hybrid shape: one `reserved` row and a lagging/non-lagging counter variant.
5. Malformed hybrid variants: missing/extra/reordered/wrong-type columns, wrong nullability/PK/unique/CHECK, additional or missing state, malformed room-number CHECK, constraint-valid schema containing invalid rows, and foreign-key/integrity failure -> fail closed with version/schema/rows/counters unchanged.
6. A v4 schema containing `cleaning` data but without the exact v5 CHECK cannot exist through constraints; any handcrafted ambiguous variant fails without table rebuild.
7. Failure injected before validation, after counter repair, and before version stamp -> whole transaction rolls back.
8. Two handles and multiple processes opening the exact hybrid concurrently -> one repair, remaining opens validate v5; no duplicate columns/temp tables/data loss.
9. Repeated `migrate()` and close/reopen after recovery -> idempotent.
10. Existing v0/v1/v2/v3 migration tests, canonical v4-to-v5 tests, version >5 rejection, reservation fencing, and multi-process allocation remain green.

Use real temporary SQLite files for file/WAL/concurrency cases. Fixtures may create their own WAL/SHM inside OS temp directories and must clean up only those known temp paths.

### Startup/error propagation

1. Plain schema error is converted to stable `AUTO_ROOM_SCHEMA_INVALID` with safe phase/message.
2. Nested cause traversal finds allowlisted codes without serializing the cause object.
3. Token-like text, database paths, SQL, newlines/control characters, long messages, stack, headers, and row content never appear in child log, IPC payload, or manager summary.
4. Unknown errors produce `STARTUP_UNKNOWN` and generic copy.
5. Trusted child IPC plus manager `ShardingReadyTimeout` reports root first and downstream timeout second.
6. Malformed/untrusted IPC payload is ignored safely.
7. `UND_ERR_CONNECT_TIMEOUT` before shard creation retains its distinct network guidance and does not mention schema.
8. Importing `src/Shard.js` and `src/Index.js` under tests does not bootstrap, spawn, read secrets into output, or set failure exit state.
9. `SHARD_COUNT` absent -> number 1; valid value -> that number; zero, negative, fractional, non-numeric, or excessive value -> stable safe failure.
10. Injected fake manager receives numeric `totalShards`; no real REST, child, token, or Discord connection is used.

### Regression

- Full `test/auto-voice-room/*.test.js` passes, including persistence/reservation/reconciliation behavior.
- Startup suites pass independently.
- No command deployment tests or production startup are needed for deterministic gate unless an owned change affects them.

All pass/fail counts and live results are **UNKNOWN** until Tester records them.

## Operational backup, rehearsal, and rollback runbook

These are post-implementation steps for an authorized operator, not actions performed by Planner/Coder.

### Gate 0 — preserve current evidence

1. Record commit, runtime version, configured DB path, file names/sizes/timestamps, and sanitized startup errors. Do not print `.env` values or DB rows.
2. Stop nodemon, ShardingManager, shard children, and every process that can open the database. Verify no bot process remains.
3. Do not delete existing `-wal` or `-shm`; their presence may contain committed pages not yet checkpointed.

### Gate 1 — SQLite-consistent backup

Preferred: use SQLite's online backup API (available through the installed `better-sqlite3`) from the source database to a new timestamped backup file on the same trusted volume while all application writers are stopped. This creates a consistent snapshot that incorporates committed WAL state without manually copying/deleting sidecars.

Requirements:

- destination must not already exist;
- close the backup handle cleanly;
- record SHA-256, byte size, `PRAGMA user_version`, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, table row counts, per-table aggregate digests, and relevant `sqlite_master` SQL digest without logging actual row content;
- retain the untouched source `.sqlite`, `-wal`, and `-shm` files as the rollback set until acceptance.

If the backup API fails, stop. Do not fall back to copying only the main `.sqlite`. A filesystem copy of the database plus WAL/SHM is allowed only as an atomic/coherent set after all writers are stopped and platform-specific consistency is proven; otherwise status is **BLOCKED** pending operator guidance.

### Gate 2 — rehearsal on copy

1. Duplicate the consistent backup to a disposable recovery candidate; never rehearse against the original backup.
2. Capture pre-recovery metadata/digests listed above.
3. Point `AUTO_ROOM_DB_PATH` only to the disposable candidate and invoke the integrated database initialization once.
4. Verify exact transition 4 -> 5, full v5 validation, integrity/foreign-key checks, row/digest equality, allowed monotonic counter behavior, and absence of temp tables.
5. Open the candidate again and prove no second mutation.
6. Run the full deterministic test suite. Any mismatch stops the process; preserve source and backup unchanged.

### Gate 3 — controlled live recovery/startup

Only after Reviewer PASS, Tester PASS, copy rehearsal PASS, and explicit Host authorization:

1. Ensure all bot writers remain stopped and make a fresh SQLite-consistent backup.
2. Start exactly one bot manager with numeric shard count 1 against the live DB. Do not deploy commands.
3. Observe one migration transaction and confirm sanitized log reports schema recovery/validation without row data.
4. Confirm metadata is 5, integrity checks pass, counts/digests match allowed invariants, and bot reaches ready.
5. Stop immediately on any schema, integrity, permission, or repeated-respawn error.

### Rollback

1. Stop all bot processes before restore.
2. Preserve the failed post-recovery database set separately for diagnosis; do not overwrite the last known-good backup.
3. Restore from the verified SQLite-consistent backup using an operator-approved SQLite restore/copy procedure while no handle is open. Never mix a restored main database with WAL/SHM from another generation.
4. Verify checksum, integrity, foreign keys, schema version, and aggregate row digests before any restart.
5. Revert the application candidate to the pre-recovery commit if startup code is implicated.
6. Do not restart until Host approves the rollback evidence.

Rollback cannot undo external Discord actions, but this recovery path must reach database validation before client login and performs no Discord business mutation during migration.

## Risks and mitigations

| Risk | Impact | Required mitigation |
|---|---|---|
| Blindly stamping v5 | Corrupt/partial schema accepted | Exact structural/state classifier plus full v5 validation before stamp |
| Rebuilding an already-v5 table | Row/state loss or unnecessary DDL | Exact hybrid path performs no table rebuild |
| Copying only `.sqlite` with live WAL | Missing committed data/inconsistent backup | Stop writers and use SQLite backup API; never delete sidecars blindly |
| Counter reset/decrement | Duplicate room numbers | Monotonic `MAX(current, active+1, reserved+1)` only |
| Concurrent startup | Double migration/lock errors | Existing `BEGIN IMMEDIATE`, busy timeout, multi-handle/process tests |
| Error output leaks secrets/data | Credential/privacy incident | Allowlist codes, bounded generic messages, sanitizer tests |
| IPC spoof/malformed payload | Misleading diagnostics | Typed shape validation and re-sanitize in manager |
| Fixed shard count hides future scaling need | Capacity issue later | Configurable positive integer; revisit with Discord evidence |
| Assuming shard=1 fixes all network errors | False diagnosis | State explicitly that gateway login still uses network; monitor separately |
| Dependency/runtime change masks issue | Larger unproven blast radius | No upgrades in Phase 1; controlled matrix later |
| Respawn loop during bad schema | Log/process churn | Clear root diagnostic and controlled single-process recovery start |

## UNKNOWN and decision gates

- Cause that originally produced the transactional-looking hybrid state is **UNKNOWN**. The recovery must not infer that it was a normal interrupted current migration.
- Live database integrity, foreign-key result, exact row counts/digests, counter value, and whether any committed pages exist only in WAL are **UNKNOWN** until authorized backup inspection.
- Frequency/root of `UND_ERR_CONNECT_TIMEOUT` and behavior on alternative Node LTS releases are **UNKNOWN**.
- Whether the current host uses a proxy/VPN/custom DNS/IPv6 path is **UNKNOWN**.
- Live startup success after schema recovery is **UNKNOWN**.
- Host must approve: automatic exact-hybrid recognizer; stable error/IPC contract; `SHARD_COUNT` default 1; backup location/retention/access; and controlled live-start window.
- If policy forbids application-led metadata repair even after exact validation, reject this plan and commission a separately reviewed operator tool. Do not partially implement both paths.

## Acceptance criteria

### Coder A

- Exact valid v5-shape/version-4 state transitions transactionally to version 5 without table rebuild or row/field loss.
- Canonical v4 still follows v4-to-v5 rebuild; canonical v5 remains idempotent.
- Malformed/ambiguous hybrids fail before mutation; injected failures roll back schema, metadata, rows, and counters.
- Counter repair is monotonic and accounts for active rooms and every reservation state.
- Required single-handle, reopen, two-handle, and multi-process tests are deterministic and use temp files only.

### Coder B

- Child output and IPC expose stable sanitized root cause; manager preserves root-vs-downstream ordering.
- No secret, DB path/content, SQL, stack, raw unknown error, or environment value is emitted.
- Shard count is numeric/configurable with validated default 1; no discovery/retry/dependency expansion is introduced.
- Modules are importable without startup side effects and tests use fake manager/process/logger boundaries.

### Reviewer

- Confirms exact classifier cannot accept supersets/subsets/reordered malformed constraints or stamp before full validation.
- Confirms transaction/rollback and preservation invariants, WAL-safe runbook, concurrency, and idempotency.
- Confirms error sanitizer/IPC trust boundary and no token/data leakage.
- Confirms network mitigation is narrow and never represented as the database fix.
- Returns PASS or blocking findings with file/line evidence; no live run or merge recommendation without gates.

### Tester

- Records exact commands, exit codes, pass/fail counts, temp paths, runtime, and candidate commit.
- Proves all required fixtures, concurrency/reopen, startup propagation, and secret-leak tests.
- Runs the full Auto Voice Room suite with zero regressions.
- Performs copy rehearsal only against an authorized SQLite-consistent backup and records before/after metadata/digest evidence without row contents.
- Marks live Discord startup **UNKNOWN** unless Host separately authorizes and it is observed.

### Operational acceptance

- Verified backup exists before any live metadata change and rollback has been rehearsed or mechanically validated.
- Live exact hybrid changes only allowed metadata/counter invariants, preserves every data row/field, and validates as v5.
- Bot reaches ready once without a schema respawn loop; any network timeout is reported separately with its real sanitized code.
- No deploy, dependency change, data deletion, WAL/SHM deletion, or main merge occurs.

## Validation commands

Run only on the integrated candidate from repository root. These deterministic commands must not point `AUTO_ROOM_DB_PATH` at production.

```powershell
node --test test\auto-voice-room\repository.test.js
node --test test\startup\startup-errors.test.js
node --test test\startup\shard-config.test.js
node --test test\auto-voice-room\*.test.js
node --test test\startup\*.test.js
node --check src\infrastructure\database\AutoRoomDatabase.js
node --check src\infrastructure\database\AutoRoomDatabaseError.js
node --check src\shared\errors\StartupErrorSanitizer.js
node --check src\Shard.js
node --check src\Index.js
git diff --check
```

If an optional new file is not used (for example `AutoRoomDatabaseError.js`), omit only its corresponding `node --check`. `npm test` is not a valid repository test command because it intentionally exits with an error.

Copy-rehearsal commands must be supplied by Coder/Tester after the exact helper/test seam exists and must include an explicit disposable candidate path plus preflight rejection of the production path. Do not improvise inline SQL against the live database. Do not run `npm run deploy:commands`, start nodemon, or contact Discord during deterministic validation.

## File status and handoff

Planner deliverable only: `docs/agentic/current-plan.md`.

Host should approve or reject this plan. On approval, freeze the error codes/IPC payload and dispatch Workstreams A and B with the exact ownership above. Integrate, review, and test before authorizing any backup-copy rehearsal or live startup. No merge to `main` is authorized by this plan.
