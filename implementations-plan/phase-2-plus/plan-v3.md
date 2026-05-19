# Phase 2+ — durable-jobs follow-on (plan v3, final pre-implementation)

**Status:** v3 — codex final review of v2 returned "minor fixes, then ship." This is the implementation target.
**Branch target:** `dev` (Phase 2 + cancel-semantics-v2 merged @ `f81b3e6c`, v0.15.6)
**Audit history:** v1 → Plan-agent (opus 4.7) + codex pre-impl → v2 → codex final → v3.

## What changed v2 → v3 (codex final review)

1. **A1 layer-2 was incomplete.** My v2 only wrapped `getOperation`/`getOperations` in `safeParse`. Codex caught that `transitionOperation` (`operation-journal/service.ts:130`) and `deleteOperation` (line 183) also load raw records directly via `storage.get`. **Fix:** centralize all raw-record loads behind one internal `_loadValidated(id)` helper that does `safeParse`. Apply across all four call sites.
2. **Drop quarantine.** Codex: "EntityStorage is a generic primitive used across roots, not just the journal. A quarantine seam there creates a second persistence surface for corrupt raw payloads, increases quota pressure, and needs its own cleanup policy." → simple delete + log truncated payload to Error.
3. **`OperationContext` required, not optional.** Codex: "Defaulting omitted context to `"popup"` will hide future caller mistakes." Required arg at type level; both callers (popup + dapp `executeRegisterToken`) thread it explicitly.
4. **Per-profile cap tradeoff documented.** Codex: "50 per profile allows one busy account to evict another account's history." Two options to resolve:
   - **(α) per-account cap, 25 records.** Fair across accounts within a profile.
   - **(β) per-profile cap, 50 records, accept the tradeoff.** Simpler.
   I lean **α (per-account, 25)** — fairness is cheap and predictable. Decision point for user.
5. **PXE mutex confirmed.** Codex traced the implementation to `packages/aztec-runtime/src/pxe/service.ts:56`. `proveTx`, `registerContract`, `executeUtility`, `simulateTx` all run under `withPxeWrite`. Token-import metadata fetches use `withPxeRead`. So a token import's `registerContract` will block a concurrent transfer's `proveTx` and vice-versa. Cross-flow e2e is valid. Additionally, `TokenService.addToken` (`token/service.ts:119`) has its own global lock that serializes imports with other imports only.

## What v3 inherits from v2 unchanged

All of v2's other decisions:
- **B1 dropped** from this round.
- **D1 dropped** entirely (no migration framework, schema additions are forward-compat).
- **Bundle 2 split into 2a + 2b** (substrate first, then token imports).
- **`succeeded.txHash` becomes optional** in 2a; kind-aware suppression at the three sites.
- **`simulating → succeeded` added to FSM legal set** in 2a; `pending → succeeded` and `submitting` skip still illegal.
- **No v8 schema bump.**
- **Order**: v0.15.7 = Bundle 1; v0.16 = Bundle 2.

---

## Bundle 1 — Production hardening (v0.15.7)

### A1 — Two-layer storage resilience

**Layer 1 — `EntityStorage` per-row resilience.**

Files: `packages/wallet-core/src/storage/entity_storage.ts:48-87` — the three bare `JSON.parse(v as string)` sites at lines 52, 70, 86.

Wrap each in try/catch:
- On parse failure: log Error with the key + payload truncated to 200 chars, then **delete the row** via `this.storage.remove(key)`.
- `get()` returns `undefined` on parse failure (caller already handles undefined as "not present").
- `getAll()` / `getValues()` skip the bad row from the iteration result; valid rows still flow through.

No quarantine seam (codex's argument: don't pollute the generic primitive).

**Tests** (in `packages/wallet-core/src/storage/entity_storage.test.ts` — create if absent):
- Valid row round-trips.
- Malformed row in `get()`: returns undefined; row deleted; Error logged.
- Malformed row in `getValues()`: returns array minus the bad row; row deleted.
- Two malformed rows: both deleted; valid rows survive.

**Layer 2 — `OperationRecordSchema.safeParse` centralized for journal.**

Files: `packages/extension/src/wallet/services/operation-journal/service.ts` — four load sites:
- `getOperation(id)` (line ~160)
- `getOperations(filter)` (line ~166)
- `transitionOperation(id, …)` (line ~130) — reads `existing`
- `deleteOperation(id)` (line ~183) — reads `existing` to emit `onOperationDeleted`

