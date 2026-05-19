# Phase 2+ — durable-jobs follow-on (plan v4, implementation target)

**Status:** ✅ **SHIPPED.** Bundle 1 = PR #82 (`v0.15.7`, branch `feat/phase-2-plus-bundle-1`). Phase A = PR #83 (`v0.16.0`, branch `feat/phase-2-plus-phase-a`, stacked on Bundle 1). Both passed `audit:vue` (1634/1634 tests on Phase A; 1625/1625 on Bundle 1) and codex post-impl review.

**Codex post-impl follow-ups applied during the implementation pass** (not in v4 above): A1 log delete failures, NO_ACCOUNT sentinel readable, A2 race-comment for the A3 boot probe; multi-in-flight card rendering on `feat/phase-2-plus-phase-a` (codex caught the single-card `topJournalOp[0]` render as a hidden Phase 2 W5 regression — fixed by rendering one card per in-flight op, per-jobId cancel emit, ambiguity-safe subtask decoration, slot accounting fix). See commit graph on each PR for the full audit trail.

**Branch target:** `dev` (Phase 2 + cancel-semantics-v2 merged @ `f81b3e6c`, v0.15.6).

**Audit history:** v1 → Plan-agent + codex pre-impl → v2 → codex final → v3 (ELI5 shown to user) → user decisions + design pivot → Explore (single-shot inventory) + codex pivot review → v4 → implementation → codex post-impl review (Bundle 1 + Phase A + multi-in-flight + cancel-disconnect-stale-error) → user manual QA pass → SHIPPED.

**Phase B (not yet started):** see "Phase B — Expansion" section below for the post-Phase-A graduation roadmap, kept here for future planning rounds.

## What's locked

| # | Decision | Source |
|---|---|---|
| 1 | **GC cap = 50 terminal records**, granularity = **per (profile, account)** | User said "50"; codex argued for per-account granularity ("records already carry `accountAddress`, both transaction surfaces are account-scoped today, per-profile creates avoidable cross-account starvation"). |
| 2 | **`addToken` graduates fully from TaskService to journal-only.** Modal subscribes to journal events for its spinner. | User: "the mature, unifying thing to do is graduate." |
| 3 | **Token-import card lives in tokens-balances view, NOT activity feed.** Activity is for transactions only. | User: "that's ONLY for transactions." |
| 4 | **Plan split: Phase A = token-import + base substrate; Phase B = expand to other single-shot ops.** | User: "first part only token and then we test that and all of the base work and theeeeen we expand." |
| 5 | **No standalone "success card" in tokens view.** Render in-flight + failed journal rows as a sibling component; on success the journal record stops rendering and the existing `TokenCard` takes over (using its `updatedAt === 0` initial-sync spinner). | Codex pivot review — UX insight. |
| 6 | **No modal reattach in Phase A.** Modal close = hand off to tokens-list card. Reopening modal starts fresh. | Codex pivot review — minimum atomic Phase A. |
| 7 | **Phase B grouping by FSM/lifecycle shape, not by domain.** | Codex pivot review. |
| 8 | **Don't overload `TokenCard`.** New sibling component for journal-backed import rows. | Codex pivot review. |

Bundle 1 hardening (A1, A2, A3) carries forward from v3 with one update: **A2 cap is per (profile, account), value = 50.**

---

## Bundle 1 — Production hardening (v0.15.7)

Same as v3 except for A2 cap value/granularity. Bundle 1 ships **first** as v0.15.7 (pure SW-internal, no UI). Then Phase A ships as v0.16.

### A1 — Two-layer storage resilience

Unchanged from v3:
- **Layer 1** (`packages/wallet-core/src/storage/entity_storage.ts:52,70,86`): try/catch around `JSON.parse`. On parse failure: log Error with truncated payload, delete the row, skip from iteration.
- **Layer 2** (`packages/extension/src/wallet/services/operation-journal/service.ts`): centralize all four raw-record load sites (`getOperation`, `getOperations`, `transitionOperation`, `deleteOperation`) behind `_loadValidated(id)` that does `OperationRecordSchema.safeParse`. On schema mismatch: log Error, delete row, return undefined.

