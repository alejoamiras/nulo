# apps/tools/tests/browser

The tools app driven in a real Chromium against a real local network, with a wallet that is NOT the
Nulo extension: an `@aztec/wallets` embedded wallet behind `@aztec/wallet-sdk`'s iframe handler
(`test-wallet/`), and an injected EIP-1193 L1 wallet answered from Node (`fixtures/l1-wallet.ts`).
This is how the dApp proves it works with *a* wallet-sdk wallet; the extension's suites never enter.

```bash
bun run e2e:tools                          # everything, one sandbox
bun run e2e:tools -- --shard=1/2           # a shard (each shard boots its own sandbox)
bun run e2e:tools -- specs/spike.spec.ts   # one file
```

`scripts/e2e/agent.sh` is the whole run: reserve two ports → `sandbox:up` (anvil + `aztec start
--local-network` + a bridge generation, from `packages/bridge-core`) → `build:local` of tools with
the run's node URL and wallet URLs baked in → `build:test-wallet` → assert both bundles name the
node → Playwright with two `webServer`s (`vite preview` of each build, the tools one serving the
generated CSP) → reap. State lives under `.e2e-state/<run>/` (gitignored): ports, the sandbox
artifacts, both `dist`s, logs, traces.

## Layout

| Path | Role |
|---|---|
| `playwright.config.ts` | chromium, `workers: 1`, the two servers, traces on failure |
| `env.ts` | the run's coordinates from the env the runner sets |
| `global-setup.ts` | the handle names chain 31337, the build is `local`, the sandbox's drip record equals the committed one |
| `fixtures/test.ts` | the `test` every spec uses: sandbox access, an actor pool per file, a fresh actor per test, the L1 shim, the egress fence, the parked wallet panel |
| `fixtures/sandbox.ts` | the Node side: `openSandbox` on the handle, `newActor()` (sponsor-deployed, own flow context) |
| `fixtures/l1-wallet.ts` | `window.ethereum` → `exposeFunction` → viem over anvil; `setChainId`, `setAccount`, `rejectNext` |
| `fixtures/egress.ts` | aborts every non-loopback request, answers the token list from `../e2e/fixtures/token-list.json`; the record must be empty at teardown |
| `fixtures/wallet-panel.ts` | parks the SDK's floating session panel in a corner so it covers no testid |
| `pages/*.ts` | testid-only page helpers: connect, drip, the Send wizard's deposit and exit directions, the journal (records + the fees their transactions billed), `fees.ts` (the ceiling the wallet will price — see below) |
| `specs/*.spec.ts` | the cells, one file per family (`deposit-token`, `fee-states`, `deposit-token-gas`, `deposit-gas-only`, `tokens`, `recovery`, `l1-wallet`, `exits`, `drip`, `activity`; `spike` keeps the discovery / grant / isolation checks); `test.use({ cells: N, l1Index: i })` at the top of each file |
| `test-wallet/` | the wallet page: `profile.ts` (`plain` \| `selfpay` \| `full`), `wallet.ts` (the embedded wallet + grant + Nulo RPCs + self-pay routing), `main.ts` (the handler, the control hook), its own `vite.config.mts` |

## How a spec gets its accounts

Actors are created in Node before the browser opens — `cells + 2` per file, capped by tools' grant
limit of 16 — and reach the wallet through a context-level init script that sets
`window.__nuloTestWalletSeeds` on the wallet origin only. The wallet imports every seed before it
answers `requestCapabilities`, so the switcher lists the whole pool from the first connect; a test
takes the next unused actor (`actor` fixture), a retry takes a spare, and no actor is ever reused.
Fee fixtures (public Fee Juice, private credit) are funded on-chain from the actor's flow context
(`actor.s`) just before the UI runs, with the same helpers the integration suite uses.

## Profiles

- `plain` — a standard wallet-sdk wallet; no Nulo RPCs (the transport answers `Unknown wallet method`).
- `selfpay` — loads `@nulo/wallet-sdk-schema-patch`, advertises `dapp-self-pay`, routes a self-payer
  payload with no `claim_and_end_setup` call to the account's held public Fee Juice; `registerToken`
  and friends answer `Unsupported wallet method`.
- `full` — `selfpay` plus a working `registerToken`/`isTokenRegistered`.

The wallet accepts only tools' app id and the sandbox's chain, is framed only by the tools origin
(CSP `frame-ancestors` + the handler's `allowedOrigins`), and is listed by no shipped build — the
`build:testnet`/`build:mainnet` bundles contain neither its URL nor the node's.

## Two things the wallet decides, and the suite reads back

- **The FPC ceiling is the wallet's.** A claim, a registration or a private exit paid through the
  PrivateFPC sets aside `gasLimits · maxFeesPerGas` of ITS transaction, and the wallet decides the
  max fee (the wallet-sdk 5.2.0 option schema names the cap `maxFeePerGas`; wallets read
  `maxFeesPerGas`; a stock wallet prices it itself, 1.5× the prediction). The app therefore reads the
  figure from the wallet (`src/lib/wallet-fee-budget.ts`: a no-op simulated under the app's limits,
  the applied settings read back), and so does the suite: `pages/fees.ts` runs the same probe
  through the harness's scripting wallet — the same `EmbeddedWallet` class on the same node — so a
  cell asserts the exact deduction the FPC made, never a multiple of tools' prediction.
- **Blocks come on demand.** The local network builds a block only when a transaction arrives; a
  claim driven from the UI waits on an L1→L2 message no block would carry. The `test` fixture keeps
  a heartbeat for the worker's whole life (the relayer revokes a random public authwit every 3 s),
  the same nudge the harness uses. It is the one place this suite differs from a real network.

## CI

`.github/workflows/pr-tools-e2e.yml` → `_tools-e2e.yml`, 6 shards (`--shard=i/6`), one sandbox
each, `tools-e2e-status` as the aggregator; runs on the `tools-e2e` paths-filter or the `e2e:tools`
label. Traces (`retain-on-failure`) and the sandbox's logs are uploaded when a shard fails.

## Rules

- Selectors are `data-testid` only (`src/lib/testids.ts`), narrowed by `data-*` attributes on the
  same element where an id repeats (`data-wallet-id`, `data-address`, `data-key`, `data-symbol`).
- Every cell states its expected payer and its balance / note postconditions, read from the chain
  through the harness — the UI's text is never the authority.
- Nothing here boots a network or picks a port by hand; the runner owns both. Two runs on one
  machine are two sandboxes on two port packs.
