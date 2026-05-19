# Codex audit (xhigh effort) — Pre-A11 UX cleanup

Date: 2026-04-27
Model: gpt-5.4 with `reasoning_effort=high`
Source log: `/tmp/codex-audit-pre-a11.log` (raw, ~15k lines including tool transcripts)

## BLOCKING

- **Track A mis-models the Send lifecycle.** `pages/send.vue:235, 278` fire-and-forgets `executeTransfer()` and immediately calls `leaveSend()`; the user navigates away before any phase header could be seen. Implementing Track A as written leaves Send unchanged. Fix: redefine the unification target around the durable awaiting card on General/Activity (`RecentActivityView.vue:106`), not Send/Execute pages themselves.

- **Execute window cannot observe `submitted` or `failed` after approval.** `dapp-interaction/service.ts:82` deletes the interaction record, detaches the window handle, starts `executeAndResolve()` async. The popup only listens for `onInteractionCancelled` (`execute/index.vue:249, 365`) — no progress, no completion. The plan's claim "we already get this signal" is false. Fix: add a correlation path before any hold-open UX (return a task/journal id from approval, OR keep interaction alive until execution settles with explicit progress events).

- **Hold-open introduces lifecycle holes around `beforeunload` + window detachment.** `closeWindow(true)` at `execute/index.vue:255, 290` is the only place removing the `beforeunload` reject handler. Background already detaches the window handle on approve (`dapp-interaction/service.ts:87`). User closing mid-proving → tx continues headless, popup has no authoritative success/failure surface. Fix: decide whether post-approve close is user-cancellable; if not, disable the close affordance after approval; if yes, don't promise in-window failure visibility.

- **Multi-op approvals are not representable by a single window phase.** `execute/index.vue:463` renders one fee/estimate/control per operation. Execution is sequential; later ops become `skipped` after first failure (`execution/service.ts:408`). A single window phase collapses partial success / skipped / per-op errors. Fix: scope Track A to single-op approvals first, OR add per-op post-confirm status rows.

- **Track B-1 relies on an event that doesn't exist.** `onGasBalanceUpdated` is not in `execution/spec.ts:8`. Today the gas cache invalidates only when a tx leaves Pending (`execution/service.ts:217`). Private gas balance also depends on FPC list (`execution/service.ts:968`). Fix: cache must be background-owned, keyed by `(profile, network, account)`, invalidated by `onTransactionUpdated`, `onFpcAdded/Deleted/Updated`, and token-balance events. Not a pure Pinia refactor.

- **Track B-2 "same params + 30s" reuse is unsafe.** `buildAndEstimateTxRequest()` is not pure — `finalizeGasLimits()` fetches live `node.getCurrentMinFees()` (`fee-strategy.ts:147`); `FpcStrategy` recomputes from live base fees (`fpc-strategy.ts:58`); even no-from path seeds from current min fees (`tx-request-builder.ts:442`). Stale reuse can underprice gas or embed wrong FPC payload across base-fee/endpoint changes. Fix: reuse only within the same in-memory submit path, validated against a captured fee/base-fee snapshot — OR reuse only the user-visible number while rebuilding the request.

- **Track C privacy claim is materially wrong.** Contacts are exposed via `aztec_getAddressBook` (`execution/service.ts:1076`), but sender registration affects what PXE can decrypt and what a dApp with `aztec_getPrivateEvents` permission can read (`dapp-interaction/service.ts:290`, `execution/service.ts:1059`). Auto-registering all contacts broadens the observable private-event surface for already-authorized dApps — not equivalent to "contacts already plaintext at rest." Fix: rewrite threat model; auto-register should be opt-in or active-network-only.

## SHOULD-FIX

- **Backfill belongs in a coordinator, not in `AccountStateService`.** That service has no `onActiveNetworkChanged` / `onActiveProfileChanged` wiring (`account-state/service.ts:35`). Put backfill in a dedicated background coordinator subscribed to `ProfileService`/`NetworkService`, OR in popup bootstrap if "when wallet UI opens" is sufficient (`app.vue:156`).

- **`ImportContactsPopup` concurrency 3 is optimistic.** `FeeSettingsCard.vue:253` documents that PXE is effectively single-threaded and parallel calls caused 60s regressions. Start serial (concurrency 1); raise only if measured.

- **Sender-status cache for `EditContactPopup` needs an invalidation contract.** `getSenders()` is a full PXE read (`account-state/service.ts:52`). "Cache it" is not enough. Define a shared sender store keyed by `networkId`, hydrated once, invalidated by `onSenderAdded`/`onSenderDeleted` + network change (events already exist).

- **Track D: explicitly separate "raw rows" from "zero rows."** Mark hypothesis as "confirmed for raw fallback, unproven for zero rows."

- **If Track A keeps execute window open, fee controls must freeze post-approve.** `FeeSettingsCard` remains interactive while `isLoading` is true; only footer buttons disable (`execute/index.vue:520, 815`). Hard-disable per-op controls once approval starts.

## NITS

- Add `aria-live="polite"` to any new phase/subtitle element.
- Notes-page "Refresh" button is lower value than fixing parser/network-refresh semantics first.
- Track C token-page copy: scope to private-zero-balance states only; broad sender education reads as noise.

## RISKS NOT YET FLAGGED

- dApp in-flight continuity is weaker than Send across SW restart. Tasks are in-memory only; only journal records survive restart, and dApp sends do not currently write journal records (`task/service.ts:31`, `operation-journal/spec.ts:19`).
- Token-scoped `RecentActivityView` intentionally suppresses dApp execute tasks (`RecentActivityView.vue:176`). Token-page lifecycle parity is a gap.
- A popup-local fee-source store won't be shared between normal popup and execute window (separate documents). Caching helps within a window, not across.

## TEST PLAN ADDITIONS

- **Track A**: e2e for dApp approval success, dApp approval failure, manual window close after approve, batched multi-op with second-op failure.
- **Track B**: unit tests for gas-source invalidation on tx settlement and FPC add/delete; integration test proving estimate reuse is rejected on priority change, fee-method change, base-fee/endpoint change; UI test with two `FeeSettingsCard` instances in one execute window.
- **Track C**: integration tests for add/edit/import contact → sender registration, PXE-down non-fatal save, idempotent backfill on network switch, sender-status cache invalidation.
- **Track D**: unit tests around restored `parseNote` type/location/content inference; page test for raw fallback when contract metadata is unavailable.

## REWRITE SUGGESTIONS

- **Track A**: split into A1 visual grammar and A2 execution-progress plumbing. Header copy can land before the hold-open decision; hold-open requires the execute window to subscribe to a task/journal id.
- **Track B**: move "fee source cache" into a background-backed read model, not Pinia-only. Popup reads snapshot; SW owns invalidation.
- **Track C**: ship "auto-register on add/import for active network" first; evaluate backfill after privacy review.
- **Track D**: treat parser restoration as a medium fix. Git history shows the richer parser was removed wholesale, not lightly broken.