Tests: 4 (Layer 1) + 3 (Layer 2) = **7 unit tests**.

### A2 — Terminal record cap

- **Cap: 50 terminal records per (profileId, accountAddress) tuple.**
- **Trigger**: new `nulo:journal:gc` alarm @ `periodInMinutes: 60`. Boot-time sweep + hourly, idempotent like `JournalReaper`.
- **Logic**: group terminal records by `(profileId, accountAddress)`. For groups over 50, sort by `terminalAt` desc, delete entries from index 50 onward via `journal.deleteOperation`.
- **Records without `accountAddress`** (e.g. failed token-import pre-account-scope): group under synthetic `(profileId, null)` bucket with its own 50 cap.
- Live alongside reaper: reaper handles non-terminal stuck records; GC handles terminal record bloat. Disjoint sets.

Tests: **5 unit tests** + 1 optional e2e (alarm wiring).

### A3 — Storage usage observability log

Unchanged from v3. One-shot at SW boot. 0 tests.

---

## Phase A — Token imports through the journal (v0.16)

The "base substrate" for the journal-only pattern. Once landed and tested, Phase B graduates additional ops following the same template.

### Schema changes (`operation-journal/spec.ts`)

```ts
// Existing
type OperationKind = "transfer" | "dapp_execute"

// Phase A
type OperationKind = "transfer" | "dapp_execute" | "token_import"
```

```ts
// Add to OperationRecord + NewOperationInput schemas
contractAddress?: string
```

```ts
// Add to OperationFilter (codex flagged: tokens-view query needs kind filter)
export const OperationFilterSchema = z.object({
  accountAddress: z.string().optional(),
  profileId: z.string().optional(),
  stage: JobStageSchema.optional(),
  isTerminal: z.boolean().optional(),
  kind: OperationKindSchema.optional(),    // ← new
})
```

```ts
// jobs/types.ts:44 — make txHash optional
| { stage: "succeeded"; txHash?: string }
```

All additions are **forward-compatible** with v0.15.6 records (optional fields, new enum variant). No storage migration / version bump.

### FSM update (`packages/wallet-core/src/jobs/fsm.ts`)

Add `simulating → succeeded` to `LEGAL_TRANSITIONS`. Keep:
- `pending → simulating | failed | cancelled` (no `pending → succeeded` skip).
- `submitting → succeeded` (existing on-chain path).
- Cancel edges unchanged.

Tests: 1 (table-driven addition to `fsm.test.ts`).

### Kind ↔ txHash invariant (`operation-journal/service.ts:transitionOperation`)

When transitioning to `succeeded`:
- `kind ∈ {"transfer", "dapp_execute"}` ⇒ `txHash` MUST be present.
- `kind === "token_import"` ⇒ `txHash` MUST be absent (omitted).
- Mismatch → throw `IllegalTransitionError` with clear message.

Codex confirmed: all current succeeded transitions in `execution/service.ts` (lines 544, 1123, 1928, 2088) pass `txHash`. No existing regression.

Tests: 2 (positive + negative for each kind branch).

### Suppress `token_import` from transaction feeds

Codex flagged this is the real risk. Three feeds today include all journal ops; we need explicit `kind !== "token_import"` filters in:

1. `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:192` (`inFlightJournalOps` computed) — exclude `token_import`.
2. `packages/extension/src/popup/pages/activity.vue:83` (`activityRows` computed) — exclude `token_import`.
3. **`journal-state.ts:73` already suppresses succeeded records globally** — token_import succeeded would be hidden by that AND by the kind filter; double-defense is fine.

No changes to `RecentActivityView.vue:210` or `activity.vue:85` succeeded-suppression — both stay as "all succeeded suppressed" because:
- succeeded transfer/dapp_execute → surfaced by `TransactionService` on-chain card.
- succeeded token_import → record stops rendering; existing `TokenCard` (with `updatedAt === 0` initial-sync spinner) takes over in the tokens view.

Tests: 2 (RecentActivityView excludes token_import; activity.vue excludes token_import).