**Centralize via `_loadValidated(id): Promise<OperationRecord | undefined>`:**
1. Call `entityStorage.get(id)` (returns undefined for missing OR layer-1-deleted rows).
2. If undefined: return undefined.
3. `OperationRecordSchema.safeParse(raw)`. On `success: false`: log Error with the schema error, call `entityStorage.delete(id)` to remove the now-known-bad row, return undefined.
4. On `success: true`: return parsed.

Refactor all four sites to use `_loadValidated`.

Also: `getOperations` iterates via `entityStorage.getValues()` — refactor to validate each row through the same code path (or expose `entityStorage.getKeys()` + map through `_loadValidated`).

**Tests** (in `operation-journal/service.test.ts`):
- Valid record: `getOperation` returns it; `transitionOperation` updates it; `deleteOperation` emits `onOperationDeleted`.
- Schema-mismatched record snuck past layer 1: `getOperation` returns undefined + row deleted + Error logged; `transitionOperation` throws a clean error (not a TypeError); `deleteOperation` no-ops.
- Mix of valid + invalid in `getOperations`: returns only the valid ones.

### A2 — Terminal record cap (no time-based GC)

**Design** (revised from v2 per codex feedback):
- **Cap: 25 terminal records per (profile, account) tuple.** "Per account" rather than "per profile" — fair across accounts; predictable bound per scope users actually perceive.
- **Sweep trigger**: new `nulo:journal:gc` alarm, `periodInMinutes: 60`. Boot-time sweep on `start()`, same idempotency wiring as `JournalReaper`.
- **Sweep logic**: group terminal records by `(profileId, accountAddress)`. For groups exceeding cap, sort by `terminalAt` desc, delete from index 25 onward via `journal.deleteOperation`.
- **Live alongside reaper**: reaper handles non-terminal stuck records; GC handles terminal record bloat. They never touch the same record set.
- **Records without `accountAddress`** (e.g. failed token-import before account scope is set): group under a synthetic `(profileId, null)` bucket with its own cap. Same behavior.

**Race-safety vs `clearChainState`.** Both paths call `journal.deleteOperation` and emit `onOperationDeleted`. Subscribers (`RecentActivityView`) treat missing records idempotently. Add one test pinning: GC delete + chain-purge delete of same record both fire → subscriber observes one delete event in the second call (because record already gone), no crash.

**Tests** (in `operation-journal/journal-gc.test.ts`):
- More than cap terminal records for one (profile, account) → oldest deleted, newest cap-kept.
- Records under cap → none deleted.
- Non-terminal records never touched by GC path (even if `updatedAt` is old).
- Multi-account: one busy account's overflow doesn't evict another account's history.
- GC + clearChainState double-delete: idempotent for subscribers, no crash.

**E2E (optional, Plan-agent recommendation):** `tests/e2e/network/journal-gc.test.ts` — seed 30 terminal records for one account in session storage via injection helper, boot SW, assert 25 remain after `start()`. Catches alarm-wiring bugs unit tests miss. Decision point for user: ship the e2e or skip.

### A3 — Storage usage observability log

**Implementation.** In `runtime.ts` boot path (after `services.start()`, before reaper), one log line at Info level:
```ts
const bytes = await chrome.storage.session.getBytesInUse?.()
const allKeys = await chrome.storage.session.get(null)
const journalKeys = Object.keys(allKeys).filter(k => k.startsWith("nulo:journal@")).length
logger.log("runtime", LogLevel.Info, `session storage: ${bytes ?? "n/a"} bytes, ${journalKeys} journal records`)
```

Single-shot at boot only; no tests.

---

## Bundle 2 — Phase 2.5 (v0.16): Token imports as durable jobs

Bundle 2a + 2b ship together in one PR. They're tightly coupled.

### Bundle 2a — Substrate for non-tx terminal records

**Core change.** `JobProgress.succeeded` becomes `{ stage: "succeeded"; txHash?: string }` in `packages/wallet-core/src/jobs/types.ts:44`.

