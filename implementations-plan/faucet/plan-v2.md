# Nulo × Aztec Faucet — Plan v2 (post-audit)

This is the **active spec**. Supersedes [plan.md](plan.md) (v1).
Re-cut after [audit-codex.md](audit-codex.md). Changelog at top.

> v1 archive: [plan.md](plan.md) — kept so the audit's line refs stay valid.
> Sources: [plan-mine.md](plan-mine.md), [plan-opus.md](plan-opus.md),
> [plan-codex.md](plan-codex.md), [brief.md](brief.md).

---

## Changelog from v1 → v2

Driven by [audit-codex.md](audit-codex.md). Codex tags: `BLOCKER` `SHOULD` `NIT`.

### Applied — correctness (BLOCKERs)
- **`wallet.executeUtility` (not `simulateUtility`)** for balance reads
  + the SDK's actual option shape (`from`, `scopes`, `extraHashedArgs: []`,
  `authWitnesses: []`, `capsules: []`). Plan reference now points at
  `packages/playground/src/sections/simulation.ts:99` as the canonical
  copy target. §5, §4 Phase D updated.
- **Drop the `wallet.registerContract(sponsoredFpcInstance, …)` call.**
  Nulo materializes the embedded `feePayer` path internally
  (`packages/wallet-bridge/src/dispatcher.ts:331`,
  `packages/extension/src/wallet/services/dapp-interaction/materialize.ts:109`),
  so the dApp never needs to register SponsoredFPC. Capability scope
  stays at `[DRIPPER, USDC, ETH]`; faucet computes the SponsoredFPC
  address only to pass as `feePayer`. §5 updated.
- **`feePayer` typing**: Aztec's `ExecutionPayload` in `@aztec/aztec.js@4.2.0`
  doesn't include `feePayer` in its public type. The playground casts
  (`packages/playground/src/sections/transactions.ts:111`). The faucet
  follows the same pattern with a single, commented `as` boundary in
  `useFaucetDrip.ts`. §5 + §11 risks updated.
- **CI/build infrastructure is real new work, not "auto"**:
  - `audit:vue` stays extension-only (its `test`/`build` invoke extension scripts).
  - New root script **`audit:faucet`** explicitly runs faucet typecheck + test + build.
  - GitHub workflow `_build-extension.yml` only builds the extension —
    we add a sibling **`_build-faucet.yml`** and wire it into the
    `Quality` aggregator with a `packages/faucet/**` path filter.
  Plan §10 reflects this honestly.
- **Shell commands fixed**: every validation command now uses explicit
  `bun run --cwd packages/faucet <script>` for each step instead of
  `… typecheck && test && build` (which would invoke the shell `test`
  builtin). §4 + §10.

### Applied — design (SHOULDs)
- **Phase F (deploy) moves earlier** → order is now **A → B → F → C → D → E → G**.
  Phase D and E now validate against real on-chain contracts, not placeholders.
- **`ActivityFeed` dropped.** Scope creep per audit. Toast covers immediate
  feedback; the wallet's own activity history covers durable record.
  Removed from §3 file tree, §4 phase E, §6 layout, §7 tests.
- **Capability approval is its own state.** The connect flow is two
  wallet interactions (`establishSecureChannel` then
  `requestCapabilities`), each with its own user-visible step.
  Added `status: "capability-approval"` to `useWalletConnection`, an
  explicit copy state, and two test cases.
- **Test count trimmed** from ~95 to ~55 high-ROI cases. Primitive
  components keep the CLAUDE.md ≥5 floor; composites stay at ≥10;
  redundant L4 component coverage cut. §7 updated.
- **Artifact import path** uses the playground-proven
  `@defi-wonderland/aztec-standards/dist/src/artifacts/{Token,Dripper}.js`
  (citations: `packages/playground/src/sections/transactions.ts:43`,
  `…/simulation.ts:39`, `packages/extension/tests/e2e/fixtures/aztec.ts:144`).
  Plan no longer overstates the extension alias as the source of truth.
- **Deploy env vs frontend env split**: `AZTEC_NODE_URL` for deploy
  (matches upstream `aztec-standards/scripts/deploy-config.ts:42`),
  `VITE_AZTEC_NODE_URL` for the frontend. `DEPLOYER_SECRET` is a
  first-class input documented in the deploy script + README.
- **Fonts**: add `SpaceGrotesk-latin-ext.woff2`. We do NOT need
  `MaterialSymbolsOutlined.woff2` — the faucet doesn't use Material icons.
- **§13 reduced to one question** (Codex's framing wins — operationally
  more critical than hosting domain).

### Rejected — with reason
- **"Merge B into A"** (NIT). Kept separate: contracts plumbing is
  reviewable independently of design tokens. Phase B is small but the
  `getContractInstanceFromInstantiationParams` reconstruction is the
  single most error-prone helper in the entire faucet; it deserves its
  own merge.
- **"`AccountNotDeployedBanner` is paranoia"** — not in v2 (codex
  marked it `LGTM` after re-checking). Banner stays.
- **"SFC ordering reminder" (NIT)** — left implicit. CLAUDE.md is
  always loaded; reiterating is noise.

### Loose ends acknowledged
- **"Works with every wallet-sdk wallet" is an inference.** Codex right
  to flag. The faucet renders best with Nulo today; we ship explicit
  `feePayer` for SDK-correctness, but in practice Nulo is the only
  validated path. Documented as a known-edge in §11.

---

## 1. Summary

Static Vue 3 + Vite SPA at `packages/faucet/`. Lets the Aztec Foundation
team self-mint **1,000 USDC** (decimals 6) or **1 ETH** (decimals 18)
on **alpha-testnet** through Wonderland's permissionless `Dripper`
contract from `@defi-wonderland/aztec-standards@4.2.0-aztecnr-rc.2`.

Visitors connect any Aztec wallet via `@aztec/wallet-sdk`; in practice
Nulo. Four buttons: USDC → public, USDC → private, ETH → public, ETH →
private. No backend, no rate limit, no custodial wallet, no switcher.

One screen. Two cards. Four buttons. Three success states, six error
states, one toast. Done.

---

