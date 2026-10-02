# Phase 1 — the wallet routes a dApp-named preexisting payer; the bridge uses it

Branch `any-erc20-bridge/dapp-self-pay`, on top of `any-erc20-bridge/first-claim` (PR #543).

## Why the wallet, not the app

- `apps/extension/src/wallet/services/execution/utils/fee-detection.ts` classified a payload by
  its payer alone: payer === sender → `fjwc`. The account entrypoint's `FEE_JUICE_WITH_CLAIM`
  "will set itself as the fee payer but not end setup phase" (`@aztec/entrypoints`
  `account_entrypoint.ts:20-34`): only the Fee Juice contract's `claim_and_end_setup` ends it. A
  sender-paid payload with no fee call never left setup — invalid.
- wallet-sdk's own `completeFeeOptions` (`base_wallet.js:185-192`) makes the SAME choice for an
  EmbeddedWallet, and routes an ABSENT payer as preexisting. So `preexistingFeeJuicePayment`
  (bridge-core) must keep an EMPTY payload for aztec.js wallets, and the Nulo-wallet shape needs a
  wrapper of its own (`selfPaidFeeJuicePayment`: payer in the payload, no calls). Codex caught the
  first version of this exactly (round on `dcaad5bd`/`ca1997b5` in
  `implementations-plan/any-erc20-bridge/lessons/phase-10.md`).
- No fee-mode field crosses the wallet-sdk RPC that the extension reads (`feeEntrypointOptions` is
  not in `wallet-bridge`), so the classification had to come from the payload the wallet parses.

## What shipped

1. `packages/wallet-bridge/src/fee-payer.ts` — `classifyFeePayer(feePayer, from, calls)`:
   `fpc` / `fjwc` (sender + `claim_and_end_setup`) / `self-pay` (sender, no fee call);
   `isSelfPay(exec, from)`. `FeeOptions.requestedPayment: "fj"` carries the verdict — never as
   `embeddedFeePayment`, because the payload carries no payment.
2. Routing: the planner builds a self-pay as `PREEXISTING_FEE_JUICE`; the materializer and the
   execute popup pre-fill `{ kind: "fj" }`, so the native `FeeJuiceStrategy` runs (estimate,
   padding, balance check, authwit discovery, signed-request reuse — all as any fee-juice send).
   The NO_FROM executor passes the calls too (a NO_FROM sender never equals the payer anyway).
3. `FeeSettingsCard` `lockedMethod` prop: the dApp's method is shown with its balance, cost and
   the get-fee-juice nudge, no selector, and the user's saved choice / the network default never
   replace it (both `runInit`'s pre-fill and `commitFromEntry`'s reconcile honour the lock). With
   no Fee Juice held the card derives no settings, so Confirm stays off — the same fail-closed
   shape as a plain fee-juice send.
4. A self-pay ALWAYS confirms in the popup (`isConfirmationNeeded`), like a send that names no
   payer: it spends the account's own Fee Juice.
5. `getWalletFeatures` (Nulo-custom RPC): schema patch, `METHOD_REGISTRY` entry (exempt, no grant,
   handler-routed), dispatcher handler returning `WALLET_FEATURES = ["dapp-self-pay"]`;
   `apps/tools/src/lib/wallet-features.ts` `walletSupports` fails CLOSED.
6. Bridge: `decideOwnGasSource` (public joins only when allowed; either balance pays only when it
   covers the ceiling; a private record prefers its private balance), `ownGasFee` probes the
   wallet, `useGasHeld` reads both balances behind the probe, the wizard's gate/confirm/fee line
   read the same way.

## Gates

- Extension unit + component (full repo suite 5380 → green after SP-1), wallet-bridge 235,
  schema-patch 11, tools 1146 + smoke 21, bridge-core fee tests.
- Network e2e: `tx-sendTx-selfPay.test.ts` (new) + `tx-sendTx-feePayer.test.ts`, proverless,
  local agent runner (proverless): both green — the self-pay spec in 53 s, the account's public
  Fee Juice fell; the existing feePayer (sponsored-FPC payer) spec in 15 s.
- Codex (fresh session `01a06cff-ae6a-7292-b323-6c21f6c5fbb4`, `xhigh`), round 1: "Do not merge yet" —
  HIGH: the classifier trusted a call's NAME (`claim_and_end_setup`), which a dApp writes freely;
  the entrypoint commits target, selector and flags, so a sender-paid payload with a call merely
  named like the claim would be built as a claim in setup (and with a call that ends setup itself,
  run dApp calls inside setup on the account's Fee Juice). Fixed: the claim is identified by the
  Fee Juice contract's address, the pinned selector `0xcbe67243`, private, non-static. MED: a
  pre-filled `{kind:"fj"}` left Confirm live over an empty/unread balance (the card's watcher never
  fires from undefined) — a self-pay is now drafted with no settings. MED: the wizard's
  `heldGasCovers` returned unknown when either read failed even if the other covered — it now
  delegates to `decideOwnGasSource`. Codex confirmed genuine FJWC is unbroken (aztec.js 5.2.0 emits
  exactly that name/address/selector), the lock survives identity/recommit paths, the fingerprint
  keeps self-pay and picker-FJ apart, and `getWalletFeatures` leaks nothing.
- Codex round 2: one HIGH — the claim was accepted at ANY position and for ANY recipient.
  aztec.js prepends the fee payload, and the entrypoint runs every call before the claim inside
  setup: `[arbitraryCall, realClaim]` would run the arbitrary call in setup, non-revertible; and
  a genuine claim crediting another account would end setup while the victim pays from held Fee
  Juice. Fixed: the claim must be `calls[0]`, its four arguments must start with the payer,
  `isStatic === false`, `hideMsgSender !== true`. LOW: the popup drafts a self-pay on its own
  (it does not call `materializeRequest`), so a popup-level pin was added (`execute/index.test.ts`:
  drafted with no fee settings, approve executes nothing until the card supplies Fee Juice).
- Found by the e2e re-run, not by codex: with the self-pay drafted WITHOUT settings, the locked
  card derives them from the wallet's gas-balance snapshot — cached for five minutes
  (`GAS_BALANCE_TTL_MS`) — which still held the pre-funding zero, so Confirm never became
  approvable. A locked mount now asks the store for a FRESH read (`forceRefresh`): a dApp locks the
  method precisely when the balance just moved.
- Codex round 3 (`aa7785c8`) — converged: "no material findings remain in `b22f6ad2..HEAD`." It
  also cleared the forced gas read on a locked mount against the store's rules (monotonic forced
  sequence, epoch checks, D4 and D11 intact; one uncached gas RPC per locked popup mount, which
  the balance-sensitive dApp request warrants).
