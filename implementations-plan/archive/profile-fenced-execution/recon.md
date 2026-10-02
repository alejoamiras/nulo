# Recon — profile-fenced-execution

Base: `origin/dev` @ `c543c18d`. Two read-only explorers (send-path reuse sweep; test-surface map),
every claim below re-verified by the driver against source before it was written here.

## The finding that shapes the plan

An authorization-time fence **already exists** — `ExecutionFence = { profileId, epoch }`
(`apps/extension/src/wallet/services/profile/profile-deletion-state.ts:17`), captured atomically by
`ProfileService.captureExecutionFence()` (`profile/service.ts:516-524`) and taken at the true
authorization moment for dApp sends: `dapp-interaction/service.ts:257-263` (`executeAndResolve`)
captures it, compares `profileId` to the session's, and passes it to
`executionService.executeOperations(..., authorizedFence)`.

It was built for one job — **deletion-epoch** fencing (audit D13): the epoch bumps only in
`ProfileDeletionState.beginDeletion`, and the single downstream validation is
`transaction/service.ts:182-185` (`assertCurrent` + owner-row check under `fence.profileId`). Nothing
anywhere asserts "`fence.profileId` is still the active profile", and the fence is **dropped on the
two send kinds** before it reaches the code that resolves a profile:

| Site | What happens | Verdict |
|---|---|---|
| `execution/service.ts:670-731` `dispatchOperation` | `register_token` (`:681`) forwards `authorizedFence`; **`send_transaction` (`:687`) and `aztec_sendTx` (`:725-730`) do not** — each re-captures a fresh fence at dispatch | root cause; `register_token` is the template |
| `execution/service.ts:840-849` `executeSendTransaction` | public signature has no fence param; captures its own (`:847`) — correct for direct UI callers (auth-registry), wrong as the dApp path's only capture | adapt: optional `fence?` param, fresh capture when absent |
| `execution-lane.ts:131,415` | `fence?.profileId ?? getActiveProfile()` — right pattern, but the fallback fires whenever the fence was dropped upstream | adapt once threading is fixed |
| `execution-lane.ts:220` `resolveExecutionMutexKey` | keys the `(profileId, chainId)` mutex on the **active** profile; no fence param | build: key on the fence; a drifted op must fail before it ever takes a slot |
| `execution-lane.ts:175` `cancelJob` | active profile is the cancel principal ("one profile is one human") | correct as-is |
| `tx-request-builder.ts:214,372` `resolveBuildContext` / `buildNoFrom` | `requireActiveProfile` → `getAccountContract(profile.id, …)`; class has no fence anywhere | build: thread the fence through the builder |
| `dapp-send-executor.ts:782` reused-estimate branch | `getActiveProfile()` with a comment that "the cross-profile fail-closed property depends on this" — i.e. relies on the account-lookup miss | adapt: resolve from the fence, assert identity |
| `dapp-send-executor.ts:526` | `sent.fence?.profileId ?? active` | adapt (fallback dies with threading) |
| `dapp-send-executor.ts:452`, `transfer-executor.ts:353` | estimate **stash** stamps `profileId` from the active profile — pre-authorization | correct as-is |
| `operation-estimate-reuse.ts:133-135` `tryConsume` | rejects when `getActiveProfile().id !== entry.profileId`, then the caller falls through to a **fresh unfenced build** | adapt: compare against the fence; never fall through on drift |
| `transfer-executor.ts:98` `execute(req, estimateId, fence)` | fence reaches `addTransaction` but **not** `createTransferJournal` (`:227`, stamps active profile) nor `fromReusedEstimate` (`:268`) / `buildFresh` (→ builder) | adapt: thread it |
| `execution/service.ts:437` `executeTransfer` | captures the fence at call time — the popup transfer's authorization moment | correct as-is |
| `execution/service.ts:486` estimate admission, `:514` decode-for-display | pre-authorization / read-only | correct as-is |
| `auth-registry/service.ts:~280`, `fpc/service.ts:136,285`, token/contact/network/dapp-session/queued-journal | direct UI calls (their own authorization moment) or D13 local-write fencing | correct as-is; must keep working with no fence arg |

