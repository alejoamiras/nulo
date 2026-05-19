# Pre-A11 UX cleanup arc — plan v3

Date: 2026-04-28
Supersedes: `plan-v2.md` (kept for diff context)
Audits incorporated: `audit-codex.md`, `audit-agent.md`
Status: pending codex re-audit on v3 deltas, then execute.

## What changed v2 → v3 (user push-back)

1. **Notes bug diagnosis was wrong.** User reports search box renders but cards don't. `notes.length > 0` (search box visible) BUT no rows render. That's a silent v-for failure, not raw-fallback rendering. Likely cause: an exception in the `v-for` body (missing import / bad helper / shape mismatch) that prod build swallows. Track is now "diagnose + fix the silent crash" — smaller than v2's parser rebuild. Type-detection enhancement is split off to a separate, non-blocking enhancement.

2. **Transaction-card lifecycle (corrected).** User clarified: the issue is the durable activity-feed card, NOT the popup window. The card layout for a dApp tx differs visibly between "loading/in-flight" and "submitted" — dApp name and function name shift position. Fix is to make the card visually consistent across phases. Less work than v2.

3. **Fee dropdown — token balances should not block rendering.** User pushed back: dropdown only needs gas balance + FPC list. Token balances populate "pay with token X" options but shouldn't gate the dropdown opening.

4. **Drop persistent-cache (stale-while-revalidate).** User's UX concern: showing a stale fee balance that then "jumps" to fresh value reads as buggy. Only pre-warm on unlock (option 2 of the three I sketched). First popup of a fresh session may briefly show a spinner; subsequent opens are instant.

5. **One branch per fix.** Each track ships as its own branch from master so user can test + merge independently. No accumulation.

6. **Commit signing**: skip GPG sign during this arc (user is away from PC, 1Password locked). User will re-sign later if needed.

---

## Branches (one per fix)

| Branch | Track | Size |
|---|---|---|
| `pre-a11/notes-vfor-fix` | Notes silent-crash diagnosis + fix | 1d |
| `pre-a11/contacts-sender-optin` | Sender opt-in via contacts | 1.5d |
| `pre-a11/fee-sync-dropdown` | Sync fee dropdown + pre-warm on unlock | 1d |
| `pre-a11/fee-estimate-reuse` | Estimate reuse + non-blocking confirm | 3.5d |
| `pre-a11/dapp-tx-card-consistency` | dApp tx card layout parity + journal write | 2d |

**Total: ~9 days** focused work. Order matches user-value: diagnose first, then visible polish, then deeper pipeline work.

---

## Branch 1 — Notes silent-crash diagnosis + fix

### Symptom (user-confirmed)

- Empty state ("NO NOTES YET") works on a 0-note account.
- On accounts with notes, the search input renders (proves `notes.length > 0`) but no cards appear below it.
- No "NO NOTES YET" placeholder visible in this state.
- No "NO MATCHES" visible (no search term).

### Root-cause hypothesis (ranked)

The v-else-if chain falls through to a branch that *should* render cards. If it renders nothing, the most likely causes:
1. **Exception inside the v-for body** — Vue swallows render errors in prod. Suspects in the body: `getColorFromAddress(note.contract)` (auto-imported helper; if undefined, the `:style` binding might silently fail), `trimAddress(note.contract, 4, 4)`, `parseNoteContent(note)` choking on an unexpected `note.content` shape (e.g., not an object).
2. **Reactivity desync** — `filteredNotes` computed returns the right length but the v-for binds to a stale ref. Less likely; computed reactivity in Vue 3 is reliable.
3. **CSS/scope issue** — `.card` style fails to load and cards render with 0 height. Should be observable in DOM.

### Plan

1. **Add console-log instrumentation (before fix):**
   - Log `notes.length`, `filteredNotes.length`, and the first note's keys after `fetchNotes()` resolves.
   - Wrap each helper call (`getColorFromAddress`, `trimAddress`, `parseNoteContent`) in a try/catch that logs the input + error.
   - Build chrome extension; user reproduces; capture console output.

2. **Fix per the diagnosis.** Most likely outcome: a missing helper import or a defensive guard needed against a `note.content` shape we didn't account for. Worst case: structural shift between the `Note` type (`note/spec.ts:3-18`) and what PXE returns post-Aztec-nightly bump.

3. **Defensive render guard (always):** add a `try` wrapper around the per-row content with a fallback to "Note (failed to render)" so a single bad note can't blank the entire page.

### Tests

- Unit: parseNoteContent with `null`, `undefined`, `{}`, `{ unknown_key: "x" }`, `{ value: "0x123" }`.
- Unit: helpers (`getColorFromAddress`, `trimAddress`) handle malformed input without throwing.
- E2e (smoke): notes page renders cards when account has at least one note (currently no fixture; add a minimal one or skip and note coverage gap).

### Out of scope (split to separate future PR)

- Re-implementing rich note type-detection (`type`, `location`, `content` population). Cards will continue to render the raw fallback once the v-for crash is fixed; making them informative is a separate enhancement.

---

