# account-balance-orphans — scope balance rows, purge them with their account

**Tier:** `mid` (confirmed by both audit legs). **`eli5_mode`:** Artifact.
**Budget:** recon 2 agents (spent) · competing outline + codex/fable dual audit (spent) + discharge resume · `/code-review` **medium** · codex fix loop ≤3 rounds.
**Base:** `origin/dev` @ `9103dea0` (includes #485 + #486). **Worktree/branch:** `account-balance-orphans` / `worktree-account-balance-orphans`.
**Owner instruction:** "check if it needs architectural work instead of a monkey-patch" — both auditors ruled **architectural (revised Outline A)**; Outline B (the point patch) is recorded in the ledger as rejected.

## Problem

`TokenBalanceRaw` (`token-balance/spec.ts:30-38`) carries no `profileId`, `chainId`, or `contract`. Recon traced every account-removal path (`recon.md`): chain purge and profile deletion cascade balances (chain purge best-effort — see Fact 1); **`AccountService.reconcileImportedAccounts` (`account/service.ts:785-797`) is the sole orphan producer** — it deletes only the Account row and emits `onAccountDeleted`, which no balance code subscribes to (`token-balance/service.ts:131-136`).

Reachable in one restore: a backup with an imported Account row but no key row gets balance rows written (`useFullBackupImport.ts:864-898`), then the account dropped at finalize (`:909-918`). Re-importing the same key reproduces the same address (`account/service.ts:441-444,705-707`), `onAccountAdded` fires, and #486's `ensurePairsHoldingLock` **skips** the pair — the stale row already occupies `${token}:${account}` (`token-balance/service.ts:282-287`) and isn't even enqueued. The user sees pre-deletion balances until a self-heal fires — and the self-heals are user-action-dependent, not time-bounded (Fact 13). Silent, wrong.

The same schema gap is the root of the family: the un-scopeable deletion (bare-address purge would destroy a sibling profile's rows — shared addresses are deliberately reachable; and the SAME profile can hold the same address on two chains, Fact 5), #486's manual chain join, the token-map-only cross-profile guard, and the **temporal token-id-reuse residual** #486 filed as "not solvable from this schema."

## Tier call

Blast radius **HIGH** (a required-field schema change on every balance row; every reader in the service + queue + backup path), security **MEDIUM** (a new deletion path + hostile-backup input), irreversibility **LOW** (pre-production: shape changes redefine the launch baseline, zero migrations exist — `CLAUDE.md`, `migrations/index.ts:21-26`), novelty/migration/external **LOW**. 1 HIGH → `mid`. Both auditors confirmed.

## Architecture — revised Outline A (dual-audit consolidated)

`Account`, `Token`, and `ImportedAccountKey` all carry required `profileId`/`chainId`; the balance row is the odd one out in its own family. The decisive argument (fable §0): `TokenService.updateToken` **hard-rejects** any change to `profileId`/`chainId`/`contract` (`token/service.ts:389-394`) — the triple is the token's immutable natural key, so a stamped copy can only go stale by token *deletion*, which already has its own purge paths (awaited from the profile-deletion coordinator; best-effort on the chain-purge leg — Fact 1).

### 1. Schema

`TokenBalanceRaw` gains **required** `profileId: string`, `chainId: number`, `contract: string` (the paired token's). Required, not optional — optional fields would force every future reader to null-check, forfeiting the point.

**Transition = legacy sweep + the just-shipped reconcile.** Old live rows fail the stricter read codec → KEEP-but-hidden (`entity_storage.ts:95-142`) → invisible to `getAll()`. On init, under the balance lock and before reconciliation, a **one-shot idempotent legacy sweep** deletes rows matching the COMPLETE pre-schema codec — a dedicated legacy predicate mirroring the old `TokenBalanceRawSchema` field-for-field (valid `id`/`token`/`account`/`updatedAt`/balance-field types), all three new fields absent, AND the canonical numeric storage-key identity equal to `raw.id` (`balance-repository.ts:28-35`) — via `repo.purgeMalformed` (snapshot-byte recheck + true-storage-id deletion, `purge-rows.ts:58-83`). Partial-new, otherwise-malformed, and key-mismatched rows are left untouched (they are debris of a different provenance, not provably legacy). Then `reconcileBalanceRows` (every init + profile switch) recreates each active-profile pair as a fresh canonical row. Rationale (codex Ask d, overruling fable's leave-it — see ledger): balance rows are recomputable projections, and hidden debris has a real cost — `allocateUnfencedId` → `nextNumericId` scans **physical keys** including hidden ones, plus a full-namespace `get()` per allocation (`id-allocators.ts:17-36`), so debris taxes every future creation. Other profiles' swept rows are recreated by their own next activation's reconcile. This is a startup baseline cleanup, **not** a numbered migration (pre-production policy).

### 2. One shared identity predicate

New `token-balance/balance-identity.ts`: `rowMatchesToken(row, token)` ⇔ `row.token === token.id && row.profileId === token.profileId && row.chainId === token.chainId && row.contract === token.contract`. The FK equality is part of the predicate — most callers resolve the token via `tokens.get(row.token)` making it implicit, but the shared invariant (especially `backup()`'s join) must not depend on an undocumented caller precondition. **Every raw-row decision goes through it** (codex Inference 3 — the filters must be complete, not decorative):

| Site | Change |
|---|---|
| `reconcile-pairs.ts` | existing rows count toward a desired pair only on full identity — closes the temporal id-reuse residual |
| `ensurePairsHoldingLock` occupancy set (`service.ts:282-287`) | identity-mismatched rows do NOT occupy `${token}:${account}` — else a stale row blocks canonical creation forever (codex High: the reconcile repair "does not work as written" without this) |
| `getTokenBalances` + `getTokenBalance(id)` | fail-closed filter (singular included — it currently returns any decodable row) |
| `refreshTokenBalance` / `requestBalanceRefresh` / `refreshAccountBalances` | don't enqueue identity-mismatched rows |
| `onTokenUpdated` / `onTransactionUpdated` row selection | same |
| `balance-job-queue.isRowEmittable` | signature takes the row; identity check (write-time backstop) |
| `balance-projector.ts` | identity guard before projecting — a foreign row must not trigger PXE/network work (decision recorded: adopt the guard; the predicate is shared and cheap) |
| `backup()` | full-identity join against owned tokens — NOT `row.profileId` alone, which would export identity-mismatched debris |

### 3. Stamping — service-owned, never client-authored

- **Create** (`createTokenBalanceHoldingLock`): receives the full `Token` — copy `profileId`/`chainId`/`contract` onto the literal. Zero new lookups.
- **`restore()` derives all three fields itself** (fable A-2 ≡ codex Inference 2 — unanimous): one `tokenService.getTokensRaw(profileId)` read at the top of the hold (explicit-profileId, no active-profile gate — `token/service.ts:186-190`; `getTokenRaw(id)` would throw pre-activation) → resolve each `tb.token` in the owned map → stamp `{...tb, id, profileId, chainId: token.chainId, contract: token.contract}` with derived fields last → an unowned `token` id becomes a per-row `restoreError` (fail-closed; this also closes the pre-existing hole where `restore()` wrote rows for arbitrary token ids with no ownership check, `service.ts:552-563`). **Pair-level dedup** in the same loop (`seen` set on `(token, account)`, mirroring `AccountService.restore`'s in-batch dedup, `account/service.ts:664-668`): the backup registry rejects duplicate row *ids* only (`backup-migration-registry.ts:281-291`), so a hostile blob can otherwise mint duplicate canonical pairs.
- **`relinkRestoredTokenBalances` does no identity stamping** — its `token: newId` remap and chain-equality cross-check keep their job; its chain authority is corrected to `newTokens[i].chainId` (the parsed persisted token), not the attacker-controlled `oldTokens[i].chainId` (codex Fact 9). No identity stamping in the popup: it would be blob-laundered (`TokenService.restore` parses blob values verbatim except `id`, `token/service.ts:725`) and version-skewed (an import running under an older composable against a newer worker would ship rows without the fields).

### 4. The purge — `purgeForAccounts(scopes, profileId)`, registered, chain-scoped

- **Scope = `(profileId, chainId, address)` tuples, never `(profileId, address)`** (codex Fact 5, verified): the same key imports on multiple chains in one profile (`importAccount` dup check is `(profileId, chainId)`-scoped, `account/service.ts:446-448`; key rows are keyed by the full tuple, `imported-keys-repository.ts:26-36`), and `reconcileImportedAccounts` drops per-`(chainId, address)` row. An address-scoped purge would kill the surviving chain's balances. `reconcileImportedAccounts`' return type changes to scope tuples `{ chainId, address }[]`.
- **Wiring = the registration pattern** (fable A-1; `registerChainPurgeSubscriber` precedent, `account/service.ts:111` / `network/service.ts:736-770`): `TokenBalanceService.init` registers `(profileId, scopes) => this.purgeForAccounts(scopes, profileId)` with `AccountService`. **No new RPC surface** — `Methods`, `defineRpcMethods`, and the client stay untouched (this discharges codex's Medium RPC finding and makes the security claim true instead of false); no client lifecycle (fable C-2 moot); any future removal path routed through the registered purge inherits the cascade (the chain and profile paths keep their own existing cascades — registration is not automatic coverage).
- **Ordering = list → purge → delete, fail-fast** (unanimous; Inference 4 retracted): inside `reconcileImportedAccounts` — list keyless imported accounts (read-only) → await registered purges with the tuple scopes → delete Account rows + emit, **re-checking key absence per row inside the delete pass** — a key that appeared during the awaited purge skips that account — → **return only the scopes actually deleted**, never the candidate list. A crash before purge changes nothing; a crash after purge but before delete leaves a keyless account with no stale balances — the safer direction, repaired by the next reconcile. **The composable's catch-and-continue at `useFullBackupImport.ts:914-917` is removed**: a purge/reconcile failure now escapes to the outer catch, which (pre-`finalizeStarted`) rolls the created profile back (`:987-993`) — import fails wholesale rather than committing with orphans (codex Ask e).
- **Internals**: joins #486's lock and the `invalidatedBalanceIds` fence exactly as `purgeForTokens` (`service.ts:459-478`); typed pass deletes `row.account === address && row.profileId === profileId && row.chainId === chainId`; emit guarded by `this.tokens.has(row.token)` (the imported profile is NOT active at the call site — every row is unmappable, and an unguarded `getTokenBalanceInfo` throws "unknown token"; if built on an abort-on-error helper, one throw abandons the purge — fable C-3, pinned by test); **raw second pass** with the same predicate on raw fields — which **deliberately skips old-shape rows** (no `profileId`/`chainId` = unattributable; they belong to the legacy sweep, not an account purge). Lock scope honesty: the lock + fence serialize against creators and in-flight projections; they do not prevent a brand-new creation *starting after* the purge — acceptable here because account restore emits no add events (`account/service.ts:638-691`) and the profile isn't activated until finalize (documented, per codex).
- Mirror `TransactionService.purgeForAccounts` (`transaction/service.ts:301-364`) for shape; do NOT cite AuthRegistry's — it purges by bare address (fable C-9).

### 5. Stale-row deletion in the reconcile — narrow, criterion-bound

During active-profile reconciliation, **delete + fence** a row iff: `row.profileId` = active profile AND its numeric `token` id resolves to a **live token** AND identity mismatches that token (a dead incarnation's row after id reuse). **Leave** foreign-profile rows and rows whose token id has no live token — the codec-hidden-token case is exactly where deletion would destroy recoverable data (fable's carve-out, honored inside codex's criterion — see ledger). Then create the canonical missing pair.

### File-level change map

| File | Change |
|---|---|
| `token-balance/spec.ts` | 3 required fields on type + schema |
| `token-balance/balance-identity.ts` (new) | the shared predicate |
| `token-balance/service.ts` | stamp at create; restore-side derivation + pair dedup; legacy sweep at init; `purgeForAccounts` (lock + fence, typed + raw passes); identity filters (plural + singular + refresh paths + handlers); `backup()` identity join; stale-row deletion in reconcile; occupancy-set fix; subscriber registration |
| `token-balance/balance-job-queue.ts` | `isRowEmittable` → row-identity check (signature change) |
| `token-balance/balance-projector.ts` | identity guard before projection |
| `token-balance/reconcile-pairs.ts` | identity-keyed existing-row matching |
| `token-balance/balance-repository.ts` | delete dead `existsByTokenAndAccount` (verified: no production caller) |
| `account/service.ts` (+ spec) | `registerAccountPurgeSubscriber`; `reconcileImportedAccounts` → list→purge→delete, returns `{chainId, address}[]` |
| `composables/useFullBackupImport.ts` | reconcile catch removed (fail-fast to rollback); relink chain authority → `newTokens[i].chainId` |
| `utils/full-backup-helpers.ts:206` | **deliberate no-op** — the balance restore-error allowlist stays `[ID]`; `contract` is an address-class field the surrounding doc forbids echoing (recorded so nobody "completes the convention") |
| tests | see phases; plus `cross-profile-isolation.test.ts` (`as`-cast rows red at runtime), `storage-codecs.test.ts:98-111` (`satisfies` — compiler-led), `token-balance/service.test.ts` factory, queue tests' `isRowEmittable` wiring, `useFullBackupImport.test.ts` |
| `ARCHITECTURE.md` | balance-row entry updated |

### Outline B (rejected — ledger)

Token-id-join point patch, no schema change. Both auditors rejected it: leaves every workaround + the temporal-reuse residual in place, re-derives the join at every future scoping site, and moves the schema decision to a moment when it costs a real migration. Recorded strengths: ~40 lines; its raw pass reaches old-shape rows during transition.

## Security & Adversarial Considerations

- **New deletion path.** `purgeForAccounts` is genuinely **not RPC-exposed** — internal, invoked via the registered awaited subscriber (the previous draft's claim was false under composable orchestration — fable C-1 Critical — and is now true by construction). Scoped `(profileId, chainId, address)`; joins the lock + invalidation fence. Two headline hazards, each pinned by a RED-verified test: bare-address deletion (sibling profile, shared address) and address-scoped deletion (same profile, same address, other chain — codex Fact 5).
- **Hostile backup input.** The blob can claim any `profileId`/`chainId`/`contract` on balance rows and any duplicate pairs: `restore()` derives all three fields from the service-side owned-token map and dedupes pairs — nothing identity-bearing survives from the wire. A test feeds forged scoping fields + duplicate pairs and asserts derived values + collapsed pairs + `restoreError`s for unowned tokens.
- **Old-shape rows** (live dev installs): swept at init under the lock via exact-shape predicate + snapshot-byte recheck; recreated per active profile by the reconcile. Failure mode of a partial sweep: leftover hidden debris, retried next init (idempotent).
- **Fail-closed rendering, completely.** One predicate gates list/single reads, refresh enqueues, handler selection, projection, queue writes, and backup export. The failure mode everywhere is a missing row (repaired by the reconcile), never a wrong one rendered or exported.
- **Fail-fast import.** A failed purge/reconcile aborts the import into the existing pre-finalize rollback instead of committing with orphans.
- **No new RPC surface, no new deps, no key material.** `footprint-coverage.test.ts` governs migrations only; the `TOKEN_BALANCE` registry entry anchors on `id`, unaffected.

## Assumptions

### Facts (verified at `9103dea0`; both audits re-verified, corrections applied)

1. Three account-removal paths as tabled in `recon.md`; chain purge is **best-effort, not crash-safe** — `TokenService.clearChainState` emits `onTokenDeleted` un-awaited per token, so a worker death can leave a hidden token-orphan (codex; further supports carrying identity on rows).
2. `reconcileImportedAccounts` returns dropped addresses (`account/service.ts:785-797`); sole caller `useFullBackupImport.ts:910`. It checks key rows per-`(profileId, chainId, address)` and can drop one chain's account while the same address survives on another chain of the same profile.
3. No balance-layer subscriber to `onAccountDeleted`; subscribers are AuthRegistry/Transaction/IncomingTransfer.
4. `EventHandler.invoke` dispatches async subscribers un-awaited (`event-handler.ts:47-61`); the coordinator and the chain-purge **registration pattern** (`account/service.ts:111`, `network/service.ts:736-770`) compensate with direct awaited calls in dependency order.
5. Two profiles can share an address by design (mnemonic-only derivation, `packages/wallet-crypto/src/derive-account-seed.ts:25-31`; soft duplicate-wallet guard; per-profile key rows), **and the same profile can hold the same address on multiple chains** (`account/service.ts:446-448` dup check is chain-scoped; `imported-keys-repository.ts:26-36` full-tuple keys). Purges must be tuple-scoped.
6. Pre-production migrations policy in force: `realMigrations = []` (`migrations/index.ts:21-26`); CLAUDE.md: shape changes redefine the launch baseline.
7. `TokenBalanceRawSchema` is a plain `z.object`; failed parse is KEEP-but-hidden; #486's reconcile recreates hidden pairs **best-effort** (per-row failures caught and skipped, `service.ts:284-296`) on every init/switch.
8. The create path holds the full `Token`; `restore()` holds only the row + threaded `profileId` and must **derive** chain/contract via `getTokensRaw(profileId)` (explicit-profileId, ungated — `token/service.ts:186-190`).
9. `relinkRestoredTokenBalances` index-pairs old→new tokens; its chain map is currently built from the **old** (attacker-controlled) token rows (`useFullBackupImport.ts:293`) — authority must be `newTokens[i]`, the parsed persisted token.
10. Backup surface: no version bump (`CURRENT_BACKUP_SCHEMA_VERSION` derives from `realMigrations`); compat-epoch covers account-contract/KDF generation + password-backup shape, none affected; registry anchors balance identity on numeric `id` (`backup-migration-registry.ts:197-205`); registry normalization rejects duplicate row **ids** only, not duplicate pairs (`:281-291`).
11. `purgeForTokens` is the deletion shape to mirror: one lock hold, typed + raw passes, fence before delete, emit guarded by `this.tokens.has` (`service.ts:459-478`).
12. Raw-shape readers outside the service module + backup registry: `utils/full-backup-helpers.ts:206` (restore-error allowlist `[ID]` — deliberate no-op) and `tests/e2e/fixtures/helpers.ts:1322-1425` (contract→id joins); the projector is an internal raw-row consumer (`balance-projector.ts:51-76`). UI consumes only projected `TokenBalanceInfo`.
13. The stale-reattachment self-heals are **user-action-dependent, not time-bounded**: unlock refresh exists but `refreshBalances` ignores its minutes param and hardcodes 30 (`utils/core.ts:142-165`); token-detail mount and manual refresh require navigation.

### Inferences

1. **Transition safety is test-backed, not asserted**: the ≥200-row transition test (Phase 1) pins one canonical row per pair, no duplicates, bounded wall time; the legacy sweep removes the allocator/storage debris tax (`id-allocators.ts:17-36` scans physical keys per allocation).
2. ~~Relink stamping keeps old backups importable~~ — **moot**: `restore()` derives fields service-side, so old backups (and version-skewed in-flight imports) restore by construction.
3. Identity filtering breaks no existing consumer — verified across UI readers, `utils/core.ts` refresh, incoming-transfer's `requestBalanceRefresh` (token ids globally unique), `onTokenUpdated` re-enqueue noise (write-guarded). Complete only because the predicate covers ALL raw-row decisions (§2 table), including the projector and `backup()`.
4. **Retracted** (both audits): an account-orphaned row matches live-token identity exactly — filters do NOT hide it, `backup()` would export it, the reconcile ignores rather than deletes it. Hence purge-before-delete + fail-fast.

### Asks — RESOLVED (dual-audit rulings; disputes in the ledger)

1. **A vs B → revised A** (unanimous).
2. **Field set → all three** (unanimous; justified by token-identity immutability, `token/service.ts:389-394`).
3. **Stale-row deletion → yes, narrowly** (codex criterion ∩ fable carve-out): delete only live-token identity-mismatch rows of the active profile; never rows whose token is absent from the map.
4. **Old-shape debris → sweep at init** (codex, overruling fable — see ledger).
5. **Crash-window ordering → split list→purge→delete, fail-fast to rollback** (unanimous; Inference 4 retracted).
6. **Tier → `mid`** (unanimous).

## Phases

*(gates use the Bun-runtime test script: `bun run --cwd apps/extension test <path>`)*

### Phase 1 — Schema, predicate, stamping, sweep, transition proof ✓
Fields on type + schema; `balance-identity.ts`; stamp at create; restore-side derivation + unowned-token rejection + pair dedup; relink chain-authority fix; legacy sweep at init. Tests: ≥200-row transition (sweep + reconcile → one canonical row per pair, no dupes, bounded time); sweep exactness (partial-new, otherwise-malformed, and storage-key-mismatched rows LEFT untouched); forged-blob fields overwritten service-side; unowned token → `restoreError`; duplicate pairs collapsed.

**Gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension test src/wallet/services/token-balance/ && bun run --cwd apps/extension test src/composables/useFullBackupImport.test.ts` — exit 0.

### Phase 2 — Complete identity enforcement + reconcile hardening
Predicate at every §2 site (reads, refreshes, handlers, projector, queue, backup); occupancy-set fix; stale-row deletion with the carve-out; retire the workarounds; delete `existsByTokenAndAccount`. Tests: temporal-reuse case (dead-incarnation row deleted + fenced, canonical pair created, nothing rendered from it); codec-hidden-token row LEFT alone; occupancy (stale row no longer blocks creation); two-profiles-shared-address visibility isolation.

**Gate.** Phase 1 commands plus `bun run --cwd apps/extension test src/wallet/services/` — exit 0.

### Phase 3 — Purge, registration, split ordering, fail-fast
`purgeForAccounts` (lock + fence, typed + raw passes, emit guard); `registerAccountPurgeSubscriber`; `reconcileImportedAccounts` → list→purge→delete returning `{chainId, address}[]`; composable catch removal. Tests: sibling-profile shared address spared (**RED vs a bare-address purge**); same-profile multi-chain — chain X keyless, chain Y live, only X purged (**RED vs an address-scoped purge**); purge completes with a foreign/empty active token map (fable C-3); purge racing a parked creation (lock serialization); purge failure pre-finalize fails the import (fail-fast); a registered callback that installs the key mid-purge → that account is skipped by the delete pass and absent from the returned scopes; composition test driving the real service graph through a doctored restore.

**Gate.** Phase 2 commands; both RED runs recorded in `lessons/phase-3.md`.

### Phase 4 — E2E
Doctored full-backup import (imported account present, key slice stripped): account drops AND zero balance rows remain for its scope; re-import the key → balances start fresh (no stale reattachment). Reuses the import-drivers helpers. Must fail without Phase 3's wiring — record red/green in `lessons/phase-4.md`.

**Gate.** `bun run e2e:agent tests/e2e/<spec>` green + documented pre-fix red.

### Phase 5 — Regression sweep + docs
`bun run audit:vue`; armed source smoke AND unarmed artifact-mode smoke (explicitly — the default command exercises neither); `NULO_E2E_PROVERLESS=1 bun run e2e:agent` full suite. `ARCHITECTURE.md` balance-row entry.

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

| Decision | Fable | Codex | Resolution |
|---|---|---|---|
| Outline | A, conditioned | revised A | **Revised A** — unanimous; B rejected (workarounds + residual survive; schema decision deferred into migration territory) |
| Field set | all three (immutability argument) | all three | **All three** |
| Purge scope | `(address, profileId)` | **`(profileId, chainId, address)`** — same-profile multi-chain hole (Fact 5) | **Codex** — verified: `importAccount` dup check is chain-scoped; return type becomes scope tuples |
| Orchestration | **A-1 registration** (`registerChainPurgeSubscriber` precedent) — no RPC | composable 3-step (list/purge/delete via RPC), flags the RPC expansion as its own Medium | **Fable's A-1 shape carrying codex's ordering + fail-fast** — achieves codex Ask e inside `reconcileImportedAccounts` with zero new RPC surface, discharging codex's own RPC finding; ratified in the discharge resume |
| Stamping authority | A-2: `restore()` derives via `getTokensRaw(profileId)` | same (Inference 2, adds the version-skew argument) | **Service-owned derivation** — unanimous; relink untouched except the chain-authority fix |
| Stale-row deletion | NO — codec-hidden-token case makes it lossy | YES — but only live-token identity-mismatch, active profile; leave no-live-token + foreign rows | **Merge** — codex's criterion structurally excludes fable's killer case; adopted with the carve-out pinned by test |
| Legacy debris sweep | NO — unattributable; other profiles' rows | YES — exact-shape predicate under lock; debris taxes the per-creation physical-key scan | **Codex** (owner's decision rule: codex rules on disputes) — balance rows are recomputable projections; swept rows are invisible + unexported meanwhile and recreated by each profile's own next activation reconcile; fable's cross-profile worry is thereby bounded to a transient re-projection |
| Ordering | split, purge first | split + **fail-fast to the outer rollback** (kill the catch-and-continue) | **Split + fail-fast** — verified: reconcile precedes `finalizeStarted`, so escape reaches `rollbackCreatedProfile` |
| Duplicate pairs (codex-only) | — | reject/collapse at restore | **Adopted** — `seen` set, `AccountService.restore` precedent |
| Occupancy set (codex-only) | — | identity-keyed or repair fails | **Adopted** — without it the whole reconcile story is fiction |
| `full-backup-helpers.ts:206` | deliberate no-op, record it | — | **Adopted** |
| Tier | mid | mid | **mid** |

Unresolved: none. Both verdicts were `conditional approve`; every condition is adopted above (fable 1–8; codex a–f), with the two disputes resolved as recorded.

## Audit verdicts

- **Fable leg** (`audit-fable.md`): `conditional approve` — all 8 conditions adopted.
- **Codex leg** (`audit-codex.md`, session `01a05831-3c23-7ce2-9026-66f9c227dddf`): `conditional approve` — all conditions adopted (revised A, tuple scopes, service-owned derivation, complete identity enforcement, stale/legacy cleanup, fail-fast split ordering).
- **Discharge pass (round 2)**: codex ratified all three consolidation deltas (A-1 registration; the stale-delete merge; the sweep, standing by it against fable's objection) — `conditional approve` with three narrow contract fixes, all adopted in this revision: complete-legacy-codec sweep predicate + canonical key identity; `row.token === token.id` in the shared predicate; return only scopes actually deleted after the per-row key recheck. **Round 3: `approve`** — "The consolidated plan matches all three conditions… I found no remaining blocking or conditional issue."

## Seeds

*(draft — finalized after the approval gate)*

```
/goal All five phases marked ✓ in implementations-plan/account-balance-orphans/plan.md (per-phase headers in the file), each ✓ backed by its gate as written reported passing in the transcript — including Phase 3's TWO documented RED runs (sibling-profile vs bare-address purge; same-profile multi-chain vs address-scoped purge) and Phase 4's documented pre-fix RED run; per phase LESSONS_FILE=implementations-plan/account-balance-orphans/lessons/phase-N.md printed; /code-review medium --fix applied and committed separately; the codex fix loop converged (resumed pass with no new material findings quoted); a PR against dev exists, created only after convergence, with gh pr view output in the transcript; bun run audit:vue and both smoke modes and NULO_E2E_PROVERLESS=1 bun run e2e:agent all exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/account-balance-orphans forward. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative), git status, git log --oneline -5; PR? gh pr view --json statusCheckRollup. (2) CI waits are fine — prep the next phase meanwhile. (3) No task? Take the next pending plan step; after each edit run bun run lint + bun run --cwd apps/extension test for touched dirs; commit → push. (4) Decision needed? /codex xhigh, decide, act, log the consult in lessons/. Hard limits: never merge, never publish, never expand scope beyond plan.md. (5) Same step failed 5×? Stop; reassess with codex. (6) Phase green = its WRITTEN gate passes; paste result, mark ✓, print LESSONS_FILE, advance. (7) All ✓? /code-review medium --fix → commit separately → codex audit loop until clean → gh pr create --base dev → gh pr checks --watch → wrap-up and stop.
```
