# Phase 2+ — durable-jobs follow-on (plan v2, post-audit consolidation)

**Status:** v2 — consolidates Plan-agent (opus 4.7) + codex pre-impl audits of v1
**Branch target:** `dev` (Phase 2 + cancel-semantics-v2 merged @ `f81b3e6c`, v0.15.6)

## Summary of audit verdicts

- **Plan-agent (opus 4.7):** "Fix-then-ship Bundle 1 as v0.15.7; re-scope Bundle 2 before approval."
- **Codex:** "Re-scope." Three substrate blockers v1 missed.

## What v1 got wrong (verified against the code)

1. **A1 (zod-on-load) was at the wrong layer.** I said wrap the journal service's load helper. There is no `_load`. Parsing happens *inside* `EntityStorage.get/getValues/getAll` at `packages/wallet-core/src/storage/entity_storage.ts:52,70,86` as bare `JSON.parse(v as string)` — no try/catch. **One malformed row throws inside `getValues` and poisons every reader.** Layer-1 fix has to live in `EntityStorage`. Layer-2 schema validation lives in the journal service.
2. **C2 (token-import FSM) had a deeper substrate blocker than "simulating → succeeded".** `JobProgress.succeeded` is typed `{ stage: "succeeded"; txHash: string }` (`packages/wallet-core/src/jobs/types.ts:44`). Token imports have no tx hash. Additionally, succeeded journal records are *intentionally suppressed* in three places:
   - `RecentActivityView.vue:210` — `if (op.progress?.stage === "succeeded") return false`
   - `activity.vue:74` — similar filter
   - `journal-state.ts:73` — `if (stage === "succeeded") return null`
   Rationale: succeeded sends/dapp_execute records have an on-chain `TransactionService` entry that surfaces them as confirmed txs. **A token-import succeeded record has no on-chain counterpart and would silently vanish.** This is a real substrate gap, not a card-rendering footnote.
3. **C2/C4 — `TokenService.addToken` has two callers, not one.**
   - Popup add-token modal.
   - dApp `register_token` op via `executeRegisterToken` (`execution/service.ts:1034-1049`).
   `addToken(profileId, networkId, accountAddress, ti, parentTask)` has no parameter for `origin` or `dappOrigin`. Threading journal context naively from inside `addToken` would tag every import as one origin or the other regardless of caller — wrong.
4. **D1 (migration framework + v8 wipe) was weakly justified.** Journal lives in `chrome.storage.session` which clears on browser exit. If Bundle 1 is the first public release and Bundle 2 wipes the journal, users lose their in-browser-session activity history. Codex flagged this as a real regression. **Drop D1 entirely** — the proposed schema changes (optional fields, new `OperationKind` variant) are forward-compatible with v7 storage; no wipe needed.

## What both audits agreed on

- **Drop B1 from Bundle 1.** The cancel-ignored race is too narrow to justify an RPC contract change in a hardening pass. If we keep it at all, ship with Bundle 2 (popup-touching pass).
- **A2 cadence: separate `nulo:journal:gc` alarm @ `periodInMinutes: 60`.** Every-Nth-tick is fragile (SW restart resets counters).
- **A2 age**: 30 days is wrong for session storage. Plan-agent → 7 days. Codex → "row cap or much shorter TTL". I converge on **row cap as primary** (predictable bound, no time math needed for session-lived storage); short TTL optional.
- **B1 contract (if shipped later): throw `CancelTooLateError extends WalletError`**, not return boolean. Matches existing typed-error round-trip (`JobCancelledError`, `WalletError`).

## What v2 changes vs v1