## Branch 2 — Contacts ↔ sender opt-in

### Plan

1. **NewContactPopup**: add a checkbox "Also register as a private-transfer sender" (default **checked**). Tooltip: "Required to receive private tokens from this address." On submit:
   - `addContact()` runs.
   - If checked: `addSender(activeNetworkId, address)` runs after, non-fatal failure (toast).

2. **EditContactPopup**: show registration status inline. On popup mount, hit `getSenders(activeNetworkId)` once and cache for the popup session. Three states:
   - "Registered as sender" + checkmark (read-only).
   - "Not registered" + "Register now" CTA.
   - Skeleton (loading).
   - On address change: prompt "Old sender registration kept on the network. Remove it?" (default keep).

3. **ImportContactsPopup**: add a checkbox "Also register imported contacts as senders" (default **OFF**). If checked, run sender registrations **serially** (PXE single-threaded per `FeeSettingsCard.vue:253` doc). Background batch with progress; popup remains interactive.

4. **Token detail page**: add a one-line banner — only when private balance is 0 AND the token was added by the user — "Expected a private transfer that didn't arrive? Make sure the sender is registered → Settings." Dismissable per (token, account) via `chrome.storage.local`. Three-dot menu: add "Manage senders" link.

5. **No backfill on network switch.** Drop entirely (audit-flag).

### Tests

- Unit: `addContact()` failure does not skip `addSender()` and vice versa.
- Unit: sender popup-cache invalidates on `onSenderAdded` / `onSenderDeleted`.
- E2e: NewContact with default-checked → submit → senders page lists the new address.
- E2e: Import with checkbox OFF → submit → senders page unchanged.
- E2e: EditContact address-change → confirm-prompt appears.

### Threat-model rewrite (in plan, not code)

Senders are a privacy surface beyond contacts: dApps with `aztec_getPrivateEvents` permission can observe events filtered by sender. Auto-registering all contacts broadens the dApp-observable graph. Ship is therefore opt-in: default-on for individual NewContact (intentional add), default-off for Import (bulk and harder to audit), no silent backfill.

---

## Branch 3 — Sync fee dropdown + pre-warm on unlock

### Plan

1. **Decouple dropdown render from token balances.** Today `FeeSettingsCard.runInit()` does `Promise.all([gas, tokenBalances, fpcs])` and gates the dropdown spinner on all three. Token balances are only needed to populate "pay with token X" options downstream. The dropdown trigger needs only:
   - Existing 5-min gas cache (`execution/service.ts:163-170, 907-933`).
   - FPC list (`fpcService.getFpcs()`).
   - Saved fee-method preference (`chrome.storage.local[FEE_METHOD_LS_KEY]`).

   Render the trigger synchronously off these. Token balances continue loading in parallel and populate token-fee options when ready (their own subtle skeleton, not the trigger).

2. **Pre-warm on unlock.** When the wallet unlocks (popup mount + auth resolve), kick off background fetches for gas + FPC for the active chain. By the time the user opens a Send or Approval popup, both are warm. This is option (2) from the cache discussion — no persisted-cache (avoids the "stale value jumps to fresh" UX concern).

3. **FPC cache in popup**, invalidated by `onFpcAdded` / `onFpcDeleted` / `onFpcUpdated` events (events already exist in `fpcService` spec — verify and subscribe). Re-emit the cache state through the existing app store.

4. **Auto-pick sponsored FPC synchronously** when the saved preference is missing and a `DefaultSponsoredFpc` is in the cached FPC list. Today this auto-pick runs inside `runInit` — pull it out so it happens off the cache.

### Heuristic for invalidation

- **Event-driven (primary):** `onTransactionUpdated` (already wired for gas), `onFpcAdded` / `onFpcDeleted` / `onFpcUpdated`, active-chain change.
- **Soft 5-min TTL (safety net):** if cache age > 5 min and no event has invalidated, refetch on next read.
- **Manual refresh** (already exists): tapping "Refresh balances" invalidates immediately.

### Tests

- Unit: dropdown opens without firing `getGasBalances` when cache is fresh.
- Unit: cache invalidates on `onTransactionUpdated`, `onFpcAdded`, `onFpcDeleted`.
- Unit: pre-warm on unlock fires gas + FPC fetches in parallel.
- E2e: open Send popup on a warm session, dropdown shows fee method instantly (no spinner).

---

## Branch 4 — Estimate reuse + non-blocking confirm

### Plan

1. **`executeSendTransaction()` + `executeAztecSendTx()` accept an optional `precomputedTxRequest?` parameter** carrying the *post-strategy* mutated tx request (not the input op).

2. **Validation snapshot.** When the popup successfully estimates, hold:
   - The post-strategy `TxRequest`.
   - Snapshot: `{ baseFee, gasSettings, feeMethod, priority, opActionsHash }`.

3. **On Confirm, validate before reuse:**
   - Re-fetch `node.getCurrentMinFees()` (cheap single round-trip).
   - Compare against snapshot baseFee.
   - Verify `feeMethod` / `priority` / `opActionsHash` unchanged.
   - All match → submit precomputed `TxRequest`. **Skip the second `buildAndEstimateTxRequest()`.**
   - Any divergence → fall back to the current path (rebuild + estimate fresh).

