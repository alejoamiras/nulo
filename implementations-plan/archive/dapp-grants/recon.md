# dapp-grants: recon

Read at `48a97f4a` (`dev` plus #718) and re-checked at `85c4d20f` (`dev` after #719), which changed
none of the code cited here. No test was run for this recon; every claim below is from reading the
file.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Fixed-text refusals with a sentinel test | #717's three `createAuthWit` refusals, `packages/wallet-bridge/src/method-scope-checkers.ts:292`, `:307`, `:320`, and their test `method-scope-checkers.test.ts:110-147` (sentinel in every request field, branch regex, `JSON.stringify({ ...err, message, stack })`) | adapt: same shape, one `test.each` row per refusal |
| A method-name type for a typed message | `MethodName`, `packages/wallet-bridge/src/method-descriptors.ts:371`; `assertKnownMethod` narrows to it before the scope check (`dispatcher.ts:870`) | reuse-as-is, imported type-only |
| Sink sentinel through the real background handler | `apps/extension/src/wallet/services/wallet-sdk/background.refusal-log.test.ts:1-97` (`serialize` that expands nested `Error`s, `handleWalletMessage` with fakes; dispatch is a throwing mock at `:72` and the journal a bare spy at `:84`) | adapt: keep `serialize`; replace the mocked dispatch with a real `WalletSdkDispatcher` and the spy with a real journal |
| A real journal and arrival in a unit test | `queued-journal.test.ts:53-130`: `OperationJournalService` on `FakeBrowserApi`, stubs for profile, session, network and account, then `tryCreateQueuedJournal` | adapt: move the builders to a shared test-only fixtures file so the background test uses the same ones, no second copy |
| A real dispatcher with stub services | `new WalletSdkDispatcher(network, account, execution, interaction, sessionWriter, logger)`, as `dispatcher.test.ts:128-137` builds it | adapt: minimal stubs in the background test |
| A typed refusal the envelope and the journal can recognise | the `WalletError` family, `packages/extension-messaging/src/errors.ts:24` (base), `:179-185` (`CapabilityNotGrantedError`, the nearest precedent), the decode union `:461-481`, `walletErrorFromPayload` `:489-`, the identity sweep `errors.test.ts:170-215`; `wallet-bridge` already imports these errors (`method-descriptors.ts:24`, `dispatcher.ts:109`) | adapt: one class, its union member, decode case and sweep entry |
| Mapping a class to the dApp envelope | `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:36-192`, the 4100 arms `:68-87`, the fall-through `:177-191`, `UNCLASSIFIED_ERROR_MESSAGE` `:199` | adapt: one arm (Ask O2) |
| Closing a queued journal row on a pre-claim failure | `failQueuedIfUnclaimed`, `queued-journal.ts:250-266` (hard-codes `kind: "popup_bound"` at `:261`) | adapt: take the kind from the caller |
| A journal failure label and context | `categoricalLabel`, `apps/extension/src/utils/journal-state.ts:185-230`; `humanizeErrorKind` (`:132-160`) has no production caller | adapt: one `categoricalLabel` case; leave `humanizeErrorKind` alone |
| A new known job-error kind with a drift guard | `KnownJobErrorKind` + `KNOWN_JOB_ERROR_KIND_TABLE`, `packages/wallet-core/src/jobs/types.ts:87-136`, guard `types.test.ts:5-31`, producer comment `:78-85` | reuse-as-is: add one literal to both and to the comment |
| A quieter log level for an expected refusal | the Terms refusal's `Debug` in `handleWalletMessage` (`background.ts:1173-1183`) | adapt: the same rule for scope refusals |
| The stored grant as the capability answer | `enrichGrantedCapabilities`, `packages/wallet-bridge/src/dispatcher.ts:1482-1532`: accounts (`:1496-1522`) and data (`dataAnswer`, `:725-732`, `:1524`) already answer from the stored grant; every other type echoes (`:1526`) | adapt: the `else` arm reads the stored grant |
| Tests that pin the answer | `dispatcher.test.ts:1920-1945` (data after a declined widening), `:2066-2110` ("a held contract in another case": pins today's echo for transaction, simulation, contracts) | adapt: new covered-request, contract-classes and reject-then-request cases; the case pin changes its expectation to the stored spelling |
| A dApp request that a listed scope refuses | playground bundle `transaction-listed` (`apps/playground/src/lib/bundles.ts:100-108`, reads `?tokenAddress=`), `pg-btn-sendTx-default` (`apps/playground/src/sections/transactions.ts:94-101`, needs `recipient`, `:43-47`); e2e helpers `requestPgBundle`, `callExpectingNoPopup`, `readStoredCapability`, `waitForPgResult`, and the three inputs `sendDefaultTx` sets (`tests/e2e/fixtures/send.ts:40-42`) | reuse-as-is: connect with the bundle naming another contract, then send the token transfer; no playground change |
| The dApp-side envelope assertion | `data-privateEvents.test.ts:34` (`UNCLASSIFIED`, built from the imported constant), `:52-57` (`expectRefusedSilently`) | adapt: its expected envelope follows Ask O2 |
| The journal detail testids | `apps/extension/src/popup/pages/journal/[id].vue`: `journal-detail-context` `:281`, `journal-detail-category` `:301`, `journal-detail-state` `:316`, `journal-detail-error-message` `:327` | reuse-as-is |
| A new network e2e for the refused send | none selects a scope-refused `sendTx` today: `rg -l "UNCLASSIFIED_ERROR_MESSAGE\|Scope violation\|could not process" apps/extension/tests/e2e` finds `data-privateEvents` (it imports the constant) and `stale-anchor-recovery` (a comment); no other spec asserts a scope refusal's envelope | build new: one file, the only end-to-end proof that a real SDK request reaches the queued row, the page and the dApp |

## Conventions to match

- Refusal text keeps the `Scope violation: ` prefix: 25 matches in `scope-enforcement.test.ts`,
  `dispatcher.test.ts:1690-1700` and `:2371` match on it; `dispatcher.test.ts:998`, `:1127`, `:2795`
  match `not authorized for this dApp session`.
- The method in a refusal is always a literal the wallet wrote: `requireContractsGrant`'s callers
  pass `"registerContract"`, `"getContractMetadata"`, `"isTokenRegistered"`
  (`method-scope-checkers.ts:87`, `:91`, `:97`); the named wrappers pass `"sendTx"`,
  `"simulateTx"`, `"profileTx"` (`:386`, `:390`, `:394`); `enforceScopeWithSession` runs only after
  `assertKnownMethod` (`dispatcher.ts:870`, `:896`), and its only production caller is the
  dispatcher.
- A `WalletError` message that reaches a dApp is a stable literal with no user input
  (`errors.ts:174-177`).
- The logger gets the envelope, never the error (`background.ts:1174-1183`); keep it.
- Arrival journals a `sendTx` only when its sender resolves: an unauthorized explicit `from` returns
  `undefined` before any row exists (`queued-journal.ts:149-157`), and dispatch refuses it
  (`dispatcher.ts:1769-1774`). A sink test for that refusal asserts no row.
- `getPrivateEvents`' filter is `args[1]`, so `enforceScopeWithSession` refuses its `scopes` under
  the `opts.scopes` label (`scope-enforcement.ts:97`); the `eventFilter.scopes` call (`:102-105`)
  re-checks the same array and never refuses. `scope-enforcement.test.ts:136` asserts only the
  refusal.
- Error-kind literals are snake case and live in wallet-core (`types.ts:87-104`).
- Component and page copy: no clause-joining em dash (owner rule).

## Realism evidence (the fee comparisons)

Both routes are read by one classifier, `classifyFeePayer` (`packages/wallet-bridge/src/fee-payer.ts:57-66`),
over the same stored request at every site that builds or shows the fee: the build
(`apps/extension/src/wallet/services/execution/operation-planner.ts:221`), the approval card's locked
method (`popup/windows/execute/OperationCard.vue:100`), the fee-path check
(`packages/wallet-bridge/src/operation-validation.ts:53`) and the popup's fee delta
(`wallet/services/dapp-interaction/approval-delta.ts:23`). `from` is the resolved wallet account
(`dispatcher.ts:1115`), so only the dApp's `feePayer` and the claim's first argument can be spelled
differently.

| Comparison | Misroute | What the window shows | What the wallet builds and charges |
|---|---|---|---|
| `:63` `feePayer` vs `from` | the sender in another spelling routes `fpc` | "Fee / Embedded payload", "The app includes fee payment in the transaction." (`FeeSettingsCard.vue:749-760`), no amount: the card any payload naming another payer gets | `AccountFeePaymentMethodOptions.EXTERNAL` (`operation-planner.ts:226-227`): the account never sets itself as fee payer (`@aztec/entrypoints` `dest/account_entrypoint.js:10-11`), so only a payer contract in the dApp's own calls pays, or none does and the transaction has no payer; the account's Fee Juice is not charged |
| `:54` claim recipient vs payer | a claim crediting the payer in another spelling routes `self-pay` | locked "Fee / Public Fee Juice · set by the app" (`FeeSettingsCard.vue:766-769`), with the service worker's estimate for the stored request (`execute/index.vue:146-147`) | `PREEXISTING_FEE_JUICE` (`operation-planner.ts:228`): the account pays from Fee Juice it holds (`account_entrypoint.js:13-17`), which is what the card says; the same charge a dApp gets honestly by naming the account as payer with any call |

Neither misroute shows a payer or an amount other than what is charged, and neither gives a dApp a
charge it could not request honestly: two ledger lines, no scope.

## Collision and dedup risks

- `#719` (`test/e2e-reliability-fixes`) merged at `85c4d20f`. It changed no file this plan cites
  or edits (its code changes are e2e fixtures and tests, `FeeMethodSelector` and `resolve-ports`);
  it rewrote `implementations-plan/follow-ups.md` (the `e2e-reliability-fixes` entries left,
  new ones added, none in § Grants and scopes) and `index.md`, which this plan reconciles at
  delivery.
- `copy-polish` edits strings under `apps/extension/src`; `journal-state.ts` gains one case here.
  Its em-dash scan skips the new strings, which carry none.
- `failed-send-check` edits the `transfer` arm of `categoricalLabel` (`journal-state.ts:217-223`);
  this plan adds a separate case, so the conflict is at most adjacent lines.
- Duplication: the plan adds no second sentinel serializer (the background test keeps its
  `serialize`, the checker test its one-line form) and no second copy of the journal stubs (moved to
  a shared fixtures file).
- Out of this plan, same shape, recorded as a follow-up: six execution-layer selector refusals that
  also start `Scope violation:` and interpolate the call's name and target
  (`execution/tx-request-builder.ts:346`, `:595`; `fast-path.ts:139`; `view-executor.ts:372`;
  `execution/service.ts:1044`; `authwit-discoverer.ts:203`). They are an ABI-binding check that runs
  after the grant check, while the wallet builds, simulates or signs, some with no window, and they
  reach other sinks.