**Invariant** (enforced in `operation-journal/service.ts:transitionOperation`):
- `kind ∈ {"transfer", "dapp_execute"}` + `stage === "succeeded"` ⇒ `txHash` MUST be present.
- `kind === "token_import"` + `stage === "succeeded"` ⇒ `txHash` MUST be absent.

Codex confirmed all current succeeded transitions in `execution/service.ts` (lines 544, 1123, 1928, 2088) pass `txHash`. No existing regression. **Caveat (codex):** validate against `existing.kind` *after* layer-2 Zod-validating `existing`. Since v3 routes all loads through `_loadValidated`, this is satisfied.

**FSM update** (`packages/wallet-core/src/jobs/fsm.ts`):
- Add `simulating → succeeded` to `LEGAL_TRANSITIONS`.
- Keep `pending → simulating | failed | cancelled` (no `pending → succeeded` skip).
- Keep `submitting → succeeded` as the on-chain path.
- Update `IllegalTransitionError` test coverage.

**UI suppression updates.** Three sites need kind-aware branches:
- `packages/extension/src/utils/journal-state.ts:73`:
  ```ts
  if (stage === "succeeded" && (kind === "transfer" || kind === "dapp_execute")) return null
  ```
- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:210`: same kind-aware condition.
- `packages/extension/src/popup/pages/activity.vue:74`: same.

**Tests for 2a** (5):
- `fsm.test.ts`: add `["simulating", "succeeded"]` to `legalEdges`; pin `["pending", "succeeded"]` still in `illegalEdges`. (1 test, table additions.)
- `operation-journal/service.test.ts`: succeeded with `kind: "transfer"` requires `txHash` (throws on omission); succeeded with `kind: "token_import"` requires `txHash` absent (throws on inclusion). (2 tests.)
- `journal-state.test.ts`: `journalTerminalDisplay` returns null for succeeded transfer; returns non-null for succeeded token_import. (2 tests.)

### Bundle 2b — Token imports through the journal

**Schema** (`operation-journal/spec.ts`):
- `OperationKind`: add `"token_import"`. `z.enum(["transfer", "dapp_execute", "token_import"])`.
- Add `contractAddress?: string` to `OperationRecord` + `NewOperationInput` schemas.
- Optional-field additions are forward-compatible with v0.15.6 records; no migration / version bump.

**`addToken` signature — `OperationContext` is required** (codex correction):

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
  parentTask?: WrappedTask,
): Promise<void>
```

Callers (both must thread context):
- Popup add-token modal: `opContext: { origin: "popup" }`.
- `executeRegisterToken` (`execution/service.ts:1048`): pull `dappOrigin` from `executeOperations` scope, pass `{ origin: "dapp", dappOrigin }`. The `origin` arg is already available at the call site through `executeSendTransaction` (line 896) — verify and thread.

**Journal flow inside `addToken`:**
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
  // existing metadata fetch + balance backfill + watchlist add (unchanged)
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

`classifyTokenImportError` returns one of: `"metadata_fetch"`, `"already_imported"`, `"contract_invalid"`, `"network_unreachable"`, `"unknown"`. Categories drive future per-kind UX; for v0.16 the card just shows the message.

**TaskService coexistence.** Keep both for now. The popup add-token modal continues to use TaskService for in-modal spinners; the journal is the *durable* record. Defer the dual-path cleanup to a future "Phase 2.5++" task.

**UI card variants.**

`TransactionAwaitingCard.vue` — in-flight (`stage !== terminal`):
- Branch on `kind === "token_import"`:
  - Icon: `coins-stacked` (verify in `assets/icons.json`; fallback `circle-add` or `wallet-plus`).
  - Title: `op.title` (token symbol or truncated address).
  - Subtitle: stage-aware — `"Fetching metadata"` for `simulating`; `"Adding token…"` (popup) or `"Requested by ${dappOrigin}"` (dapp) for `pending`.
  - **No Cancel button.** Token imports run quickly enough that the Cancel affordance just adds noise.

`TransactionTerminalCard.vue` — terminal (`terminalAt !== null`):
- Succeeded variant: icon `check-circle`, title `"Token added"`, subtitle `op.title` (symbol).
- Failed variant: icon `close-circle`, title `"Couldn't add token"`, subtitle `error.message` truncated.
- Cancelled variant: not applicable.

**UX copy (decision points — open):**

In-flight subtitle:
- (a) "Adding token…" — friendly default
- (b) "Fetching metadata…" — technical
- (c) "Importing…" — concise

