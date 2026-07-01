# Storage migration framework — data-preserving versioned migrator (LIVE path)

**Scope:** the **live** migration path (data transformed on extension update). Backup-import migration is **split out** into its own plan (`storage-migration-backup/`) — the engine's injected-data-source seam lets it plug in later with zero rework. · **Status:** v6 — design locked + all four audit rounds folded; ready to implement. · **Quality bar:** production-grade now, `/harden security` at production-prep.

## 1. Summary

The real production migration mechanism: when a release changes a persisted `chrome.storage.local` record's shape (add / rename / remove a field, restructure), existing users' data is **transformed in place**, never wiped. A single global schema version drives numbered, sequential, pure, defensively-coded, **idempotent** migrations behind a `chrome.*`-free engine. Crash-safe via a durable phase journal + pre-migration backup/restore; a UI barrier (statically proven to cover every direct reader) so pages can't corrupt a migration in flight; fail-closed with a per-migration `breaking` flag driving block-vs-degrade.

**No wipe, no legacy.** In dev everyone reinstalls fresh → the current structure IS v1: fresh installs stamp max and run nothing; the legacy `migrate.ts` is deleted. Forward migrations start at v2, one file at a time.

## 2. Reference studies (`research/`)
- **MetaMask**: one global version, 463 numbered migrations never deleted, pure Migrator + impure `PersistenceManager`, guard-everything discipline, `template.ts`/`types.ts`; never retries.
- **Rabby**: one global integer, narrow-slice named migrations; anti-pattern = swallow-and-advance.

## 3. Locked design decisions

### 3.1 Single global version + narrow-slice, footprint-declaring migrations
One `nulo:schema:version`; numbered sequential; apply where `version > persisted`. **Rejected per-collection vectors.** Each migration declares its footprint so the engine backs up only the touched slice:
```
type Migration = {
  version: number
  description: string
  breaking: boolean           // default true (§3.5)
  reads:  StorageRef[]        // roots + value keys read
  writes: StorageRef[]        // roots + value keys written/deleted
  up(ctx: MigrationContext): Promise<void>
}
```
`ctx.local.rows(root)` / `setRows` / `value` / `setValue` mirror EntityStorage's exact `${root}@${id}` + JSON semantics and **never trigger the read-time malformed-row auto-delete** (`entity_storage.ts:47-60`). **Session storage OUT** (ephemeral, holds the passhash bearer). **Engine keeps an injected data-source abstraction** (so `storage-migration-backup/` plugs in later) but only the **live** chrome.storage adapter is built here.

### 3.2 Pure engine + impure persistence
- **`packages/wallet-core/src/migration/`** (pure, no `chrome.*`/I/O; biome-enforced): `Migration` type, `Migrator` (injected migrations array = test seam; injected data-source/backup/version ports), the crash-safe state machine, idempotency + marker validation.
- **Extension**: the live `MigrationContext` adapter, the backup store, the registry, boot + UI wiring.

### 3.3 Crash-safe state machine (durable phase journal — concrete contract)
Per migration N, strictly ordered so the UI barrier and backup both precede any write:
1. **Set durable `running=N` FIRST** (this is also the UI barrier, §3.6). Resume semantics: on boot, `running=N` with **no valid backup sentinel** ⇒ the crash happened during prep ⇒ safe to (re)start N from clean live state (nothing was written yet).
2. **Write the pre-migration backup** of N's declared footprint as **one atomic `chrome.storage.local.set({...})` whose last key is a `backup:complete` sentinel** describing the payload (a torn/partial backup is never trusted).
3. **Apply N's writes as one batched diff** — a single `set` of all changed rows/values **plus explicit tombstones** for deletes/creates (the port's separate `set`/`remove` are composed into one atomic apply; no per-root incremental commit).
4. **Stamp `version=N`.**
5. **Clear `running` + the backup** (atomic).
On boot with `running=N` + a valid backup ⇒ **restore the backup first** (complete + idempotent), then re-run N. Restore-fail ⇒ fail closed, keep the backup. Per-migration checkpoint: a throw at N keeps `1…N-1` durable. **Idempotency is structurally enforced** — the harness runs **every migration twice** and asserts equality.