| v1 | v2 |
|---|---|
| Bundle 1 = A1 (one-layer) + A2 (every-60-tick, 30d) + B1 toast | Bundle 1 = A1 (two-layer: EntityStorage resilience + journal Zod safeParse) + A2 (separate alarm, row-cap) |
| B1 in Bundle 1 (optional) | B1 dropped from this round; documented as "open option, defer" |
| Bundle 2 = C1-C4 + D1 migration framework (v8 wipe) | Bundle 2 split into **2a substrate** + **2b token imports**. D1 dropped. Schema additions are forward-compat with v7. |
| C2 = "extend FSM with simulating→succeeded" | C2 = full substrate work: make `succeeded.txHash` optional; differentiate UI suppression by kind; THEN extend FSM |
| `addToken` signature unchanged | `addToken` gains a context arg threaded from both callers |

---

## Bundle 1 — Production hardening (v0.15.7)

### A1 — Two-layer storage resilience

**Layer 1 — `EntityStorage` per-row JSON.parse resilience.**

Files: `packages/wallet-core/src/storage/entity_storage.ts` lines 48-87.

Wrap each `JSON.parse(v as string)` in try/catch. On parse failure:
1. Log Error with the key + truncated payload.
2. **Quarantine**: copy the raw value to a sibling key under the same root namespace (e.g. `nulo:journal@<id>` → `nulo:journal:quarantine@<id>`) and delete the original row. Quarantine is per-root, not global, so a generic primitive: `EntityStorage` ctor takes an optional `quarantineRoot` arg; if set, parse failures move bad rows there.
3. Skip the row from the iteration result. Callers see the array minus the bad row.

Single-row `get()` returns `undefined` on parse failure (caller already handles undefined as "not present").

**Test taxonomy for Layer 1** (in `packages/wallet-core/src/storage/entity_storage.test.ts` — file may not exist yet, create it):
- Valid row round-trips.
- Malformed row in `get()`: returns undefined, quarantined.
- Malformed row in `getValues()`: returns array minus the bad row, quarantined.
- Quarantine disabled (no quarantineRoot): bad row deleted, not preserved.

**Layer 2 — `OperationRecordSchema.safeParse` on journal-service public reads.**

Files: `packages/extension/src/wallet/services/operation-journal/service.ts` — find `getOperation` (~line 160) and `getOperations` (~line 166).

After `EntityStorage` returns a record (or array of records), pipe each through `OperationRecordSchema.safeParse`. On `success: false`: same policy — quarantine via `EntityStorage`'s primitive, log Error, omit from result.

**Test taxonomy for Layer 2** (in `operation-journal/service.test.ts`):
- Valid record round-trips.
- Schema-mismatched record (e.g. `stage: "rabbit"` snuck past layer 1): quarantined, omitted.
- Two records, one valid one schema-mismatched: getOperations returns only the valid one.

### A2 — Terminal record row-cap (no time-based GC)

**Why row-cap over TTL.** Session storage clears on browser exit anyway. The accumulation problem is "within one browser session, how many terminal records pile up". A row cap is predictable, unit-testable, and time-independent. TTL on session-lived data is a category error.

**Design.**
- Cap: keep at most `MAX_TERMINAL_RECORDS_PER_PROFILE = 50` terminal records per profile. (Decision point — pick 50, 100, or 25; 50 is comfortable headroom over the 5-row UI cap.)
- Sweep trigger: a new `nulo:journal:gc` alarm, `periodInMinutes: 60`. Boot-time sweep on `start()`, same idempotency as the reaper.
- Sweep logic: for each profile, get all terminal records, sort by `terminalAt` desc, delete entries from index `MAX_TERMINAL_RECORDS_PER_PROFILE` onward.
- Live alongside reaper: reaper handles non-terminal stuck records; GC handles terminal record bloat. They never touch the same record set.

**Race-safety vs `clearChainState`.** Both paths call `journal.deleteOperation` and emit `onOperationDeleted`. Subscribers (`RecentActivityView`) treat missing records idempotently. Add one test pinning: GC delete + chain-purge delete of same record both fire → subscriber observes one delete, no crash.