**Why the implicit safety net is not one.** "The successor profile cannot own the operation's
account, so `getAccountContract` throws" is false by architecture: two profiles restored from one
recovery phrase share the master secret and therefore the frozen, master-derived account addresses
(`ARCHITECTURE.md:156`; `CLAUDE.md` § Account-address freeze). A sibling profile resolves the same
address successfully; the operation then continues under the wrong profile's PXE store
(`packages/wallet-crypto/src/pxe-store-key.ts:39-42` — the store key salts on `profileId`), journal
scope and session, with no error.

**The checkpoint that must exist.** `execution-coordinator.ts:280-306` `proveAndSend` is the frozen
sequence `checkCancelled → journal(proving) → prove → checkCancelled → toTx → journal(submitting)
→ checkCancelled → send`. The FSM forbids `submitting → cancelled`
(`packages/wallet-core/src/jobs/fsm.ts:28-30,47`) — submit is the point of no return, so a drift check
must land **at the post-prove `checkCancelled` (`:298`)**, before `journal(submitting)`, so the
record can legally go `proving → failed`. `checkCancelled` is constructed per path
(`dapp-send-executor.ts:220,757`); the fence assert rides the same hook.

## Reuse map

| Capability | Existing | Verdict |
|---|---|---|
| Fence type + atomic capture | `ExecutionFence`, `captureExecutionFence` | **reuse as-is** |
| Fence validation pattern | `ProfileDeletionState.assertCurrent(id, epoch)` (`profile-deletion-state.ts:64-71`) | **adapt**: sibling identity assert — `fence.profileId === activeProfile.id` else typed drift error; epoch assert stays for incarnation |
| Switch-epoch primitive | `wallet-sdk/profile-switch-teardown.ts:80-101` `trackProfileSwitchEpoch` (lock / unlock-to-same stay flat) | **precedent only** — identity compare suffices; not wired to execution (see Inference in plan) |
| Fence threading template | `executeRegisterToken` (`service.ts:788-798`): `authorizedFence ?? fresh capture` | **reuse the pattern** on the two send kinds |
| Typed dApp-facing errors | `packages/extension-messaging/src/errors.ts` (`WalletError` subclasses, `toPayload`/`walletErrorFromPayload`); envelope `wallet-sdk/error-envelope.ts` `toWalletResponseError` — one `instanceof` branch per class; `SESSION_INVALID_ERROR` = 4900 `SESSION_INVALID` (`:194-198`), documented as covering "profile switch" at the **session** layer | **build** `ProfileDriftError extends WalletError` + envelope branch (4900, `walletErrorCode: "PROFILE_CHANGED"`) |
| Terminalize-then-throw catch arm | `execution-lane.ts:284-292` (`ExecutionMutexCapacityError` → `markJournal(failed)` → throw `TooManyPendingError`) | **copy the shape** |
| Failure classification | `mark-failed-unless-cancelled.ts` (special-cases `DuplicateInitializationError` → `kind`); `rpc-cancel.ts` `classifyOperationCatch` "rides the code channel" for `PxeStaleAnchorError`/`ContractNotRegisteredError`; `KnownJobErrorKind` open union + `satisfies Record<…, true>` mirror (`packages/wallet-core/src/jobs/types.ts:87-112`) | **adapt**: add `"profile_drift"`; both catch arms (dApp shared + transfer inline) |
| Failed-card copy | `utils/journal-state.ts:97-122` `journalTerminalDisplay` → `failedSubtitleFor(kind)`; `cancelled` → "Cancelled" gray; `interrupted` amber | **adapt**: a `profile_drift` subtitle (copy → owner sign-off) |
| In-flight enumeration at switch time | `OperationFilterSchema { profileId, isTerminal }` (`operation-journal/spec.ts:286-292`) — `getOperations({ profileId, isTerminal: false })` works today; nothing calls it at switch time | **reuse the query; build the caller** |
| Profile switch UI | `SelectProfilePopup.vue:41-63` → `appStore.commitScopeChange(() => appStore.profile = p)`; on refusal a toast, no dialog | **adapt** to a confirm flow |
| In-flight predicate | `utils/in-flight-send.ts` `hasInFlightSend(ops, {profileId, accountAddress, networkId})` — **account-scoped by design**; the store's tracker (`app.store.ts:158-217`) already holds every op of the profile | **build** a profile-wide predicate over the same list (account-scoped one under-detects for a profile switch) |
| `commitScopeChange` contract | synchronous `commit()`, one `refreshInFlight()` re-check immediately before (`app.store.ts:187-215`) | **reuse**: a dialog awaits, so re-check after the dialog, then commit — same shape |
| Confirm dialog | `cacheStore.confirm = {title, description, confirm_text, confirm_color, callback, single?}` + `popupStore.open("confirm")` → `ConfirmPopup.vue`; destructive example `settings/contacts/index.vue:129-139` | **reuse as-is** |
| Cancel in flight | `ExecutionService.cancelJob` (journal-first, aborts the prove controller; `execution-lane.ts:163-200`) | **reuse** from the dialog callback and from an SW-side sweep |
| Execution README | `execution/README.md` — zero mentions of "fence" | **doc gap to close** |