4. **Non-blocking confirm (bundled).** Allow Confirm while `isEstimating` is true. The Confirm path:
   - If estimate not done: wait for in-flight estimate, then validate + submit.
   - If estimate stale: trigger fresh.
   - Button label flows: `Confirm` → `Estimating fee…` (if estimate not done) → `Proving…` → `Submitting…` → done.
   - Hard-stop: Confirm stays disabled if a fee error is showing.

### Tests

- Unit: estimate reused when snapshot matches; not reused when feeMethod / priority / opActions / baseFee changes.
- Integration: estimate → 30s idle → Confirm → assert `buildAndEstimateTxRequest` called only once.
- Integration: estimate → change recipient → Confirm → assert re-estimation IS triggered.
- Integration: race — Confirm clicked during in-flight estimate → wait + serialize + submit.
- E2e (network suite, requires green-state): full Send flow with estimate reuse pin.

---

## Branch 5 — dApp tx card layout parity + journal write

### What user actually wants

The durable transaction card on the activity feed for a dApp tx looks one way while in-flight and a different way once submitted — specifically the dApp name and function name shift position. Make these consistent: same component, same field positions, only status text changes through phases.

### Plan

1. **Inspect the two states.** Read `RecentActivityView.vue` + `TransactionAwaitingCard.vue` + journal-rendering paths. Identify exactly which fields move between in-flight (TaskService-driven) and submitted (journal-driven). The contract should be: `{title, subtitle, status, app?}` rendered in the same template regardless of phase.

2. **Unify the renderer.** Either:
   - Refactor to a single `TransactionCard.vue` that takes a phase prop and renders consistently, OR
   - Patch the two existing renderers so the field positions match.
   Choice depends on what the inspection reveals. Default to the smaller patch.

3. **Write `dapp_execute` journal records.** When `executeSendTransaction()` and `executeAztecSendTx()` resolve (success or failure), write an `OperationJournal` entry with `kind: "dapp_execute"` (already declared at `operation-journal/spec.ts:19` — no schema migration). Carries: dApp hostname, signing account, op summary, txHash. This makes dApp txs survive SW restart in the activity view.

4. **Brief subtitle change in the popup window** for the ~200-500ms before window closes after Confirm. Phase progression: `proving` → `submitting`. Static text label change inside the existing button or below it; no new component.

5. **Multi-op approvals**: support the single-op happy path. Multi-op gets a single window-level subtitle reflecting the *current* op being processed. Per-op post-confirm rows are deferred to post-A11.

### Out of scope

- Holding the execute window open through `submitted` (needs new correlation surface; deferred to post-A11).
- Per-op post-confirm status rows.
- Token-page parity for dApp activity (`RecentActivityView.vue:176` intentionally suppresses dApp tasks token-scoped).

### Tests

- Unit: `executeSendTransaction` writes a journal entry with the right account on success.
- Unit: failure path writes a `failed` journal entry.
- E2e: dApp approval succeeds → window closes → activity view shows the dApp tx with consistent field positions vs in-flight state.

---

## Sequencing

Branches ship in this order; each merges to master independently:

1. **Branch 1 (notes-vfor-fix)** — quickest, unblocks user's flow.
2. **Branch 3 (fee-sync-dropdown)** — visible polish, low risk, isolates fee noise for later QA.
3. **Branch 2 (contacts-sender-optin)** — self-contained, additive.
4. **Branch 4 (fee-estimate-reuse)** — pipeline change, test-heavy.
5. **Branch 5 (dapp-tx-card-consistency)** — last; benefits from cleaner fee state landed in 3+4.

User can test + merge as each branch lands. Nothing accumulates.

## Verification

Per branch: typecheck + lint + units + smoke e2e. Branches 4 + 5 also run the network e2e suite (fee-methods + dapp approval) before merge.

## Decisions to confirm before execution

1. **Notes diagnosis approach** (Branch 1): instrument with logs first → user reproduces → fix? Or jump straight to a defensive try-catch wrap and ship the fix blind, log-instrument as fallback if it doesn't resolve? My recommendation: instrument first, fix is more surgical.
2. **Banner copy** (Branch 2): "Expected a private transfer that didn't arrive? Make sure the sender is registered." Approve as-is or rewrite.

## Risk register (v3)

1. Branch 1 may surface an unexpected root cause requiring a deeper fix (e.g., Aztec-nightly shape change). Sizing accommodates 1-2 days, won't blow up the arc.
2. Branch 4 race semantics: Confirm during in-flight estimate must serialize correctly. Adversarial test required.
3. Branch 5 multi-op degraded UX: if user reports it, fast-follow.
4. Branch 3 cold-cache first popup of session: still has a one-time spinner. Acceptable per user.
5. Auto-pick sponsored FPC synchronously off cache: if the saved preference points to a now-deleted FPC, fall back to default. Test required.
