# Phase 5 — authwits under the fence, and no unregistered sends (arc 3, unstacked off dev)

Branch `worktree-approval-scope-follow-execution` off `dev` `771c2a16` (the prerequisite `profile-fenced-execution` #610/#611 merged). Code commits `e8d98d3b` (the two fixes), `01502d7e` (codex round 1).

## Validation gate — reported passing

- `bun run audit:vue` (typecheck:all ∥ unit/component ∥ lint, then build): **exit 0** — 12 packages typecheck exit 0, 6267 tests passed (507 files, 3 skipped), Vite build ✓. Run after refactoring the authwit fence gate under the complexity budget (see below).
- Targeted: `bun --bun vitest run src/wallet/services/execution src/wallet/services/dapp-interaction` — 707 passed / 1 skipped / 7 todo (52 files). `src/wallet/services/wallet-sdk` — 156 passed (17 files). `packages/wallet-bridge` `dispatcher.test.ts` — 125 passed.
- `bun run e2e:agent tests/e2e/network/batch-mixed.test.ts` (the dispatcher's silent authwit path, live) — **exit 0 twice** — on `e8d98d3b` (10.2s) and again on `01502d7e` after the round-1 fix (12.6s); "silent path returns named results for all legs"; solo, retry 0.

## What shipped

**A — authwits under the fence.** Wire handler captures the fence at admission (`captureExecutionFence()` in place of `requireActiveProfile`); `ctx.fence` carries it. `handleCreateAuthWit`'s covered branch refuses without a same-profile fence and forwards it sixth to `executeOperations`. `aztec_createAuthWit` joins `FENCED_OPERATION_KINDS`. The arm resolves the account by `fence.profileId` and runs `assertAuthWitFenceLive` (awaited `assertFence` then synchronous `isFenceLive` throw) as the statement before `createAuthWit`.

**B — no unregistered sends.** `createTransferJournal` throws (create error or no id) and moved inside the build `try` (task fails); `createAndRegisterFresh` throws instead of returning an empty result (the dApp-send slot scaffold releases the slot + both controller keys and yields the failed envelope).

## Complexity budget

`executeAztecCreateAuthWit` tripped `noExcessiveCognitiveComplexity` at 16 (max 15) once the fence gate was inlined. Refactored the two-line gate into a private `assertAuthWitFenceLive(fence)` helper (no suppression, per the ratchet rule) → back to ≤15; `biome check` clean on the file, then audit:vue green.

## Deliberate deviation from the plan's test list

The plan listed a `background.test.ts` wire-handler test pinning "the fence is captured at entry, not the arm." `handleWalletMessage` is module-private with no mock-friendly seam, and exporting it purely for a test is a production change for test convenience. The entry-capture is instead pinned by:
- the **batch-mixed network e2e**, which drives a real covered dApp authwit through the real wire handler → dispatcher → arm; without the entry capture `ctx.fence` is undefined and the covered branch refuses, so the e2e would fail;
- the **dispatcher tests** (covered authwit forwards `ctx.fence`; a missing/foreign fence is refused);
- the **service.fence-entry tests** (fenced-kind entry refusal; the arm forwards the fence and never captures).
The "capture in the arm instead of at entry" mutation therefore reds the e2e (and the covered-authwit dispatcher tests, which require a production-supplied `ctx.fence`). Logged rather than silently skipped.

## Test changes

- `service.fence-entry.test.ts`: `aztec_createAuthWit` added to the fence-less-throws `test.each`; the "reads/registrations run fence-less" case drops the authwit; new case — a dApp authwit dispatches under its forwarded fence, never a capture.
- `dispatcher.test.ts`: shared `ctx` fixture gains a matching `fence`; new tests — covered authwit forwards `ctx.fence`; a missing/foreign fence is refused before `executeOperations`.
- `transfer-executor.test.ts`: the two fail-open journal tests replaced — a throwing `createJournalOperation` and a record with no id each refuse before any build (task failed, no registerInFlight, no proveAndSend).
- `claim-helper.test.ts`: `createFreshRecord` returning undefined now refuses (no controller registered).
- `dapp-send-executor.test.ts`: new case — a claim refusal releases the slot, runs no send, rethrows.

## Codex loop (arc 3 boundary) — GPT-6 Astra, `high`, static, fresh session `01a0b098-…`

### Round 1 (on `e8d98d3b`) → conditional

Quoted: "**Conditional — one security fix required (high confidence).**"

| # | Finding | Verified | Disposition |
|---|---|---|---|
| P1 | The fence check still yielded before signing: `isFenceLive()` ran inside the async `assertAuthWitFenceLive()` helper, and awaiting that helper added a microtask boundary between the synchronous check and `account.createAuthWit()`. A pending lock/switch/deletion continuation could invalidate the fence in that gap while the account handle already held signing material | yes — self-inflicted: the complexity budget (16 > 15) pushed the gate into a helper, which is exactly the shape the invariant forbids | **Adopted** (`01502d7e`): gate inlined (`await assertFence` → `if (!isFenceLive) throw` → `return account.createAuthWit(...)`, nothing between); the node read + chain rebind + three-way message-hash resolution moved verbatim into a private `resolveAuthWitMessageHash(op, network)` (early returns) to hold the budget without a suppression. Regression added: a bare-prototype describe where `isFenceLive` returns `false` after `assertFence` resolved → `SessionEndedError`, `createAuthWit` uncalled (+ assert-rejects, happy path resolving by `fence.profileId`, UI-origin self-capture). |
| P3 | Two comments contradicted the change: `FENCED_OPERATION_KINDS` said silent authwits arrive fence-less; the `authorizedFence` parameter doc said the dispatcher never forwards one | yes | **Adopted**: both reworded (silently-covered authwit arrives under the wire handler's admission fence; the dispatcher forwards only that fence, never a dApp-supplied value). |

Held (codex's own "looks fine"): the requested signer is validated against session accounts and resolved by the fence's profile; the `ctx.fence.profileId !== ctx.profileId` refusal cannot falsely trigger through the wire handler (both fields come from one capture); both locked-message variants become the same generic wire error (no envelope regression); the journal refusal terminalizes the task and missing-id journal updates no-op; the dApp-send scaffold releases the slot and applicable controller keys with cancellation cleanup intact; the fence shapes match exactly (structural compatibility, no present defect).

Gate after the fix: execution + wallet-sdk suites 809 passed (64 files); `bun run lint` exit 0, complexity baseline unchanged; `vue-tsc` clean.

### Round 2 (resumed, on `01502d7e`) → **approve**

Quoted: "**Approve — no new material findings (high confidence).**" Holds: the extraction preserves branch precedence, chain validation, artifact lookup, selector/name checks, parsing order and propagated errors, and its promise boundary sits before both fence checks; no suspension occurs between `isFenceLive()` and invoking `account.createAuthWit()` (the return expression is evaluated immediately; adopting the returned promise happens afterward). One precision taken as a documented property, not a gap: signing *starts* under a live fence, but Schnorr awaits `BarretenbergSync.initSingleton()` downstream — post-invocation asynchronous work, analogous to an already-initiated send, the same as the prerequisite's `node.sendTx` statement.

Loop converged in 2 rounds (under the 3-round hard stop).

### Round 3 (resumed, on `55233ca7` — the signed-off copy wired in) → **approve**

Quoted: "**Approve — no new material findings (high confidence).**" Holds: existing `WalletError` identity and details survive the wrap, other faults are logged and replaced by the constant detail-free refusal (their message and stack never enter the popup payload); the new error originates only in the popup transfer executor and neither the operation-result code allowlist nor the wallet-sdk error mapper exposes `OPERATION_NOT_RECORDED` to a dApp; the inline `try/catch` adds no settlement hop; on refusal the task fails, missing-id journal updates no-op and no controller was registered. One factual correction taken: the journal service's epoch/network guards throw plain `Error`, so a begun-deletion refusal is wrapped too — the "nothing was sent" copy stays accurate for it.

Loop converged at the 3-round hard stop's edge: rounds 1–2 on the fixes, round 3 re-opened only for the copy wiring.

## Copy (Ask 3) — signed off and wired

The owner asked when the toast appears, was shown the trigger, the UX and the exact string against today's generic toast, and answered **"that proposal is perfect."** (2026-09-17, quoted in plan.md §Copy). Wired in `55233ca7`: typed `OperationNotRecordedError`, `popup/utils/transfer-failure-copy.ts`, `send.vue` renders the label.

**Attempt log.** The first cut wrapped the journal create in an awaited private helper. `transfer-executor.cancel-window.pins.test.ts` reddened (`registerInFlight` not yet called one microtask after the create resolved): the helper added a settlement hop between the row becoming visible and its cancel controller registering. Inlined the `try/catch`; `audit:vue` exit 0 (6274 tests). Same family of mistake as round 1's P1 — **in this executor, an awaited helper is never a free refactor.**
