# Phase 1 — the playground gate

## Design, as built (departures from plan rev 6 — ledger rows 46–47)

- **Two private routes, not one.** The PrivateFPC *credit* (`pay_fee`) needs a prior
  `PrivateFPC.mint` sent AS the account (`msg_sender == claimer`), and that mint is itself the
  account's first transaction — so "never-sent × credit" cannot exist. The bridge's own first-claim
  shape is `FeeJuice.claim + mint_and_pay_fee` (`PrivateMintAndPayFeePaymentMethod`, PR #543): that
  is the never-sent private cell. `pay_fee` from held credit (`FPCFeePaymentMethod`, the
  production `unknown nullifier` attempt) is the deployed private cell.
- **Never-sent sends deploy the account**, so there is exactly one per account: self-pay on the
  first account, fuel on the second. The deployed block then runs the full
  `{first, second} × {simulate, send} × {self-pay, fpc-credit}`.
- **"Deployed" is read from the kernel output**, not from a script-side `requiresInitialization`
  (the script cannot compute an extension account's initialization nullifier — it has neither the
  signing key nor the instance). A never-sent account is simulated init-wrapped (root frame = the
  multicall entrypoint, the account nested); a deployed one runs its own entrypoint at the root.
  The flip after the first send is asserted on every later simulate cell.
- **Private balances and the FPC credit are read through the playground's `executeUtility`**
  (`balance_of_private`, `PrivateFPC.balance_of` with `scopes: [account]`): they are notes only the
  extension's PXE holds. Public Fee Juice is read script-side (`balance_of_public`).
- **The negative control's error text comes from the service worker's log trail.** The dApp sees
  the scrubbed envelope (`The wallet could not process the request.`) by design; the spec turns
  Developer + Debug mode on through the settings toggles (testids added:
  `settings-toggle-{developerMode,debugMode}`) and polls `readSwLogTrail` for
  `Setup function not on allow list`.
- **The playground gained** `sections/phase.ts` (`pg-*-phase-*`), a dependency on
  `@alejoamiras/private-fee-juice` (already in the lockfile for the extension; sub-path imports
  only, the top-level export is version-drifted), and the `simFrom` override now also names the
  acting account for the sendTx buttons. The two-account fixture became a bundle-keyed factory
  with a `transaction-contracts` sibling (`dappConnectedExtensionWithFirstTwoAccountsContractsCap`).

## Run log



### Attempt 1 (retries on) — killed at the first send cell

The four never-sent simulate cells passed (both accounts, self-pay and fpc-fuel; the fuel cells
show `FeeJuice._increase_public_balance` as the only setup-phase call, the mint under app logic).
The first send cell failed instantly: my utility reader assumed a bare integer, but
`executeUtility` returns the SDK's `UtilityExecutionResult` (`{ result: Fr[] }`), raw return
fields. Fixed by decoding in the playground section (`decodeFromAbi(call.returnTypes, out.result)`)
so the feed carries the u128 as a string. Run killed rather than paying two blind retries; all
later runs pass `--retry=0` so the first failure prints its error.

### Attempt 2 (retry 0) — six cells green, then a blind popup timeout

```
cell: never-sent / first / simulate / self-pay
cell: never-sent / first / simulate / fpc-fuel
cell: never-sent / second / simulate / self-pay
cell: never-sent / second / simulate / fpc-fuel
cell: never-sent / first / send / self-pay          ← receipt success, balance +1, FJ debit = receipt fee
cell: never-sent / second / send / fpc-fuel         ← receipt success, balance +1, credit = fuel − fee > 0
cell: deployed / first / credit mint (PrivateFPC.mint as A)
TimeoutError: Timed out after waiting 60000ms      (waitForPopup "execute")
```

The credit mint's execute popup never opened and the spec waited on the popup alone, so the
dApp-side reason (the section's `safe` wrapper records it in the feed) was lost. Spec change:
`sendThroughPopup` races the feed row against the popup and fails with the row's error text.

### Attempt 3 (retry 0) — the credit mint's real cause

Same six cells green. The credit mint now failed with its feed row instead of a blind timeout:

```
Error: phase.mintCredit settled before the execute popup opened:
  {"message":"\"The wallet could not process the request.\""}
```

Cause found in the wallet-bridge, not the chain: `scope-enforcement.ts:98` admits only SESSION
accounts in `opts.additionalScopes`, and the mint copied the canonical harness's
`additionalScopes: [fpc]` (valid for an EmbeddedWallet, refused by a dApp session). The mint
credits `msg_sender` and reads no note the FPC scope would unlock, so the option is dropped.
Spec changes alongside: Developer + Debug mode are enabled before the cells (any wallet-side
failure is now reported with the service worker's matching log lines), and the mint waits
`PXE_ANCHOR_SYNC_WORKAROUND_MS` after the script-side `FeeJuice.claim` so the wallet's anchor
block holds the claim's nullifier the mint reads.

### Attempt 4 — the settings hop

Failed before the cells: `enableDeveloperLogs` navigated with a `page.goto(<popup url>#/popup/settings/advanced)`
and the toggle never rendered. Replaced with the suite's `navigateByHash` hop (after
`#/popup/general`), a body-text diagnostic on timeout, and an `aria-checked` wait so both writes
land before the popup closes.

### Attempt 5 (retry 0) — GREEN, every cell

```
[selfpay-phase] node 5.2.0
cell: never-sent / first / simulate / self-pay
cell: never-sent / first / simulate / fpc-fuel
cell: never-sent / second / simulate / self-pay
cell: never-sent / second / simulate / fpc-fuel
cell: never-sent / first / send / self-pay
cell: never-sent / second / send / fpc-fuel
cell: deployed / first / credit mint (PrivateFPC.mint as A)
cell: deployed / first / simulate / self-pay
cell: deployed / first / simulate / fpc-credit
cell: deployed / first / send / self-pay
cell: deployed / first / send / fpc-credit
cell: deployed / second / simulate / self-pay
cell: deployed / second / simulate / fpc-credit
cell: deployed / second / send / self-pay
cell: deployed / second / send / fpc-credit
cell: deployed / second / transfer / simulate / self-pay
cell: deployed / second / transfer / send / self-pay
cell: negative control / second / transfer / simulate / external payer
✓ tests/e2e/network/selfpay-phase.test.ts (1 test) 272434ms
Test Files  1 passed (1)   Tests  1 passed (1)   Duration 338.99s
```

Oracles that held, per cell class: **simulate** — `feePayer` = the account (self-pay) or the FPC
(fuel/credit); the account's and the token's frames in the execution tree; root frame = the
multicall entrypoint while never-sent, = the account once deployed; setup-phase public calls
= `[]` for self-pay and credit, `[FeeJuice]` (the allow-listed `_increase_public_balance`) for
fuel; app-phase public calls = exactly the token. **send** — receipt success, the recipient's
private balance +1, and the payer's debit: public Fee Juice down by exactly the receipt's fee
(self-pay), the PrivateFPC credit created at fuel − fee (fuel) or reduced (credit). **negative
control** — the wallet refuses the `from = B, feePayer = A, no fee call` transfer in simulation
and the service worker's log trail carries the node's `Setup function not on allow list`
(`TX_PUBLIC_SETUP_ALLOWLIST` asserted unset in the harness environment; the node enforces its
default list — AuthRegistry `set_authorized`/`_set_authorized` + FeeJuice
`_increase_public_balance`, `@aztec/p2p` config).

Nothing stayed red: Phase 2 (diagnosis) and Phase 3 (a further fix) are not needed — the
dispatcher fix of Phase 0 is the whole fix. Production attribution (A4) stands on H5.

Wall-time on this host: ~5.7 min of test after a ~1 min boot (sends are fast here; CI's
proverless heavy runner is comparable). The confirmation rerun below prints the node's
rejection line verbatim.

### Confirmation rerun — the node's rejection, verbatim

Second consecutive green (`Tests 1 passed`, exit 0). The negative control now prints the
service worker's line:

```
{"context":"sw","source":"pxe","level":3,
 "data":["[WRITE] simulateTx failed after 436ms",
         "The simulated transaction is unable to be added to state and is invalid. Reason: Setup function not on allow list"]}
```

— the production error text, produced by the harness node's validator on a transfer whose
public enqueue the wallet legitimately left in setup (`from = B`, `feePayer = A`, no fee
call ⇒ `fpc` ⇒ `EXTERNAL`). The dApp saw only `The wallet could not process the request.`

### Pre-fix reversal — `898a3b99`'s dispatcher, suite otherwise at HEAD

The matrix fails at the FIRST second-account cell (both first-account cells pass, as they must:
the first account is what the old dispatcher always resolved to):

```
Error: never-sent / second / simulate / self-pay: simulate failed:
  {"message":"\"The wallet could not process the request.\""}
sw-trail:
  ["Request failed", 63, "Assertion failed: caller is not minter 'assert(minter.eq(sender), \"caller is not minter\")' …"]
  [{"method":"simulateTx","requestId":63,"status":"rejected"}]
Test Files  1 failed (1)
```

`Token.mint_to_private` asserts `msg_sender == minter`; the token's minter is the second account
and the dApp named it in `opts.from`, so the only way the assertion fails is the wallet building
the simulation as the first account — the H5 chain, witnessed by the contract itself. (The first
read of the trail, before this spec polled past the store's 2s flush debounce, showed only stale
`getSyncedBlockHeader` noise; the trail reader now waits for a line newer than the cell start.)
The dispatcher was restored by the runner script; `git status` clean.