## 2. Architecture

```text
┌────────────────────────────────────────────────────────────┐
│  Aztec alpha-testnet                                        │
│                                                             │
│    ┌──────────────────┐   salt 1337 (matches Wonderland)    │
│    │  Dripper         │   permissionless;                   │
│    │  (no auth)       │   drip_to_{public,private}(t, a)    │
│    └────────┬─────────┘                                     │
│             │ mint_to_{public,private}(msg_sender, amount)  │
│    ┌────────┴────────┐                                      │
│    │                 │                                      │
│  Token(USDC, d=6)  Token(ETH, d=18)                         │
│  minter=Dripper    minter=Dripper                           │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ Aztec RPC + SponsoredFPC fee (embedded feePayer)
                    │
          ┌─────────▼──────────┐
          │  Aztec wallet      │   Discovery + emoji-verified
          │  (Nulo extension)  │   AES-GCM channel via wallet-sdk
          └─────────┬──────────┘
                    │ window.postMessage
                    │
   ┌────────────────▼─────────────────────────────────┐
   │  packages/faucet (static Vue 3 SPA)              │
   │                                                   │
   │  src/App.vue   ─ one screen, one column           │
   │    ├─ Hero                                        │
   │    ├─ WalletPanel                                 │
   │    │   ├─ ConnectButton                           │
   │    │   ├─ VerificationModal     ← teleported      │
   │    │   ├─ CapabilityApproval    ← inline state    │
   │    │   └─ AddressDisplay + Disconnect             │
   │    ├─ AccountNotDeployedBanner (conditional)      │
   │    ├─ TokenCard × 2 (USDC + ETH)                  │
   │    │   ├─ DisclaimerTag                           │
   │    │   ├─ BalanceRow (public + private)           │
   │    │   └─ DripButton × 2 (public + private)       │
   │    ├─ AppToastRegion                              │
   │    └─ Footer                                      │
   └───────────────────────────────────────────────────┘
```

**State model — three composables, no Pinia.** Single user, single
connection, single global in-flight drip.

| State | Lives in | Why |
|---|---|---|
| `status` (`idle\|discovering\|verifying\|capability-approval\|connected\|error`), `wallet`, `provider`, `pendingConnection`, `selectedAccount` | `useWalletConnection` (module singleton) | Wallet must survive component re-mount. One concrete connection per tab. **Capability-approval is its own state** — a second wallet interaction, not part of "verifying". |
| `inflight: { token, target } \| null`, `last: Record<tokenSymbol, { txHash \| error }>` | `useFaucetDrip` (module singleton) | Global single-action gate — wallet popups serialize anyway. |
| `publicBalance`, `privateBalance` per token | `useTokenBalance(tokenAddress)` (per-card instance) | Two cards poll independently every 15s. |
| Toast queue | `useToast` (module singleton) | One transient toast at a time. |
| Contract addresses + `ContractInstance`s | `src/contracts/deployments.ts`, imported at module scope | Build-time constant. No reactivity needed. |

**Map by symbol, not array order**: `lib/contracts.ts` looks up tokens
by `constructorArgs.symbol === "USDC" | "ETH"`. Deploy script writes an
array; we don't rely on its order.

---

## 3. File-by-file layout