### 3.4 Marker validation + fresh/stale decision table
- **No `nulo:schema:version` AND no stale legacy key** ⇒ genuinely fresh ⇒ init at max, run nothing.
- **Valid integer in `0..currentMaxVersion`** ⇒ run migrations `> marker`.
- **Corrupt / out-of-range marker over existing data** ⇒ **FAIL CLOSED** (recovery/reinstall guidance) — never init-at-max-and-skip.
- **New marker absent BUT a stale `nulo:core:storage-version` present** ⇒ non-fresh dev install (the reinstall assumption is violated) ⇒ **FAIL CLOSED** with a loud reinstall/dev-reset message. Never silently remove the stale key (it's the one breadcrumb proving non-fresh).

### 3.5 Fail-closed + `breaking` flag (block-vs-degrade)
Never advance the version on failure (data + backup intact). A **durable retry counter** — stored under its OWN key, **outside** any migration's footprint (so restore can't reset it) and **in the reset/uninstall wipe set** — bounds retries across boots. After K failures:
- **`breaking: true` (default)** ⇒ **block with a recovery path** ("update failed — your funds are safe; export recovery / reinstall").
- **`breaking: false`** ⇒ **boot degraded with a soft warning.**
Never Rabby's swallow-and-advance; never MetaMask's run-on-un-migrated-data; never an infinite silent loop.

### 3.6 UI barrier + static coverage ban (close the read race)
The durable `running` marker (§3.3 step 1) is the cross-context barrier. A **migration-aware storage facade** wraps every `chrome.storage.local` access; if `running` is set, callers get a brief **"Updating…"** state and block until it clears. **Coverage is statically enforced**, not just tested: a biome `noRestrictedGlobals`/`noRestrictedImports` rule bans raw `chrome.storage.local` outside the facade + the migration adapter, with an explicit allowlist. Every current direct reader is routed through the facade — the full set includes `stores/app.store.ts`, `composables/syncedRef.js`, `BalanceView.vue`, `FeeSettingsCard.vue`, `settings/fpcs/index.vue`, `new-profile-helpers.ts`, `NewAccountPopup.vue`, `utils/lastActiveProfile.ts`, `utils/core.ts`, `wallet/config/store.ts`. The barrier engages ONLY on the rare boot after an update that ships a migration. **Deferred (separate initiative):** routing all UI storage through the SW is the cleaner long-term end-state; the facade is the seam it will slot into.

### 3.7 Crypto/KDF is NOT auto-migratable (documented limit)
The secret is encrypted under a password-derived key; the migrator runs at boot **pre-unlock** — no password, can't re-encrypt. Vector/KDF rotation is **re-encrypt-on-next-unlock OR a documented reset**, never a boot migration. **`wallet-crypto/README.md:37` + `extension/README.md:82` are rewritten in Phase 2** (co-located with the `migrate.ts` deletion) to say exactly this.

### 3.8 Boot wiring + legacy deletion
Migrator runs **before `config.load()`** (pulled OUT of the `runtime.ts:96-101` `Promise.all`, not serialized behind BB init; the migrator needs neither). Delete `migrate.ts` + its v2–v8 changelog + the stray `BalanceView.vue:198` key-rename (switch its caller to `loadBalanceDisplayOption`, fixing the pre-existing falsy-value crash). Add `@nulo/wallet-core/migration` to `wallet-core/package.json` `exports`.

### 3.9 Proof: seam + build-time-excluded fixture + smoke e2es
Engine's injected migrations array = unit seam. The e2e fixture migration is **build-time excluded** via the repo's proven pattern: a static-false constant conditional spread (`const migrations = [...real, ...(E2E_FIXTURE ? [fixture] : [])]`, `E2E_FIXTURE` a build-time-false const so DCE strips it), plus its marker added to the negative bundle-grep in `.github/workflows/_build-extension.yml:79` (precedent `chrome-storage-proof-gate.ts:37-43`). A writable storage flag gates *firing*, not *shipping* — not used.

## 4. Competing outline (rejected)
Per-collection version vectors — rejected (§3.1); single-global's safety is load-bearing on PXE/session staying out of scope (flagged).

## 5. Phases (each gated)

### Phase 1 — Engine (`wallet-core`, pure) ✓ COMPLETE
`Migration` type (+ `breaking`, footprint), `Migrator` with the §3.3 journal (running-first, atomic-backup+sentinel, batched-diff+tombstones, stamp, clear; restore-before-retry; resume-on-prep-crash), fail-closed + durable bounded-retry (§3.5), marker validation + decision table (§3.4), injected data-source/backup/version ports, run-twice idempotency harness.
**Gate** — `bun run --cwd packages/wallet-core typecheck && bun run --cwd packages/wallet-core test src/migration && bun run lint`. Pass: apply-in-order · per-migration checkpoint · throw-at-N keeps 1…N-1 · backup→restore→**retry-forward-succeeds** · restore-failure fails-closed-keeps-backup · resume-on-prep-crash · batched-diff apply + tombstone restore · **every migration twice ≡ once** · marker decision table (fresh / valid / corrupt-fail-closed / stale-fail-closed) · retry-counter durable + outside footprint · injected seam + injected data-source exercised. Biome: no `chrome.*` in `src/migration/`. Layers: typecheck·lint·unit.

