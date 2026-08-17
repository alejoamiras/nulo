# Arc 9 — quality-first-extractions (Q-01 scoped, Q-02 staged)

[mid] tier of the 2026-08-16 dual-audit **quality** remediation — the two `CONFIRMED` **extraction** findings, each deliberately SCOPED to its smallest-safe-first-step (per verified.md). **Zero behavior change.** Dual audit (codex + fable) over the complete arc diff at the end; bounded loop.

Source of truth: `audit/quality/2026-08-16-extension-mid/findings/verified.md` (Q-01, Q-02 both `CONFIRMED`).

Anchors are CURRENT (verified by 2 parallel recon agents against `dev@09b7ae1f`; audit numbers drifted — Arc 5 `#391` reshaped the PXE file, Arc 6 the backup composable).

## Governing discipline
- These are the highest-risk changes of the remediation (a concurrency primitive in `aztec-runtime`; a 557-line security-sensitive restore closure). Smallest-safe-first-step ONLY; the rest of each finding is a documented, codex-agreed follow-up.
- Behavior-preservation net = the existing unit/composition/e2e suites, run green unchanged.

---

## Q-01 (scoped) — extract `PxeLifecycleCoordinator` (the purge-epoch fence only)

File: `packages/aztec-runtime/src/pxe/service.ts` (929 lines; `PxeService`).

**Recon correction:** the audit's "3 different `deleteDatabase` policies" is ALREADY half-resolved — Arc 5's `deleteDb` helper (`:774`) unified the 2 destructive teardown sites; only the 2 non-destructive `sweepOrphanStores` inline sites remain, and they are DELIBERATELY a different (best-effort resolve-on-blocked) policy — unifying them would be a behavior change, not a pure extraction. So teardown is NOT the seam.

**The real, high-value seam is the byte-identical purge-epoch fence** — the self-documented "concurrency audit MED #4" recurring bug class. Extract a `PxeLifecycleCoordinator` that owns ONLY the epoch counter + its fence:
- `#epochs: Map<string, number>` (was `chainPurgeEpochs` `:138`)
- `bump(key)` (was `bumpChainPurgeEpoch` `:180-183`)
- `capture(key): number` — synchronous entry read (replaces `withPxeRead:842` + `withPxeWrite:893`)
- `assertUnchanged(key, captured, label)` — the byte-identical throw (replaces `withPxeRead:858-860` + `withPxeWrite:903-905`, killing the MED #4 duplication)

`PxeService` keeps `chainKey`, `clearChainState` (calls `this.lifecycle.bump(key)` ×2 — the B-18 double-bump stays INSIDE the `chainGuard.write` critical section, unchanged ordering), and delegates the op-path capture/assert. **`clearChainState`/`clearProfileState`/`deleteDb`/`sweepOrphanStores` STAY on `PxeService`** — they're coupled to `chainGuards`/`profileBarriers`/`registry` (shared with the op path); moving them is the risky part and is out of this scoped step. `ChainStoreWedgedError`/`inFlightOpens` (opfs-store.ts, B-07) are separate — untouched. `ImportExportCoordinator`: does NOT exist in this file — skipped.

**Behavior-preservation:** `capture`/`assertUnchanged`/`bump` are byte-identical to the inlined code (same `?? 0`, same `!== captured` throw with the same message). The coordinator has NO guard/registry coupling (self-contained epoch counter).

**Test lockstep (recon warning):** `incarnation-fence.test.ts` reaches into `PxeService` privates via `as unknown as` casts — `chainPurgeEpochs` moves to `this.lifecycle`, so those casts update in lockstep (`chainKey`, `withPxeRead`, `withPxeWrite` stay on `PxeService`). Net: `incarnation-fence.test.ts` (epoch bump at both ends, B-18 fence, lifecycle matrix) + `service.test.ts` (deletion honesty) stay green.

---

## Q-02 (staged) — extract `validateAndMigrateBackup` (stage 1 of `restoreBackup`)

File: `apps/extension/src/composables/useFullBackupImport.ts` (the audit's `apps/.../services/backup/` path was wrong — the method is the composable's `restoreBackup()`, `:215-772`, ~557 lines).

Extract ONLY the **validation + migration** stage (`:226-319`) — verified as the zero-closure-state-risk first step: it reads only `fullBackup`/`checksum`/`backup` (+ pure helpers) and the guard refs, writes only `restoreStatus`/`opts.fillError`, and touches NONE of the 11 service clients or the `createdProfileId`/`finalizeStarted`/`importedChainAddress` rollback state (all declared at `:324+`, downstream of the stage).

Extracted signature (async — `getHashHex` + `migrateBackupData` are async):
```
async function validateAndMigrateBackup(fullBackup):
  Promise<{ kind: "ok"; data; backup } | { kind: "rejected"; title; message }>
```
- The stage's 5 inline `restoreStatus="failed"; opts.fillError(...); return` branches become a discriminated `{kind:"rejected", title, message}` the CALLER maps back to `restoreStatus`/`fillError` (the only non-mechanical part; well-precedented, mirrors `BackupMigrationResult`'s shape).
- Preserve verbatim: the user-facing titles ("Incompatible backup", "Backup is too new", "Backup Integrity Check Failed"), the trust-gate ORDER (checksum → compat-epoch → version-range → migration — tests pin checksum-wins-over-epoch), and the composable's OWN version checks (they produce distinct titles the tests pin, NOT the migrator's reasons).
- The re-entrancy + `isAllowedToImportBackup` guard (`:221-224`) STAYS in the caller (not part of the stage). `migrateBackupData` is pure/in-memory/idempotent (no live storage/PXE/secret side effects) — safe to move inside the extracted fn. Only `data` + `backup` escape the stage (feed the rest of restore).