```text
packages/faucet/
├── README.md                              purpose, dev, deploy command, hosting
├── package.json                           "@nulo/faucet", exact pins matching extension's Aztec line
├── tsconfig.json                          extends root; vue type plugin; @/* alias
├── biome.json                             extends root; faucet-specific noRestrictedImports for ui/composite layer rule
├── vite.config.ts                         vue + nodePolyfills + COOP/COEP dev headers; dedupes noir-acvm_js/noirc_abi
├── vitest.config.ts                       vue-aware vitest; jsdom; test/setup.ts
├── index.html                             entry + node-globals shim (Buffer, process) — copied from playground
├── public/
│   ├── _headers                           Cloudflare Pages: COOP, COEP, CSP, cache
│   ├── favicon.svg                        Nulo mark
│   └── fonts/
│       ├── SpaceGrotesk-latin.woff2
│       ├── SpaceGrotesk-latin-ext.woff2   referenced by base.css
│       ├── InterVariable.woff2
│       └── JetBrainsMono-latin.woff2
├── scripts/
│   ├── deploy-config.ts                   faucet-only token list (USDC d=6, ETH d=18) + network config
│   └── deploy.ts                          self-contained deployer (~150 lines vendored from aztec-standards)
├── src/
│   ├── main.ts                            createApp, mount, vendored CSS imports
│   ├── App.vue                            single page: Hero + WalletPanel + AccountNotDeployedBanner + TokenCards + Toast + Footer
│   ├── env.d.ts                           Vite typings for VITE_AZTEC_NODE_URL, VITE_EXPLORER_BASE_URL, VITE_CHAIN_ID, VITE_CHAIN_VERSION, VITE_NULO_INSTALL_URL
│   ├── test/
│   │   └── setup.ts                       jsdom shims (process, global, Buffer); matchMedia stub
│   ├── design/
│   │   ├── base.css                       vendored CSS vars from extension _base.scss + reset + @font-face
│   │   └── tokens.ts                      vendored typed reflection of CSS var names (subset of extension's)
│   ├── constants/
│   │   └── tokens.ts                      `{ symbol, decimals, displayAmount, onchainAmount: bigint }` per faucet token
│   ├── contracts/
│   │   ├── deployments.json               committed deploy output (Dripper + USDC + ETH on alpha-testnet)
│   │   ├── deployments.ts                 parses + validates; reconstructs ContractInstance per record via getContractInstanceFromInstantiationParams
│   │   ├── deployments.test.ts            invariants: minter==dripper, decimals correct, addresses parse
│   │   └── sponsored-fpc.ts               computes deterministic SponsoredFPC address from SPONSORED_FPC_SALT
│   ├── lib/
│   │   ├── chain-info.ts                  reads URL ?chainId/?version + VITE_CHAIN_* + falls back to Fr.ZERO/Fr.ZERO
│   │   ├── capabilities.ts                builds the exact AppCapabilities manifest
│   │   ├── capabilities.test.ts           proves metadata + exact scopes + no extra capability types
│   │   ├── wallet.ts                      pure helpers: extractGrantedAccounts, registerContractsInOrder
│   │   ├── errors.ts                      normalizes wallet/discovery/tx errors → UI categories
│   │   ├── errors.test.ts                 covers reject, network, fee, init, revert cases
│   │   ├── format.ts                      formatBigInt(value, decimals, places), trimAddress, trimTxHash
│   │   ├── format.test.ts                 5 cases for amount formatting + address shortening
│   │   ├── testids.ts                     CENTRAL data-testid catalog ("fa-…" prefix)
│   │   ├── explorer.ts                    explorerTxUrl(hash), explorerAddressUrl(addr) using VITE_EXPLORER_BASE_URL
│   │   └── emoji.ts                       re-exports hashToEmoji from @aztec/wallet-sdk/crypto + chunk-to-3x3 helper
│   ├── composables/
│   │   ├── useWalletConnection.ts         discovery → secureChannel → confirm → requestCapabilities (own state) → register contracts
│   │   ├── useWalletConnection.test.ts    ≥10 cases (CLAUDE.md composable rule)
│   │   ├── useFaucetDrip.ts               builds dripper exec; attaches SponsoredFPC feePayer (cast at boundary); sendTx; receipt wait
│   │   ├── useFaucetDrip.test.ts          ≥10 cases
│   │   ├── useTokenBalance.ts             polls executeUtility(balance_of_public/private) every 15s; manual refresh; dispose()
│   │   ├── useTokenBalance.test.ts        ≥10 cases
│   │   ├── useToast.ts                    queue + auto-dismiss
│   │   └── useToast.test.ts               5 cases
│   └── components/
│       ├── ui/                            L1/L2 primitives (≥5 cases each per CLAUDE.md)
│       │   ├── AppButton.vue / .test.ts
│       │   ├── Spinner.vue  / .test.ts
│       │   ├── Tag.vue      / .test.ts
│       │   ├── Card.vue     / .test.ts
│       │   └── Toast.vue    / .test.ts
│       ├── composite/                     L3 composites (≥10 cases each per CLAUDE.md)
│       │   ├── EmojiGrid.vue        / .test.ts
│       │   ├── AddressDisplay.vue   / .test.ts
│       │   ├── BalanceRow.vue       / .test.ts
│       │   ├── DisclaimerTag.vue    / .test.ts (5 — pure presentation)
│       │   └── DripButton.vue       / .test.ts
│       ├── VerificationModal.vue          wallet verification overlay with EmojiGrid + match/cancel
│       ├── VerificationModal.test.ts      5 cases
│       ├── WalletPanel.vue                idle / no-wallet / discovering / verifying / capability-approval / connected / error
│       ├── WalletPanel.test.ts            ≥8 cases (state-rich, includes capability-approval)
│       ├── AccountNotDeployedBanner.vue   inline banner above token cards when account contract missing
│       ├── AccountNotDeployedBanner.test.ts
│       ├── TokenCard.vue                  USDC/ETH card: symbol, disclaimer, balance row, drip buttons, status row
│       ├── TokenCard.test.ts              ≥10 cases (composite)
│       ├── AppToastRegion.vue             fixed-position toast renderer driven by useToast
│       └── Footer.vue                     network info + contract links + Nulo/Wonderland links + disclaimer
└── tests/
    └── e2e/
        ├── README.md                       how smoke runs (no Aztec network required)
        ├── faucet-smoke.test.ts            5 cases against a mock wallet provider
        └── helpers/
            ├── mockWalletProvider.ts       fake provider — postMessage discovery + canned RPC replies (incl. registerContract, executeUtility, sendTx)
            └── pageHelpers.ts              puppeteer drivers (mirrors extension's e2e helpers)
```

**Removed from v1**: `ActivityFeed.vue` + `.test.ts` (scope creep).

**Testid catalog** (all `fa-` prefix; defined in `src/lib/testids.ts`):

- `fa-status` (carries `data-status="idle|discovering|verifying|capability-approval|connected|error"`)
- `fa-btn-connect`, `fa-btn-disconnect`, `fa-btn-install-nulo`
- `fa-account` (selected account chip)
- `fa-banner-account-not-deployed`
- `fa-verification-modal`, `fa-emoji-grid`, `fa-emoji-cell-{0..8}`, `fa-btn-verify-confirm`, `fa-btn-verify-cancel`
- `fa-token-card` (with `data-symbol="USDC|ETH"`)
- `fa-balance-public`, `fa-balance-private`
- `fa-btn-drip-public`, `fa-btn-drip-private`
- `fa-drip-status` (carries `data-drip-status="idle|dripping|ok|error"`)
- `fa-toast` (with `data-kind="ok|error|info"`)

---

## 4. Phase plan

**New order**: A → B → F → C → D → E → G.

Phase F (contract deployment) moves before the wallet flow so that
Phases C–E validate against real on-chain contracts, not placeholders.
Deploy uses an `EmbeddedWallet` (no extension required) — it's fully
independent of the user-wallet flow.

Validation per phase is explicit:
`bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run --cwd packages/faucet build`
(separate `bun run --cwd …` for each script; no shell-builtin `test`
hazard).

### Phase A — Scaffold + brand foundation (½ day)

**Files**: `package.json`, `tsconfig.json`, `vite.config.ts`,
`vitest.config.ts`, `biome.json`, `index.html`, `src/main.ts`,
`src/App.vue` (placeholder), `src/env.d.ts`, `src/test/setup.ts`,
`src/design/{base.css,tokens.ts}`, `public/fonts/*`, `public/favicon.svg`,
`public/_headers`, L1/L2 primitives + tests. Root `package.json`:
add `dev:faucet`, `build:faucet`, `test:faucet`, `audit:faucet`.

Vite config mirrors the proven extension pattern: `vite-plugin-node-polyfills`,
COOP/COEP dev headers via `server.headers`, dedupe of
`@aztec/noir-noirc_abi` + `@aztec/noir-acvm_js`. Port `5176`, `strictPort: true`.

