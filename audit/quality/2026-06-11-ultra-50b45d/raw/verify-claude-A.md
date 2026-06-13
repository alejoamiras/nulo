# Verification — findings Q1–Q8 (verifier A, Claude)

Protocol: per finding, instances were opened and judged BEFORE reading the full claim text. DO-NOT-FLAG rules from `raw/QUALITY-PROMPT.md` checked against each finding.

### Q1 — CONFIRMED (high)

Pre-read: `capability-map.ts` (EXEMPT_METHODS:18, METHOD_CAPABILITY_MAP:21-46), `dispatcher.ts` (METHOD_TO_KIND:163-178, NETWORK_ONLY_KINDS:184-192, ACCOUNT_KINDS:198, dispatch special-cases 253-280, build switches 867-956), and `scope-enforcement.ts` (METHOD_SCOPE_CHECKER:348-362) independently restate per-method facts — classic parallel registries; adding one method touches 5+ tables across 3 files. The sync comment at `scope-enforcement.ts:9-10` exists verbatim ("must be kept in sync with buildNetworkOperation / buildAccountOperation").

All instance lines exhibit. Possible adjacent instance deliberately excluded: the three `nulo-schema-patch.ts` copies are a documented house contract pinned by `dispatcher.test.ts` — correctly not flagged. Smallest-safe refactoring (MethodDescriptor registry) is internal-only, no byte-parity constraint; F-00x AUDIT markers survive as descriptor fields.

### Q2 — CONFIRMED (high)

Pre-read: popup vs onboarding `import.vue` are near line-for-line duplicates — `fillError`/`handleCopyError`/`handlePasswordInput`/`handleSecretInput`, all four `isAllowedTo*` computeds, all four import handlers (same error-string routing), `useFullBackupImport` wiring, `parsedBackupName` watch, `clearFormState`, CTA template ladders, even the `shakeInput` keyframes (popup 656-667 = onboarding 528-539). `profile/new.vue:72-175` vs `create.vue:51-136` duplicate strength hint, latch-first submit, UserRejectedError handling, notification payload.

Boundary claim verified: onboarding pages import `@/popup/components/popups/PasskeyCeremonyDialog.vue` (onboarding import.vue:10, create.vue:8); the dialog imports `@/popup/utils/passkey-ceremony` (:31), teleports to `#popup` (:82), and its "Used by" header (:10-14) omits the onboarding consumers — stale. All instances exhibit. Refactoring needs parameterization (popup/onboarding completeImport flows differ: bootstrapActiveProfile vs app.vue listener, routes, toasts) — the proposed flow composables accommodate that.

### Q3 — CONFIRMED (high)

Pre-read: the two `ServiceClient` bases each own a pending-request map, `getRequestId` (identical), timeout machinery, the A6 `resultIsJson` JSON.parse fallback (near-identical comment + code), and a verbatim logDebug/Info/Warn/Error quartet. The two `Service` bases share the validate→unwrap→invoke→jsonSanitize→respond flow and a byte-identical `ensureInitialized()` (background 187-199 = offscreen 158-170). Error-contract divergence verified: background reconstructs `walletErrorFromPayload(errorPayload)` (client.ts:112); offscreen rejects with plain strings (tuple type `(error: string) => void`, `reject("Client disconnected")`).

Consumer count sanity: 42 non-test files import extension-messaging; 21 `extends ServiceClient` subclasses — "40+ consumers" is fair. Real fork differences (port vs sendMessage, telemetry, keepalive, per-method timeout) are exactly what the proposed transport-hook split preserves. Note: unifying error contracts changes offscreen's rejection type — a deliberate behavior alignment, flagged in the finding itself.

### Q4 — CONFIRMED (high)

Pre-read: `service.ts` is 2302 lines, one class. Member list alone shows divergent concerns: 13 injected collaborators, gasBalanceCache + `#computeGasBalances` (1476-1575), estimateReuseCache + `tryConsumeTransferEstimate` (619+), activeControllers/executionMutex/executionWaiters cluster (308-335), `executeOperations` dispatcher plus ~22 `executeAztec*`/`execute*` per-kind handlers (1033-2300), transfer pipeline (405-610). Large Class + Divergent Change is the textbook mapping.

All instance ranges exhibit. The dropped "no facade test" overclaim was correctly removed (per consolidated corrections). Smallest-safe refactoring is consistent with the coordinator extraction already started in `execution-coordinator.ts` — the file's own header lists the intended next moves, corroborating "half-done."

### Q5 — CONFIRMED (high)

Pre-read: the four pipelines (`executeTransfer` 405-610, `executeSendTransaction` 1130-1213, `executeAztecSendTx` ~1860-2015, `executeNoFromSendTx` ~2022-2205) each hand-roll: AbortController registration into `activeControllers`, `checkCancelled` closure, markJournal staging (simulating→proving→submitting→succeeded/failed), `coordinator.proveTxTask` → `toTx()` → `coordinator.sendTxTask` → `transactionService.addTransaction(...getEstimatedFee/getGasDetails)` → terminal mark, `JobCancelledSentinel` catch, `finally` controller cleanup. Proven 4-copy duplication.