**Test net:** `useFullBackupImport.test.ts:462-536` — the "guards before any writes" block (compat-epoch, legacy blob, malformed version, too-new, tampered checksum, checksum-before-epoch order, migration-failure zero-rollback) + "backup migration wiring" (v1→v2 forward + services see current-shape slices). Must stay green unchanged.

---

## Deferred / documented (codex-agreed deviations — recorded in remediation.md)
- **Q-01 remaining:** the other 4 god-services + the rest of the PXE service split (teardown methods, the #281-D4 incarnation/generation fence, `provisionChainStoreKey`/`assertGenerationCurrent`) — guard/registry-coupled, higher-risk; fast-follow arcs.
- **Q-02 remaining:** the other `restoreBackup` stages (profile/network/account/token restore, the 6-client loop, finalize/relink) — they share the deliberately-hoisted `createdProfileId`/`finalizeStarted`/`importedChainAddress` rollback state; staged follow-ups.
- **Q-04** (composition-root closures, `CONFIRMED`) — NOT in any arc per the remediation plan; an architectural Long-Method extraction (background.ts `initWalletSdkHandler` 375 lines + execution `init()` 200 lines with 25 `= null!` eager fields). Present to the dual audit for an explicit deferral decision; the verified.md pilot (`buildFeeStrategies` / `wireTabLifecycle`) is the recorded entry point.

## Implementation order (lowest-risk first, commit each)
1. Q-02 `validateAndMigrateBackup` (pure-ish stage, well-fenced by tests).
2. Q-01 `PxeLifecycleCoordinator` (concurrency primitive — most care; update the incarnation-fence casts in lockstep).

## Validation
Per finding: affected package typecheck + the finding's colocated + fence/backup tests. Then typecheck:all + lint + affected suites. `NULO_E2E_PROVERLESS=1 e2e:agent` (SOLO) for the PXE teardown/purge canaries after Q-01. audit:vue before PR.

## Dual audit (codex + fable) over complete arc diff — bounded (initial + max 2 resumes)
- **Initial (parallel):** **fable/opus → approve** (both extractions byte-verified md5-identical; sync-capture confirmed; even caught the `chainKey` hoist as behavior-neutral; Q-04 deferral agreed). **codex → reject** on ONE point (Q-01 fully approved): Q-02's extracted async helper adds one promise-reaction turn before the caller's `restoreStatus`/`fillError` continuation (a microtask-scheduling delta) + 2 non-blocking test-strength notes. Q-04 deferral agreed by both.
- **Round-1 fixes → resume: APPROVE (converged).** Documented/accepted the scheduling drift at the call site (codex's offered resolution) — inherent to any function-extraction of an awaited stage, unobservable vs the real crypto/migration awaits, strictly re-entrancy-safe; exported `validateAndMigrateBackup` + 6 exact-title-AND-message pins; strengthened the coordinator test to the complete fence string. Codex verdict (resume 1 of 2): "approve — the documented acceptance resolves my blocking finding; Q-02 does not need to be reverted inline … validator tests now pin the fixed rejection copy and gate precedence … no remaining blocking findings." **Both audit legs approve.**

## Q-04 — documented deferral (both audit legs agreed)
Architectural composition-root Long-Method finding (`background.ts` `initWalletSdkHandler` 375 lines + execution `init()` ~200 lines with 25 `= null!` eager fields). Deliberately NOT arced — dominated by init-ordering hazards + bricks-the-SW blast radius; pulling even a pilot in would violate this arc's smallest-safe-step discipline. Recorded entry point for a future arc: the verified.md pilot (`buildFeeStrategies` / `wireTabLifecycle`).
