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
  local agent runner: PENDING_E2E
- Codex: PENDING_CODEX
