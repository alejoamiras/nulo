Verdict: the brief is mostly right, but I’d correct two points up front. C2 is likely not just codex Med #1; the current code also has a separate replay-loss path when `PopupManager` connects before the active `(profile, network, account)` tuple exists. And the proposed `pending iff hidden record exists...` invariant needs one guard: only auto-reconcile the unresolved branch (`unknown`/`pending`), never overwrite user-chosen `trusted`/`blocked`.

**Phase Plan**
1. **C2 repro pins first.** Files: `packages/extension/src/popup/components/popups/PopupManager.test.ts`, `packages/extension/tests/e2e/network/incoming-transfers.test.ts`. Ship: deterministic reproductions for `popup close -> reopen` replay loss and `incomingTransfersVisible false -> true` suppression during init. Tests: component race harness plus one MV3 popup-lifecycle e2e. Risk: low. Depends: none.

2. **Encode the trust reconcile invariant in one helper.** Files: `packages/extension/src/wallet/services/incoming-transfer/service.ts`, `.../service.scenarios.test.ts`. Ship: a single `reconcilePendingTrust(...)` path that recomputes only the unresolved branch from persisted records, evaluating outgoing/in-flight membership per record/account, and explicitly leaving `trusted`/`blocked` untouched. Tests: pending->unknown, pending stays pending, trusted/blocked never auto-demote. Risk: medium. Depends: none.

3. **Serialize late-delete by tx hash.** Files: `packages/extension/src/wallet/services/incoming-transfer/service.ts`, `.../service.scenarios.test.ts`. Ship: replace raw `onTransactionAdded` delete loop with a per-`txHash` guarded/serialized delete-and-reconcile path so duplicate same-hash emits cannot double-fire `onIncomingTransferDeleted`. Tests: two concurrent same-hash emits produce one delete event and one reconcile. Risk: medium. Depends: 2.

4. **Reconcile when the journal learns `submitting.txHash`, not only when tx storage does.** Files: `packages/extension/src/wallet/services/incoming-transfer/service.ts`, `.../service.scenarios.test.ts`. Ship: subscribe to `OperationJournalService` add/update events and route any newly-visible `progress.txHash` through the same delete/reconcile path; this is the real fix for PXE note discovery beating transaction persistence. Tests: note arrives first, journal later exposes `txHash`, record disappears, `pending` rolls back if no actionable hidden notes remain. Risk: medium-high. Depends: 2-3.

5. **Harden PopupManager replay/auto-close lifecycle.** Files: `packages/extension/src/popup/components/popups/PopupManager.vue`, `.../PopupManager.test.ts`, optionally `packages/extension/tests/e2e/network/incoming-transfers.test.ts`. Ship: seed visibility before processing updates or ignore updates until seeded; defer replay until active scope exists; replay again on active-scope arrival after connect; auto-close the currently open trust popup when the same triple is reconciled from `pending` to `unknown`. Tests: phase-1 races go green, plus self-note auto-close. Risk: medium-high. Depends: 1-4.

6. **Manual token add auto-trust, popup path only.** Files: `packages/extension/src/popup/components/popups/NewTokenPopup.vue`, `.../NewTokenPopup.test.ts`. Ship: after successful popup-origin `addToken`, call `IncomingTransferServiceClient.setTrustAllow(submittingProfileId, submittingNetworkId, newToken.contract)` as best-effort. Do not move this into `TokenService.addToken`, because that would also trust dApp `registerToken`. Tests: success path calls allow once; parse/error/duplicate paths do not. Risk: medium-low. Depends: 5.

7. **Low-risk cleanup bundle: aria, method label, onboarding copy.** Files: `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`, `packages/extension/src/utils/tx-enrichment.ts`, `.../tx-enrichment.test.ts`, `packages/extension/src/onboarding/pages/fees.vue`. Ship: fix `aria-controls`/`v-if`, map `claim_and_end_setup` to `Claim Fee Juice`, and rewrite fees copy for A1-A4 without changing flow or routes. Tests: add only the method-label unit pin; copy/aria are trivial and can stay manual QA. Risk: low. Depends: none.

