# q09-ext-composables-stores-utils — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`, the supplied `_outer.md` and `extension-shared-ui.md` maps, production clone leads, and both prior quality reports.
- `apps/extension/src/composables/`: profile creation/import/bootstrap, full-backup restore stages, activation waits, fee-estimation wrappers and engine, incoming transfers/health/arrivals, token scope/pinning/seeding, prices, Presto status, legal acceptance, dApp approval/payload/hostname, entity/form/popup helpers, network activation, clipboard/countdown, ticker, storage synchronization, and design re-export shims.
- `apps/extension/src/stores/`: all six stores; focused reads of balance fetching, activity scoping, and app-store refresh/orchestration.
- `apps/extension/src/utils/`: token amount/order/aggregate/fold/search; amount, fee, receipt, transaction, journal and transfer helpers; backup helpers; storage/core facades; clipboard, files, password, naming, errors, URL scrubbing, coalescing, hero fitting and guarded network activation.
- Handoff targets: `popup/components/modules/general/recent-activity-rows.ts`, `popup/windows/verify/index.vue`, lifecycle sections of the execute/discover/capabilities windows, activation handlers in import/auth pages, `popup/auth-guard.ts`, `components/Header.vue`, `components/JsonViewer/LogsViewer.vue`, `components/NotificationManager.vue`, and account-client signatures.
- Package comparisons: `wallet-core` encoding/errors/sleep/queue/keyed-lock utilities, `extension-messaging/src/core/base-client.ts`, `aztec-runtime` fetch and OPFS-open implementations, `design/src/internal/sanitize.ts`, and the extension’s `wallet/utils` barrel/offscreen lifecycle.
- Relevant colocated tests were inspected, especially activation waits, hostname handling, restore stages, activity rows and sanitizer parity.

Reviewed `dev` at `910a4def`. No files modified; tests were not executed. History counts below are **total commits / commits since 2026-06-01**, for the current file paths, without rename following.

## q09-ext-composables-stores-utils-X-1: Deadline races are independently implemented in eight places

**Title:** Deadline races are independently implemented in eight places.

**Smell name:** **Duplicate Code → Shotgun Surgery**. The duplicated mechanism is “observe an existing promise until a deadline, settle with a caller-specific timeout outcome, and manage the timer.”

**Maintenance impact:** **Structural**, spanning eight files in three workspaces. Confidence: **high**. History:

| File | Commits |
|---|---:|
| `apps/extension/src/stores/balances.store.ts` | 6 / 6 |
| `apps/extension/src/composables/importPreflight.ts` | 1 / 1 |
| `apps/extension/src/composables/importChainSync.ts` | 2 / 2 |
| `apps/extension/src/components/Header.vue` | 7 / 7 |
| `apps/extension/src/popup/auth-guard.ts` | 3 / 3 |
| `apps/extension/src/components/JsonViewer/LogsViewer.vue` | 4 / 4 |
| `packages/extension-messaging/src/core/base-client.ts` | 8 / 8 |
| `packages/aztec-runtime/src/pxe/opfs-store.ts` | 4 / 4 |

**Concrete evidence:**

- `apps/extension/src/stores/balances.store.ts:124-138`: generic exported `withTimeout`, implemented with promise handlers and timer cleanup.
- `apps/extension/src/composables/importPreflight.ts:41-47`: probe-versus-sleep race.
- `apps/extension/src/composables/importChainSync.ts:111-117`: restore-versus-sleep race.
- `apps/extension/src/components/Header.vue:34-43`: read-versus-expiry race returning an unanswered sentinel.
- `apps/extension/src/popup/auth-guard.ts:83-90`: generic `withinDeadline`, with a rejection factory and cleanup.
- `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200`: log-fetch race followed by batch-size retry.
- `packages/extension-messaging/src/core/base-client.ts:284-301`: readiness race using a transport-specific timeout error.
- `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135,168-170`: store-open race using a store-specific timeout error.