## Test surface

Normative: `apps/extension/tests/COMPOSITION-TESTS.md` — real service graph + real journal FSM,
fakes only at process boundaries; escalate to e2e on D1–D6 (shallow-PXE surface cap, no
simulate/prove semantics, no second wallet, bb-free). Failure taxonomy: Theatre / Second wallet /
Drift / bb-bound.

| Layer | Existing | Verdict |
|---|---|---|
| Composition harness | `execution/service.composition.test.ts:91-212` `makeHarness()` — real `ExecutionService` + real journal on `FakeBrowserApi`; `ProfileService` fake **hardcodes `p1`** for `getActiveProfile`/`captureExecutionFence`; `profileChanged` is a real `EventHandler`; `getNetwork` is a controllable `vi.fn`; `makeControllableGate()` (`:58-76`) parks at prove via the real `ProofGate` | **adapt**: mutable active profile in the fake (`setActiveProfile("p2")` flips what `getActiveProfile` answers and fires `profileChanged`); park at prove with the gate, at build via `getNetwork` |
| Existing parked case | `:387-418` parks a **gas-balance compute** across a switch — cache eviction, not execution | template only |
| Existing hold-and-cancel | `:222-256` holds the proof gate and cancels via `cancelJob` | **reuse the shape** for hold-and-switch |
| Lane fence pins | `execution-lane.test.ts:187-222` — create-time: fence wins over a `p2-successor` active profile; no later-checkpoint pin | **extend** |
| Executor pins | `dapp-send-executor.test.ts`, `transfer-executor.test.ts:163`, `tx-request-builder.pins.test.ts:133` — pin the **locked** (undefined) case; none pin a *different* active profile | **extend** |
| Error plumbing pins | `mark-failed-unless-cancelled.test.ts:57-63` (`DuplicateInitializationError` kind), `rpc-cancel.test.ts:71-92` (code channel + negative control) | **extend** for `ProfileDriftError` |
| Deletion state pins | `profile-deletion-state.test.ts` (32 lines); `profile/service.integration.test.ts:410-417` `captureExecutionFence` | **extend** with the identity assert |
| Store | `app.store.shape.pins.test.ts:15-32` mocks `OperationJournalServiceClient` with a controllable `getOperations` — seeds records at any stage; `app.store.setup-active-account.test.ts` parks a journal read on a gate | **reuse** for the profile-wide predicate + dialog re-check |
| Component | `SelectProfilePopup.test.ts:120-134` (refusal toast case; hoisted `H.appStoreState` mock); `ConfirmPopup.test.ts` (`cacheStore` mock shape) | **adapt** refusal → confirm-then-cancel |
| E2E: two profiles | `tests/e2e/network/session-profileSwitch.test.ts` (N-04) creates a second profile inline: `header-lock` → `auth-profile` → `select-profile-new-btn` → register fields → `register-submit-btn` → `waitForHash(#/popup/general)`; no shared helper | **extract** `createAndActivateProfile(page, name, password)` into `fixtures/helpers.ts` |
| E2E: park at prove | `fixtures/proof-gate.ts` `holdProofGate`/`releaseProofGate` (needs `NULO_E2E_PROVERLESS=1`); parks after `journal(proving)`, before `pxe.proveTx` | **reuse as-is** |
| E2E: typed error end-to-end | `cancel-mid-prove.test.ts` — `waitForPgResult` → `result.status === "error"`, `parsed.data.walletErrorCode === "JOB_CANCELLED"`; `tx-awaiting-card[data-stage]` typed over `JobStage` (`TransactionAwaitingCard.vue:55`) so `data-stage="failed"` needs no new selector | **adapt**; note the switch tears the dApp channel down, so the dApp-side assertion is disconnection, not a code |
| E2E: account-switch precedent | `account-switch-live-session.test.ts` — an account switch lets A's send **finish as A** | the profile test must state the deliberate departure in its header |
| E2E: refusal guard | `in-flight-send-guard.test.ts` — account switch refused mid-prove; `retry: 0`, proverless | structural template |
| E2E: no simulate-phase gate | only the prove gate exists; `.claude/skills/e2e-testing/SKILL.md:575-579` prescribes the shape for a new one | build only if a build/simulate-phase e2e proves necessary (composition covers it) |
| Sharding | automatic SHA-1 over `tests/e2e/network/**`; a dedicated lane needs `behavior-gating.test.ts` | nothing to register |
| Flake ledger | #21 (deleted-generation superseded after re-import), #29 (`lockActiveProfile` must emit when `close()` didn't) | relevant to the identity assert + lock path |

