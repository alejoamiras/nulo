# account-balance-orphans — scope balance rows, purge them with their account

**Tier:** `mid` (see Tier call). **`eli5_mode`:** Artifact.
**Budget:** recon 2 agents (spent) · competing outline + codex/fable dual audit + re-audit to convergence · `/code-review` **medium** · codex fix loop ≤3 rounds.
**Base:** `origin/dev` @ `9103dea0` (includes #485 + #486). **Worktree/branch:** `account-balance-orphans` / `worktree-account-balance-orphans`.
**Owner instruction:** "check if it needs architectural work instead of a monkey-patch" — the architecture-vs-patch ruling is this plan's centerpiece, delegated to the auditors.

## Problem

`TokenBalanceRaw` (`token-balance/spec.ts:30-38`) carries no `profileId`, `chainId`, or `contract`. Recon traced every account-removal path (`recon.md`): chain purge and profile deletion already cascade balances correctly; **`AccountService.reconcileImportedAccounts` (`account/service.ts:785-797`) is the sole orphan producer** — it deletes only the Account row and emits `onAccountDeleted`, which no balance code subscribes to (`token-balance/service.ts:131-136`).

Reachable in one restore: a backup with an imported Account row but no key row gets balance rows written (`useFullBackupImport.ts:864-898`), then the account dropped at finalize (`:909-918`). Re-importing the same key reproduces the same address (`account/service.ts:441-444,705-707`), `onAccountAdded` fires, and #486's `ensurePairsHoldingLock` **skips** the pair — the stale row already occupies `${token}:${account}` (`token-balance/service.ts:282-287`) and isn't even enqueued. The user sees pre-deletion balances until an unscoped self-heal fires (unlock's `refreshBalances(10,…)` `auth.vue:174`, token-detail mount, or manual refresh). Bounded, silent, wrong.

The same schema gap is the root of the family: the un-scopeable deletion (bare-address purge would destroy a sibling profile's rows — shared addresses are deliberately reachable, `recon.md`), #486's manual chain join, the token-map-only cross-profile guard, and the **temporal token-id-reuse residual** #486 filed as "not solvable from this schema."

## Tier call

Blast radius **HIGH** (a required-field schema change on every balance row; every reader in the service + queue + backup path), security **MEDIUM** (a new deletion path + hostile-backup input), irreversibility **LOW** (pre-production: shape changes redefine the launch baseline, zero migrations exist — `CLAUDE.md`, `migrations/index.ts:18,22`), novelty/migration/external **LOW**. 1 HIGH → `mid`, with the dual audit a schema change deserves.

## Architecture & Implementation — Outline A (chosen draft): complete the schema convention

`Account`, `Token`, and `ImportedAccountKey` all carry required `profileId`/`chainId`; the balance row is **the odd one out in its own family**, with no recorded rationale (`recon.md`). The draft extends it rather than patching around it — the owner's standing preference and the direction #486's own docs pointed ("schema-carried incarnation", deferred for scope only).

### 1. Schema

`TokenBalanceRaw` gains **required** `profileId: string`, `chainId: number`, `contract: string` (the paired token's). Required, not optional — the family precedent, and optional fields would force every future reader to null-check, forfeiting the point.

**The transition is the just-shipped reconcile.** Old live rows fail the stricter read codec → KEEP-but-hidden (`entity_storage.ts:95-142`) → invisible to `getAll()` → `reconcileBalanceRows` (every init + profile switch, `token-balance/service.ts:149,397`) recreates each pair as a fresh canonical row and enqueues its projection. No migration is written (pre-production policy, quoted in `recon.md`).

### 2. Stamping — every write site already holds the values

- `createTokenBalanceHoldingLock` (`token-balance/service.ts:236-261`): receives the full `Token` — copy `profileId`/`chainId`/`contract` onto the literal. Zero new lookups.
- `restore()` (`:537-565`): **overwrite** `profileId` from the already-required param (never trust the blob). `chainId`/`contract` arrive pre-stamped by relink (next bullet); the schema parse enforces presence.
- `relinkRestoredTokenBalances` (`useFullBackupImport.ts:270-335`): already index-pairs old→new tokens and holds each restored token's `chainId`/`contract` in `newTokens`. Stamp both onto the relinked row **from restore-side truth, overwriting anything the hostile blob claims** — the same posture as the existing `token: newId` overwrite. Consequence: **old backups remain fully importable** (fields injected at relink), not degraded to restoreErrors; rows that fail relink drop exactly as today.

### 3. `purgeForAccounts(addresses, profileId)` — the fix itself

New on `TokenBalanceService`, mirroring `TransactionService.purgeForAccounts(addresses, profileId?)` (`transaction/service.ts:301-364`) and `AuthRegistryService`'s (`auth-registry/service.ts:428-449`):

- Deletes rows where `row.account ∈ addresses && row.profileId === profileId` — direct, safe scoping the schema makes possible. Never bare address.
- Joins #486's lock (deletion must not interleave with a creation) and the `invalidatedBalanceIds` fence (an in-flight projection must not resurrect a deleted id), exactly as `purgeForTokens` does (`token-balance/service.ts:459-478`).
- **Called directly and awaited from the restore composable** — `reconcileImportedAccounts` already returns the dropped addresses (`Promise<string[]>`, `account/service.ts:785-797`), and its only caller is `useFullBackupImport.ts:910`. Orchestration from above keeps the dependency arrows clean (`AccountService` is phase 0 and cannot call phase-1 `TokenBalanceService`); this is the coordinator precedent's shape — direct awaited call, events remain no-ops. **Not** an `onAccountDeleted` subscriber: structurally fire-and-forget (`event-handler.ts:47-61`), which is the monkey-patch recon ruled out.

### 4. What the fields retire (same PR, small diffs each)

- `reconcile-pairs.ts`: existing rows count toward a desired pair only on full identity (`profileId`/`chainId`/`contract` match), not numeric id — closing the temporal token-id-reuse residual. A stale row from a dead incarnation stops suppressing repair.
- `getTokenBalances` (`:165-178`) + the queue's `isRowEmittable` (`balance-job-queue.ts:50-56`): filter on row identity against the live token (fail-closed — an identity-mismatched row is never rendered or written), retiring the token-map-only guard as the *sole* defense.
- `backup()` (`:526-535`): direct `row.profileId` filter, dropping the owned-token-ids join.

### 5. Data & control flow (critical path)

Restore finalize: slices restored (balances relink-stamped) → `reconcileImportedAccounts(profileId)` drops keyless imported accounts → **`await tokenBalance.purgeForAccounts(dropped, profileId)`** → activation → the switch-tail reconcile runs as backstop. Live creation: unchanged flow, three more fields on the literal.

### File-level change map

| File | Change |
|---|---|
| `token-balance/spec.ts` | 3 required fields on type + schema |
| `token-balance/service.ts` | stamp at create; `restore()` profileId overwrite; `purgeForAccounts` (lock + fence); identity-based `getTokenBalances` filter; `backup()` simplification |
| `token-balance/balance-job-queue.ts` | `isRowEmittable` → identity check (callback signature change) |
| `token-balance/reconcile-pairs.ts` | identity-keyed existing-row matching |
| `composables/useFullBackupImport.ts` | relink stamps `chainId`/`contract`; awaited `purgeForAccounts` after reconcile |
| tests | unit (spec/service/queue/reconcile-pairs), composition, restore-path, e2e |
| `ARCHITECTURE.md` | balance-row entry updated |

### Trade-offs / alternatives not taken (within A)

- **Deleting identity-mismatched stale rows** in the reconcile: deferred to an Ask — fail-closed filtering makes them invisible; deletion is a separate risk class even when newly safe.
- **Composite storage key** (like Account's `profileId:chainId:address`): rejected — would break `numberAnchor("id")` backup identity and every numeric-id mechanism (allocator, fence, key-identity guard) for marginal gain over field-level scoping.

## Architecture & Implementation — Outline B (competing, for the audit): the point patch

No schema change. `purgeForAccounts(addresses, profileId)` scopes the delete via a token-id join instead: fetch the profile's token ids (`getTokensRaw(profileId)`), delete rows where `row.account ∈ addresses && row.token ∈ profileTokenIds` — safe because token ids are globally unique. Same lock/fence, same composable call site.

- **Wins:** ~40 lines total; no row-shape change; no relink work; no reader churn.
- **Costs:** leaves every workaround in place (the five comment-documented ones in `recon.md`); leaves the temporal-reuse residual open; leaves the re-import reattachment *partially* fixed (purge closes the restore path, but any future account-removal feature re-opens it and must remember the join); the cross-profile guard stays the in-memory token map alone; and the schema decision migrates from "nearly free now" (pre-production baseline) to "a real migration later."
- **Why not chosen as the draft:** it is precisely the monkey-patch the owner asked us to check against. It fixes the one reachable path without touching the gap that produced the family.

## Security & Adversarial Considerations

- **New deletion path.** `purgeForAccounts` is not RPC-exposed (internal + composable-called); scoped `account+profileId`; joins the lock and the invalidation fence. The shared-address hazard is the headline: bare-address deletion destroys a sibling profile's rows — pinned by a test with two profiles sharing an address.
- **Hostile backup input.** The blob can claim any `profileId`/`chainId`/`contract` on balance rows: relink and `restore()` **overwrite from restore-side truth** (the restored token, the threaded profileId) — the same posture as the existing `token: newId` overwrite. A test feeds a blob with forged scoping fields and asserts the stored rows carry the derived values.
- **Old-shape rows** (live storage, dev installs): codec-hidden, auto-repaired by the reconcile; hidden bytes are inert debris (never rendered, physical keys still block id reuse). Whether to raw-sweep them is an Ask.
- **Fail-closed rendering.** Identity-mismatched rows (stale incarnation, foreign profile) are filtered out of `getTokenBalances` and `isRowEmittable` — the failure mode is a missing row (repaired by the reconcile), never a wrong one rendered.
- **No new RPC surface, no new deps, no key material.** `footprint-coverage.test.ts` governs migrations only; `TOKEN_BALANCE` registry entry anchors on `id`, unaffected (`recon.md`).

## Assumptions

### Facts (verified at `9103dea0`)

1. No standalone delete-account RPC exists; the three removal paths and their cascade outcomes are as tabled in `recon.md` (chain purge cascades via tokens; profile deletion via the coordinator's `purgeForTokens`, `coordinator.ts:121`; `reconcileImportedAccounts` orphans).
2. `reconcileImportedAccounts` returns the dropped addresses (`account/service.ts:785-797`) and has exactly one caller (`useFullBackupImport.ts:910`).
3. No balance-layer code subscribes to `onAccountDeleted`; subscribers are AuthRegistry/Transaction/IncomingTransfer only (`recon.md` search trail).
4. `EventHandler.invoke` dispatches async subscribers un-awaited (`event-handler.ts:47-61`); the coordinator compensates with direct awaited calls in dependency order (`coordinator.ts:109-131`).
5. Two profiles can share an address by design: mnemonic-only derivation (`derive-account-seed.ts:25-31`), soft duplicate-wallet guard (`profile/service.ts:1917-1928`), per-profile imported-key rows (`imported-keys-repository.ts:26-35`); `transaction/service.ts:305-310` documents the address-only-deletion hazard verbatim.
6. Pre-production migrations policy is in force: `realMigrations = []` (`migrations/index.ts:18,22`); CLAUDE.md: shape changes redefine the launch baseline.
7. `TokenBalanceRawSchema` is a plain `z.object` (`spec.ts:41-57`); a failed parse is KEEP-but-hidden (`entity_storage.ts:95-142`), and #486's reconcile recreates hidden pairs on every init/switch (`token-balance/service.ts:149,312-348,397`).
8. Both write sites hold the needed values: `createTokenBalanceHoldingLock` receives the full `Token`; `restore()` already requires `profileId` (`token-balance/service.ts:236,537-546`).
9. `relinkRestoredTokenBalances` index-pairs old→new tokens, already tracks per-token `chainId`, holds `contract` on `newTokens`, and drops un-relinkable rows with bounded diagnostics (`useFullBackupImport.ts:270-335`).
10. Backup surface: no version bump needed (`CURRENT_BACKUP_SCHEMA_VERSION` derives from `realMigrations`, `backup-migrator.ts:74`); compat-epoch is key-derivation-only; registry entry anchors on `id` (`backup-migration-registry.ts:205`).
11. `purgeForTokens` is the existing deletion shape to mirror: lock + `invalidatedBalanceIds` + typed & raw passes (`token-balance/service.ts:459-478`).
12. UI consumes only projected `TokenBalanceInfo`; no reader of the raw shape exists outside the service module + backup registry (repo-wide grep, `recon.md`).
13. The stale-reattachment exposure is bounded by three unscoped self-heals (unlock ≥10-min refresh `auth.vue:174`; token-detail mount; manual refresh) — real but not permanent.

### Inferences (attack these)

1. **Required fields + reconcile auto-repair is a safe transition** for live dev installs — the only cost is one-time hidden debris and a re-projection pass. Unproven against a store with many rows.
2. **Relink stamping keeps old backups fully importable** — fields injected in-memory before `restore()` parses. Assumes the composable's service-loop ordering (tokens → relink → balances) holds for every import path, including the one that skips relink if any.
3. **Identity-filtering `isRowEmittable` and `getTokenBalances` breaks no existing consumer** — anything visible today has a live token in the map, which now also matches identity. The edge: rows created before the schema change are hidden anyway (Inference 1), so no NEW visibility loss.
4. **The crash window between `reconcileImportedAccounts`' row delete and the awaited purge is an acceptable residual** — a crash mid-finalize lands in the restore-pending machinery, and the next unlock's reconcile + fail-closed filters make the orphan invisible (though its bytes persist).

### Asks — routed to the auditors, not the owner

1. **A vs B** — is the schema extension justified, or is the point patch right? (The owner's instruction: check whether architectural work is warranted. The draft says yes.)
2. **Field set** — `profileId`+`chainId`+`contract`, or a subset? `contract` is what closes the temporal-reuse residual; `chainId` is derivable from the token but retires the manual joins.
3. **Stale-row deletion** — with identity now on rows, deleting provably-stale rows (identity mismatch vs the live token at that id, same profileId) becomes safe. Include a scoped cleanup in the reconcile, or keep create-only + fail-closed filtering and leave debris?
4. **Old-shape debris raw-sweep** — sweep codec-hidden pre-schema rows once, or leave them (physical keys still guard id reuse)?
5. **Crash-window ordering** — accept Inference 4, or split `reconcileImportedAccounts` into list→purge-balances→delete-rows so dependents die first (the coordinator's ordering rationale)?
6. **Tier confirm** — `mid`?

## Phases

*(gates use the Bun-runtime test script: `bun run --cwd apps/extension test <path>`)*

### Phase 1 — Schema + stamping + transition proof
Fields on type+schema; stamp at create and restore (profileId overwrite); relink stamping with hostile-field overwrite test; unit tests: old-shape row is hidden and the reconcile recreates its pair (the transition test); forged-blob scoping fields are overwritten.

**Gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension test src/wallet/services/token-balance/` — exit 0; transition + forged-blob tests green.

### Phase 2 — Retire the workarounds
Identity-keyed `reconcile-pairs`; identity filters in `getTokenBalances` + `isRowEmittable` (queue callback change); `backup()` simplification. Tests: temporal-reuse case (stale row from dead incarnation no longer suppresses repair AND is not rendered); two-profiles-shared-address visibility isolation.

**Gate.** Phase 1 commands plus `bun run --cwd apps/extension test src/wallet/services/` — exit 0.

### Phase 3 — `purgeForAccounts` + composable wiring
The purge (lock + fence, typed + raw passes per `purgeForTokens`); composable awaits it with `reconcileImportedAccounts`' return. Tests: purge scoped by profileId spares the sibling profile's rows at the same address (the headline pin); purge racing a parked creation (lock serialization); composition test driving the real service graph through a doctored restore.

**Gate.** Phase 2 commands; the sibling-profile test verified RED against a bare-address purge implementation.

### Phase 4 — E2E
Doctored full-backup import (imported account present, key slice stripped): assert the account drops AND zero balance rows remain for it; then re-import the key and assert balances start fresh (no stale reattachment). Reuses the import-drivers helpers. Must fail without Phase 3's wiring — record red/green in `lessons/phase-4.md`.

**Gate.** `bun run e2e:agent tests/e2e/<spec>` green + documented pre-fix red.

### Phase 5 — Regression sweep + docs
`bun run audit:vue`; armed source smoke AND unarmed artifact-mode smoke (explicitly — the default command exercises neither, per #485/#486 lessons); `NULO_E2E_PROVERLESS=1 bun run e2e:agent` full suite. `ARCHITECTURE.md` balance-row entry.

**Gate.** All four exit 0.

## Delivery

**Single arc, single PR** → `dev`, plain `gh pr create`. `/code-review` **medium**.
Title (≤93 chars): `fix(balances): profile-scoped rows and an awaited account purge close orphan reattachment`

## Post-implementation

1. **`/code-review medium --fix`** on the net diff; skim; commit separately.
2. **Codex audit** (`/codex xhigh`): net diff + code-review commit summary + this plan + decision ledger + adversarial/security ask + both rules verbatim:
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop**: verify claims against the repo, apply, commit, log in `lessons/`, RESUME the same session with the fix diff; loop until no new material findings; surface after 3 rounds.
4. **Delivery**: only now `gh pr create --base dev`; `gh pr checks --watch` until `quality-status` + `smoke-e2e-status` + `network-e2e-status` green; re-run genuine flakes, fix real breakage, never weaken a gate; update `implementations-plan/index.md`.

**Post-implementation hardening:** no `/harden` — no new trust boundary beyond the internal purge.

## Decision ledger

*(filled from the audits)*

## Audit verdicts

*(pending — codex xhigh + fable leg, dual, on both outlines)*

## Seeds

*(draft — finalized after the approval gate)*

```
/goal All five phases marked ✓ in implementations-plan/account-balance-orphans/plan.md (per-phase headers in the file), each ✓ backed by its gate as written reported passing in the transcript — including Phase 3's sibling-profile RED run and Phase 4's documented pre-fix RED run; per phase LESSONS_FILE=implementations-plan/account-balance-orphans/lessons/phase-N.md printed; /code-review medium --fix applied and committed separately; the codex fix loop converged (resumed pass with no new material findings quoted); a PR against dev exists, created only after convergence, with gh pr view output in the transcript; bun run audit:vue and both smoke modes and NULO_E2E_PROVERLESS=1 bun run e2e:agent all exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/account-balance-orphans forward. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative), git status, git log --oneline -5; PR? gh pr view --json statusCheckRollup. (2) CI waits are fine — prep the next phase meanwhile. (3) No task? Take the next pending plan step; after each edit run bun run lint + bun run --cwd apps/extension test for touched dirs; commit → push. (4) Decision needed? /codex xhigh, decide, act, log the consult in lessons/. Hard limits: never merge, never publish, never expand scope beyond plan.md. (5) Same step failed 5×? Stop; reassess with codex. (6) Phase green = its WRITTEN gate passes; paste result, mark ✓, print LESSONS_FILE, advance. (7) All ✓? /code-review medium --fix → commit separately → codex audit loop until clean → gh pr create --base dev → gh pr checks --watch → wrap-up and stop.
```