Cleanup already differs: the store, Header, auth guard and package implementations clear timers on early settlement; the preflight, registration and log-fetch implementations leave their losing timers scheduled.

**Why it harms future change:** Improving deadline settlement or timer cleanup requires auditing eight implementations. The general helper currently lives inside a Pinia store, which is an unsuitable dependency for package code and unrelated UI utilities.

**Smallest safe refactoring:** **Extract Function / Parameterize Function** into `packages/wallet-core/src/utils/`, exported through `@nulo/wallet-core/utils`. Parameterize the timeout outcome so existing errors and fallback values remain unchanged. Keep budget calculations, retries, profile guards and OPFS quarantine/late-close handling in their current owners. The primitive must bound observation without cancelling the underlying operation.

**What disappears:** Seven independent implementations of timeout setup, race settlement and cleanup. Each caller retains its domain policy around one shared deadline call.

**Instances:** `apps/extension/src/stores/balances.store.ts:124`; `apps/extension/src/composables/importPreflight.ts:41`; `apps/extension/src/composables/importChainSync.ts:115`; `apps/extension/src/components/Header.vue:34`; `apps/extension/src/popup/auth-guard.ts:83`; `apps/extension/src/components/JsonViewer/LogsViewer.vue:189`; `packages/extension-messaging/src/core/base-client.ts:284`; `packages/aztec-runtime/src/pxe/opfs-store.ts:124`.

## q09-ext-composables-stores-utils-X-2: Home duplicates History’s transaction and receipt row construction

**Title:** Home duplicates History’s transaction and receipt row construction.

**Smell name:** **Duplicate Code**.

**Maintenance impact:** **Structural**, two files serving Home/token previews and History. Confidence: **high**. History: `activity-rows.ts` **6 / 6**; `recent-activity-rows.ts` **1 / 1**. The preview helper was extracted on 2026-09-01, so its short history understates the age of the underlying logic.

**Concrete evidence:**

- `apps/extension/src/utils/activity-rows.ts:79-88` and `apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:55-64` perform the same transaction filtering by account, chain and foreign profile, then construct the same `type`, `key`, `sortKey` and `tx` fields.
- `apps/extension/src/utils/activity-rows.ts:104-120` and `apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:66-80` repeat account/network filtering and incoming-row projection, including the block-seconds-to-milliseconds conversion and `discoveredAt` fallback.

The complete builders deliberately differ: preview journal rows arrive prefiltered; preview receipts have additional token/profile checks. Those differences do not require duplicating the transaction builder or receipt projection.

**Why it harms future change:** A change to transaction scope matching, stable row keys or receipt timestamp fallback must be applied to both display paths. Their comments explicitly promise matching scope decisions, but the common behavior has separate implementations.

**Smallest safe refactoring:** **Extract Function** in `apps/extension/src/utils/activity-rows.ts`: expose the shared scoped transaction builder and extract the receipt projection/common scope predicate. Have the preview apply its additional token/profile conditions before using them. Preserve separate top-level builders and journal policies.

**What disappears:** The second transaction-filter/map loop and the second implementation of receipt keys and timestamp conversion—roughly 20–30 lines of duplicated implementation and accompanying policy explanation.

**Instances:** `apps/extension/src/utils/activity-rows.ts:79`; `apps/extension/src/utils/activity-rows.ts:104`; `apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:55`; `apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:66`.

## q09-ext-composables-stores-utils-X-3: Verification bypasses the existing dApp hostname composable

**Title:** Verification bypasses the existing dApp hostname composable.

**Smell name:** **Duplicate Code**, specifically incomplete adoption of an existing extraction.

**Maintenance impact:** **Local**, with two implementations governing hostname presentation across approval windows. Confidence: **high**. History: `useDappHostname.ts` **1 / 1**; verification window **7 / 7**.

**Concrete evidence:**