8. **Failure taxonomy utility before page redesign.** Files: `packages/extension/src/utils/journal-state.ts`, `.../journal-state.test.ts`. Ship: promote `JobError.kind` mapping from “tag + generic subtitle” to a wallet-owned label/context model that clearly separates simulation/pre-broadcast failures from on-chain/submission failures, without introducing new components. Tests: exhaustive kind pins, especially simulation vs network/submit-style categories. Risk: low-medium. Depends: none.

9. **Restyle `journal/[id].vue` to mirror `tx/[id].vue` hierarchy.** Files: `packages/extension/src/popup/pages/journal/[id].vue`, likely a new page test. Ship: header -> status badge -> key facts -> details -> debug, reusing existing brutalist spacing/borders from `popup/pages/tx/[id].vue` and `popup/pages/settings/appearance.vue`; no edits to `tx/[id].vue`, no new failure-category components. Tests: one focused component/page pin for hierarchy + dev-mode raw-error gating + sanitized dApp origin rendering. Risk: medium. Depends: 8.

10. **E1 reproduce in automation, then fix the confirmed layer.** Likely files: `packages/extension/src/popup/pages/send.vue`, `packages/extension/src/composables/useProfileBootstrap.ts`, `packages/extension/src/popup/app.vue`, possibly `packages/extension/src/stores/app.store.ts` if active-account persistence is implicated, plus `packages/extension/tests/e2e/network/transfers.test.ts`. Ship: first pin the exact profile-switch/send failure, then fix at the layer the repro proves: page-local resnapshot, bootstrap sequencing, or profile/account persistence. Tests: new e2e for profile A -> profile B -> send, plus the smallest unit/component pin that matches the chosen layer. Risk: medium-high. Depends: none, but easier after 1-9 reduce unrelated popup noise.

11. **Close the explicit codex glue-test gaps and run regression sweep.** Files: `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`, new `packages/extension/src/popup/components/modules/general/RecentActivityView.test.ts`, `packages/extension/src/popup/components/popups/PopupManager.test.ts`, maybe one e2e extension to `incoming-transfers.test.ts`. Ship: tests for `onAccountAdded -> hydrateSchedulers`, `RecentActivityView.connect()` on mount, OFF->ON replay, and popup close/reopen after unresolved trust prompt. Risk: low. Depends: 3-5 and 10.

**Security & Adversarial Considerations**
- Trust reconciliation must be idempotent and scoped to unresolved trust only. A literal “hidden record exists => pending” rule would wrongly clobber `blocked`.
- Reconcile must evaluate self-note status per record account, not per current popup account, because trust rows are keyed by `(profileId, networkId, contract)` while records are per account.
- PXE can deliver notes before both journal and transaction persistence, and may rediscover the same note after delete. The fix should make “known outgoing/in-flight hash” the source of truth, not “record currently exists”.
- Visibility-gate hardening must prevent both failure modes: over-suppression of legitimate replays and under-suppression that leaks a contract touch while the user opted out.
- Popup lifecycle needs explicit coverage for popup unload/reopen, SW reconnect, hidden vs destroyed popup, and multiple popup windows. If cross-window dedupe is out of scope, call that residual risk out in the PR.
- B1/B2 must keep all new failure labels/context wallet-controlled. Do not ever derive them from `op.subtitle` or other dApp-controlled strings; keep `sanitizeJournalSubtitle` and developer-mode-only raw error fields intact.
- Confirmed tx detail QA surface is best protected by not editing `packages/extension/src/popup/pages/tx/[id].vue` at all.
- Dependency policy should stay unchanged: no new packages, preserve `bun.lock`, preserve the 7-day `minimumReleaseAge` gate and current Puppeteer exclusions.