### Phase 2 — Extension adapter + boot wiring + legacy deletion + crypto docs ✓ COMPLETE
Live `MigrationContext` (EntityStorage `${root}@` parity, no read-time row-delete); backup store (atomic `set`+sentinel; in reset/wipe set); registry (baseline, `template.ts`, `types.ts`); wire before `config.load()`; delete `migrate.ts` + BalanceView stray; stale/corrupt marker fail-closed UX; retry-counter key in the reset set; package `exports`; **rewrite `wallet-crypto/README.md:37` + `extension/README.md:82`** (§3.7).
**Gate** — `bun run audit:vue`. Pass: fresh-install init-at-max runs nothing; migrator before `config.load()`; stale/corrupt marker fails closed (loud, not silent); backup is one atomic `set`+sentinel; `ctx.local.rows(root)` ≡ `EntityStorage.getAll()` incl. NOT deleting malformed rows; BalanceView caller switched; no orphan `runStorageMigration`. Layers: typecheck·lint·unit·component·build.

### Phase 3 — UI barrier + static facade ban + fail/degrade UX
The migration-aware storage facade routing **every** direct reader (§3.6 list); the biome static ban proving no raw `chrome.storage.local` outside the facade/adapter (+ allowlist); the "Updating…" state; bounded-retry → `breaking`-driven block-with-recovery vs boot-degraded-with-warning.
**Gate** — `bun run lint && bun run test:components && bun run audit:vue`. Pass: **the static ban fails the build on a raw `chrome.storage.local` outside the facade** (add a deliberate violation in a test fixture, assert lint errors, revert); component tests — set `running` shows "Updating…" + blocks reads; a `breaking` failure renders recovery; an additive failure boots degraded. Layers: typecheck·lint·unit·component·build.

### Phase 4 — Proof: seam + fixture + smoke e2es
Build-time-excluded fixture (§3.9) + **four** smoke e2es hitting the real boot path.
**Gate** — `bun run test:e2e` (selectors by `data-testid` only). Pass: (1) fixture transforms seeded live rows + checkpoints; (2) throwing fixture ⇒ version unadvanced + backup restored + **next-boot retry with a fixed fixture completes + clears backup**; (3) **popup opened mid-migration** shows "Updating…" + no old-shape write-back; (4) **SW killed at each journal kill-point** (running-before-backup, backup-before-write, stamp-before-clear, restore-partial-fail) ⇒ next boot converges correctly. Negative bundle-grep proves the fixture marker absent from `dist/`. Layers: smoke e2e (+ prior green).

### Phase 5 — Docs + network e2e
ARCHITECTURE.md §5 (framework + worked `template.ts` example) + §3 (journal now `local`); `apps/extension/README.md` + `packages/wallet-core/README.md`; supersede M4.7 in `M4/DECISIONS.md`; update `implementations-plan/index.md`; add a pointer to the `storage-migration-backup/` follow-up. Network e2e: cold-boot + register/sync post-migration.
**Gate** — `bun run e2e:agent` && `bun run audit:vue`. Pass: cold-boot + register/sync round-trip; docs reflect live behavior. Layers: network e2e · full audit gate.

## 6. Security & Adversarial Considerations
- **Untrusted persisted state**: every `up()` Zod-validates its slice + guards; marker range-validated + fail-closed (§3.4).
- **Backup secret handling**: backup holds encrypted profile secrets (ciphertext already at rest; passhash bearer is session-only, never backed up — `profile/spec.ts:18-35`). Retention = **clear-after-success only** (no keep-last-N); backup + retry-counter keys in the reset/uninstall wipe set.
- **Crash-safety**: running-first barrier, atomic backup+sentinel, batched-diff+tombstones, restore-before-retry (§3.3).
- **Availability**: `breaking`-flag block-vs-degrade avoids bricking (§3.5).
- **Crypto limit**: KDF/vector = re-encrypt-on-unlock-or-reset (§3.7).
- **Race**: statically-enforced facade coverage closes the direct-reader vector (§3.6).
- **Test-seam isolation**: build-time exclusion + negative bundle-grep (§3.9).
- **Least privilege / supply chain**: no new permissions; no new dependency (Zod already in-tree — verify in Phase 1).