- `apps/extension/src/composables/useDappHostname.ts:8-27` derives a hostname using `new URL`, falls back to the supplied text on parse failure, and flags either non-ASCII characters or an `xn--` label.
- `apps/extension/src/popup/windows/verify/index.vue:52-67` independently implements those same two computed values.
- Execute, discover and capabilities already call `useDappHostname`; verification passes its local results into `DappIdentityBlock` at `apps/extension/src/popup/windows/verify/index.vue:182-185`.

**Why it harms future change:** Updating URL fallback or suspicious-hostname classification in the shared helper changes three windows while leaving verification on the old policy. The existing helper’s tests do not cover verification’s copied implementation.

**Smallest safe refactoring:** **Replace Inline Code with Function Call**: use `useDappHostname(dapp)` in verification, retaining the existing local aliases. The helper remains in `apps/extension/src/composables/`; no new abstraction is needed.

**What disappears:** The verification window’s two computed bodies, approximately 16 lines.

**Instances:** `apps/extension/src/composables/useDappHostname.ts:8`; `apps/extension/src/popup/windows/verify/index.vue:53`.

## q09-ext-composables-stores-utils-X-4: Profile activation waits duplicate the watcher-and-timeout lifecycle

**Title:** Profile activation waits duplicate the watcher-and-timeout lifecycle.

**Smell name:** **Duplicate Code**.

**Maintenance impact:** **Local**, two low-churn helper files, used by unlock and import completion. Confidence: **high**. History: `unlockWait.ts` **1 / 1**; `waitForProfileActive.ts` **1 / 1**.

**Concrete evidence:**

- `apps/extension/src/composables/waitForProfileActive.ts:30-47` checks the already-active fast path, installs a watcher over login/profile identity, arms a timeout and tears down both resources on settlement.
- `apps/extension/src/composables/unlockWait.ts:33-61` repeats that lifecycle and success predicate, adding bootstrap-failure observation and typed errors.
- The callers are live: `apps/extension/src/popup/pages/import.vue:69-75` and `apps/extension/src/popup/pages/auth.vue:154-164`.

The bootstrap-failure behavior is a legitimate difference. It does not require a second implementation of the activation predicate and cleanup protocol.

**Why it harms future change:** Changes to activation readiness or waiter disposal must be made twice. A lifecycle fix can land in the unlock helper while import retains the old behavior.

**Smallest safe refactoring:** **Extract Function / Parameterize Function** into a C0 internal activation-wait helper under `apps/extension/src/composables/`. Parameterize the timeout error and optional bootstrap-failure source. Keep the two public wrappers and their current observable error behavior. Use one watcher per wait, preserving `unlockWait.ts`’s explicit prohibition against racing independent watchers.

**What disappears:** One copy of the fast-path check, activation watcher, timeout and settlement cleanup. The public wrappers retain only their policy differences.

**Instances:** `apps/extension/src/composables/waitForProfileActive.ts:30`; `apps/extension/src/composables/unlockWait.ts:33`.

## q09-ext-composables-stores-utils-X-5: Restore stages depend on UI-owned transforms through impossible parameter types

**Title:** Restore stages depend on UI-owned transforms through impossible parameter types.

**Smell name:** **Inappropriate Intimacy**. The extracted stage module still depends on domain implementation details owned by its UI orchestrator; callback injection conceals that dependency and erases its contract.

**Maintenance impact:** **Structural**, two files on an actively changing restore path. Confidence: **high**. History: `useFullBackupImport.ts` **31 / 31**; `full-backup-restore.ts` **5 / 5**. Both changed on 2026-09-30.

**Concrete evidence:**

- `apps/extension/src/composables/useFullBackupImport.ts:165-171` owns `restoreAccountsAndFilterOwnedSlices`, which requires an `AccountServiceClient` and calls its `restore` method.
- `apps/extension/src/composables/full-backup-restore.ts:129-133` declares the stage’s `AccountRestoreClient` without that `restore` method.
- `apps/extension/src/composables/full-backup-restore.ts:326-339` accepts the UI-owned function as a callback with `data: never` and `accountService: never`, then casts both arguments to invoke it. Its comment explicitly says the injection avoids a module cycle.
- The same shape recurs for token relinking: the implementation has real parameter types at `apps/extension/src/composables/useFullBackupImport.ts:239-243`, but the stage accepts `data: never, newTokens: never` at `apps/extension/src/composables/full-backup-restore.ts:373-388`.
- The orchestrator casts both injected functions to `never` at `apps/extension/src/composables/useFullBackupImport.ts:523-536`.