One wording nuance: `execution-coordinator.ts:15-19` doesn't document a *pending* extraction — it affirmatively claims `proveAndSend` "DOES move" into the coordinator, yet `grep proveAndSend` hits only that comment; the method was never created. The doc is false, which is *stronger* evidence than the finding states. Verdict unchanged. Template-method extraction is feasible; per-path variation (offchain effects, receipt wait, activity shapes) stays as hook parameters.

### Q6 — CONFIRMED (high)

Pre-read: `RecentActivityView.vue:91-109` reimplements the tx/journal/incoming triple-merge with the same sortKey rules (`blockTimestamp*1000` fallback comment included), while `activity.vue:133-140` calls the shared `buildActivityRows`. `activity-rows.ts:11-14` claims the merge was "Extracted from the inline merges that previously lived in both" — false for the widget. Incoming-transfer handlers (onIncomingTransferAdded/Updated/Deleted), config-toggle reload, and tokens/`onTokenAdded` wiring are duplicated verbatim between widget (205-251, 128-144) and page (52-93, 147-156). Awaiting-card prop derivation (`cardTitleFor`/`cardOriginLabelFor`/`cardAmountFor`/`cardTransferTypeFor`, 345-400) mirrors the already-extracted `buildJournalTerminalCardProps` (`journal-state.ts:324-352`) shape-for-shape. The token/!token template branches (704-817) duplicate the full awaiting+merged-rows block.

All instances exhibit. Refactoring note: the widget's merge adds a row budget and token-scoped filter, so `buildActivityRows` reuse needs parameters — the proposed `useIncomingTransfers` + awaiting-props extraction is the right smallest step.

### Q7 — CONFIRMED (high)

Pre-read: `resolvePackageFile` duplicated in `vite.config.ts:8-17` and `vitest.config.ts:13-22` under a literal "Keep in sync" comment; artifact aliases and the `__VERSION__`/`__SENTINEL__`/define block duplicated across both. Drift claim verified: `vitest.e2e.all.config.ts` lacks the noir nodejs aliases and `retry: 2`/`pool`/`isolate` that `vitest.e2e.network.config.ts` carries, yet its include glob (`tests/e2e/**`) covers the network suite, and `test:e2e:all` is wired in package.json — shipped divergence. Wrapper mutation verified: chrome/firefox `.mts` files `push` onto the imported `viteConfig.plugins` and mutate `build.outDir` in place (7-22 in both).

Minor: finding says "8 config files"; 7 are cited. Not verdict-affecting. Config sprawl is an explicitly sanctioned analog in the prompt; vite.config.ts is production build surface so the test-code exclusion doesn't apply. `mergeConfig`/factory refactor is safe; the noir-alias host-specific comment must travel with the shared helper.

### Q8 — CONFIRMED (high)

Pre-read: `useFormState` fixes baselines at construction (`FieldDef.initial`; `isDirty`/`reset` compare against `defs[name].initial`, 153-169) with no rebase API — so every async edit dialog hand-rolls refill (`fillFromEndpoint`:37-41, `handleFillFieldsWithDefaultValues` in EditNetwork:53-58 and EditContact:149-153) and bypasses `form.isDirty` with its own per-field dirty computeds (EditEndpoint:43-46, EditContact:120-130). `FormPopup` emits only button-click `submit`; consumers duplicate the identical Enter-keydown-on-input guard (EditEndpoint:93-98, EditNetwork, NewContact:181-192 — whose comment even documents the double-fire hazard any FormPopup-level fix must handle). Hand-rolled add/update/delete list mirroring confirmed at every cited dialog (NewContact, EditContact, NewFpc, EditFpc, SelectFpc, SelectToken, SelectBalanceType, SelectProfile, BalanceView) with real drift (SelectTokenPopup has no update handler; BalanceView's delete handler diverges) despite `useEntityCrud` existing.

All instances exhibit. "Half-done abstraction" framing is accurate, not consumer-blame.

## Summary

| Finding | Verdict | Confidence |
|---|---|---|
| Q1 | CONFIRMED | high |
| Q2 | CONFIRMED | high |
| Q3 | CONFIRMED | high |
| Q4 | CONFIRMED | high |
| Q5 | CONFIRMED (doc-staleness is stronger than stated: comment claims extraction happened; it never did) | high |
| Q6 | CONFIRMED | high |
| Q7 | CONFIRMED (minor: 7 config files cited, not 8) | high |
| Q8 | CONFIRMED | high |

No DO-NOT-FLAG violations found in Q1–Q8. No instance lines failed to exhibit the claimed smell.