### `addToken` signature — required `OperationContext`

```ts
type OperationContext =
  | { origin: "popup" }
  | { origin: "dapp"; dappOrigin: string }

addToken(
  profileId: string,
  networkId: string,
  accountAddress: string,
  ti: TokenInterface,
  opContext: OperationContext,        // ← REQUIRED, type-enforced
  parentTask?: WrappedTask,           // kept for parseTokenInterface sub-tasks
): Promise<void>
```

Callers (both must thread context):
- **Popup add-token modal** (`NewTokenPopup.vue`): `opContext: { origin: "popup" }`.
- **Dapp `register_token`** (`execution/service.ts:1048`): `opContext: { origin: "dapp", dappOrigin }`. The dapp origin is available at `executeRegisterToken`'s scope (threaded from `executeOperations`).

### `addToken` journal flow (replace TaskService for the parent op)

Inside `TokenService.addToken`:

```ts
const op = await this.journal.createOperation({
  kind: "token_import",
  origin: opContext.origin,
  profileId,
  accountAddress,
  networkId,
  contractAddress: ti.address.toString(),
  title: ti.symbol ?? formatAddress(ti.address.toString()),
  subtitle: opContext.origin === "dapp" ? `Requested by ${opContext.dappOrigin}` : "Adding token…",
})

try {
  await this.journal.transitionOperation(op.id, { stage: "simulating" })
  // existing metadata parse + registerContract + watchlist add
  await this.journal.transitionOperation(op.id, { stage: "succeeded" })  // no txHash for non-tx ops
} catch (err) {
  await this.journal.transitionOperation(op.id, { stage: "failed" }, {
    kind: classifyTokenImportError(err),
    message: getErrorMessage(err),
    normalizedRaw: normalizeError(err),
  })
  throw err
}
```

`parseTokenInterface` keeps its TaskService sub-task wiring (parent/child progress within the modal). The *journal* records the parent op only.

**Success boundary** (codex): `succeeded` means "token added to watchlist" (i.e., after `onTokenAdded` fires). NOT "first balance load finished". After succeeded, `TokenCard`'s existing `updatedAt === 0` spinner covers the balance-load phase.

`classifyTokenImportError` returns one of: `"metadata_fetch"`, `"already_imported"`, `"contract_invalid"`, `"network_unreachable"`, `"unknown"`.

### Modal subscription (`NewTokenPopup.vue`)

Replace TaskService subscription for the *parent op* with a journal-event subscription:

```ts
// On submit
const op = await this.tokenService.addToken(..., { origin: "popup" })  // returns the journal record id
const journalClient = new OperationJournalServiceClient()
const unsubscribe = journalClient.onOperationUpdated.add((updated) => {
  if (updated.id !== op.id) return
  if (updated.progress.stage === "succeeded") {
    // close modal — TokenCard in tokens view will show initial-sync spinner
    closeModal()
  } else if (updated.progress.stage === "failed") {
    // surface error to modal
    showError(updated.error?.message ?? "Unknown error")
  }
})
```

On modal close (manual or auto): `unsubscribe()`, `journalClient.disconnect()`. **No reattach if modal reopens** — fresh modal = fresh add-token flow.

### Tokens-view journal row component

**New component:** `packages/extension/src/popup/components/modules/general/TokenImportRow.vue` (or similar).

Subscribes to journal: `journal.getOperations({ kind: "token_import", profileId, accountAddress, isTerminal: false })` plus terminal-failed (e.g. `terminalAt > now - 30s` window so the user sees the failed result for ~30s).

Renders:
- In-flight: icon, title (symbol or short address), subtitle ("Adding token…").
- Failed: icon, title ("Couldn't add token"), subtitle = error.message (truncated). Auto-dismisses after 30s window.

Sibling to `TokenCard`, NOT a variant. Lives inside `TokensView.vue` (`packages/extension/src/popup/components/modules/general/TokensView.vue:21` area).

Tests: 3 (in-flight render, failed render with auto-dismiss, succeeded record disappears from view).

### Phase A test budget