## Hard constraints

- Every `fence?:` on a send-path signature exists so direct UI callers (auth-registry, popup
  transfer entry) can omit it and get a fresh capture — keep that contract; make the **dApp** path
  unable to omit it.
- `commitScopeChange`'s `commit` must stay synchronous; any dialog re-checks after it resolves.
- Lock (`onActiveProfileChanged(undefined)`) must never be blocked or prompted (owner; `in-flight-send.ts` header).
- `submitting → cancelled` is illegal; nothing past `journal(submitting)` may be "cancelled" by a switch.
- `mark-failed-unless-cancelled` is deliberately synchronous (microtask timing on the cancel/slot-release path) — a new branch must not make it async.
- The popup transfer never takes the execution mutex ("Zero-slot transfer quirk", `execution/README.md:34-36`) — do not harmonize.
- Comments never reference plans/phases; the code talks about live behavior.

## Collision / dedup risks

- Writing a second "switch epoch" when an identity compare against `fence.profileId` already
  expresses the invariant — resist; `trackProfileSwitchEpoch` exists for dApp-session dispatch.
- A new dialog component when `ConfirmPopup` + `cacheStore.confirm` is the repo standard.
- A second in-flight tracker when the store's list is already profile-wide — add a predicate, not a client.
- Duplicating the two-profile e2e recipe a second time instead of extracting the helper.

## Search trails (absence claims)

- No identity assert on `fence.profileId` anywhere: `grep -rn "assertCurrent\|fence.profileId" apps/extension/src/wallet/services` → only `transaction/service.ts:183-184`, `execution-lane.ts:131,415`, `dapp-send-executor.ts:526`, `executeAndResolve`.
- No switch-time enumeration of in-flight ops: `grep -rn "isTerminal: false\|isTerminal:false" apps/extension/src` → journal internals + tests only.
- No `data-stage="failed"` e2e assertion: `grep -rn 'data-stage="failed"\|"failed"' apps/extension/tests/e2e` → none on `tx-awaiting-card`.
- No two-profile helper: `grep -rn "select-profile-new-btn\|register-submit-btn" apps/extension/tests/e2e/fixtures` → none; only inline in `session-profileSwitch.test.ts`.
- `execution/README.md` has no "fence": `grep -n fence apps/extension/src/wallet/services/execution/README.md` → none.
- `navigator.locks`, `switchProfile` RPC: none (a switch is `unlockProfile(otherId)` replacing the single `ActiveSession`, `ARCHITECTURE.md` §7).
