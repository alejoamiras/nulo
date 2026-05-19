# Pre-A11 UX cleanup arc — plan v4

Date: 2026-04-28
Supersedes: `plan-v3.md` (kept for diff context)
Audits: `audit-codex.md` (v1), `audit-agent.md` (v1), `audit-codex-v3.md` (v3 delta)
Status: APPROVED for execution per user direction. Ship branch-by-branch with `--no-gpg-sign`.

## What changed v3 → v4 (codex v3 delta audit)

1. **Branch 4 scope tightened.** Reuse contract carved to `send_transaction` + non-embedded, non-`default_entrypoint` `aztec_sendTx` only. Other variants take divergent execution paths today and aren't safe candidates.
2. **Branch 4 snapshot includes endpoint identity.** Primary endpoint can change at runtime; captured in the snapshot, validated at confirm.
3. **Branch 1 reframed.** Helpers are null-safe — "silent blank" is NOT a helper exception. Plan now: DOM inspection + a precomputed safe display-model in script (not template-level try-catch).
4. **Branch 2 test wording corrected.** `addContact` failure is hard stop; only `addSender` is non-fatal. Test asserts that.
5. **Branch 3 cache ownership clarified.** SW services own warm state; popup stores mirror. Cache key includes profile id (private gas balance is profile-scoped).
6. **Branch 5 explicit field contract.** Single shared `TransactionCard`-style layout with stable field positions. Plus network-aware journal filter on `RecentActivityView`.
7. **Order shift**: 1 → 3 → 2 → **5 → 4** (Branch 5 ahead of Branch 4; both touch the execution service, smaller-first).

## Branches (final order)

| # | Branch | Track | Size |
|---|---|---|---|
| 1 | `pre-a11/notes-vfor-fix` | Notes silent-render | 1d |
| 2 | `pre-a11/fee-sync-dropdown` | Sync dropdown + pre-warm | 1.5d |
| 3 | `pre-a11/contacts-sender-optin` | Contacts → sender opt-in | 1.5d |
| 4 | `pre-a11/dapp-tx-card-consistency` | dApp tx card unified layout + journal write | 2.5d |
| 5 | `pre-a11/fee-estimate-reuse` | Estimate reuse + non-blocking confirm | 4d |

**Total: ~10.5 days** focused work.

---

## Branch 1 — Notes silent render fix

### Approach (reshaped)