**Tests** (extend `operation-journal/reaper.test.ts` or new sibling `journal-gc.test.ts`):
- More than cap terminal records for one profile → oldest deleted, newest cap-kept.
- Records under cap → none deleted.
- Non-terminal records never touched by GC path (even if old).
- GC + clearChainState double-delete is idempotent for subscribers.

**E2E** (1, in `tests/e2e/network/journal-gc.test.ts` — *optional, Plan-agent recommendation*):
- Seed 55 terminal records in session storage via injection helper, boot SW, assert 50 remain after `start()`. Catches alarm-wiring bugs unit tests miss.

### A3 — Storage usage observability log

**Why.** Cheap data point for whether 50 is the right cap, and for spotting bloat in other namespaces.

**Implementation.** In `runtime.ts` boot path (after `services.start()` but before reaper), one log line: `await chrome.storage.session.getBytesInUse()` + count of records per `nulo:journal@` prefix. Log at Info. Single-shot; not periodic.

No tests (observability log).

---

## Bundle 2 — Phase 2.5 (v0.16): Token imports as durable jobs

Split into **2a (substrate)** and **2b (token imports)**. 2b depends on 2a but they can land in one PR.

### Bundle 2a — Substrate for non-tx terminal records

**The core change.** `JobProgress.succeeded` becomes `{ stage: "succeeded"; txHash?: string }`. The "succeeded" record can represent two semantic terminations:
- *On-chain success* (transfer, dapp_execute) — has `txHash`, surfaced by `TransactionService`, suppressed from journal-terminal-display.
- *Non-tx success* (token_import, future imports) — no `txHash`, surfaced *from the journal* via a render path that today doesn't exist.

**Pinned invariants.** The kind ↔ txHash relationship has to be enforceable:
- `kind: "transfer" | "dapp_execute"` → succeeded MUST have `txHash`.
- `kind: "token_import"` (etc.) → succeeded MUST NOT have `txHash`.

Enforce in `transitionOperation` (`operation-journal/service.ts`): when transitioning to `succeeded`, validate against the kind. Throw `IllegalTransitionError` with a clear message on mismatch.

**FSM update** (`packages/wallet-core/src/jobs/fsm.ts`):
- Add `simulating → succeeded` to `LEGAL_TRANSITIONS`.
- Keep `pending → simulating | failed | cancelled` (no `pending → succeeded` skip).
- Keep `submitting → succeeded` as the on-chain path.

**UI suppression update.** The three suppression sites need a kind-aware branch:
- `journal-state.ts:73`: `if (stage === "succeeded" && (kind === "transfer" || kind === "dapp_execute")) return null` — those still surface via on-chain card. `token_import` succeeded falls through to terminal-display.
- `RecentActivityView.vue:210` + `activity.vue:74`: same kind-aware branch.

**Tests for 2a** (~5):
- `fsm.test.ts`: `simulating → succeeded` legal, `pending → succeeded` still illegal, `submitting → succeeded` still legal. (3 pins, can be one test with `legalEdges` table additions.)
- `operation-journal/service.test.ts`: succeeded with `kind: "transfer"` requires `txHash`; succeeded with `kind: "token_import"` requires `txHash === undefined`. (2 tests.)
- `journal-state.test.ts`: `journalTerminalDisplay` returns null for succeeded transfer; returns non-null for succeeded token_import. (2 tests.)

### Bundle 2b — Token imports through the journal

**Schema** (`operation-journal/spec.ts`):
- `OperationKind`: add `"token_import"`. `kind: z.enum(["transfer", "dapp_execute", "token_import"])`.
- Add `contractAddress?: string` to `OperationRecord` + `NewOperationInput` schemas.
- Optional fields = backward-compatible. No migration / v8 bump needed. Records from v0.15.6 parse fine.

**`addToken` signature** — caller-context arg:

```ts
type OperationContext = { origin: "popup" | "dapp"; dappOrigin?: string }

addToken(
  profileId: string,
  networkId: string,
  accountAddress: string,
  ti: TokenInterface,
  parentTask?: WrappedTask,
  opContext?: OperationContext,    // ← new, optional
): Promise<void>
```

