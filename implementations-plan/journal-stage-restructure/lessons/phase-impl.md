# Implementation lessons — journal-stage-restructure

## Local-gate diagnosis loop (post-Phase D)

Two surprises during the local 6-test gate revealed gaps the plan didn't anticipate:

### 1. The `proving`-only selector races on local WASM

**Initial implementation**: `waitForSendTxProvingStage(walletPopup)` selector was
`[data-testid="tx-awaiting-card"][data-stage="proving"]`. The plan assumed
"proving is the long-lived stage" because that's true under the accelerator's
chonk path (which dominates the wall-time when the native binary is active).

**Observed locally**: First run timed out on all 6 tests at the `proving`
matcher. On local WASM the wallet spends most of its time in `simulating`
(kernelless discovery → real sim), and the `proving` window is small +
followed almost immediately by `submitting`. The poll loop was racing past
`proving` between the `200ms` poll ticks.

**Fix**: broaden the matcher to "any active stage past pending/queued":
```
[data-testid="tx-awaiting-card"][data-stage]:not([data-stage="pending"]):not([data-stage="queued"])
```
Rename helper `waitForSendTxProvingStage` → `waitForSendTxActiveStage` so the
loosened semantic is visible at every call site. Codex's defensive design
catch was right that the rename is louder than a string-parameter weakening,
but the proper "active" framing is what the test actually wants — it doesn't
care which active stage, only that the wallet got past the queue.

### 2. Simulate fails without pre-minted tokens

**Initial implementation**: tests granted capabilities + submitted sendTx, but
didn't mint any tokens to the granted account. The simulate step then failed
("not enough balance"), the journal advanced straight to `failed`, and the
`tx-awaiting-card` unmounted before any wait could observe it.

**Observed locally**: second run after the selector broadening — still 5/6
failures, awaiting card never appeared in popup snapshots.

**Fix**: added `mintPublicTokensForAccount(aztecConfig, accountAddress)`
helper to `tests/e2e/fixtures/aztec.ts` (wraps the existing
`createTestWallet` + `mintPublicTokens` + cleanup pattern that
`cancel-mid-prove.test.ts` already used inline). Called from all 6 tests
post-cap-grant.

### 3. `noFrom` is a special case — journal terminates too fast for the card to mount

**Surfaced on run 3 (5/6 green, noFrom still red)**.

The playground's `pg-btn-sendTx-noFrom` calls `transfer_public_to_public`,
which is a PUBLIC function. `buildNoFrom` in
`packages/extension/src/wallet/services/execution/tx-request-builder.ts:429`
throws `"DefaultEntrypoint only supports private functions"`. The journal
moves `simulating → failed` in roughly 2-3 seconds.

`openPopup(...)` (in this test) opens a NEW wallet popup tab AFTER
`approveExecute` returns. By the time that popup hydrates + mounts +
fetches journal records, the noFrom journal is already terminal. The
`tx-awaiting-card` is replaced with `tx-terminal-card`. Polling never
catches a `data-stage`.

**Fix**: this test is fundamentally about popup-shape (fee-set badge
appears, no fee picker). The pre-restructure pattern from PR #46 already
handled this correctly with `expect(["ok", "error"]).toContain(result.status)`
— tolerant of failure because the test KNEW the call would error. Restored
that pattern for noFrom only, with a 30s budget (the error-path is fast).
Kept the popup-shape assertion (fee-set badge) intact. Documented the
exception inline + here.

The other 5 tests (sendTx-default, multi-account-from, multicall × 2,
feePayer, sponsoredFpc) all reach an active stage cleanly with the
broadened selector + pre-mint.

## Outcome

Final local 6/6 green. Audit:vue clean (typecheck + units + components +
lint + build). Ready to push + open PR off dev.
