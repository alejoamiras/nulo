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
bun run --cwd apps/faucet dev    # http://localhost:5176
```

Connect with the Nulo extension (or any wallet that speaks
`@aztec/wallet-sdk`). The faucet uses **discovery** to find wallets: every
wallet that answers is listed in a picker and you choose explicitly (a
wallet's name/icon/id are self-claimed, so the picker is a selection, not a
trust decision — the emoji verification that follows is what proves the
channel). Your choice is remembered per browser: the next
Connect briefly re-scans and tries your previous selection; "use a
different wallet" (or the `switch` action on the connected chip) forgets
it. Collision detection is best-effort: if multiple wallets claim the
remembered identity during the scan window, auto-reconnect turns itself
off and the picker shows all claimants.

**Multiple accounts**: if your wallet shares more than one account, the
faucet asks which one to use ("Choose main account") and remembers the
answer per wallet. The connected chip shows the active account and opens
a menu to switch anytime — switching drives all tabs (Faucet, Bridge,
Fuel) and is blocked while an operation is running, so nothing ever
executes under an account other than the one it started with.

## Deploy the contracts (one-time)

The first run requires the maintainer to deploy the `Dripper` + USDC +
ETH contracts on alpha-testnet. The resulting addresses are written to
`src/contracts/deployments.json` (and committed).

```bash
cd apps/faucet
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
bun run --cwd apps/faucet build      # → apps/faucet/dist/
```

Static output (~6 MB JS, ~7 MB wasm chunks, ~5.5 MB gzipped total).

Hosting: **Cloudflare Pages** is the recommended fit.

- Project root: `apps/faucet`
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
| `VITE_NULO_INSTALL_URL` | Frontend (no-wallet CTA) | Chrome Web Store link, defaults to a generic one |

The deploy env (`AZTEC_NODE_URL`) is deliberately separate from the
frontend env (`VITE_AZTEC_NODE_URL`). The build never embeds `DEPLOYER_SECRET`.

**Chain identity is NOT an env var.** The L1 chainId + rollup version that
wallet-sdk discovery matches on are hardcoded in `src/lib/chain-constants.ts`
(the faucet is testnet-only) — there is deliberately no `VITE_CHAIN_*` override.
A stale Cloudflare `VITE_CHAIN_VERSION` once shadowed the value and broke the
wallet handshake in prod ("No network configured for chainId 4138294185"), so
the env path was removed. The production build also emits `dist/build.json` +
a `<meta name="nulo-build">` (a matching `buildId` + the testnet `chainId`) that
the release pipeline's post-deploy `verify-live` check reads.

## Tests

```bash
bun run --cwd apps/faucet typecheck   # vue-tsc
bun run --cwd apps/faucet test        # vitest unit + component
bun run --cwd apps/faucet test:e2e    # smoke e2e (mock wallet, jsdom)
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
                │  apps/faucet (this)  │
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
apps/faucet/
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

## Fuel tab

A third tab — **Fuel** — bridges your L1 fee asset ($AZTEC) directly into Aztec **Fee Juice** (gas),
public or private, with **no swap**. It reuses the bridge's journal/engine (an additive `assetKind`
discriminant) and the canonical `FeeJuicePortal`; the L2 claim is sponsored (public) or a carrier-less
Wonderland-FPC tx (private). Composables: `useFuel` (deposit + claim) + `useL1FeeAsset` (L1 balance).
Local-gates-only today — a full bridge needs the live L2 network (deferred live sign-off). See
[`implementations-plan/fuel-direct-bridge/`](../../implementations-plan/fuel-direct-bridge/plan.md).

## What this is NOT

Non-goals (from plan-v2 §12):

- No backend, no analytics, no rate limit
- No network switcher (alpha-testnet only)
- No custom drip amounts (fixed 1,000 USDC / 1 ETH)
- No `@nulo/ui` extraction (design tokens vendored)
- No extension refactor — the faucet does not touch `apps/extension/**`
- No i18n
- No swap UI or transfer-between-users — that's the AMM playground
