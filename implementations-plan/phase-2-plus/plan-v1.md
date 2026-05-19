# Phase 2+ — durable-jobs follow-on (plan v1, pre-audit)

**Status:** draft v1 — me only, before Plan-agent + codex audits
**Branch target:** `dev` (Phase 2 + cancel-semantics-v2 already merged @ `f81b3e6c`, v0.15.6)
**Scope philosophy:** Phase 2 left the substrate solid (FSM, reaper, carries, multi-(profile,chain) PXE). Phase 2 follow-ups (terminal-cards, feesettings, card-affordances, affordances-v4, cancel-semantics-v2) covered the UX gaps surfaced in QA. What remains in the original "Phase 2+" lane is: (a) production hardening before first release, (b) one cosmetic UX gap, and (c) the Phase 2.5 substrate extension (token imports as durable jobs).

This plan is a **bundle proposal**: I recommend two landings (Bundle 1 = hardening, Bundle 2 = Phase 2.5). User can approve either independently.

---

## What's actually open (after the audit-by-Explore cross-check)

Of the original "Phase 2+ candidates" in `phase-2/summary.html`:

| ID | Original framing | Reality today | Disposition |
|---|---|---|---|
| D1 | Migration framework absorbing v6 wipe | Single entrypoint `runStorageMigration` in `storage/migrate.ts`; clean, one entrypoint. v7 already added inline (Phase 2 follow-up v4). Refactor pays off only when a v8 lands. | **Bundle with Phase 2.5 (which forces v8).** Skip standalone. |
| D2 | IDB backup for browser-restart durability | Declared unrecoverable in Phase 2 summary (offscreen dies with browser → prove state gone → cannot resume). | **Decline.** Phase 2 closeout was correct. |
| D3 | Phase 2.5 — token imports as durable jobs | `TokenService.addToken` (`packages/extension/src/wallet/services/token/service.ts:107-150`) uses TaskService (in-memory) for progress. `OperationKind` lacks `"import_token"`. | **Bundle 2.** Real user-visible upgrade. |
| D4 | Strict Zod on journal reads | Schema is enforced on every RPC entrypoint via `validateParams` (write side). Load side (`_load`) trusts session storage. | **Bundle 1 — narrow scope.** Add `OperationRecordSchema.safeParse` on load; delete + log + continue on mismatch. |
| D5 | Histoire/Lost-Pixel for RecentActivityView | Histoire harness not in `audit:vue`. Blocked by M6 phase 10. | **Defer until M6.** |
| Cancel-ignored UX | Toast for race "click Cancel during proving, FSM rejects because already submitting" | Cancel button is *hidden* when `stage === "submitting"` (verified at `TransactionAwaitingCard.vue:61`). Race window = the few ms between popup state update and SW handling the click. Real but vanishingly small. | **Bundle 1 — small + cheap; or drop.** Decision point for user. |
| Tombstone GC | Phase 2 explicitly accepted unbounded terminal accumulation | Terminal records keep `terminalAt` set but are never deleted. UI caps at 5 rows so visually invisible; storage bloats over months. `JournalReaper` only marks stuck records, doesn't delete. | **Bundle 1 — add sweep mode to reaper.** |
| Cross-profile fairness, memory cap, retry | Carries were preserved (`origin`, `profileId`, `attempts`) | No demand yet; retry was explicitly killed in Phase 2 follow-up v4. | **Defer indefinitely.** |
| dappRequestId / popup reattach | Schema field for window-reload-mid-dApp | Not needed. Journal lives in session storage; popup reload survives. Window manager re-binds via `jobId`. | **Decline.** |
| Per-stage prove progress (carry #4) | Show prover %  inside `proving` stage | BB.wasm prove blocks JS turn; PXE exposes no callback. JS heartbeat would deadlock. | **Decline.** Technically infeasible. |

**Net:** four items survive into the proposed Bundles. Bundle 1 = A1 (zod load), A2 (GC), B1 (cancel-ignored toast — optional). Bundle 2 = C1-C4 (token imports as jobs) + D1 (migration framework, naturally paired with C's v8 bump).

---

## Bundle 1 — Production hardening + UX polish (small)

### A1 — Zod validation on journal load path

**Problem.** `OperationJournalService._load` reads session storage and trusts the parsed JSON. If a record is malformed (e.g. partial migration, corrupted by some unrelated bug, or a future v7→v8 mismatch on first boot), the downstream `transitionOperation` indexes into `LEGAL_TRANSITIONS[stage]` and could throw a TypeError instead of `IllegalTransitionError`. The reaper then catches and logs but the record is unreachable until the v8 wipe fires.

**Fix.** In the load helper that parses session-storage JSON into `OperationRecord`, wrap with `OperationRecordSchema.safeParse(raw)`. On `success: false`: delete the storage key, log a warning with the schema error, continue. On `success: true`: return the parsed record.

**Files:**
- `packages/extension/src/wallet/services/operation-journal/service.ts` — the `_load` (or equivalent) helper.
- `packages/extension/src/wallet/services/operation-journal/spec.ts` — already exports `OperationRecordSchema`. No change.

**Tests:** 3 in `operation-journal/service.test.ts`:
1. Round-trip: valid record survives load.
2. Malformed record (missing `progress.stage`): deleted from storage, warning logged, no record returned.
3. Schema-mismatch (e.g. `stage: "rabbit"`): same as #2.

### A2 — Terminal-record GC sweep in `JournalReaper`

**Problem.** Phase 2 deliberately keeps terminal records forever (carry #2 — tombstones). The UI caps render at 5 rows so a user with months of activity never sees the bloat, but `chrome.storage.session` quota is finite and the records accumulate unboundedly. Even with conservative usage, ~1 terminal record per tx + UI cards persisting beyond browser-session, this is technically a leak.

**Fix.** Add a second sweep mode to `JournalReaper.reap()` — call it `mode: "gc"`. Selects records where `terminalAt !== null && (now - terminalAt) > GC_AGE_MS` and calls `journal.deleteOperation(id)`. Run once per boot (after the existing boot sweep) and every Nth alarm tick (to avoid running every minute).

**Decisions:**
- `GC_AGE_MS`: 30 days. (User-visible: terminal cards aren't going to render beyond ROW_BUDGET=5 anyway.)
- Frequency: boot + once per 60 alarm ticks (so ~hourly when SW is alive). Cheaper than per-minute and the bloat is slow.
- Does GC preserve idempotency / tombstones for any consumer? **Search needed** — but `dispatcher.ts` resolves operations by `jobId` *during* their lifecycle; a 30-day-old terminal record being deleted has no readers.

**Files:**
- `packages/extension/src/wallet/services/operation-journal/reaper.ts` — add GC path.
- `packages/extension/src/wallet/services/operation-journal/reaper.test.ts` — extend.

**Tests:** 3 in `reaper.test.ts`:
1. Terminal record older than `GC_AGE_MS` deleted on boot sweep.
2. Terminal record younger than `GC_AGE_MS` kept.
3. Non-terminal record (e.g. proving) never deleted by GC path (still subject to stuck-record sweep).

### B1 — Cancel-ignored toast *[OPTIONAL — decision point]*

**Problem.** If the user clicks Cancel while stage is `proving`, the popup hides the button optimistically; the SW receives the cancel, FSM rejects it because the stage already advanced to `submitting`, SW drops the signal silently and logs debug. The user wonders why nothing happened until the success/failure card lands ~seconds later.

**Question for user:** Is this worth the cycles? Pros: closes a UX confusion window. Cons: it's a vanishingly small race; the success card lands quickly anyway; adds a moving part.

**Fix (if approved).** `cancelJob` RPC returns `boolean` (was `void`). In execution-service `cancelJob` (`service.ts:783-814`), if FSM transition succeeds → return `true`, if it rejects → return `false`. In `recent-activity-handlers.ts:buildCancelHandler`, on `false` open a toast.

**UX copy candidates (single-sentence, declarative — to be decided):**
- (a) "Transaction already sent — can't cancel."
- (b) "Too late to cancel — your transaction is being broadcast."
- (c) "Cancel arrived too late; transaction is already submitting."
- (d) "Couldn't cancel — already submitted to the network."

My recommendation: **(b)** — explains *why*, friendly tone.

**Files:**
- `packages/extension/src/wallet/services/execution/spec.ts` — `cancelJob` signature change (`void → boolean`).
- `packages/extension/src/wallet/services/execution/service.ts` — return value.
- `packages/extension/src/popup/components/modules/general/recent-activity-handlers.ts` — `buildCancelHandler` shows toast on `false`.

**Tests:** 2 unit:
1. `cancelJob` returns `true` when stage = `proving`.
2. `cancelJob` returns `false` when stage = `submitting`.

No e2e — the race is non-deterministic without mocks.

---

## Bundle 2 — Phase 2.5: Token imports as durable jobs

### Context

`addToken` is a non-trivial flow:
1. Resolve token-contract metadata (decimals, symbol, name) via PXE.
2. Detect type (asset vs FPC vs unknown via heuristics).
3. Add to per-account watchlist.
4. Backfill balance.

Today this is wrapped in a TaskService step that gives the popup live progress. The "popup lies during proving" pathology that Phase 2 fixed for sends applies in miniature here: if the popup closes mid-import, the in-flight task vanishes from the UI on reopen. Less severe because imports don't broadcast on-chain — failure mode is "the user thinks the import didn't happen, retries, no harm done" rather than "phantom transaction." Still worth fixing for consistency.

### C1 — Schema extension

**`packages/extension/src/wallet/services/operation-journal/spec.ts`:**
- `OperationKind`: add `"token_import"` (or `"import_token"` — naming decision).
- Existing fields cover the metadata needed: `tokenId?` already exists; `accountAddress` is the consumer. `title` = token symbol or contract address (during the import we don't yet know the symbol — see C2).
- No new field needed if we lean on `title`/`subtitle`. **Decision point**: should we add a `contractAddress` field instead of overloading `tokenId`? `tokenId` is the post-import internal id; during import it doesn't exist yet.

**Recommendation:** Add `contractAddress?: string` (top-level optional, populated at create-time for token imports). Future-proof and parallel to `recipientAddress` for transfers.

### C2 — Journal wiring in `TokenService.addToken`

Wrap the addToken implementation so it:
1. `journal.createOperation({ kind: "token_import", origin: "popup", profileId, accountAddress, contractAddress, title: contractAddress (short), subtitle: "Importing token…" })`
2. Transitions to `simulating` while fetching metadata.
3. Transitions to `succeeded` on completion (no `proving` stage — there's nothing to prove).
4. On error: `failed` with appropriate `JobError.kind` (e.g. `"metadata_fetch"`, `"already_imported"`).

**FSM compatibility check:** existing FSM `pending → simulating → succeeded` is legal (skips `proving` and `submitting`). Verify against `assertCanTransition` — I believe this is already legal, but pin it.

Actually wait — checking `wallet-core/src/jobs/fsm.ts`: the LEGAL_TRANSITIONS table has `simulating → proving` and `proving → submitting` as the main path. `simulating → succeeded` is NOT in the legal set. **This is a real schema gap.**

**Decision point for user:** two options to handle:
- (a) Add `simulating → succeeded` to FSM legal set. Costs: opens the FSM to other "no-prove" flows in the future, which is good if we want token imports to be first-class. Bad if we want token imports to look identical to transfers; they don't actually need a "submitting" stage.
- (b) Add a new stage variant `validating` (instead of `proving`) for token imports. `pending → simulating → validating → succeeded`. Costs: schema gets uglier; need to update OperationRecordSchema; cards branch on kind to render correctly. Good if we want strict per-kind FSM shapes.

**My recommendation:** **(a)** — extend FSM with `simulating → succeeded`. Simpler. Aligns with "token imports are a simpler subset of the same FSM." Carry #4 (extensible progress) makes per-stage UI easy.

### C3 — Activity card variant for token-import

Today `TransactionAwaitingCard` and `TransactionTerminalCard` branch internally on `kind === "transfer"` vs `"dapp_execute"`. Add a third branch:
- `kind === "token_import"`: title = "Adding token" (or token symbol if available), subtitle = `contractAddress` truncated, icon = `wallet-plus` (verify icon exists in `assets/icons.json`).

Terminal states:
- Succeeded: "Token added"
- Cancelled: not applicable (no cancel button for imports).
- Failed: "Couldn't add token"
- Interrupted (SW restart): "Add interrupted — try again."

**UX copy decision points** included.

### C4 — Wire `TokenService.addToken` callers

Find all callers (Send page, Add Token modal, dApp `wallet_watchAsset` if it exists). All should now journal automatically because the journal is inside `addToken`.

Verify `wallet-bridge` doesn't have an alternative path that bypasses the journal.

### D1 — Migration framework refactor (bundled with C)

C bumps storage to v8 (`OperationKind` extended → existing v7 records still parse since the field set is a superset, BUT the FSM legal set changes; previously-stuck `simulating` records might be reinterpretable. Safer to wipe).

Refactor `migrate.ts` from inline switch to a versioned migration registry:
- `migrations/index.ts` — exports `MIGRATIONS: readonly Migration[]` sorted by `to` version.
- `migrations/0008.ts` — the v8 wipe (token-import schema).
- `runStorageMigration` becomes a fold over the registry.

**Tests:** 4 in `migrate.test.ts`:
1. Fresh install (no version key) → CURRENT_VERSION, all migrations skipped (no records to wipe).
2. v7 → v8: triggers v8 wipe.
3. Re-run from CURRENT_VERSION: no-op.
4. Future-proofing: registry is in monotonic order (lint-style assertion).

### Tests for Bundle 2

Unit (~7):
- `spec.test.ts`: schema accepts `kind: "token_import"`, accepts `contractAddress` field, schema rejects unknown kind. *(2 tests)*
- `fsm.test.ts`: `simulating → succeeded` legal; pin the new edge. *(1 test)*
- `token/service.test.ts`: addToken creates + transitions journal entry; addToken failure transitions to `failed` with correct `kind`. *(2 tests)*
- `TransactionAwaitingCard.test.ts` + `TransactionTerminalCard.test.ts`: render token-import variants. *(2 tests, one each)*

E2E (network, ~1):
- `tests/e2e/network/token-import.test.ts`: add an asset to a fresh account; assert journal entry reaches `succeeded`. (May already exist as a non-journal test; refactor to assert journal state.)

---

## Validation & gates

### Before opening PR
- `bun run audit:vue` (typecheck → unit + component → lint → build).
- `bun run test:e2e` (smoke).
- `bun run e2e:agent` (network) — required because Bundle 2 touches token + journal across SW boundary.

### CI checks per-PR
- Quality / Status (commitlint, lint, typecheck, units, build).
- Smoke e2e / Status (auto-triggered if popup/contracts touched).
- Network e2e / Status (auto-triggered if `extension-network` filter hits — Bundle 2 will).

### Test count budget
- Bundle 1: 3 (A1) + 3 (A2) + 2 (B1, if approved) = 6-8 tests.
- Bundle 2: ~7 unit + 1 e2e = 8 tests.
- **Total: ~14-16 tests.** Within budget per the user's "succinct" goal.

---

## Decision points for user (call these out in ELI5)

1. **B1 — ship the cancel-ignored toast, or drop?** I recommend ship (small) but flag as optional.
2. **B1 copy** — pick (a)/(b)/(c)/(d) from above. I recommend (b).
3. **C — Phase 2.5 in this round, or split?** I lean: ship Bundle 1 first as v0.15.7 (hardening), then Bundle 2 as v0.16 (token imports). Two smaller PRs > one big one.
4. **C2 — FSM extension strategy (a) vs (b)?** I recommend (a) — extend FSM with `simulating → succeeded`.
5. **C1 — add `contractAddress` field, or overload `title`?** I recommend add the field.
6. **C3 — UX copy** for token-import card states. Draft above.

---

## Order of operations

1. This plan goes to (a) Plan-agent (opus 4.7) and (b) codex via helper script, in parallel.
2. Consolidate audit feedback → plan v2.
3. Plan v2 → codex for final blessing.
4. User reviews ELI5 HTML and answers decision points → plan v3 (approved).
5. Implement Bundle 1 → codex post-impl review → fix → land.
6. Implement Bundle 2 → codex post-impl review → fix → land.

---

## Open questions / risks I want audited

- **A2 GC frequency.** Is "every 60th alarm tick" the right cadence, or should GC live on its own alarm with a longer period? Chrome alarms minimum is 1 min in prod — we already pay that. A separate `nulo:journal:gc` alarm with `periodInMinutes: 60` is cleaner.
- **A2 GC age.** 30 days vs 7 days. Smaller window = more aggressive cleanup but risks losing user-visible history they might want.
- **C2 FSM extension.** Is `simulating → succeeded` really safe, or does it break invariants the existing FSM relies on? Need codex's read on this.
- **C concurrency.** If user kicks off 3 token imports at once, do they serialize on the per-(profile, chain) PXE mutex from Phase 2 W3, or do they parallelize? Token import is a PXE read — likely safe to parallelize. Need to check.
- **C migration risk.** Wiping journal on v8 also wipes succeeded transfer history. User would lose all "Recent activity" tombstones. Is that acceptable? Phase 2 explicitly was — no production users.
- **B1 race condition.** Is `cancelJob` actually FSM-rejecting in the `submitting` stage, or does the optimistic UI race make this irrelevant? Re-read the cancel-semantics-v2 work to confirm.

---

## Stuff NOT in this plan (explicit non-goals)

- Cross-profile fairness, per-origin rate limits.
- Memory cap on warm profiles.
- Retry (explicitly killed in Phase 2 follow-up v4).
- dApp request reattach across popup reload.
- Histoire/Lost-Pixel coverage (blocked on M6).
- IDB backup of journal (declined as out-of-scope).

These all stay carried in the schema (origin, profileId, attempts) for whenever they become real demand.