Helpers are null-safe; page-level catch surfaces errors as a banner. So the silent-blank symptom is not a helper exception. More likely:
- A single bad note crashes the v-for body without the catch firing (template-level errors don't bubble to the script-level try/catch in `fetchNotes`).
- Reactivity timing issue.
- Layout/CSS issue making cards 0-height.

### Plan

1. **Add temporary instrumentation** (to be removed before merge): log `notes.value`, `filteredNotes.value`, and the keys of the first note after `fetchNotes()` resolves.
2. **Precompute a safe `displayNote` model** in `<script setup>` so the template renders only off plain primitives (no helper calls in template). Each `displayNote` is built inside a per-note try/catch in script with a `renderError?: string` field so a single bad note becomes "Note (failed to render)" instead of breaking the page.
3. **User reproduces**, captures console, sends back; finalize the underlying fix (likely a missing field or a shape mismatch between `Note` spec and PXE response).
4. **Remove instrumentation** before merge.

### Tests

- Unit: `parseNoteContent(null)`, `parseNoteContent(undefined)`, `parseNoteContent({})`, `parseNoteContent({ unknown: "x" })` all return non-throwing values.
- Unit: the new `buildDisplayNote(note)` returns `renderError` on malformed input rather than throwing.
- E2e (smoke): notes page renders search box AND empty state when account has no notes (regression for the v3-correction symptom).

### Branching + commit

`pre-a11/notes-vfor-fix` from master. Commit with `--no-gpg-sign`. Bump patch.

---

## Branch 2 — Fee sync dropdown + pre-warm on unlock

### Approach (audit-corrected)

- Decouple dropdown render from token balances entirely. Trigger renders synchronously off gas + FPC + saved preference.
- Cache lives at SW level (existing `executionService` 5-min cache stays canonical); popup-side Pinia mirrors only the most recent snapshot for synchronous reads.
- Pre-warm on unlock: kick off `getGasBalances` + `getFpcs` for active chain when the wallet unlocks. No persisted-cache (per user push-back).
- Cold-cache first popup of session: one-time spinner accepted (rare).

### Cache key correction

Gas cache key includes profile id, not just `(networkId, accountAddress)`. Reason: private gas balance depends on profile-scoped FPCs.

### Heuristic (final)

- Event-driven invalidation: `onTransactionUpdated` (gas), `onFpcAdded`/`Deleted`/`Updated` (FPC), active-chain change, profile switch.
- Soft TTL: 5 min safety net.
- Manual refresh: existing "Refresh balances" path.

### Tests

- Unit: gas cache invalidates on `onTransactionUpdated`, profile switch, network switch.
- Unit: FPC cache invalidates on `onFpcAdded`/`Deleted`/`Updated`.
- Unit: `FeeSettingsCard.runInit` does NOT block trigger render on token balances.
- Race test: "unlock triggers warm + user opens fee card immediately" — dropdown should render off the ongoing fetch's resolved values.
- E2e: open Send popup on a warm session, dropdown renders fee method without spinner.

---

## Branch 3 — Contacts ↔ sender opt-in

### Plan

1. **NewContactPopup**: checkbox "Also register as a private-transfer sender" (default **checked**). Submit:
   - `addContact()` runs (failure = hard stop, popup stays open with error).
   - If checkbox checked AND contact saved: `addSender(activeNetworkId, address)` runs after, **non-fatal failure** (toast: "Contact saved · sender registration failed; retry from Senders").

2. **EditContactPopup**: inline registration status. Hit `getSenders(activeNetworkId)` once on popup mount, cache for popup session. Three states (registered/not-registered/loading). On address change: prompt "Old sender registration kept on the network. Remove it?" (default keep).

3. **ImportContactsPopup**: checkbox "Also register imported contacts as senders" (default **OFF**). If checked, run sender registrations **serially** (concurrency 1) as background batch with progress; popup remains interactive.

4. **Token detail page**: one-line banner ONLY when private balance is 0 AND user-added token: "Expected a private transfer that didn't arrive? Make sure the sender is registered → Settings." Dismissable per (token, account). Three-dot menu: "Manage senders" link.

5. **No backfill on network switch.**

### Tests

- Unit: `addContact()` failure does NOT trigger `addSender()` (corrected from v3).
- Unit: `addSender()` failure leaves saved contact intact (non-fatal).
- Unit: sender popup-cache invalidates on `onSenderAdded`/`Deleted` AND on network switch.
- E2e: NewContact with default-checked → senders page lists new address.
- E2e: Import with checkbox OFF → senders page unchanged.
- E2e: EditContact address change → "Remove old?" prompt appears.

---

## Branch 4 — dApp tx card unified layout + journal write

### Field contract (single shared layout)

Both in-flight (TaskService) and submitted (journal) renders use:

```
[icon]  [TITLE: method name]
        [SUBTITLE: dApp hostname · call-count if multi-op]
        [STATUS: phase text + amount/hash chip]
```

- Title: method name first (matches submitted-card grammar; in-flight cards lose the redundant prefix).
- Subtitle: dApp identity, stable across phases.
- Status: phase-driven (Proving → Submitting → Submitted; or Failed).

### Plan

1. **Inspect divergence** (codex-cited): `RecentActivityView.vue:79-88, 291-304` (in-flight) vs `TransactionCard.vue:78-95, 127-131` + `tx-enrichment.ts:78-104` (submitted). Document exact field shifts.
2. **Build a single presentational `TransactionCardLayout` component** that both renderers use. Move the in-flight + submitted layouts to share the same template; phase prop drives status text only.
3. **Write `dapp_execute` journal records** from `executeSendTransaction()` and `executeAztecSendTx()` on success and failure. Carries: dApp hostname, signing account, op summary, txHash, networkId.
4. **Network-aware journal filter** on `RecentActivityView`: filter journal entries by `(accountAddress, networkId)`, not just account (codex-flagged hidden coupling for multi-network profiles).
5. **Brief subtitle change in popup window** for the ~200-500ms before close: phase progresses `proving → submitting`. Static text, no new component.
6. `aria-live="polite"` on the phase text.

### Out of scope

- Hold execute window open through `submitted` (deferred to post-A11).
- Per-op post-confirm rows in execute window.
- Token-page parity for dApp activity.

### Tests

- Unit: `executeSendTransaction` writes a journal entry with the right `(accountAddress, networkId)` on success and failure.
- Unit: in-flight + submitted renders use the same layout component (snapshot test).
- Unit: `RecentActivityView` filters journal by network when provided.
- E2e: dApp approval succeeds → window closes → activity view shows dApp tx with consistent field positions.
- E2e: SW restart after dApp approval → popup reopens → activity view still shows the dApp tx (journal-driven survival).

---

## Branch 5 — Estimate reuse + non-blocking confirm

### Scope (carved per audit)

Reuse applies to:
- `executeSendTransaction()` (Send page).
- `executeAztecSendTx()` **only when**: `feeMethod !== embedded` AND op is NOT `default_entrypoint`.

Other variants fall back to current path. Plan documents this explicitly.

### Snapshot (audit-corrected)

```
{
  baseFee, gasSettings, feeMethod, priority, opActionsHash,
  primaryEndpointId, primaryEndpointUrl,   // NEW
}
```

### Plan

1. **`executeSendTransaction()` + `executeAztecSendTx()`** accept optional `precomputedTxRequest?` parameter (post-strategy mutated tx request).
2. **Validation at submit:**
   - Re-fetch `node.getCurrentMinFees()` and verify against snapshot baseFee.
   - Verify `feeMethod`, `priority`, `opActionsHash` unchanged.
   - **Verify primary endpoint id+url unchanged.**
   - Verify branch is in the carved set (not embedded, not `default_entrypoint`).
   - All match → submit precomputed `TxRequest`.
   - Any divergence → fall back to fresh `buildAndEstimateTxRequest()`.
3. **Non-blocking confirm** (bundled): allow Confirm while estimating; button label flows `Confirm` → `Estimating fee…` → `Proving…` → `Submitting…`.
4. **Hard-stop**: Confirm disabled if a fee error is showing.

### Tests

- Unit: snapshot match → reuse; mismatch on each field individually → fresh estimate.
- Unit: endpoint change between estimate and confirm → fresh estimate.
- Unit: embedded-fee `aztec_sendTx` ALWAYS goes fresh (carve-out).
- Unit: `default_entrypoint` ALWAYS goes fresh.
- Unit: planner/authwit preprocessing not double-run on reuse.
- Integration: estimate → 30s idle → Confirm → assert single `buildAndEstimateTxRequest` call.
- Integration: estimate → change recipient → Confirm fast → re-estimation triggered.
- Integration: race — Confirm during in-flight estimate → serialized + submitted.
- E2e (network suite): full Send flow with estimate-reuse pin.
- E2e (network suite): full Send flow with cold-cache (no reuse path).

---

## Verification per branch

- `bun run typecheck` + `bun run lint` + `bun run test` + `bun run test:e2e` (smoke).
- Branches 4 + 5 also run network e2e (fee-methods + dapp approval).

## Commit policy

- One branch per fix from `master`.
- Commits with `--no-gpg-sign` per user (1Password locked).
- Each branch ends with patch version bump + commit.
- User merges branch-by-branch.

## Decisions still to confirm

1. **Branch 1 first instrumentation**: am I instrumenting + asking user to repro, OR shipping the display-model fix blind first and adding instrumentation only if it doesn't resolve? My recommendation: ship the fix (display-model + render guard) directly — the safety guard is right regardless, and the user reproducing console logs is friction.
2. **Branch 3 banner copy** on token detail page (still my draft).

## Risk register

1. Branch 1 root cause may not be in helpers — could be a shape regression from Aztec nightly. Display-model approach absorbs both.
2. Branch 5 carve-outs documented in code comments — risk that a future contributor extends reuse to `default_entrypoint` without revisiting. Mitigation: explicit guard with assertion + test.
3. Branch 4 unified component refactor: risk of regression on the submitted-card path that already works. Mitigation: snapshot tests covering both modes.
4. Branch 2 cold offscreen import: bulk register is multi-second. Background-task UX with progress.
5. Branch 5 race semantics on Confirm-during-estimate: adversarial test required.
6. Cross-window cache divergence (popup ↔ execute window): accepted out-of-scope.