## 7. Assumptions
**Facts**: config loads before migration + writes normalized config back (`runtime.ts:96-105`, `config/store.ts:55`); journal now `local` (`operation-journal/service.ts:96`); UI reads `chrome.storage.local` directly across the §3.6 set; passhash session-only; `unlimitedStorage` granted (`manifest.config.ts:39`); EntityStorage `${root}@` + read-time malformed-row delete (`entity_storage.ts:47-63`); wallet-core bans `chrome.*` (biome covers `src/migration/`); `wallet-crypto/README.md:37` points vector changes at the deleted `migrate.ts`; the port exposes separate `set`/`remove` (`storage-port.ts:18-32`).
**Inferences (flagged)**: single-global > per-collection (load-bearing on PXE/session-out); always-backup cheap+safe (`unlimitedStorage`) conditioned on clear-after-success.
**Asks (resolved)**: scope = live chrome.storage JSON (backup split out ✓); PXE + session out; no legacy (reinstall fresh, delete `migrate.ts`); `breaking` default = breaking ✓; proof via seam + build-time-excluded fixture ✓.

## 8. Decision ledger
- **Chosen**: single global version; narrow-slice footprint-declaring migrations; pure wallet-core engine (injected data-source seam) + impure extension persistence; concrete crash-safe journal (running-first barrier, atomic backup+sentinel, batched-diff+tombstones, restore-before-retry, resume-on-prep-crash); fail-closed + durable-bounded-retry + `breaking` block-vs-degrade; statically-enforced facade coverage; marker decision table (fresh / valid / corrupt→fail-closed / stale→fail-closed); crypto = re-encrypt-on-unlock-or-reset; no wipe; build-time-excluded fixture + 4 smoke e2es.
- **Split out** → `storage-migration-backup/`: migrate imported backups forward (the backup is a DIFFERENT representation — per-service arrays + master-key + whole-blob checksum, `export/full.vue:128-141`; needs a service-array↔storage-row mapping, a compat-epoch field SEPARATE from the data version — today they're the same `schema-version !== 2` check at `useFullBackupImport.ts:216` — and checksum-after-migrate). Plugs into the engine's injected-data-source seam.
- **Rejected**: per-collection vectors; whole-state snapshots; wipe/genesis; writable-flag fixture gating; silent stale-key removal; init-at-max on a corrupt marker; run-on-un-migrated-data; swallow-and-advance.
- **Deferred (separate initiative)**: full SW-routing of UI storage.
- **Audit trail**: v1–v3 wipe scrapped (codex+Opus R1/R2 + final pass); v4 data-preserving (codex REJECT / Opus conditional — converged); v5 unified-backup (codex final REJECT — surfaced the backup-representation mismatch + compat conflation); v6 = split live path, all four rounds' foldable findings incorporated. Post-impl `/code-review max --fix` + codex post-impl audit gate the implementation.

## 9. Seeds (finalized, 5-phase live path)

**Recommended — `/goal`** (completion is transcript-observable):
```
/goal All 5 phases marked ✓ in implementations-plan/storage-migration-framework/plan.md (the per-phase headers in the file, not just chat), each ✓ backed by its phase's validation gate (as written in plan.md) reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/storage-migration-framework/lessons/phase-N.md in the transcript; `/code-review max --fix` complete with findings applied and committed separately; codex post-impl audit (xhigh) complete with high/critical findings addressed (especially the crash-safe journal, fail-closed + durable retry-counter, statically-enforced facade coverage, and marker decision-table invariants); `bun run audit:vue`, `bun run test:e2e`, and `bun run e2e:agent` all report exit 0 in the transcript.
```

**Alternative — `/loop 15m`**:
```
/loop 15m Drive implementations-plan/storage-migration-framework forward (the LIVE migration path — backup import is a separate queued plan, out of scope). Never idle waiting for my input. Each firing: (1) reality-check plan.md + lessons/ (authoritative, not chat), `git status`/`git log --oneline -5`, any PR's `gh pr view --json statusCheckRollup` (no --watch). (2) Waiting on CI is fine — confirm it's progressing (`gh run watch <id>` up to 10 min), use the wait to review the diff / prep the next phase. (3) No task in hand? Take the next pending step; after each edit run `bun run lint` + the touched package's tests; commit → push. (4) Stuck or a decision you'd bring to me? `/codex xhigh`, reach a defensible call, act, log it in lessons/phase-N.md — hard limits stay hard (never merge to main/release, publish, or expand scope; do NOT pull in backup-import migration). (5) Same step failed 5×? Reassess with codex. (6) Phase green = its plan.md gate passes (commands + criteria): run it, paste it, mark ✓, file lessons, print LESSONS_FILE=…/phase-N.md, advance. (7) All 5 ✓? `/code-review max --fix` → commit separately → codex post-impl audit → address high/critical → wrap-up → surface and stop. Keep the ASCII checklist visible (plan.md is source of truth).
```