| Layer | Tests | Where |
|---|---|---|
| FSM legal-transition pin | 1 | `wallet-core/src/jobs/fsm.test.ts` |
| Schema additions | 2 | `operation-journal/spec.test.ts` (kind enum, filter accepts kind, contractAddress) |
| Kind ↔ txHash invariant | 2 | `operation-journal/service.test.ts` |
| Feed exclusions | 2 | RecentActivityView + activity.vue tests |
| `addToken` journal flow | 3 | `token/service.test.ts` (success, failure, OperationContext required) |
| Modal subscription | 2 | `NewTokenPopup.test.ts` (closes on succeeded; surfaces error on failed) |
| Tokens-view row | 3 | `TokenImportRow.test.ts` (in-flight, failed-window, succeeded disappears) |
| **Total unit** | **15** | |
| E2E network — token import | 1 | `tests/e2e/network/token-import.test.ts` (full add-token; assert TokenImportRow vanishes + TokenCard appears on success) |
| E2E network — cross-flow | 1 | `tests/e2e/network/token-import-during-prove.test.ts` (token import during a transfer's prove; both reach terminal correctly — pins per-(profile, chain) PXE write-lock from `withPxeWrite`) |
| **Total e2e** | **2** | |

Grand total Phase A: **15 unit + 2 e2e.**

---

## Phase B — Expansion (post-Phase-A; planned, not yet committed)

Codex insisted: **group by FSM/lifecycle shape**, not by domain. After Phase A ships and is validated in production, we batch by shape.

### Batch B1 — Single-shot journal-only ops with a natural home surface

These look exactly like `token_import`: no on-chain prove/submit, FSM is `pending → simulating → succeeded/failed`. The "natural home surface" is a non-activity-feed view (tokens, contacts, networks list, settings).

| Op | Service method | Home surface | Cost | Notes |
|---|---|---|---|---|
| Add sender | `AccountStateService.addSender` | (no current visual home; could show "registering sender…" in account-detail view) | Small | 1-3s PXE registration; non-fatal on failure today |
| Add contact (with sender registration) | `ContactService.addContact` + sender opt-in | contacts list view | Small | sender registration is optional; partial-success semantics |
| Add network | `NetworkService.addNetwork` | networks list view | Small | RPC node-info fetch + validation; 2-5s typical |
| Add endpoint | `NetworkService.addEndpoint` | network-detail view | Small | RPC connectivity test |

**Test scope estimate B1**: ~20-25 unit + 1-2 e2e.

### Batch B2 — Destructive write ops with confirm-and-complete

These submit transactions on-chain, same FSM shape as `transfer` (`pending → simulating → proving → submitting → succeeded/failed/cancelled`). They already use the activity feed surface today; journaling them just adds durability semantics.

| Op | Service method | Surface | Cost | Notes |
|---|---|---|---|---|
| Revoke authwits (batched) | `AuthRegistryService.revokeAuthwits` | activity feed (already in surface; cancel-semantics-v2 added per-chunk cancelled UI) | Medium | Per-chunk loop; each chunk a journal op? Or one journal op spanning chunks? Decision. |
| Change authwits registry | `AuthRegistryService.setRegistryEnabled` | activity feed | Medium | Single on-chain tx; cancel-semantics-v2 already handled cancel UX |

**Test scope estimate B2**: ~15-20 unit + 1 e2e per op = 2 e2e total.

### Batch B3 — Long multi-step import/export flows

These need richer per-stage progress payloads (e.g. `progress.syncedAccounts`, `progress.totalAccounts`). May warrant extending `JobProgress.simulating` or adding a new intermediate stage like `syncing`.

| Op | Service method | Cost | Notes |
|---|---|---|---|
| Import backup | `ProfileService.restoreBackup` | Large | 10-30s; multi-step account sync; needs per-account checkpointing in `progress` |
| Import seed phrase | `ProfileService.importFromSeedPhrase` | Medium | 5-10s; derives keys, syncs state |
| Import private key | `ProfileService.importFromPrivateKey` | Medium | 5-10s; similar to seed import |
| Create profile (passkey) | `ProfileService.createPasskeyProfile` | Medium | 3-10s; retry on `ProfileIdConflictError` — journal `attempts` counter pays off here |

**Test scope estimate B3**: ~30-40 unit + 2-3 e2e (network — these are stateful onboarding flows).

### NOT graduating (explicit non-goals for journaling)

Sub-second local writes don't benefit from journaling — the op completes before SW could die. Pure overhead.

- Edit profile name (`ProfileService.changeProfileName`)
- Edit account (`AccountService.updateAccount`)
- Edit FPC (`FpcService.updateFpc`)
- Edit network / endpoint (`NetworkService.updateNetwork`, `updateEndpoint`)
- Edit contact (`ContactService.updateContact`)
- New account (local KeyStore only, no network)
- New FPC (local storage only)
- Confirm/decision popups (`ConfirmPopup`, `DataViewerPopup`, `SelectToken`, `SelectProfile`, `SelectBalance`, `SelectNetworks`, `SelectFpc`)
- Read-only viewers (`TokenMetadataPopup`, `JsonViewer`, `LogsViewer`)
- Receive / address display
- Forgot-password redirect (`ForgotPasswordPopup`)
- Unlock profile (password/passkey) — pure auth gate
- Passkey ceremony — already has AbortController-based cancel; no SW-restart durability win

**Rule**: if op completes <500ms AND has no PXE/network call, skip journaling.

### Approval/session flows (deferred indefinitely)

dApp connect-session approval, capability negotiation, etc. — different shape (user-decision gates, not async work). Phase 3 territory if at all.

---

## Validation gates per PR

### v0.15.7 (Bundle 1 — hardening)

- `bun run audit:vue` — typecheck → unit + component → lint → build. Must pass clean.
- `bun run test:e2e` — smoke. No UI surface in Bundle 1, should be unaffected.
- Network e2e — skip (no on-chain surface).
- Manual smoke: extension boot, recent-activity renders, no console errors.

### v0.16 (Phase A — token imports)

- `bun run audit:vue` — typecheck must catch any callsite that doesn't thread `OperationContext`.
- `bun run test:e2e` — smoke covers popup paths.
- `bun run e2e:agent` — network covers token-import flow + cross-flow regression.
- Manual smoke: add a token from the modal; observe TokenImportRow in tokens view; observe replacement by TokenCard on success; add a token via dapp `register_token` path; observe cross-flow with a concurrent transfer.

### Phase B PRs (future)

Per-batch validation. Each batch lands as its own PR after Phase A is validated in production.

---

## Order of operations

1. **v0.15.7** — Bundle 1 (A1 + A2 + A3). Pure SW-internal hardening. Ships first.
2. **v0.16** — Phase A. Token imports as journal-only ops + base architecture template.
3. **v0.16.x+ (Phase B1, B2, B3)** — each batch lands separately after Phase A validates in production. Order within Phase B is flexible based on observed need.

Each landing = separate PR onto `dev`. Codex post-impl review after each.

---

## Open items deferred to Phase B planning (not blocking Phase A)

- Whether to extend `JobProgress.simulating` with per-stage progress fields for B3 (`syncedAccounts`, etc.), or add a new intermediate stage `syncing`. Defer until B3 is the next-up batch.
- B2 question: revoke-authwits — one journal op per chunk, or one journal op spanning all chunks? Probably one op spanning chunks with a `chunkIndex/chunkTotal` field in `progress.simulating`, but defer.
- B1 question: add-sender has no current visual home today; do we add one in B1, or just track durably without surfacing? Defer.

These are not blockers for v0.15.7 or v0.16.

---

## Test budget summary (Phase A + Bundle 1)

| | Unit | E2E |
|---|---|---|
| Bundle 1 (A1 + A2 + A3) | 12 | 0-1 |
| Phase A (token-import) | 15 | 2 |
| **Total v0.15.7 + v0.16** | **27** | **2-3** |

Per the user's "succinct" rule, each test is load-bearing — no redundant coverage of the same behavior.

Phase B total scope (rough): +65-85 unit + 4-6 e2e across batches B1+B2+B3.
