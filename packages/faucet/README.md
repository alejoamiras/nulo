# @nulo/faucet

A faucet web app for the Aztec Network. Lets the Aztec Foundation team
(or anyone with a wallet) self-mint test USDC + test ETH on
**alpha-testnet** through Wonderland's permissionless `Dripper` contract.

One screen. Two token cards. Four drip buttons. No backend, no
rate limit.

For the full plan + audit transcripts see [`implementations-plan/faucet/`](../../implementations-plan/faucet/).

## Quick start

```bash
# from repo root
bun install
bun run --cwd packages/faucet dev    # http://localhost:5176
```

Connect with the Nulo extension (or any wallet that speaks
`@aztec/wallet-sdk`). The faucet uses **discovery** to find a wallet, so
you don't need to do anything other than have an extension installed.

## Deploy the contracts (one-time)

The first run requires the maintainer to deploy the `Dripper` + USDC +
ETH contracts on alpha-testnet. The resulting addresses are written to
`src/contracts/deployments.json` (and committed).

```bash
cd packages/faucet
export DEPLOYER_SECRET="<at-least-32-character-string>"
export AZTEC_NODE_URL="https://rpc.testnet.aztec-labs.com"   # optional
bun run deploy:testnet
```

The deploy script:

- Derives a Schnorr deployer account from `poseidon2(DEPLOYER_SECRET)`.
- Pays deploy fees via the alpha-testnet **Sponsored FPC** (so the
  deployer needs no balance).
- Computes deterministic addresses from salts (Dripper: `1337`,
  USDC: `4242`, ETH: `4243`).
- Skips any contract already on-chain at the computed address —
  idempotent.

Dry-run to compute addresses without sending any tx:

```bash
bun run deploy:testnet:dry
```

Commit the resulting `src/contracts/deployments.json` and push.

## Production build + hosting

```bash
bun run --cwd packages/faucet build      # → packages/faucet/dist/
```

Static output (~6 MB JS, ~7 MB wasm chunks, ~5.5 MB gzipped total).

Hosting: **Cloudflare Pages** is the recommended fit.

- Project root: `packages/faucet`
- Install: `bun install --frozen-lockfile`
- Build: `bun run build`
- Output: `dist`

`bb.js` needs cross-origin isolation. The faucet ships a
`public/_headers` file with `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp` and a tight CSP. Cloudflare
Pages respects `_headers` natively.

## Environment

| Variable | Where it's read | Purpose |
|---|---|---|
| `AZTEC_NODE_URL` | `scripts/deploy.ts` only | Override alpha-testnet RPC for deploy |
| `DEPLOYER_SECRET` | `scripts/deploy.ts` only | Seed for the deployer Schnorr account |
| `VITE_AZTEC_NODE_URL` | Frontend (account-deployed probe) | Optional node URL the dApp uses |
| `VITE_EXPLORER_BASE_URL` | Frontend | Base for tx + address explorer links |
| `VITE_CHAIN_ID` | Frontend wallet-sdk discovery | Pin chain in wallet matcher |
| `VITE_CHAIN_VERSION` | Frontend wallet-sdk discovery | Pin protocol version |
| `VITE_NULO_INSTALL_URL` | Frontend (no-wallet CTA) | Chrome Web Store link, defaults to a generic one |

The deploy env (`AZTEC_NODE_URL`) is deliberately separate from the
frontend env (`VITE_AZTEC_NODE_URL`). The build never embeds `DEPLOYER_SECRET`.

## Tests

```bash
bun run --cwd packages/faucet typecheck   # vue-tsc
bun run --cwd packages/faucet test        # vitest unit + component
bun run --cwd packages/faucet test:e2e    # smoke e2e (mock wallet, jsdom)
```

The smoke e2e uses a mock wallet provider in jsdom — no real wallet, no
Aztec network. Manual end-to-end against alpha-testnet is the
maintainer's responsibility before merging deploy changes.

## Architecture in one diagram

```
                  ┌──────────────────────────┐
                  │  Aztec alpha-testnet      │
                  │   Dripper (permissionless)│
                  │   USDC (decimals=6)       │
                  │   ETH (decimals=18)       │
                  └──────────┬────────────────┘
                             │ sponsored FPC fee
                             │
                       ┌─────▼──────┐
                       │  Wallet    │  @aztec/wallet-sdk
                       │  (Nulo)    │  encrypted MessagePort
                       └─────┬──────┘
                             │ window.postMessage
                ┌────────────▼─────────────┐
                │  packages/faucet (this)  │
                │                          │
                │  Hero · WalletPanel ·    │
                │  TokenCard × 2 ·         │
                │  Toast · Footer          │
                └──────────────────────────┘
```

Three composables (no Pinia):

- `useWalletConnection` — discovery → emoji verify → capability approval → `setting-up` (register contracts) → connected
- `useFaucetDrip` — single global in-flight drip; `interaction.request({ fee: new SponsoredFeePaymentMethod(fpc.address) })` embeds the sponsor call so the public-setup-phase passes the allow-list
- `useTokenBalance` — polls every 15s. `balance_of_public` (public view) via `interaction.simulate({from})` → `SimulationResult.result`; `balance_of_private` (utility) via `wallet.executeUtility(call, opts)` → `UtilityExecutionResult.result[0]`

## File layout

```
packages/faucet/
├── README.md                 ← you are here
├── public/_headers           ← COOP/COEP/CSP for cloudflare pages
├── scripts/deploy.ts         ← one-time deployer; idempotent
├── src/
│   ├── App.vue               ← single page
│   ├── components/
│   │   ├── ui/               ← L1/L2 primitives (≥5 cases each)
│   │   ├── composite/        ← L3 composites (≥10 cases each)
│   │   └── *.vue             ← orchestration components (WalletPanel, TokenCard, …)
│   ├── composables/          ← module-singleton state + side effects
│   ├── contracts/
│   │   ├── deployments.json  ← committed addresses (post-deploy)
│   │   └── deployments.ts    ← parses + rebuilds ContractInstance
│   ├── design/               ← vendored CSS vars from extension
│   └── lib/                  ← pure helpers
└── tests/e2e/                ← smoke (mock wallet in jsdom)
```

See [`implementations-plan/faucet/plan-v2.md`](../../implementations-plan/faucet/plan-v2.md)
for the full file-by-file walkthrough and the rationale for every
non-obvious decision.

## What this is NOT

Non-goals (from plan-v2 §12):

- No backend, no analytics, no rate limit
- No network switcher (alpha-testnet only)
- No custom drip amounts (fixed 1,000 USDC / 1 ETH)
- No `@nulo/ui` extraction (design tokens vendored)
- No extension refactor — the faucet does not touch `packages/extension/**`
- No i18n
- No swap UI or transfer-between-users — that's the AMM playground