**Validation**: `bun install && bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run --cwd packages/faucet build`.
Placeholder renders. 25+ primitive test cases green.

**Risk**: bb.js wasm + COOP/COEP fragility. **Mitigation**: mirror
`packages/playground/vite.config.ts` and `packages/playground/index.html` exactly.

### Phase B — Contracts plumbing (½ day)

**Files**: `src/constants/tokens.ts`, `src/contracts/sponsored-fpc.ts`,
`src/contracts/deployments.json` (with placeholder addresses for now),
`src/contracts/deployments.ts`, `src/contracts/deployments.test.ts`.

**Critical**: `deployments.ts` does NOT pass the JSON straight to
`wallet.registerContract`. It rebuilds each `ContractInstance` via:

```ts
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"

const instance = await getContractInstanceFromInstantiationParams(TokenContractArtifact, {
  constructorArgs: [name, symbol, decimals, AztecAddress.fromString(minter)],
  salt: new Fr(salt),
  publicKeys: PublicKeys.default(),
  deployer: AztecAddress.fromString(deployer),
  constructorArtifact: "constructor_with_minter",
})
```

Raw JSON is *deploy metadata*, not a registerable `ContractInstance`.

**Token amounts** in `src/constants/tokens.ts`:

```ts
export const FAUCET_TOKENS = [
  { symbol: "USDC", decimals: 6,  displayAmount: "1,000", onchainAmount: 1_000_000_000n },
  { symbol: "ETH",  decimals: 18, displayAmount: "1",     onchainAmount: 1_000_000_000_000_000_000n },
] as const
```

Both `onchainAmount`s fit in `u64` (max 1.84e19); `Dripper` casts to `u128` internally.

**Validation**: typecheck + test. `deployments.test.ts` asserts:
- Each address parses as `AztecAddress`
- `dripper.address !== AztecAddress.ZERO`
- Each token's `constructorArgs.minter === dripper.address`
- Each token's `constructorArgs.decimals` matches `FAUCET_TOKENS`

### Phase F — Contract deployment (½ day) — MOVED EARLY

**Files**: `scripts/deploy-config.ts`, `scripts/deploy.ts` (~150 lines
vendored from `aztec-standards/scripts/deploy.ts` with our token list),
real `src/contracts/deployments.json` (committed).

**Maintainer command**:

```bash
cd packages/faucet
export DEPLOYER_SECRET="<32+ char string>"        # required
export AZTEC_NODE_URL="https://<alpha-testnet-rpc>"   # optional override
bun run deploy:testnet
```

`AZTEC_NODE_URL` mirrors upstream's
`aztec-standards/scripts/deploy-config.ts:42`. The frontend uses a
separate `VITE_AZTEC_NODE_URL` (Vite prefix required for browser exposure).
The deploy script never reads `VITE_*`.

The script:
1. `createAztecNodeClient(AZTEC_NODE_URL ?? alpha-testnet default)`
2. `EmbeddedWallet.create(...)` with `proverEnabled: true`
3. Schnorr deployer from `poseidon2Hash([Fr.fromBufferReduce(Buffer.from(DEPLOYER_SECRET))])`
4. Register SponsoredFPC; build `SponsoredFeePaymentMethod` for deploy fees
5. Ensure deployer account is deployed
6. Compute addresses for Dripper (salt 1337), USDC (4242), ETH (4243)
7. For each: check `node.getContract(addr)`; if absent, deploy
8. Write `packages/faucet/src/contracts/deployments.json`

**Optional**: `--dry-run`, `--salt <n>` to evict a borked deploy.

**Idempotent**: re-run = no-op if everything exists.

**Validation**: `bun run --cwd packages/faucet deploy:testnet:dry`
prints expected addresses. Real deploy → JSON committed. Phases C–E
now work against real contracts.

**Salt 1337 + Wonderland collision**: if their Dripper exists at salt
1337 on alpha-testnet, ours collides to the same address (good — we
share it). Token salts (4242, 4243) avoid collision with their WETH/DAI/USDC.

### Phase C — Wallet connect flow (1 day)

**Files**: `lib/{chain-info,capabilities,wallet,emoji,errors,testids}.ts`
+ tests, `composables/{useToast,useWalletConnection}.ts` + tests,
`components/{ui/Toast,AppToastRegion}.vue`,
`components/composite/{EmojiGrid,AddressDisplay}.vue` + tests,
`components/VerificationModal.vue` + test,
`components/WalletPanel.vue` + test,
`components/AccountNotDeployedBanner.vue` + test,
`src/App.vue` (real layout starts).

**`chain-info.ts` precedence**:
1. URL `?chainId=…&version=…`
2. `VITE_CHAIN_ID` / `VITE_CHAIN_VERSION` env
3. `Fr.ZERO` / `Fr.ZERO` permissive

**Emoji**: `import { hashToEmoji } from "@aztec/wallet-sdk/crypto"`
(confirmed public: extension uses the same import at
`packages/extension/src/popup/windows/verify/index.vue:7`).

**Connect state machine** — two distinct wallet interactions:

```
idle
  → discovering            (manager.getAvailableWallets)
  → verifying              (provider.establishSecureChannel → emoji grid)
  → capability-approval    (wallet.requestCapabilities → Nulo shows /windows/capabilities)
  → connected              (extractGrantedAccounts → register contracts)
  → error (terminal-ish; user can retry)
```