**Why it harms future change:** The declared stage interface does not describe everything the account stage actually needs. Changing a transform’s required data or client methods does not reliably produce an error at this handoff, because both the callback and its arguments are cast through `never`. Reviewing a stage requires reopening the orchestrator to recover its effective contract.

**Smallest safe refactoring:** **Move Function**: move account filtering and token relinking into a non-reactive restore-support module beside the stages. Share the required backup shapes and a minimal account-client type that includes `restore`; let stages import the functions directly. Preserve service lifecycle and stage ordering. Public re-exports can retain existing import compatibility.

**What disappears:** Two injected domain-function parameters, their duplicated `never`-based signatures and the associated handoff casts. No restore stages or validation checks need removal.

**Instances:** `apps/extension/src/composables/useFullBackupImport.ts:165`; `apps/extension/src/composables/useFullBackupImport.ts:239`; `apps/extension/src/composables/useFullBackupImport.ts:528`; `apps/extension/src/composables/useFullBackupImport.ts:536`; `apps/extension/src/composables/full-backup-restore.ts:129`; `apps/extension/src/composables/full-backup-restore.ts:326`; `apps/extension/src/composables/full-backup-restore.ts:373`.

## Non-findings considered

- **Prior 2026-08-14 Q-03, fee-estimation state-machine duplication:** fixed by `internal/fee-estimation-engine.ts`; the wrappers preserve legitimate single-slot/keyed handoff differences.
- **Prior 2026-08-16 Q-02, monolithic backup restore:** substantial stage decomposition now exists. X-5 concerns the remaining dependency contract, not the old Long Method claim.
- **Prior 2026-08-16 Q-12, unenforced sanitizer parity:** fixed by `utils/sanitize-parity.test.ts`, which imports both implementations and compares shared fixtures. The former missing-enforcement finding is not recurring.
- **Prior clipboard duplication:** ordinary copies use shared helpers; secret exports have their own shared composable. Its immediate scrub scheduling and deliberate persistence across route changes justify a different lifecycle.
- **Whole Home/History builder unification:** rejected. Journal filtering and token/profile policies differ; X-2 extracts only their common operations.
- **Gas/FPC refresh pipelines:** forced gas refresh has additional sequencing, stale-display and verified-balance rules. A blanket generic pipeline would hide meaningful differences.
- **All event-backed composables as one generic hook:** rejected. Read/event precedence, scope fencing, retries and presentation hold times differ materially.
- **Pin-write FIFO versus `KeyedLock`:** the local queue removes idle entries automatically; `KeyedLock` retains them until explicit deletion. Direct replacement would change its retention contract.
- **Amount helpers:** parsing stored balances, reading ambiguous user input, truncating balances, rounding fees and constructing compact display forms have distinct contracts; formatting already delegates substantially to shared helpers.
- **Promise timeout versus aborting fetch/offscreen lifecycle:** not interchangeable. X-1 excludes socket abortion and offscreen creation/READY/close coordination.
- **Design shims, storage facade, service triads and accepted complexity directives:** deliberate boundaries or compatibility mechanisms; no independent maintenance finding established.
- **`useSyncedRef` listener lifetime and notification auto-destroy timer:** the inspected synced ref is app-store scoped, and no production caller enabling `autoDestroy` was found; no concrete user-path leak or timer failure is asserted.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/composables/useDappApprovalWindow.ts:123-129` — **Confidence: high.** Start with a pending `options.init()`, unmount and call `dispose()`, then let initialization settle. `start()` subsequently adds the `beforeunload` listener after disposal removed it, retaining the disposed window’s reject closure. There is no disposed guard after the await. The execute window wires these operations to mount/unmount at `apps/extension/src/popup/windows/execute/index.vue:611-615`.

## Cross-rebuttal (codex on claude)

IDs below share prefix `q09-ext-composables-stores-utils-`. Paths are relative to `apps/extension/src/` unless beginning `packages/`. Confidence: high on source observations; moderate on extraction value.

**1. Overconfident / wrong in Claude’s findings**

- **C-1 — Partially agree.** Counter fencing is reusable, but the eight-instance claim includes a different contract: `stores/app.store.ts:277-296` captures an existing generation and checks event revisions rather than superseding each read; also, `composables/useLegalAcceptance.ts:16-52` has no `disposed` flag, contradicting “every site.”
- **C-2 — Agree on duplication; reject the asserted observed leak.** Transaction projection matches at `utils/activity-rows.ts:79-88` and `popup/components/modules/general/recent-activity-rows.ts:55-64`; the missing receipt guard is real, but `composables/useIncomingTransfers.ts:115-117` filters live events by profile, so foreign-profile display has not been demonstrated.
- **C-3 — Partially agree.** Method metadata overlaps, but membership differences reflect meaningful contracts: `utils/tx-amount.ts:9-10,40-45` reads an amount from recipient **or commitment** mints, whereas `utils/transfer-intent.ts:70-73` requires a recipient address; their disagreement does not establish drift or a bug.
- **C-4 — Partially agree.** Rate scaling overlaps, but the proposed composition changes behavior: `utils/fee-estimation.ts:106-109` tests the unrounded value, while `wallet/services/price/convert.ts:71-75` first rounds to micro-USD; `$0.0009996` becomes 1,000 micro-USD, losing the existing `<$0.001` hint.
- **C-5 — Partially agree.** The listed test-only functions have no production references after checking bare-name/template usage; however, the alias at `utils/incoming-dust.ts:46` is live at `wallet/services/incoming-transfer/service.ts:593`, so its removal is alias simplification, not Dead Code.
- **C-6 — Agree on duplication; qualify the refactor.** Import recovery catches every rejection at `composables/completeImportWithRecovery.ts:54-59`, contrary to the claimed generic-error matching; adopting `unlockWait.ts:38-40` also introduces immediate bootstrap-failure rejection, which requires preserving or explicitly changing import policy.
- **C-7 — Disagree with the broad finding.** Five sites are listed, with different scope dimensions; sharing `IncomingScope` does not require identical private key encodings (`composables/useIncomingTransfers.ts:72`, `useArrivals.ts:103`), and `packages/wallet-core/src/activity/scope.ts:45-53` requires four dimensions plus validation/address normalization.
- **C-8 — Agree, but split the root causes.** Profile normalization is duplicated at `popup/components/popups/EditProfilePopup.vue:46,78-81,111`; malformed-row policy separately repeats at `utils/token-order.ts:40`, `token-amount.ts:50`, and `token-aggregate.ts:20`.

**2. What Claude missed that I found**

- **X-1 — Duplicate Code:** retain the common deadline mechanism, including package sites (`stores/balances.store.ts:124-138`; `packages/extension-messaging/src/core/base-client.ts:284-301`; `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135`). Typed timeout outcomes can be parameterized; retries and late-worker cleanup remain caller-owned.
- **X-3 — Duplicate Code:** `popup/windows/verify/index.vue:53-67` repeats hostname extraction and suspicious-host detection already provided by `composables/useDappHostname.ts:8-27`.
- **X-5 — Inappropriate Intimacy:** `composables/full-backup-restore.ts:326-339` accepts UI-owned transforms through impossible `never` parameters, matched by casts at `useFullBackupImport.ts:528,536`. This remains within the explicitly requested general-maintainability scope, even without duplication.

**3. What BOTH of us missed**

No additional finding established in this light pass.