Callers:
- Popup add-token: `opContext: { origin: "popup" }`.
- `executeRegisterToken` (`execution/service.ts:1048`): `opContext: { origin: "dapp", dappOrigin: ... }` — needs the dapp origin threaded from `executeOperations` (already available at the call site).
- Default to `{ origin: "popup" }` if omitted (least-surprise; preserves existing test setups that don't pass context).

**Journal flow inside `addToken`:**
```ts
const op = await journal.createOperation({
  kind: "token_import",
  origin: opContext.origin,
  profileId,
  accountAddress,
  networkId,
  contractAddress: ti.address,
  title: ti.symbol ?? formatAddress(ti.address),
  subtitle: opContext.origin === "dapp" ? `Requested by ${opContext.dappOrigin}` : "Adding token…",
})

await journal.transitionOperation(op.id, { stage: "simulating" })
try {
  // existing metadata + balance fetch + watchlist add
  await journal.transitionOperation(op.id, { stage: "succeeded" })  // no txHash for non-tx ops
} catch (err) {
  await journal.transitionOperation(op.id, { stage: "failed" }, {
    kind: classifyTokenImportError(err),
    message: getErrorMessage(err),
    normalizedRaw: normalizeError(err),
  })
  throw err
}
```

**TaskService coexistence.** Plan-agent question: keep TaskService alongside or remove?
- **Keep both for now.** Popup's in-memory TaskService is what powers the existing "Adding token…" spinner during the modal. Removing it would mean rewiring the modal to subscribe to journal updates. Out of scope; defer.
- **Decision point**: do we remove TaskService for token imports in this round, or leave the dual path? I lean *leave*. Confirms a small Phase 2.5++ later.

**UI card variants.**

In-flight (`TransactionAwaitingCard.vue`):
- Branch on `kind === "token_import"`: icon = `coins-stacked` (verify in `assets/icons.json`; fallback `circle-add`); title = `op.title`; subtitle = stage-aware ("Importing…", "Verifying…").

Terminal (`TransactionTerminalCard.vue`):
- Succeeded: icon = `check-circle`, title = `${tokenSymbol} added`, subtitle = `${contractAddress}` (truncated).
- Failed: icon = `close-circle`, title = "Couldn't add token", subtitle = error.message (truncated).
- Cancelled: not applicable (no Cancel button for imports).

**UX copy (decision points):**
- In-flight title: "Importing token" / "Adding token" / `${tokenSymbol ?? "Token"}`?
- In-flight subtitle: "Fetching metadata…" (technical) / "Adding token…" (friendly) / dappOrigin if from dapp.
- Terminal succeeded title: "Token added" / "Added ${symbol}" / "${symbol} added".
- Terminal failed title: "Couldn't add token" / "Add failed".

My picks (open to user override):
- In-flight title: token symbol if known, else "Token".
- In-flight subtitle: "Adding token…" (popup) / "Added by ${dappOrigin}" (dapp).
- Terminal succeeded: "Token added".
- Terminal failed: "Couldn't add token".

**Tests for 2b** (~6 unit + 1-2 e2e):
- `spec.test.ts`: schema accepts `kind: "token_import"`; accepts `contractAddress`. (1 test).
- `token/service.test.ts`: addToken creates journal entry; transitions to succeeded; transitions to failed on metadata error. (3 tests).
- `TransactionAwaitingCard.test.ts`: renders token_import variant (1 test).
- `TransactionTerminalCard.test.ts`: renders succeeded + failed token_import (1 test, two assertions).
- **E2E (network):** `tests/e2e/network/token-import.test.ts` — full add-token flow ending in journal succeeded card. (1 test).
- **E2E (network) — cross-flow regression** (Plan-agent recommendation): start a token import while a transfer is in `proving`, assert both reach terminal correctly. Catches per-(profile,chain) PXE mutex regressions. (1 test).

**Concurrency / PXE mutex check.** Plan-agent flagged: does `addToken`'s `parseTokenInterface` + balance backfill share the per-(profile, chain) PXE mutex with `proveTx`? Worth verifying before implementation. Expected behavior: token-import serializes behind any in-flight prove on the same PXE. If so, that's the contract — document it; cross-flow e2e pins it.

---

## What's NOT in v2 (explicit non-goals)

- **B1 (cancel-ignored toast).** Both audits agreed: drop. Race is narrow, RPC contract change for marginal UX. Carry to a hypothetical future Phase 2++.
- **D1 (migration framework).** Codex flagged the v8 wipe as a regression. Bundle 2 is forward-compat with v7 storage (only optional field additions + new enum variant). Defer until a *destructive* schema change actually forces a version bump.
- **dappRequestId / popup reattach, IDB backup, cross-profile fairness, retry, per-stage prove progress.** All decline calls survive both audits.
- **Histoire/Lost-Pixel coverage.** Still blocked on M6 phase 10.
- **Removing TaskService from `addToken`.** Dual path lives on; clean-up is a Phase 2.5++ task.

---

## Test budget v2

- Bundle 1: 4 (A1 layer 1) + 3 (A1 layer 2) + 4 (A2) + 0 (A3) = **11 unit tests**, optionally + 1 e2e (A2 alarm wiring).
- Bundle 2a: **5 unit tests**.
- Bundle 2b: **6 unit tests + 2 e2e (network)**.
- **Total: ~22 unit + 2-3 e2e.** Slightly above v1's budget but each test is load-bearing per the "succinct" rule.

---

## Order of operations

1. **v0.15.7** — Bundle 1 (A1 + A2 + A3). Pure SW-internal hardening. Low blast radius. Ships first because it's the substrate cleanup we want before any further schema work.
2. **v0.16** — Bundle 2 (2a + 2b together — they're coupled). Token imports as durable jobs.

Each ships as a separate PR onto `dev`. Each PR ends with full `audit:vue` + smoke e2e (no UI for v0.15.7; UI for v0.16) + network e2e for v0.16.

---

## Decision points for user (consolidated → ELI5)

1. **A2 cap value: 25 / 50 / 100 terminal records per profile?** My pick: **50** (10× UI cap).
2. **A2 e2e for alarm wiring: include or skip?** My pick: **include** (Plan-agent recommendation; cheap, catches alarm bugs).
3. **B1 cancel-ignored toast: defer indefinitely (my pick), or ship in v0.16?**
4. **2a `succeeded.txHash` optional + kind-aware suppression**: confirm direction or propose a `validating` stage instead (uglier; both audits prefer optional `txHash`).
5. **2b TaskService coexistence**: keep both (my pick) or remove TaskService for token imports in this round (more work)?
6. **2b UX copy**: confirm picks above or override?
7. **Ship v0.15.7 separately from v0.16 (my pick), or bundle?**
8. **Cross-flow e2e for Bundle 2 (token-import-during-prove): include or skip?** My pick: **include** (per Plan-agent).

---

## Open risks I want codex to confirm in v3 review

- **A1 quarantine** — is it safer to *delete* malformed rows than to quarantine them? Quarantine preserves forensic recovery but means a corrupted record's payload may survive in storage. Plan-agent suggested quarantine; codex's response was "delete + log + continue is right policy". Probably go with simple delete (codex's pick) + log the truncated payload to Error. Drop the quarantine seam to keep things simple.
- **2a kind-aware succeeded validation** — does adding the kind check in `transitionOperation` regress any existing test? Search for `succeeded` transitions in `operation-journal/service.test.ts` to confirm none pass a token_import-shaped payload (they shouldn't — token_import doesn't exist yet).
- **Concurrency** — confirm `parseTokenInterface` shares the PXE mutex with `proveTx`. If it doesn't, the cross-flow e2e covers different ground than intended.

These three go in the next codex round (final review of v2).