**Capability-approval has its own UI** — copy in §6. If the user
rejects capabilities, we surface a distinct error (not "verification
failed"), with a Retry button that re-runs `requestCapabilities`.

**Account-not-deployed pre-flight**: after connect, `node.getContract(selectedAccount)`.
If null, render the banner above the token cards.

**Validation**: typecheck + test + build. Manual: dev server + Nulo →
discovery → emoji → confirm → capability approve → connected →
banner check.

### Phase D — Token reads (½ day)

**Files**: `lib/{format,explorer}.ts` + tests,
`composables/useTokenBalance.ts` + test,
`components/composite/{BalanceRow,DisclaimerTag}.vue` + tests,
`components/TokenCard.vue` skeleton (symbol + balance row, no drip
buttons yet), `App.vue` renders 2 TokenCards when connected.

**`useTokenBalance`** uses `wallet.executeUtility`, not `simulateUtility`.
Copy the playground's option shape verbatim
(`packages/playground/src/sections/simulation.ts:99`):

```ts
const call = await tokenContract.methods.balance_of_public(addr).request()
const result = await wallet.executeUtility(call, {
  from: addr,
  scopes: [],
  authWitnesses: [],
  capsules: [],
  extraHashedArgs: [],
})
// result is the call return value; coerce to bigint
```

Polls every 15s via `setInterval`. Disposed via `dispose()` called from
parent `onBeforeUnmount` (per CLAUDE.md composable rule). Now that
Phase F has run, balances reflect real chain state.

**Validation**: typecheck + test + build. Manual: connect → see
balances render as `0.00` (or your existing balance) for both tokens.

### Phase E — Drip flow (1 day)

**Files**: `composables/useFaucetDrip.ts` + test,
`components/composite/DripButton.vue` + test, full `TokenCard.vue` + test,
`src/App.vue` wiring.

**`useFaucetDrip`** — one composable, one global in-flight state:

```ts
const inflight = ref<{ tokenSymbol: string; target: "public" | "private" } | null>(null)
const last = reactive<Record<string, { kind: "txHash" | "error"; value: string } | null>>({})

async function drip(token: FaucetToken, target: "public" | "private") {
  if (inflight.value) return  // global gate; all 4 buttons disable
  inflight.value = { tokenSymbol: token.symbol, target }
  try {
    const dripper = await DripperContract.at(DRIPPER, wallet)
    const interaction = target === "public"
      ? dripper.methods.drip_to_public(token.address, token.onchainAmount)
      : dripper.methods.drip_to_private(token.address, token.onchainAmount)
    const exec = await interaction.request()
    // ExecutionPayload doesn't include feePayer in @aztec/aztec.js@4.2.0 types.
    // Runtime supports it; Nulo's dispatcher materializes the embedded fee
    // path. Single typed-boundary cast matches playground's transactions.ts:111.
    const execWithFee = { ...exec, feePayer: SPONSORED_FPC_ADDRESS } as Parameters<typeof wallet.sendTx>[0]
    const tx = await wallet.sendTx(execWithFee, { from: selectedAccount })
    last[token.symbol] = { kind: "txHash", value: tx.txHash.toString() }
    await balance.refresh(token.symbol)
  } catch (e) {
    last[token.symbol] = { kind: "error", value: normalizeError(e) }
  } finally {
    inflight.value = null
  }
}
```

**Why explicit `feePayer`**: SDK-correctness for any wallet. Nulo's
dispatcher detects and materializes the embedded fee path
(`packages/wallet-bridge/src/dispatcher.ts:331`,
`packages/extension/src/wallet/services/dapp-interaction/materialize.ts:109`).

**Why one global in-flight**: wallet popups serialize; queueing
multiple is confusing UX. All four DripButtons disable while one is
active; the active one shows the spinner.

**Wait boundary**: default SDK `sendTx` waits for `node.getTxReceipt(txHash)`.
Don't pass `wait: "NO_WAIT"`. Receipt resolution = UI success boundary.

**Validation**: typecheck + test + build. Manual end-to-end against
the real Dripper + tokens deployed in Phase F: all four drips succeed;
balances refresh; explorer links open.

### Phase G — Smoke e2e + polish + README (½ day)

**Files**: `tests/e2e/helpers/{mockWalletProvider,pageHelpers}.ts`,
`tests/e2e/faucet-smoke.test.ts`, `README.md`, Footer copy finalized.

**Mock wallet provider** intercepts `aztec-wallet-discovery`
postMessage and responds with canned WalletInfo + a MessagePort.
Implements **all six** RPCs the faucet uses (audit-driven addition —
v1 missed `registerContract`):
1. discovery handshake
2. `establishSecureChannel` → returns deterministic `verificationHash`
3. `confirm`
4. `requestCapabilities` → returns canned `granted.accounts`
5. **`registerContract`** → returns `void` (the missing one in v1)
6. `executeUtility` → returns canned `0n`
7. `sendTx` → returns deterministic fake `txHash`

**Smoke (5 cases)**:
1. Empty state — no wallet detected
2. Discover → emoji modal → confirm → **capability approval** → connected
3. Renders 2 TokenCards with balances rendered as "0.00"
4. Click drip USDC public → button loading → success toast with explorer link
5. Disconnect → resets to empty

**Validation**: `bun run --cwd packages/faucet test:e2e` green.

**Total**: ~4 working days for a solo author, gates green between phases.

---

## 5. Wallet-SDK integration details

**Discovery** mirrors `packages/playground/src/lib/wallet.ts:62-93`:

```ts
const manager = WalletManager.configure({ extensions: { enabled: true } })
const discovery = manager.getAvailableWallets({
  chainInfo: readChainInfo(),  // see chain-info.ts precedence above
  appId: "nulo-faucet",
  timeout: 60_000,
})
for await (const provider of discovery.wallets) {
  firstProvider = provider
  break
}
```

**Emoji verify modal**: `pending.verificationHash` →
`hashToEmoji(hash)` → split into 9-emoji string → render 3×3 grid in
`VerificationModal`. Match → `await pending.confirm()` returns the
`Wallet`. Cancel → `pending.cancel()`.

Emoji grid is the **only** emoji surface in the faucet — protocol
security material, not UI decoration.

**Capability manifest** — scoped tight, no SponsoredFPC:

```ts
{
  version: "1.0",
  metadata: {
    name: "nulo-faucet",
    version: "0.1.0",
    description: "Test USDC + ETH on Aztec alpha-testnet — Nulo",
    url: window.location.origin,
  },
  capabilities: [
    { type: "accounts", canGet: true, canCreateAuthWit: false },
    { type: "contracts", contracts: [DRIPPER, USDC, ETH], canRegister: true, canGetMetadata: true },
    { type: "simulation", utilities: { scope: [
      { contract: USDC, function: "balance_of_private" },
      { contract: USDC, function: "balance_of_public" },
      { contract: ETH,  function: "balance_of_private" },
      { contract: ETH,  function: "balance_of_public" },
    ]}},
    { type: "transaction", scope: [
      { contract: DRIPPER, function: "drip_to_public" },
      { contract: DRIPPER, function: "drip_to_private" },
    ]},
  ],
}
```

`canCreateAuthWit: false` (Dripper has no auth guards). **No
wildcard scopes.** **No SponsoredFPC** in the contracts list — the
wallet materializes the fee path internally; we never need to
`registerContract(sponsoredFpc)` from the dApp.

**Granted accounts** come from `result.granted.find(c => c.type === "accounts").accounts`.
First account is `selectedAccount`. No `wallet.getAccounts()` follow-up.

**Contract registration** — strict order, after capability grant:

```ts
const instances = rebuildInstancesFromDeployments(deploymentsJson)
await wallet.registerContract(instances.dripper, DripperContractArtifact)
await wallet.registerContract(instances.usdc,    TokenContractArtifact)
await wallet.registerContract(instances.eth,     TokenContractArtifact)
// NO SponsoredFPC registration. Nulo handles it internally.
```

**Utility reads** — `wallet.executeUtility`, not `simulateUtility`.
Pattern from `packages/playground/src/sections/simulation.ts:99-102`:

```ts
const call = await contract.methods.balance_of_public(addr).request()
await wallet.executeUtility(call, {
  from: addr,
  scopes: [],
  authWitnesses: [],
  capsules: [],
  extraHashedArgs: [],
})
```

**Fee payment** — explicit embedded `feePayer`. The SDK's
`ExecutionPayload` type in `@aztec/aztec.js@4.2.0` doesn't include
`feePayer`; playground casts at the boundary
(`packages/playground/src/sections/transactions.ts:111`). Faucet does
the same — **one** typed cast in `useFaucetDrip.ts`, commented.
Nulo's dispatcher (`packages/wallet-bridge/src/dispatcher.ts:331`)
+ materializer (`packages/extension/src/wallet/services/dapp-interaction/materialize.ts:109`)
+ execute popup (`packages/extension/src/popup/windows/execute/index.vue:195`)
handle the embedded fee end-to-end (per e2e at
`packages/extension/tests/e2e/network/tx-sendTx-feePayer.test.ts:11`).

**"Works with every wallet-sdk wallet"** is an inference — only Nulo
is validated. README documents this.

**Wait boundary**: default SDK `sendTx` waits for the receipt. Don't
pass `wait: "NO_WAIT"`.

**Disconnect**: subscribe to `provider.onDisconnect()` → reset state.
Manual disconnect calls `provider.disconnect()` (best-effort). Browser
refresh forgets everything.

---

## 6. UX & copy

Tone: brutalist, confident, no marketing fluff.

### Layout

Single column, max-width 720px, centered. Five stacked bands: hero,
wallet panel, optional banner, two TokenCards side-by-side, footer.
No ActivityFeed (cut in v2).

### Copy (final)

**Hero**:
- H1: `DRIP TEST ASSETS`
- Sub: `Alpha-testnet only. Connect an Aztec wallet and mint fixed USDC or ETH into a public or private balance. Internal faucet. No real value.`

**Empty (no wallet detected)** — after 60s discovery timeout:
- Title: `No Aztec wallet detected on this browser.`
- Body: `This faucet works with any wallet that speaks the Aztec Wallet SDK. Nulo is the fastest way to start — it's an extension, takes 30 seconds.`
- CTA: `Install Nulo`

**Connect button states**:
- idle: `Connect wallet`
- discovering: `Searching for wallet…`
- verifying: `Verify in wallet` (paired with modal)
- **capability-approval**: `Approve permissions in wallet` *(new state — v2)*
- connected: hidden (replaced by AddressDisplay + `Disconnect`)
- error: contextual subtext + retry button

**Verification modal**:
- Title: `VERIFY THE GRID`
- Body: `Match this grid with the wallet window. If it differs, stop.`
- Secondary: `This check is for the secure channel. It is not decorative.`
- Buttons: `[ Cancel ]` `[ They match ]`

**Capability-approval inline state** (in WalletPanel, after verify-confirm):
- Heading: `Awaiting permissions`
- Body: `Approve this faucet's permissions in your wallet. We're asking to read your balances and submit drip transactions to the Dripper contract — nothing else.`
- Retry button (on rejection): `Approve permissions`
- Error subtext (on rejection): `You denied the permissions. Click to try again.`

**Account-not-deployed banner**:
> `Your wallet account isn't on-chain yet. Send any transaction from your wallet first to initialize it — then come back here.`

**Connected header**:
- `Connected · 0x12a8…3f9c · alpha-testnet`  [copy] [Disconnect]

**TokenCard chrome**:
- Header: `USDC` (mono symbol, 24pt) and `Fixed drip: 1,000 USDC`
- Tag bottom-left: `Test token · no real value`

**TokenCard balance row**:
```
balance · public   0.00
balance · private  0.00
```

**TokenCard buttons** (idle):
- `Drip 1,000 USDC to public`
- `Drip 1,000 USDC to private`
- `Drip 1 ETH to public`
- `Drip 1 ETH to private`

**TokenCard helper text**:
- idle: *(empty)*
- dripping: `Submitting in wallet…` (with hint `Private drips take 30–90 seconds.`)
- success: `Submitted to alpha-testnet.`
- error: `Last request failed.` + `Retry`

**Drip success toast**:
- `Dripped 1,000 USDC to public · view tx` (tx link)
- (and 3 sister variants)

**Error toasts** (normalized in `lib/errors.ts`):
- User rejected: `Rejected in wallet.`
- Capability rejected: `You denied the permissions. Click Approve to try again.`
- No wallet: `No wallet found. Install Nulo and reload.`
- Network down: `Alpha-testnet is not responding. Try again.`
- Tx reverted: `Drip transaction reverted — view tx.`
- No fee asset / sponsored FPC unavailable: `No sponsored fee route available. Wait or report.`
- Account uninitialized: `Selected account isn't deployed on alpha-testnet. Send any tx from your wallet first.`
- Contract not registered: `Couldn't register the faucet contracts with your wallet. Reconnect.`

**Footer**:
- `Contracts: USDC · ETH · Dripper`  (each → explorer)
- `Alpha-testnet only · Permissionless dripper · Fixed amounts · No rate limit`
- `Nulo Wallet · GitHub · Wonderland aztec-standards`

### Visual register
- BG `#0a0908`, surfaces `#141312`, text `#f5f0e6`, accent `#f8f1e7`.
- Headline Space Grotesk 700 (-0.02em tracking); body Inter 400/500;
  mono JetBrains Mono for addresses, hashes, amounts, the emoji grid.
- 1px outlined containers (`#4a463f`). No shadows, no gradients.
- Buttons: 2px outline for ghost; solid accent with dark text for primary.
- Animations: 150ms hover opacity + one CSS spinner. Nothing else.

---

## 7. Tests

Trimmed in v2 per CLAUDE.md philosophy: enough to prove correctness +
catch failures. ~55 cases total.

### Unit / composable
- **`useWalletConnection.test.ts` — 10**:
  idle→discovering→verifying transition;
  verifying→capability-approval transition (NEW v2);
  capability-approval→connected transition (NEW v2);
  capability-approval→error on user rejection (NEW v2);
  cancel from verifying;
  no-provider timeout;
  granted.accounts populates selectedAccount;
  disconnect; reconnect; provider.onDisconnect handler.
- **`useFaucetDrip.test.ts` — 10**:
  USDC public uses `1_000_000_000n`;
  USDC private same;
  ETH uses `1e18n`;
  passes `from = selectedAccount`;
  injects `feePayer = SPONSORED_FPC_ADDRESS`;
  receipt success → `last[symbol].kind === "txHash"`;
  rejection → `last[symbol].kind === "error"`;
  global in-flight gate blocks concurrent drip;
  drip then balance.refresh callback fires;
  state resets after completion.
- **`useTokenBalance.test.ts` — 10**:
  initial fetch (public + private) via `executeUtility`;
  polls every 15s;
  stops on dispose;
  refresh() invalidates timer + refetches;
  contract-not-found → safe zero;
  RPC error surfaces cleanly;
  returns BigInt unmodified;
  multiple instances independent;
  switching wallet resets;
  formatBigInt path coverage.
- **`useToast.test.ts` — 5**:
  add; dismiss; auto-dismiss; queue order; max queue size.

### Library
- **`deployments.test.ts` — 5**: parses JSON; addresses parse; dripper non-zero;
  `minter === dripper.address` for each token; decimals match `FAUCET_TOKENS`.
- **`capabilities.test.ts` — 5**: metadata fields; accounts shape; contracts
  scope exact (no SponsoredFPC); transaction scope exact; no extra capability types.
- **`errors.test.ts` — 5**: user reject (`code === 4001`); no-wallet; network;
  revert; account-uninitialized + sponsored-fee failure.
- **`format.test.ts` — 5**: zero; integer; trim trailing zeros; 1e9; 1n at decimals=18.

### Component
| Component | Cases |
|---|---|
| `AppButton` | 5 |
| `Spinner` | 5 |
| `Tag` | 5 |
| `Card` | 5 |
| `Toast` | 5 |
| `DisclaimerTag` | 5 |
| `EmojiGrid` | 10 (L3) |
| `AddressDisplay` | 10 (L3) |
| `BalanceRow` | 10 (L3) |
| `DripButton` | 10 (L3) |
| `VerificationModal` | 5 |
| `WalletPanel` | 8 (includes capability-approval state — NEW) |
| `AccountNotDeployedBanner` | 5 |
| `TokenCard` | 10 (composite) |
| `Footer` | 5 |

**Total**: ~55 unit/component cases + 5 smoke. Down from v1's 95.
Cut: ActivityFeed.test.ts (5 cases), redundant L4 wrapper tests.

### Smoke e2e (5 cases, single spec)
Mock provider supports all 7 RPCs the faucet uses (now includes
`registerContract`). See §4 Phase G.

### Network e2e — DEFERRED
Same justification as v1.

---

## 8. Deploy story

Single maintainer command:

```bash
cd packages/faucet
export DEPLOYER_SECRET="<32+ char string>"
export AZTEC_NODE_URL="https://<alpha-testnet-rpc>"   # optional override
bun run deploy:testnet
```

Optional:
```bash
bun run deploy:testnet:dry                            # compute + print addresses
bun run deploy:testnet -- --salt 1338                 # evict borked deploy
```

`scripts/deploy.ts` is self-contained (~150 lines vendored from
`aztec-standards/scripts/deploy.ts`). Reads `AZTEC_NODE_URL` (NOT
`VITE_AZTEC_NODE_URL` — that's frontend-only).

Frontend pickup via `src/contracts/deployments.ts`:

```ts
import deploymentsJson from "./deployments.json"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { DripperContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js"

const findToken = (symbol: string) => {
  const t = deploymentsJson.tokens.find(t => t.constructorArgs.symbol === symbol)
  if (!t) throw new Error(`deployments.json missing token: ${symbol}`)
  return t
}

export const DRIPPER = AztecAddress.fromString(deploymentsJson.dripper.address)
export const USDC = AztecAddress.fromString(findToken("USDC").address)
export const ETH  = AztecAddress.fromString(findToken("ETH").address)
```

Path `@defi-wonderland/aztec-standards/dist/src/artifacts/{Token,Dripper}.js`
is the proven playground path (cites:
`packages/playground/src/sections/transactions.ts:43`,
`…/simulation.ts:39`, `packages/extension/tests/e2e/fixtures/aztec.ts:144`).

**Frontend never reads contract addresses from env.** Build-time constant.

---

## 9. Build & hosting

**Build**: `bun run --cwd packages/faucet build` → `packages/faucet/dist/`.
~5–6 MB total (bb.js dominates). Acceptable for internal audience.

**Required headers** — bb.js needs cross-origin isolation. Ship via
`public/_headers` (Cloudflare Pages respects natively):

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://*.aztec.network wss://*.aztec.network; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
```

Same set via `vite.config.ts:server.headers` in dev.

**Hosting**: Cloudflare Pages.
- Project root: `packages/faucet`
- Install: `bun install --frozen-lockfile`
- Build: `bun run build`
- Output: `dist`

**Fonts**: self-hosted (`SpaceGrotesk-latin`, `SpaceGrotesk-latin-ext`,
`InterVariable`, `JetBrainsMono-latin`). No CDN, no third-party.
COEP stays clean.

Custom domain deferred — see §13.

---

## 10. CI gates

**Honest accounting** (audit-driven): `audit:vue` is extension-only by
design (its `test` and `build` steps run extension scripts). The
faucet needs explicit hookups:

**Root `package.json` additions** (new):
```json
"dev:faucet":   "bun run --cwd packages/faucet dev",
"build:faucet": "bun run --cwd packages/faucet build",
"test:faucet":  "bun run --cwd packages/faucet test",
"audit:faucet": "bun run typecheck:all && bun run test:faucet && bun run lint && bun run build:faucet"
```

`audit:vue` stays as-is. `audit:faucet` is the pre-PR gate for faucet work.

**Pre-existing auto-coverage**:
- `bun run lint` (root biome covers `packages/**`)
- `bun run typecheck:all` (filter `'@nulo/*'` — picks faucet up automatically)
- `bun run test:all` (same filter)

**GitHub Actions** — new work, not auto:
- **`.github/workflows/_build-faucet.yml`** — mirrors `_build-extension.yml`
  shape. Runs `bun install` + `bun run --cwd packages/faucet typecheck` +
  `bun run --cwd packages/faucet test` + `bun run --cwd packages/faucet build`.
- **`.github/workflows/pr-quick.yml`** — add `faucet:` to the
  paths-filter under `changes.outputs`; gate the new build job on
  `packages/faucet/**`.
- **`Quality / Status`** aggregator gets a `_build-faucet` dependency
  when the path filter fires.

**Smoke e2e for faucet** — advisory at first:
- New `Faucet smoke / Status` workflow runs `bun run --cwd packages/faucet test:e2e`
  on PRs touching `packages/faucet/**`. Required after one green week.

**Network e2e**: not in v1.

---

## 11. Risks & open questions

1. **`feePayer` typing** (audit-flagged): `ExecutionPayload` in
   `@aztec/aztec.js@4.2.0` doesn't include `feePayer`. Faucet uses one
   `as` cast at the boundary (`useFaucetDrip.ts`), matching the
   playground pattern. Risk: if the SDK adds proper typing later, the
   cast becomes dead code; if it changes the wire-shape, the cast hides
   the break. **Mitigation**: a single commented boundary, audit-grep-able.

2. **`deployments.json` is deploy metadata, not a registerable
   ContractInstance**. `lib/contracts.ts` MUST reconstruct via
   `getContractInstanceFromInstantiationParams` (per Phase B). Tested
   in `deployments.test.ts`.

3. **alpha-testnet SponsoredFPC reliability** (audit-flagged as most
   likely v1 break): the network's sponsored fee path is the single
   external dependency. The extension's own e2e accepts both success
   and failure (`packages/extension/tests/e2e/network/tx-sendTx-feePayer.test.ts:65`).
   The faucet surfaces a clear error category (`No sponsored fee route…`)
   + a Retry button. We can't fix from our side.

4. **"Works with every wallet-sdk wallet"** is an inference — only
   Nulo is validated. README acknowledges this explicitly.

5. **Account-not-deployed gotcha**. Pre-flight `node.getContract(account)`
   + banner. Friendly fix copy.

6. **Private drip is slow** (30–90s). UI shows `Submitting in wallet…`
   + the hint `Private drips take 30–90 seconds.`

7. **bb.js bundle size** (~5–6 MB). Accepted for internal audience.

8. **Salt 1337 + Wonderland Dripper collision** on alpha-testnet → we
   share their Dripper if they've deployed there. Token salts (4242, 4243)
   avoid collision with their WETH/DAI/USDC.

9. **No persistent wallet state on refresh**. Defer auto-reconnect.

10. **Test-token name confusion** ("USDC" / "ETH"). Mitigated by
    `Test token · no real value` chip. Re-evaluate after Foundation feedback.

---

## 12. Non-goals (explicit)

- Multiple networks · network switcher · sandbox toggle
- Multiple drip amounts · user-configurable amounts · chips
- Rate limiting (none — trust the audience)
- Backend · server · database · analytics
- Custom wallet UI (use SDK as-is)
- i18n (English only)
- Mobile-first layout (responsive-default suffices)
- ~~Activity history beyond session~~ — and NO ActivityFeed (v2 cut)
- Storybook for faucet components
- Visual regression testing
- Lighthouse a11y CI gate (manual check only)
- Custom dripper contract (use Wonderland's)
- Refactoring the extension · extracting `@nulo/ui`
- React port
- More than 2 tokens
- Account switcher · wallet picker UI (auto-pick first)
- Auto-reconnect across refresh
- Swap UI · transfer-between-users · balance history page
- Wallet creation/recovery/onboarding inside the faucet
- CHANGELOG entries · marketing copy
- Production observability (no Sentry)
- Keyboard shortcuts beyond standard tab order
- Dark/light theme toggle (one theme)

---

## 13. The one question I'd ask the user (Codex's framing wins)

**Which exact alpha-testnet environment are we shipping against?**

Specifically, the four values that need to land in env before the
faucet leaves dev:
- `AZTEC_NODE_URL` (deploy + frontend `VITE_AZTEC_NODE_URL`) — the canonical RPC URL
- `VITE_EXPLORER_BASE_URL` — the explorer the success-toast tx links point at
- `VITE_CHAIN_ID` — chainId so the wallet-sdk discovery matcher isn't a wildcard in prod
- `VITE_CHAIN_VERSION` — the matching protocol version

And one bonus, only because it directly affects the v1 fragility:
*is SponsoredFPC known-good on the target environment right now?* If
not, every drip will fail and we should know before we hand the URL out.

These all default sensibly (wildcard, mainline alpha-testnet RPC,
`pages.dev` URL) so development is unblocked. They need answers before
public hand-off.