**Assumptions**
Facts
- `IncomingTransferService` currently sets `pending`, writes a hidden record, and emits `onIncomingTransferPending`; `onTransactionAdded` only deletes matching records and emits delete, with no trust rollback path. `packages/extension/src/wallet/services/incoming-transfer/service.ts:366-377`, `:440-459`
- `replayPendingPrompts` only replays persisted `pending` trust rows with hidden records and bails entirely when `incomingTransfersVisible` is off. `packages/extension/src/wallet/services/incoming-transfer/service.ts:497-520`
- `PopupManager` replays on `incomingTransferService.onConnected`, but returns early unless `appStore.profile`, `appStore.network`, and `appStore.account` already exist; it also starts with `lastVisibility = true` and seeds after `connect()` + `getValue()`. `packages/extension/src/popup/components/popups/PopupManager.vue:105-156`
- `IncomingTrustPopup` unconditionally points `aria-controls` at a node that only exists under `v-if="expanded"`. `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:133-156`
- Manual token import goes through `NewTokenPopup` with `origin: "popup"` and currently does not touch incoming-transfer trust state. `packages/extension/src/popup/components/popups/NewTokenPopup.vue:170-203`
- dApp `registerToken` is already popup-gated and validates the requested account against the session’s authorized accounts before execution. `packages/wallet-bridge/src/dispatcher.ts:433-488`
- `humanizeMethodName` title-cases unknown snake_case methods, and `claim_and_end_setup` is not in `METHOD_LABELS`. `packages/extension/src/utils/tx-enrichment.ts:14-64`
- `send.vue` snapshots tokens and balances on mount; its watchers do not resubscribe on profile/network/account identity changes. `packages/extension/src/popup/pages/send.vue:302-379`
- `bootstrapActiveProfile` is async and sequences profile -> networks -> account -> tx sync -> `isLogined`. `packages/extension/src/composables/useProfileBootstrap.ts:63-76`
- `TokenBalanceService.getTokenBalances` filters by `tokenId` and `accountAddress`, while the service separately repopulates its token map on active-profile change. `packages/extension/src/wallet/services/token-balance/service.ts:83-114`, `:163-169`
- Bun is the package manager/test shell, and the repo enforces a 7-day minimum package age with explicit Puppeteer exclusions. `package.json:7-40`, `bunfig.toml:3-44`

Inferences
- C2 is probably two bugs, not one: the codex visibility-seed race and a separate replay-loss path when `onConnected` fires before profile/network/account bootstrap completes.
- The right reconcile invariant is “within the unresolved branch, `pending` iff at least one hidden record still lacks a matching outgoing/in-flight hash”; `trusted` and `blocked` remain authoritative user decisions.
- E1 is more likely bootstrap sequencing + mount-only fetches than a raw Pinia bug; the services react to active-profile changes, but `send.vue` does not.
- Multiple popup windows likely still duplicate prompts because queue dedupe is per `PopupManager` instance, not shared.

Asks
- If popup-origin `setTrustAllow` fails after a manual token import succeeds, is best-effort acceptable, or do you want the import surfaced as partially failed?
- Do you want multiple simultaneous popup windows treated as in-scope for this PR, or documented as residual risk?
- If the E1 repro points to a broader profile-scoped token-source issue, are you willing to widen that phase beyond `send.vue` to a shared token/bootstrap layer fix?

**Open Questions**
- What exact user flow reproduces E1 in your testing? The only obvious profile-picker in the popup is on the auth screen, and its selector currently just swaps `appStore.profile` before unlock. `packages/extension/src/popup/pages/auth.vue:148`, `packages/extension/src/popup/components/popups/SelectProfilePopup.vue:30-33`
- Does the popup close/reopen trust-prompt loss reproduce only on full popup unload, or also on soft reconnect after SW restart while the popup stays open?
- Do you want the self-resolve auto-close to clear only the currently open prompt, or also drop any queued duplicate for the same `(profileId, networkId, contract)` triple?