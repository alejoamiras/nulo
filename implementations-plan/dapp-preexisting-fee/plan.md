# dApp-named preexisting Fee Juice — the wallet routes it, the bridge uses it

**Status:** in progress (owner-authorized 2026-09-04, as its own PR after `any-erc20-bridge/first-claim`).
**Branch:** `any-erc20-bridge/dapp-self-pay`. **Lessons:** [`lessons/phase-1.md`](lessons/phase-1.md).

## Why

A dApp transaction sent through the wallet SDK can name the ACCOUNT ITSELF as fee payer with no
fee calls — "pay from the Fee Juice I already hold" (`preexistingFeeJuicePayment` in bridge-core).
The extension classifies every sender-paid payload as `fjwc` (`fee-detection.ts`) and builds the
account entrypoint in `FEE_JUICE_WITH_CLAIM` mode, which sets the payer but deliberately does NOT
end setup — the Fee Juice contract's `claim_and_end_setup` does. With no such call the app phase
never starts: the transaction is invalid. So a dApp claim with no fresh Fee Juice message of its
own can only pay from the private balance at the PrivateFPC today, and an account holding only
PUBLIC Fee Juice cannot claim a token-only bridge (the ruling: no bridge path leans on the
sponsored FPC — see `implementations-plan/any-erc20-bridge/lessons/phase-10.md`, round 4).

## What

### Wallet (apps/extension + packages/wallet-bridge + packages/wallet-sdk-schema-patch)

1. **Detection by payload, not payer alone** (`execution/utils/fee-detection.ts`): sender-paid AND
   a `claim_and_end_setup` call → `fjwc`; sender-paid with no fee call → `requested self-pay`;
   other payer → `fpc`; no payer → the user's fee card. The verdict rides on `FeeOptions` as a
   NEW field (`requestedPayment: "fj"`), never as `embeddedFeePayment` — "embedded" means the
   payload carries the payment; a self-pay carries nothing, the wallet only has to pick Fee Juice.
2. **Routing**: the planner maps it to `PREEXISTING_FEE_JUICE`; the materializer (silent path) and
   the popup pre-fill `feeSettings = { paymentMethod: { kind: "fj" } }` so the native
   `FeeJuiceStrategy` runs — estimation, predicted-worst padding, the balance check, authwit
   discovery, the signed-request reuse cache — all unchanged. `requiresFeeSelection` treats it as
   ready; the popup shows the "fee set by the app" badge (no picker, so the sponsored FPC is never
   offered). dApp-supplied `maxFeesPerGas` / limits are honored as today.
3. **Feature probe** (`getWalletFeatures(): string[]`, Nulo-custom RPC via the schema patch): a
   dApp asks before naming the account's public Fee Juice; an older wallet build rejects the
   unknown method and the dApp falls back. No grant needed (no account data).

### Bridge (apps/tools)

4. `decideOwnGasSource` regains the public source: preferred when it covers the reference ceiling
   (the wallet's own estimate is the real check), else the private balance, else stop; ONLY when
   the connected wallet advertises the feature — otherwise the private-only ladder of
   `e63ba624` stands. The wizard's token-only gate and the confirm re-read both balances the same
   way. A private record keeps preferring its private balance.

## Validation gates

- Extension unit: `fee-detection`, `operation-planner`, `materialize`, `operation-validation`
  (wallet-bridge + popup shim), `execute/index` popup pre-fill, `dapp-send-executor` (fj strategy
  chosen, discovery runs, reuse eligible), `operation-fingerprint`, dispatcher reachability for the
  new RPC, schema-patch `apply.test.ts`.
- Extension network e2e: `tx-sendTx-selfPay.test.ts` — the playground names the account itself as
  payer with no fee call; the wallet lands it paid from the account's public Fee Juice (funded
  via `bridgeFeeJuice` + `claimFeeJuice`), the popup shows the badge and no picker.
- Tools unit + jsdom smoke; bridge-core unit.
- `bun run test:all`, `bun run lint`, `bun run lint:actions`; CI's quality + smoke + network gates.
- Codex review at `xhigh` after the local gates, converged.

## Security & adversarial considerations

- A dApp cannot make the wallet pay from anything but the account's own Fee Juice through this
  path (the payer is the account; the protocol charges only its balance). No sponsor, no FPC.
- The verdict is derived from the payload the wallet itself parses, never from a dApp-supplied
  flag: a payload claiming "fjwc" without a claim call is now routed as a self-pay, not built
  invalid; a payload with a `claim_and_end_setup` call stays `fjwc` as before.
- The feature probe reveals only a static feature list; no account, network, or balance data.
- The fee card stays hidden exactly as for embedded payments, so the user cannot be steered to a
  sponsor by a dApp; the dApp's cap and limits are bounded by the node's `txsLimits` as today.