Terminal succeeded title:
- (a) "Token added"
- (b) `"${symbol} added"` — interpolates the symbol
- (c) `"Added ${symbol}"`

Terminal failed title:
- (a) "Couldn't add token"
- (b) "Import failed"
- (c) "Token import failed"

My picks (open to override): in-flight (a), terminal succeeded (a), terminal failed (a). Default-friendly tone; consistent with existing toast copy in `popup/utils/toast.ts`.

**Tests for 2b** (6 unit + 2 e2e):
- `spec.test.ts`: schema accepts `kind: "token_import"`; accepts `contractAddress`. (1 test.)
- `token/service.test.ts`: addToken creates + transitions journal entry to succeeded; failure transitions to failed with correct `error.kind`; OperationContext required (type-level + runtime). (3 tests.)
- `TransactionAwaitingCard.test.ts`: renders token_import variant for `simulating` and `pending` stages. (1 test, two assertions.)
- `TransactionTerminalCard.test.ts`: renders succeeded + failed token_import. (1 test, two assertions.)
- **E2E (network)** — `tests/e2e/network/token-import.test.ts`: full add-token flow; assert succeeded card visible in activity feed (no on-chain TransactionService counterpart). (1 test.)
- **E2E (network) — cross-flow regression** (Plan-agent + codex): start a token import while a transfer is in `proving`; assert both reach terminal correctly. Pins the per-(profile, chain) PXE write-lock contention boundary. (1 test.)

---

## Validation gates (per PR)

### v0.15.7 (Bundle 1)
- `bun run audit:vue` (typecheck → unit + component → lint → build) — must pass.
- `bun run test:e2e` — smoke; no UI surface in Bundle 1 so should be unaffected.
- Network e2e: skip (Bundle 1 has no on-chain surface).
- Manual smoke: extension boot, recent-activity view renders, no console errors.

### v0.16 (Bundle 2 = 2a + 2b)
- `bun run audit:vue` — typecheck must catch any callsite that doesn't thread `OperationContext`.
- `bun run test:e2e` — smoke covers popup paths.
- `bun run e2e:agent` — network covers token-import flow + cross-flow regression.
- Manual smoke: add a token from the modal; add a token via dapp `register_token`; observe terminal card in activity feed; observe cross-flow with a concurrent transfer.

---

## Decision points for user (consolidated → ELI5)

1. **Bundle 1 A2 cap shape**:
   - (α) **25 per (profile, account)** — fair across accounts. *(My pick.)*
   - (β) 50 per profile — simpler.
2. **Bundle 1 A2 e2e for alarm wiring**: include or skip? My pick: include (cheap; Plan-agent + codex both recommend).
3. **Bundle 1 ship as v0.15.7 separately** (my pick) or bundle with v0.16?
4. **B1 cancel-ignored toast**: defer indefinitely (my pick); revisit only if QA surfaces complaints.
5. **Bundle 2b UX copy**:
   - In-flight subtitle: (a/b/c above). My pick: (a) "Adding token…".
   - Terminal succeeded title: (a/b/c above). My pick: (a) "Token added".
   - Terminal failed title: (a/b/c above). My pick: (a) "Couldn't add token".
6. **Bundle 2b TaskService coexistence**: keep both (my pick) or remove TaskService for token imports in this round?
7. **Cross-flow e2e in Bundle 2**: include (my pick) or skip?

---

## Test budget v3 — final

- Bundle 1: 4 (A1 layer 1) + 3 (A1 layer 2) + 5 (A2) + 0 (A3) = **12 unit tests**, optionally + 1 e2e (A2 alarm).
- Bundle 2a: **5 unit tests**.
- Bundle 2b: **6 unit tests + 2 e2e (network).**
- **Total: ~23 unit + 2-3 e2e.** Up from v1's 14-16; the bump is load-bearing (layer-1 EntityStorage + invariant validations).

---

## Order of operations (final)

1. Write ELI5 HTML for user approval (this plan + decision points).
2. User answers decision points → plan v4 (locks open decisions).
3. Implement Bundle 1 → codex post-impl review → fix → land as v0.15.7.
4. Implement Bundle 2 → codex post-impl review → fix → land as v0.16.

Each landing is a separate PR onto `dev`.
