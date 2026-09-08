---
plan: tools-self-testing
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off            # owner directive 2026-09-03 — the codex fix loop is the review
budget: recon 2 mappers + prior 4-agent research sweep; codex at high; no wide fan-out
base: origin/dev @ 036709d8
status: v2 — dual audit folded in; awaiting the fresh-context codex pass
---

# tools-self-testing

Give `apps/tools` and the any-ERC-20 bridge their own proof of correctness, without the Nulo extension anywhere in the loop, and make CI say which product it is testing.

Three arcs, stacked:

1. **CI naming** — every e2e workflow, aggregator check, label, and doc names the app it tests; branch protection is repointed by a one-command runbook.
2. **Bridge integration suite** — the sandbox smoke (`deploy:sandbox --smoke`) becomes a vitest suite over a real anvil + `aztec start --local-network`, with a Uniswap-V4 Quoter facade so the gas leg is reachable, vendored canonical bytecode so CI never touches a public RPC, a Dripper fixture, and a `bridge-contracts-status` job that runs it.
3. **Tools browser e2e** — Playwright drives the real tools UI against the same sandbox, with an injected EIP-1193 L1 wallet and an embedded wallet-sdk-compatible L2 wallet, across an enumerated flow matrix, sharded, behind a `tools-e2e-status` check.

Locked in Phase 0 (owner, 2026-09-08): gas leg via **Mock + Quoter facade**; **rename the aggregators + coordinated branch-protection update**; new gates **advisory first, required after a clean week**; **full matrix in both layers, browser sharded**.

## Goals

- A contract or bridge-core change cannot merge without the sandbox round trips passing (once promoted to required).
- A tools change cannot merge without the real UI completing every matrix cell against a real local network (once promoted).
- A third-party wallet-sdk wallet drives every core flow; the Nulo-custom RPCs only add convenience.
- Reading the Checks tab tells you which product a red check belongs to.

## Non-goals

- Real Uniswap V4 on the sandbox (the Sepolia-fork forge test keeps that proof).
- Real proving in the browser (the embedded wallet runs proverless; the local network accepts that).
- Driving tools with the Nulo extension (manual pre-release smoke only, per `CLAUDE.md` § Two products).
- Live-testnet canaries for a manifest bump (the `aztec-update` skill's canaries).
- Firefox/WebKit in the tools suite (Chromium only).

## Architecture & Implementation

### Proposed architecture

```
packages/bridge-core/
  package.json                exports += "./sandbox": "./scripts/sandbox/index.ts"  (Node-only harness surface)
  scripts/sandbox/
    index.ts                  NEW  public harness surface (boot/attach, fixtures, accounts, fee-state shapers, flows, handle codec)
    local-network.ts          (exists) boot/attach/teardown, port registry
    fixtures.ts               NEW  deployL1Fixtures + deployGeneration + tokens + MockSwapTarget + MockV4Quoter + Dripper — extracted from deploy-sandbox.ts
    manifest.ts               NEW  buildManifest (real `swap` block, explicit `rollupVersion`, permissionless-mint token sources) + writeArtifacts(dir)
    accounts.ts               NEW  relayer/genesis + Nulo-shape Schnorr actors; shapeFeeState(); fresh-token allocator for registration cases
    flows.ts                  NEW  the smoke flows + the missing cells, as pure functions over a reconstructed `SandboxClients`; no module-level state
    handle.ts                 NEW  `SandboxHandle` (strings only) + zod codec + `openSandbox(handle)` → clients
    bytecode/{permit2,multicall3}.json  NEW vendored canonical runtime code + independently sourced keccak pins
    cli.ts                    NEW  `up|down|smoke` (deploy-sandbox.ts becomes a 20-line alias)
  test/integration/*.integration.test.ts   NEW  one file per family; sequential; one boot per run; each file self-sufficient
  vitest.integration.config.ts  NEW  globalSetup boots + deploys once, `provide()`s the JSON handle; unit config excludes `test/integration/**`
  tsconfig.scripts.json         include += "test/**/*.ts"

contracts/bridge/evm/src/mocks/MockV4Quoter.sol   NEW  `is IV4Quoter`; reads MockSwapTarget's rate per call; allow-listed pool keys
packages/bridge-core/src/quoter-abi.test.ts       NEW  pins QUOTER_ABI against out/IV4Quoter.sol/IV4Quoter.json (router-abi pattern; runs in the CI "ABI pins" step)

apps/tools/
  src/lib/network-targets.ts     `ToolsTargetKey += "local"`; `localTarget(cfg)` FACTORY (no fs, no const); TARGETS built via the factory from an injected define
  src/lib/network.ts             31337 → viem chain; nodeUrl from the target (no DEV gate for local)
  src/composables/createAztecWalletSession.ts   `webWallets: { urls }` when `target.key === "local"` (a `define`, DCE'd in testnet/mainnet)
  src/contracts/deployments.ts   target-aware drip record (local record injected by define)
  vite.config.ts                 local target: read `$NULO_SANDBOX_ARTIFACTS/{handle,manifest,deployments}.json` at config eval, `define` the local config, manifest path + outDir per run
  vite.local.config.mts          NEW
  scripts/verify-build-target.ts  uses the same factory
  tests/browser/                 NEW Playwright suite (own tsconfig; excluded from vue-tsc and from vitest)
    playwright.config.ts         chromium, workers: 1, webServer ×2 (tools preview on 127.0.0.1, test wallet), traces on first retry
    global-setup.ts              reads handle.json (written by the CLI); no booting here
    fixtures/{l1-wallet,sandbox,wallet-panel,egress}.ts
    test-wallet/                 tiny vite app: `start()` first, lazy EmbeddedWallet (ephemeral), profiles, COEP+CORP headers, allowedOrigins
    pages/*.ts                   page objects, testid-only
    specs/*.spec.ts              the matrix (table below)
  scripts/e2e/agent.sh           NEW: ports → `bridge-core cli up` → build local (per-run outDir) → assert bundle → playwright → reap

.github/
  workflows/pr-extension-smoke-e2e.yml, pr-extension-network-e2e.yml, _extension-smoke-e2e.yml, _extension-network-e2e.yml, extension-network-e2e-soak.yml   RENAMED
  workflows/bridge-contracts.yml (was contracts.yml) + _bridge-contracts.yml (+ integration, txe jobs)
  workflows/pr-tools-e2e.yml + _tools-e2e.yml   NEW
  actions/setup-playwright/      NEW
scripts/ci-cd/required-checks.sh  NEW  print / --apply / --add, with --expect precondition
```

Reuse per `recon.md`: `startLocalNetwork`, `waitForL1ToL2Message`, `consumeWithdrawal`, `createL2Wallet`, `deriveNuloAccountKeys`, `MockSwapTarget`, `IV4Quoter.sol`, the extension's `agent.sh`/`resolve-ports`/`reap` pattern, `setup-aztec`, `setup-bun`, `behavior-gating.test.ts`, the `_bridge-contracts.yml` forge/remappings steps.

### Key interfaces

```ts
// @nulo/bridge-core/sandbox — handle.ts (JSON only; Fr/AztecAddress are hex strings)
export type SandboxHandle = {
  anvilUrl: string; nodeUrl: string; l1ChainId: 31337; rollupVersion: number; walletChainId: number
  manifestPath: string; deploymentsPath: string        // manifest.json (ManifestV2 with a real swap block), deployments.json (drip record)
  l1: { deployerKey: Hex; actorKeys: Hex[] }           // anvil mnemonic index 0 = deployer/relayer; 1.. = actors
  l2: { relayer: string; actorSecrets: string[] }      // genesis relayer address; fresh Schnorr secrets (Nulo shape)
  swapTarget: Address; quoter: Address                 // MockSwapTarget, MockV4Quoter
}
export const SandboxHandleSchema: z.ZodType<SandboxHandle>
export function openSandbox(h: SandboxHandle): Promise<SandboxClients>   // viem clients + node client + EmbeddedWallet (Node)
export type FeeState = "sponsored" | "public-fj" | "private-credit-1" | "private-credit-3" | "none" | "public-only" | "private-only"
export function shapeFeeState(c: SandboxClients, account: AztecAddress, state: FeeState): Promise<void>
export function allocateToken(c: SandboxClients, kind: "portal-only" | "unregistered" | "routeless" | "fee-asset"): Promise<TokenFixture>  // fresh ERC-20 per registration case
```

```ts
// apps/tools/src/lib/network-targets.ts
export type ToolsTargetKey = "testnet" | "mainnet" | "local"
export type LocalTargetConfig = { nodeUrl: string; rollupVersion: number; walletChainId: number; webWalletUrls: string[]; host: string; manifestFile: string }
export function localTarget(cfg: LocalTargetConfig): ToolsTarget   // pure; fed by `__NULO_LOCAL_TARGET__` (vite define) at runtime and by vite.config.ts at build time
```

```ts
// apps/tools/tests/browser/test-wallet/profile.ts
export type TestWalletProfile = "plain" | "selfpay"
// plain:   standard wallet-sdk surface; requestCapabilities returns { version: "1.0", granted, wallet: { name, ... } }; NO Nulo RPCs
// selfpay: + imports @nulo/wallet-sdk-schema-patch/register (so the iframe handler's WalletSchema knows getWalletFeatures),
//          getWalletFeatures() → ["dapp-self-pay"], and routes a payload whose feePayer === sender with NO fee call as
//          PREEXISTING_FEE_JUICE (BaseWallet maps it to FEE_JUICE_WITH_CLAIM, base_wallet.js:184-193) — the semantics
//          selfPaidFeeJuicePayment documents (packages/bridge-core/src/fee-juice.ts:122-135)
```

```ts
// apps/tools/tests/browser/fixtures/l1-wallet.ts
export async function installL1Wallet(page: Page, o: { rpcUrl: string; privateKey: Hex; chainId: number }): Promise<L1WalletControl>
// exposeFunction("__nuloL1Request") answers eth_requestAccounts, eth_accounts, eth_chainId, eth_sendTransaction,
// eth_signTypedData_v4, personal_sign, wallet_switchEthereumChain; proxies everything else to rpcUrl.
// addInitScript installs window.ethereum (request/on/removeListener; emits accountsChanged/chainChanged) + EIP-6963 announce.
// L1WalletControl: { setChainId(id), setAccount(key), rejectNext(kind) } for wrong-chain / account-change / rejection cells.
```

### Data & control flow (browser run)

1. `apps/tools/scripts/e2e/agent.sh`: resolve a port pack (anvil, aztec, aztec-admin, aztec-p2p, tools, test-wallet) → `bun run --cwd packages/bridge-core sandbox:up --artifacts "$RUN_DIR"` boots anvil + local network, builds `forge out/` if absent, deploys fixtures, writes `handle.json` + `manifest.json` + `deployments.json` (all strings) → `NULO_SANDBOX_ARTIFACTS=$RUN_DIR bun run --cwd apps/tools build:local --outDir "$RUN_DIR/dist"` (vite.config.ts reads the three files at config eval and `define`s `__NULO_LOCAL_TARGET__`; manifest path and outDir are per run, never `public/`) → asserts the bundle contains the node URL and the test-wallet URL → `playwright test [--shard=i/n]` → reap owned pgids.
2. Playwright `webServer` serves `$RUN_DIR/dist` via `vite preview` on `127.0.0.1:<tools>` (COOP/COEP) and the test-wallet dev build on `127.0.0.1:<tw>` (COEP `require-corp` + `Cross-Origin-Resource-Policy: cross-origin` + CSP `frame-ancestors http://127.0.0.1:<tools>`). `global-setup.ts` only parses `handle.json`.
3. Per spec file (worker-scoped page, `test.describe.configure({ mode: "serial" })`): `installL1Wallet`; egress fixture routes `tokens.uniswap.org` to `fixtures/token-list.json` and aborts any non-loopback request (asserted at teardown); `page.goto(tools)`; connect L1 → connect Aztec: picker lists the test wallet (`webWallets` discovery) → emoji modal → confirm; capability grant → approve; the wallet-panel fixture shrinks the SDK's floating iframe panel (420×500, `z-index` 999999, `iframe_provider.js:146-162`) to a corner so it never covers a testid; then the flow by testids; assertions read journal/receipt testids and, where the UI cannot show it, the chain via the harness (`openSandbox(handle)` in Node).
4. Fee state and token fixtures are shaped BEFORE the flow through the harness (`shapeFeeState`, `allocateToken`), never through the UI.
5. Isolation: fresh L2 actor + fresh L1 actor key per spec file; registration cells allocate a fresh token; pause/rate mutations restore in `finally`; deployer/relayer operations are serialized behind one harness mutex; the chain is never snapshotted (an `evm_revert` is a reorg to the archiver); `workers: 1` per sandbox, parallelism only via shards (each shard boots its own sandbox).

### File-level change map

Arc 1 (CI naming): rename 5 workflow files (+ every `uses:` in `release.yml`, `nightly.yml`), rename aggregator job names, rename workflow `name:`s, labels `e2e:extension-smoke` / `e2e:extension-network` (old labels accepted for one release, then dropped), `_build-tools.yml` step "Tools jsdom smoke", `contracts.yml` → `bridge-contracts.yml` with `bridge-contracts-status` (bump to `checkout@v7` with `fetch-depth: 0` / `paths-filter@v4`; `changes` job keeps `pull-requests: read`), `scripts/ci-cd/behavior-gating.test.ts` (`FILTER_WORKFLOWS` + a new aggregator-name assertion), `scripts/ci-cd/verify-cert-run.sh` (`REQUIRED_WORKFLOWS`), docs: `README.md`, `CI.md`, `CLAUDE.md` (Branching + Quality gates), `ARCHITECTURE.md` §14, `.github/README.md`, `apps/extension/README.md`, `apps/extension/tests/e2e/README.md`, `apps/extension/tests/COMPOSITION-TESTS.md`, `apps/tools/tests/e2e/README.md`, `.claude/skills/e2e-testing/SKILL.md`; new `scripts/ci-cd/required-checks.sh`.

Arc 2 (bridge integration): `contracts/bridge/evm/src/mocks/MockV4Quoter.sol` + `test/MockV4Quoter.t.sol`; `packages/bridge-core/scripts/sandbox/{index,fixtures,manifest,accounts,flows,handle,cli}.ts`, `bytecode/*.json`, `scripts/refresh-canonical-bytecode.ts`; `scripts/deploy-sandbox.ts` → alias of `cli.ts`; `src/quoter-abi.test.ts`; `vitest.config.ts` (exclude `test/integration/**`), `vitest.integration.config.ts`, `test/integration/{deposits,gas-leg,fee-states,registration,exits,pause,drip,recovery}.integration.test.ts`; `package.json` (`exports["./sandbox"]`, `test:integration`, `sandbox:up|down|smoke`); `tsconfig.scripts.json`; `.github/workflows/_bridge-contracts.yml` (+ `integration`, `txe` jobs; ABI-pins step adds `quoter-abi`), `bridge-contracts.yml` filter; `contracts/bridge/evm/README.md`, `packages/bridge-core/README.md`.

Arc 3 (tools browser e2e): `apps/tools/package.json` (`@playwright/test` devDep exact-pinned, `test:browser`, `build:local`, `dev:local`, `typecheck` += `tsc -p tests/browser`), `vite.local.config.mts`, `vite.config.ts` (local artifacts loader + define + per-run manifest/outDir), `vitest.config.ts` (exclude `tests/browser/**`), `src/lib/{network-targets,network}.ts`, `src/contracts/deployments.ts`, `src/composables/createAztecWalletSession.ts`, `scripts/verify-build-target.ts`, `tests/browser/**` (+ `tsconfig.json`, README), `scripts/e2e/agent.sh`, `.gitignore` (`.e2e-state/`), `.github/actions/setup-playwright/action.yml`, `.github/workflows/{_tools-e2e,pr-tools-e2e}.yml`, `behavior-gating.test.ts` (tools-e2e filter), delete the extension's `TOOLS_DEV_PORT`/`toolsUrl` plumbing (`apps/extension/tests/e2e/global-setup.ts`, `lockfile.ts`, `scripts/e2e/resolve-ports.ts` `tools` entry, `agent.sh`), docs: `apps/tools/README.md` (three targets), `CI.md`, `CLAUDE.md` quality-gates table.

### Non-obvious mechanics

- **Local target is a build-time target, not a DEV mode.** `vite build --config vite.local.config.mts` is a production-mode bundle (`import.meta.env.DEV === false`), so every DEV-gated affordance (`VITE_AZTEC_NODE_URL`, the `?chainId` override, a DEV-gated `webWallets`) is dead in it, and `checkBuildIntegrity` runs with `isProd: true` and compares the exact hostname. Therefore: the local target carries `nodeUrl`, `webWalletUrls`, `rollupVersion`, `walletChainId`, `host: "127.0.0.1"` as a `define`d JSON object produced by `vite.config.ts` from `$NULO_SANDBOX_ARTIFACTS`; `network-targets.ts` gets a pure `localTarget(cfg)` factory (it is imported by both the browser bundle and the Vite config, so no `fs` there); every local-only branch is keyed on `target.key === "local"`, which the testnet/mainnet builds dead-code-eliminate. `assertNodeChainMatches` stays enforced and verifies the injected identity against the live node at connect.
- **Quoter facade**: `MockV4Quoter is IV4Quoter` (the repo's own interface), answering `quoteExactInputSingle` by normal return: hop `token→WETH` = `exactAmount` (1:1); hop `native→feeJuice` = `exactAmount * rateNum / rateDen`, reading `MockSwapTarget.rateNum()/rateDen()` **per call** (`setRate` is mutable). Composition equals `MockSwapTarget.swap` settlement, so the `minFuelOutput` the review signs is met; `minFuelFj` can still bind (`gas-share.ts:73`) and settlement then correctly reverts — a test cell. Pool keys outside the allow-list revert (the `NORT` no-route fixture). ABI pin: `quoter-abi.test.ts` compares `QUOTER_ABI` in `quote.ts` to `out/IV4Quoter.sol/IV4Quoter.json`, and the CI "ABI pins" step names it.
- **Manifest `swap` block for the sandbox**: `poolManager` = the facade address (never read by TS), `weth` = `FAKE_WETH`, `feeJuice` = local fee asset, `tiers` = `[{ fee: 3000, tickSpacing: 60 }]`, `ethFj` = `{ fee: 500, tickSpacing: 10 }`, `slippageBps`, `minFuelFj`, `fjPerTx`, `fjRegister` = the calibration the smoke already prints. Tokens carry `source: "permissionless-mint"` + `sourceContract` so `MintStrip` renders. `rollupVersion` is written explicitly (today only `walletChainId` is).
- **Proving on the local network** is synthesized (`automineEnableProveEpoch`); `consumeWithdrawal` already waits on `waitForProven`. `RollupCheatCodes` are used only where they add signal: `advanceToNextEpoch` to shorten exit tests, and a negative test asserting `Outbox.consume` reverts before the checkpoint is proven.
- **Blocks only on demand**: the local network builds a block when a tx arrives; `forceBlock` stays the nudge.
- **Flows carry no module state.** Today's smoke keeps `feeSamples`, `flowResults`, `creditNotes`, `exitGasSamples` at module level and runs order-dependent (one note → exit → two more notes → three-note exit) on one actor. Each integration file mints its own deposits/notes on its own actor; calibration samples are returned values the CLI's `smoke` subcommand aggregates. `optionalFlow`'s swallowed failures are not carried over — the PrivateFPC-paid registration flow becomes a normal test.
- **Test wallet startup order**: `IframeConnectionHandler.start()` runs synchronously at page load (discovery probes time out after 10 s); the `EmbeddedWallet` is created lazily in `getWallet` with `ephemeral: true` (the probe iframe and the session iframe never contend for the same OPFS store); `allowedOrigins: [toolsOrigin]`; the page refuses to start unless `location.hostname` is loopback (belt) and framing is restricted by CSP (braces).
- **Bundle-inject assertion** (from the extension's `agent.sh`): after `build:local`, grep the run's `dist` for the node URL and the test-wallet URL; abort on a miss.
- **Sharding**: Playwright `--shard=i/n` by file, `workers: 1`; every shard boots its own sandbox. Shard count is sized from the measured smoke + per-flow durations recorded in Phase 2 (nothing is measured today).
- **Rename cut-over**: required contexts are matched by name and live in legacy branch protection on both branches. Runbook (`required-checks.sh`): `print` shows both branches' current `checks`; `--apply --expect '<current json>'` PATCHes `required_status_checks` only (using `checks` with `app_id: 15368`, preserving each branch's `strict`), refusing if the live value differs from `--expect`; it prints the rollback command. Sequence: (1) confirm the new check names are green on the PR's mergeable SHA (`gh pr view --json statusCheckRollup`), (2) `--apply` on `dev` AND `main` (main's next promote PR produces the new names too), (3) merge within minutes. Needs an admin-scoped `gh` login — say so in the script's header. `--add <name,...>` is implemented now for the week-later promotion.
- **Two Aztec toolchains in one workflow**: `noir`/`hub-parity`/`txe` pin nargo 5.0.1 from `Nargo.toml`; the sandbox jobs pin 5.2.0 from `packages/bridge-core/package.json` (as `aztecPin()` does) with their own `setup-aztec` cache key.

### Trade-offs & alternatives not taken

| Fork | Chosen | Rejected | Why |
|---|---|---|---|
| Runner for the browser suite | Playwright Test (Node) | Vitest + `playwright` library under Bun | Browser automation under Bun is unsupported, so B collapses to "vitest on Node for one config"; `@playwright/test` gives `webServer`, traces, `--shard` for free. Both audits agreed. |
| Where the harness lives | `packages/bridge-core/scripts/sandbox/` behind a real `exports["./sandbox"]` entry | new `packages/sandbox-harness` workspace | Two consumers today; the export gives the package boundary B wanted without a new workspace (three-places rule). The browser suite keeps its own `tsconfig` so bridge-core's `@aztec/viem` alias never enters `vue-tsc`. |
| Gas-leg venue | Quoter facade over `MockSwapTarget` | local V4 deploy / Sepolia fork | Owner call (Phase 0). |
| L1 wallet | in-repo shim | `@johanneskares/wallet-mock`, `headless-web3-provider` | Dormant one-maintainer packages; the shim is ~80 lines and needs the CSP-proxy behavior anyway. |
| Local chain id | real `local` ToolsTarget via `define` | anvil at 11155111; a DEV-mode-only local run | Faking Sepolia lies to viem's chain object; DEV-mode would skip `checkBuildIntegrity` and never test the shipped bundle shape. |
| Chain resets | fresh actors + fresh tokens per file | `evm_snapshot/revert` | A revert is a reorg to the archiver. |
| Drip on the sandbox | deploy Dripper + tokens | skip drip in e2e | Drip is in the matrix; the artifact is already a dependency. |
| TXE in CI | try it in the new job (5.0.1 toolchain) | leave manual | The "no oracle in the image" premise predates `setup-aztec`; if it fails for infra reasons the job is dropped with the evidence logged. |
| Order | contracts suite first, then the spike, then the browser suite | tools first (B) | The contract suite reuses a proven script; the embedded-wallet handshake is the unproven part and must not gate the cheap signal. The spike still runs before the browser suite is built. |

## Matrix

Every cell names its layer(s): **I** = integration suite (bridge-core seams), **B** = browser suite (real UI). Fee-state columns are shaped by the harness before the flow.

| # | Cell | Wallet profile / fee state | I | B |
|---|---|---|---|---|
| 1 | token only, public, registered token, sponsored | plain / sponsored | ✓ | ✓ |
| 2 | token only, private, registered | plain / sponsored | ✓ | ✓ |
| 3 | token only, first-time (register+claim), public + private | plain / sponsored | ✓ | ✓ (first-time note testid, then #1 cheaper) |
| 4 | token only, public, claim from held **public** FJ | selfpay / public-only | ✓ | ✓ |
| 5 | token only, public, wallet lacks the feature → public FJ reads 0, private credit pays | plain / both (public + credit) | ✓ | ✓ |
| 6 | token only, public, no FJ at all → `OWN_GAS_STOPS.none` | plain / none | ✓ (decision) | ✓ (copy) |
| 7 | token only, public, FJ under ceiling → `short` | selfpay / public-only (short) | ✓ | ✓ |
| 8 | token only, private, no private credit → `PRIVATE_OWN_GAS_STOPS.none` (public FJ present but forbidden) | selfpay / public-only | ✓ | ✓ |
| 9 | token only, private, credit under ceiling → `short` | plain / private-only (short) | ✓ | ✓ |
| 10 | token only, `unverifiable` (node RPC aborted during the read) | plain / any | – | ✓ (`page.route` abort) |
| 11 | token + gas, public, self-paying claim (`fjwc`) | plain / none | ✓ | ✓ |
| 12 | token + gas, private (private fuel → PrivateFPC credit pays the claim) | plain / none | ✓ | ✓ |
| 13 | token + gas, `minFuelFj` binds → review refuses / settlement reverts | plain | ✓ | ✓ |
| 14 | gas only, fee-asset identity route (no swap) | plain / none | ✓ | ✓ |
| 15 | gas only, swapped (non-fee token → FJ) public + private | plain / none | ✓ | ✓ |
| 16 | gas only, WETH single-hop route | plain / none | ✓ | ✓ |
| 17 | routeless token → gas choices greyed, token-only still sends | plain | ✓ (no-route) | ✓ |
| 18 | discovered route feeds the send (real facade quote) | plain | ✓ | ✓ (route status testid) |
| 19 | interrupted claim recovery: pending / dropped / consumed branches | plain | ✓ | ✓ (reload mid-claim; `fuel-claim-state.ts:63`) |
| 20 | grant declined → nothing signed; grant for a left selection discarded | plain | – | ✓ |
| 21 | L1 signature rejected; L1 account change; L1 wrong chain → chip + switch | plain | – | ✓ |
| 22 | exit public | plain / sponsored | ✓ | ✓ |
| 23 | exit private from 1 credit note / from 3 notes | plain / private-credit-1, -3 | ✓ | ✓ |
| 24 | exit private with no credit → refused before any authwit | plain / none | ✓ | ✓ |
| 25 | exit while hub paused (L2) / withdrawals paused (L1) → notice, nothing burned | plain | ✓ | ✓ |
| 26 | exit repriced (fee moved between review and send) | plain | ✓ (harness only — no fee knob on the local network) | – |
| 27 | Outbox consume before proven → reverts; after `advanceToNextEpoch` → lands | – | ✓ | – |
| 28 | registration races: relayer-first; two concurrent first claims; portal-only token; tampered registration ×3 fee modes | – | ✓ | – |
| 29 | catalog (manifest tokens first, remote list after refresh, list served from fixture); paste lookup good + bad | – | – | ✓ |
| 30 | add-to-wallet button → `unsupported` on both profiles (no `registerToken`) | plain, selfpay | – | ✓ |
| 31 | MintStrip mint (permissionless-mint source) | plain | – | ✓ |
| 32 | drip public / private; balances update | plain | ✓ | ✓ |
| 33 | activity: journal backup / restore; dock badge; background completion toast | – | – | ✓ |
| 34 | no-egress: every browser test leaves only loopback requests | – | – | ✓ (fixture assertion) |

## Phases

Fast layers on every gate: `bun run lint` + `bun run typecheck:all` + the touched package's `test`. CI-run proofs for new/renamed workflows happen at Delivery (a `workflow_dispatch` needs the file on the default branch; a PR runs its own workflow files from the merge ref).

### Arc 1 — CI names say the app

#### Phase 1: Rename workflows, aggregators, labels, scripts, docs; ship the protection runbook
- Rename files and `name:`s per the change map; aggregator jobs → `extension-smoke-e2e-status`, `extension-network-e2e-status`, `bridge-contracts-status`; `quality-status` stays (app-neutral).
- `decide` jobs accept both old and new labels for one release; the runbook creates the new labels (`gh label create`).
- `scripts/ci-cd/required-checks.sh`: `print` / `--apply --expect <json>` / `--add <names>` / prints rollback; `checks` + `app_id`, preserves `strict`; header states the admin-token need. `bash -n` + `shellcheck` clean.
- `behavior-gating.test.ts`: `FILTER_WORKFLOWS` updated; new assertion that each PR workflow's aggregator job id/name matches the documented check name list (single source in the test).
- Docs + `verify-cert-run.sh` updated.
- **Validation gate**: `bun run lint:actions` exit 0; `bun run test:ci-gating` exit 0; `rg -n 'smoke-e2e-status|network-e2e-status|contracts-status' --glob '!implementations-plan/**' --glob '!audit/**' --glob '!wallets-architecture-research/**' .` returns only the new names. Layers: lint · unit. CI proof at Delivery: the arc-1 PR shows the new check-run names green.
- **Owner action at merge**: `scripts/ci-cd/required-checks.sh --apply --expect "$(scripts/ci-cd/required-checks.sh print --json)"`, then merge within minutes.

### Arc 2 — Bridge integration suite

#### Phase 2: Extract the harness; vendor canonical bytecode; make flows stateless; measure
- `scripts/sandbox/{index,fixtures,manifest,accounts,flows,handle,cli}.ts`; `deploy-sandbox.ts` becomes an alias. Flows take a `SandboxClients` and return their samples; no module state; `optionalFlow` removed.
- `exports["./sandbox"]` added; `tsconfig.scripts.json` includes `test/**`; unit `vitest.config.ts` excludes `test/integration/**`.
- `bytecode/permit2.json`, `multicall3.json`: runtime code + keccak pinned from an independent source (two public RPCs must agree AND match Uniswap's / mds1's published canonical code hash, recorded in the file); `copyCanonicalCode` reads the file and re-checks the keccak; `refresh-canonical-bytecode.ts` re-fetches and diffs.
- `cli.ts up` builds `forge out/` when absent (same pins as `_bridge-contracts.yml`). `smoke` prints per-flow durations.
- **Validation gate**: `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test` exit 0; `bun run --cwd packages/bridge-core sandbox:smoke` completes with `✅` and no `SEPOLIA_RPC_URL` fetch in its log; the per-flow duration table is pasted into `lessons/phase-2.md`. Layers: typecheck · unit · live-sandbox smoke.

#### Phase 3: `MockV4Quoter` + real `swap` block + the missing flow cells
- `MockV4Quoter.sol is IV4Quoter` + `MockV4Quoter.t.sol` (composition == `MockSwapTarget.swap` for dust, half-cap, both currency orderings, rate change); `src/quoter-abi.test.ts`; `_bridge-contracts.yml` ABI-pins step adds `quoter-abi`.
- `manifest.ts` emits the `swap` block + `rollupVersion` + permissionless-mint token sources; `flows.ts` gains cells 4–9, 12–16, 18, 19, 24, 26, 27 at the seam level (`fee-states`, `gas-leg`, `recovery`, `exits`).
- **Validation gate**: `cd contracts/bridge/evm && forge test --no-match-contract Fork` exit 0; `bun run --cwd packages/bridge-core test -- quoter-abi` exit 0 (with `out/` present); `bun run --cwd packages/bridge-core sandbox:smoke` green including the new flows. Layers: unit (forge, vitest) · live-sandbox smoke.

#### Phase 4: Vitest integration suite + Dripper fixture
- `vitest.integration.config.ts` (`fileParallelism: false`, `testTimeout` 300 s, `globalSetup` boots via `startLocalNetwork` + fixtures and `provide()`s the JSON handle; `BRIDGE_INTEGRATION=1` set by the script and asserted by `describe.skipIf(!process.env.BRIDGE_INTEGRATION)` in every file). Each file `openSandbox(inject("handle"))`, allocates its own actors/tokens/notes.
- Dripper + NULO/OLUN deployed in `fixtures.ts`; `deployments.json` written; `drip.integration.test.ts`.
- **Validation gate**: `bun run --cwd packages/bridge-core test:integration` exit 0 with every matrix "I" cell present as a named test; `bun run --cwd packages/bridge-core test` still exit 0 and does not collect `test/integration/**`. Layers: typecheck · unit · integration (live sandbox).

#### Phase 5: CI job for the suite (+ TXE attempt)
- `_bridge-contracts.yml` gains `integration` (setup-bun → `setup-aztec` pinned from `packages/bridge-core/package.json` with its own cache key → forge install/remappings/build steps copied from the `forge` job → `test:integration`, `timeout-minutes: 30`, logs artifact on failure) and `txe` (`setup-aztec` at the `Nargo.toml` pin → `contracts/bridge/aztec/scripts/run-txe-tests.sh`). `bridge-contracts.yml` filter (literal per-dep `src/**` + `package.json` entries, per the guard): `contracts/bridge/**`, `packages/bridge-core/**`, `packages/wallet-crypto/src/**` + `package.json`, `packages/wallet-core/src/**` + `package.json`, `apps/tools/public/*-bridge.json`, `patches/**`, `bun.lock`, `package.json`, `bunfig.toml`, the two workflow files, `.github/actions/setup-aztec/**`, `.github/actions/setup-bun/**`.
- **Validation gate**: `bun run lint:actions` + `bun run test:ci-gating` exit 0 (guard extended with a bridge-graph assertion). Layers: lint · unit. CI proof at Delivery: `integration` success on the arc-2 PR; `txe` failing for toolchain reasons → log + drop the job in the fix loop.

### Arc 3 — Tools browser e2e

#### Phase 6: Spike — embedded wallet behind the iframe handler connects to tools
- Timeboxed half day. Build only: the test-wallet page (`start()` first, lazy ephemeral `EmbeddedWallet`, `requestCapabilities` returning a schema-valid object, COEP + CORP headers, `allowedOrigins`), a temporary `webWallets` wiring in `createAztecWalletSession.ts`, tools served in dev mode with `VITE_AZTEC_NODE_URL` at a running sandbox. Drive by hand or a throwaway Playwright script.
- Checks, each recorded in `lessons/phase-6.md`: discovery lists the wallet within the 10 s probe; emoji modal → confirm; capability grant round-trips; one public drip lands (receipt testid populated, L2 balance moved via the harness); the floating panel's position and whether a shrink fixture is enough; the `selfpay` override point in `BaseWallet` (which method maps `feePayer === from` → `FEE_JUICE_WITH_CLAIM`) and that a held-public-FJ send goes through with it.
- **Validation gate**: the transcript shows the drip receipt and balance move; `lessons/phase-6.md` records go / no-go per check. No-go fallback recorded there: the test wallet speaks the extension transport through an `addInitScript` relay shim (re-plan as its own phase). Layers: manual e2e.

#### Phase 7: `local` ToolsTarget, local build, local drip record
- `localTarget(cfg)` factory; `TARGETS.local` from `__NULO_LOCAL_TARGET__`; `VIEM_CHAINS[31337]`; `vite.config.ts` local loader (`$NULO_SANDBOX_ARTIFACTS`, per-run manifest path + `--outDir`), `vite.local.config.mts`, `build:local`, `dev:local`, `verify-build-target local`, target-aware `deployments.ts`, `webWallets` keyed on `target.key === "local"`, README target text.
- **Validation gate**: `bun run --cwd apps/tools typecheck && bun run --cwd apps/tools test && bun run --cwd apps/tools test:e2e` exit 0; with a sandbox artifacts dir, `NULO_SANDBOX_ARTIFACTS=<dir> bun run --cwd apps/tools build:local --outDir <dir>/dist && bun run --cwd apps/tools verify:build-target local` exit 0 and the bundle contains the node URL + wallet URL; `bun run --cwd apps/tools build:testnet` contains neither string and no `local-bridge` manifest. Layers: typecheck · unit · jsdom smoke · build.

#### Phase 8: Playwright scaffold, L1 shim, first flow, agent runner
- `@playwright/test` (exact pin), `playwright.config.ts`, `tests/browser/tsconfig.json` (+ `typecheck` script), `vitest.config.ts` exclude, `global-setup.ts`, fixtures (`l1-wallet`, `sandbox`, `wallet-panel`, `egress`), `pages/*.ts`, `specs/connect-and-deposit.spec.ts` (cell 1), `apps/tools/scripts/e2e/agent.sh` + reap, root scripts `e2e:tools`, `e2e:tools:reap`.
- **Validation gate**: `bun run e2e:tools` exit 0 with cell 1 green at retry 0; `e2e:tools:reap` afterwards reports nothing to reap; the egress fixture reports zero non-loopback requests. Layers: e2e (live sandbox, real browser).

#### Phase 9: The matrix
- Specs by family: `deposit-token`, `deposit-token-gas`, `deposit-gas-only`, `fee-states`, `recovery`, `l1-wallet`, `exits`, `tokens`, `drip`, `activity`; every "B" cell in the table is a named test.
- **Validation gate**: `bun run e2e:tools` exit 0 at retry 0; `bun run e2e:tools -- --shard=1/2` and `--shard=2/2` both exit 0; durations pasted into `lessons/phase-9.md` and the CI shard count chosen from them. Layers: e2e.

#### Phase 10: CI for the tools suite; delete the extension's dead tools plumbing; docs
- `.github/actions/setup-playwright` (cache keyed on the pinned version), `_tools-e2e.yml` (inputs `ref`, `shard`, `shard_label`; setup-bun → `setup-aztec` at the bridge-core pin → forge build steps → setup-playwright → `bun run e2e:tools -- --shard`; `timeout-minutes: 30`; traces + logs on failure), `pr-tools-e2e.yml` (`name: Tools e2e`; filter `tools-e2e` with literal per-dep entries: `apps/tools/**`, `contracts/bridge/**`, `packages/bridge-core/src/**` + `package.json` (+ `scripts/**`), `packages/{design,wallet-crypto,wallet-core,wallet-sdk-schema-patch,resolve-asset}/src/**` + `package.json`, root config, `patches/**`, the two workflow files, the three actions; label `e2e:tools`; N shards from Phase 9; `tools-e2e-status` exact-state aggregator; `changes` job `pull-requests: read`).
- Remove `TOOLS_DEV_PORT`/`toolsUrl`/`ports.tools`/`pids.tools` from the extension runner.
- Docs: `CI.md` (per-app sections), `CLAUDE.md` quality-gates table + required-checks list (two advisory gates + the promotion rule + who owns it), `apps/tools/README.md`, `tests/browser/README.md`, `.github/README.md`.
- **Validation gate**: `bun run lint:actions` + `bun run test:ci-gating` (guard extended with the tools graph) + `bun run --cwd apps/extension test:e2e` (smoke; proves the plumbing removal broke nothing) exit 0. Layers: lint · unit · extension smoke. CI proof at Delivery: all shards + `tools-e2e-status` green on the arc-3 PR at retry 0.

**Promotion (owner, after a clean week = 7 days of retry-0 green on every PR that tripped the filter):** `scripts/ci-cd/required-checks.sh --add bridge-contracts-status,tools-e2e-status --expect "$(… print --json)"`.

## Security & Adversarial Considerations

- **Threat model**: CI workflows run repo code with `GITHUB_TOKEN`; new workflows keep `permissions: contents: read` (+ `pull-requests: read` only on the paths-filter job). The sandbox binds loopback; the test wallet page and the tools preview bind loopback. Nothing touches production credentials.
- **Supply chain**: `@playwright/test` is the only new dependency, exact-pinned, subject to `minimumReleaseAge` and the frozen lockfile; its browser build is pinned transitively by that version and cached by it. Vendored Permit2/Multicall3 runtime code is pinned by keccak from an independent source (two providers + the published canonical hash), so a poisoned RPC at vendoring time is detected, not just a later change. `setup-aztec`'s `curl | bash` installer is pre-existing and out of scope here (noted).
- **Secrets**: none added. Anvil dev keys are public constants on loopback. The sandbox actor secret is generated per run and never printed.
- **The auto-approving wallet page** is hostile by construction; its defenses are `allowedOrigins: [toolsOrigin]` on the handler (the SDK's own check, `iframe_connection_handler.js:100-103`), CSP `frame-ancestors` limited to the tools origin, a loopback-hostname refusal, a separate build entry that no production target references, and a `build:testnet`/`build:mainnet` assertion that neither its assets nor its URL appear in the bundle.
- **Runbook least privilege**: `required-checks.sh` prints before it applies, applies only with `--apply --expect`, touches only `required_status_checks` (never signatures, never merge methods), preserves `strict`, and prints the rollback.
- **Domain risks the suites now cover**: consume-before-proven (negative), the pause switches, tampered registrations, the private-gas fences (a private bridge never falls through to a public payer), `minFuelFj` binding. The Quoter facade is test-only Solidity under `src/mocks/`; `verify:deployments` keeps asserting the real `UniswapFuelSwap` on testnet/mainnet.
- **Egress**: browser tests block every non-loopback request; the token list is served from a fixture. No test can be influenced by a live third-party response.

## Assumptions

### Facts (verified)
- `deploy:sandbox --smoke` boots anvil + `aztec start --local-network`, deploys a generation, runs 17 flows including Outbox consumption after `waitForProven` — `packages/bridge-core/scripts/deploy-sandbox.ts:1218-1352`, `src/flows.ts:211-264`. It keeps module-level state (`feeSamples`, `flowResults`, `creditNotes`, `exitGasSamples`) and is order-dependent; `optionalFlow` swallows failures (line 490).
- The 5.2.0 local network defaults to `useAutomineSequencer: true`, `automineEnableProveEpoch: true`, `realProofs: false`, `aztecEpochDuration: 4` — `~/.aztec/versions/5.2.0/node_modules/@aztec/aztec/dest/local-network/local-network.js:94-106`.
- `@aztec/ethereum/test` ships `start_anvil`, `EthCheatCodes`, `RollupCheatCodes`; `@aztec/aztec.js` ships `ethereum/portal_manager` and `utils/cross_chain` — installed 5.x listings.
- `@aztec/wallets` exports `./embedded` (browser entrypoint with `ephemeral` option) and `./testing`; `@aztec/wallet-sdk` exports `./iframe/handlers` (`IframeConnectionHandler` with `getWallet`, `onPendingDiscovery`, `approveDiscovery`, `start`, `allowedOrigins` config) and `./manager` with `webWallets.urls`.
- The iframe handler dispatches only methods present in `WalletSchema` (`iframe_connection_handler.js:203`); `WalletCapabilitiesSchema` requires `version: "1.0"` + `wallet` metadata (`aztec.js/dest/wallet/wallet.js:254`); `BaseWallet.requestCapabilities` throws `Not implemented` (`base_wallet.js:145`); `BaseWallet` maps `feePayer === from` to `FEE_JUICE_WITH_CLAIM` (`base_wallet.js:184-193`).
- Web-wallet discovery probes time out at 10 s (`iframe_discovery.js:13`); the SDK's iframe provider renders a 420×500 fixed panel at `z-index: 999999` when no container is given (`iframe_provider.js:146-162`); tools already handles `type: "web"` providers (`createAztecWalletSession.ts:546-550`).
- `selfPaidFeeJuicePayment` documents the `dapp-self-pay` semantics: sender as payer, no fee call, routed by the Nulo wallet as self-pay over the preexisting balance — `packages/bridge-core/src/fee-juice.ts:122-135`. `ownGasFee` (held public gas) gates on the feature; the fueled `fjwc` claim does not — `apps/tools/src/composables/deposit-flow.ts:602-615, 672-690`.
- Tools discovery is `WalletManager.configure({ extensions: { enabled: true } })` — `createAztecWalletSession.ts:477`; `requestCapabilities` at 786; `registerContracts` at 869.
- `useL1Wallet.ts` reads `window.ethereum` and routes both viem clients through `custom(provider)` (CSP).
- With `manifest.bridge.l1.swap` undefined, `useRouteQuote` returns `unavailable/config` for every token and `ChoiceCards` greys both gas choices.
- Quoting: `readContract` on `Multicall3.aggregate3` → `Quoter.quoteExactInputSingle`; reverts = "no pool", never decoded — `quote.ts` `readHopOutput`. `IV4Quoter.sol` declares the struct/selector. `MockSwapTarget.swap` ignores `path`, pays `amount*rateNum/rateDen`, `setRate` is mutable. `signedMinFuelOutput` can exceed output when `minFuelFj` binds (`gas-share.ts:73`); the router reverts (`SwapBridgeRouter.sol:225`).
- `manifest.bridge.l1.swap.poolManager` is never read by TS; tokens need `source: "permissionless-mint"` + `sourceContract` for `MintStrip` (`manifest-v2.ts:57,166`). The sandbox manifest writes `walletChainId` but no explicit `rollupVersion` (`deploy-sandbox.ts:304-316`).
- `build:local` would be a production-mode bundle: `import.meta.env.DEV` false, `checkBuildIntegrity` `isProd: true` with exact-hostname compare (`build-integrity.ts:28-33`); `network.ts:44-48` DEV-gates `VITE_AZTEC_NODE_URL`; `network-targets.ts` is imported by `vite.config.ts:11` and the browser bundle.
- Tools serves COOP `same-origin` + COEP `require-corp` in dev and preview (`vite.config.ts:14-17`); `useTokenCatalog.ts:86` fetches the remote token list unconditionally.
- `apps/tools/vitest.config.ts:19` excludes only `tests/e2e/**`; `packages/bridge-core/vitest.config.ts` has no excludes; `tsconfig.scripts.json` includes `src/**` + `scripts/**` only.
- `evmArtifact` reads `contracts/bridge/evm/out` (`script-artifacts.ts:12-16`), gitignored; only the `forge` job in `_bridge-contracts.yml` builds it; the ABI-pins step runs `test -- factory-abi router-abi` (line 147). TXE pins nargo 5.0.1 (`run-txe-tests.sh:23`).
- `@nulo/bridge-core` exports `.`, `./artifacts`, `./fee-juice`, `./private-fpc-artifact` only; bridge-core's viem is `npm:@aztec/viem@2.38.2`, tools' is `^2.52.2`.
- `behavior-gating.test.ts:59-64` requires literal `packages/<dep>/src/**` + `package.json` filter entries per transitive dep; `contracts.yml` `changes` has `pull-requests: read` (line 19) and no `fetch-depth: 0`.
- Required checks live in legacy branch protection on `dev` (`strict:false`) and `main` (`strict:true`): `network-e2e-status`, `quality-status`, `smoke-e2e-status`, app_id 15368; rulesets carry only merge-method/review rules; `contracts-status` is not required.
- `workflow_dispatch` requires the workflow file on the default branch; `pull_request` runs use the merge ref's workflow files.
- The extension's `global-setup.ts` spawns tools when `TOOLS_DEV_PORT` is set; no test consumes `toolsUrl`. No Playwright anywhere in the repo.

### Inferences (unverified — attack these)
- I1. With `start()` first, lazy ephemeral wallet, CORP + COEP on the wallet page and `allowedOrigins`, `BrowserEmbeddedWallet` + `IframeConnectionHandler` completes tools' handshake without SDK changes. Phase 6 tests exactly this.
- I2. The local network accepts proverless txs from a browser PXE as it does from the Node `EmbeddedWallet` (same `proverEnabled: false` path).
- I3. The `selfpay` routing override has a clean seam in `BaseWallet` (a single overridable method around `base_wallet.js:184-193`); Phase 6 names it.
- I4. The `setup-aztec` runner can run the TXE oracle when the 5.0.1 toolchain is installed; Phase 5 tests it and drops the job if not.
- I5. Playwright's Chromium honors the preview server's COOP/COEP so the WASM simulator runs; the iframe wallet is also `crossOriginIsolated` once it sends COEP + CORP.
- I6. Shard count and the 30-minute job budget: unmeasured today; Phases 2 and 9 measure and size.
- I7. A `webWallets` wallet is listed by `getAvailableWallets` alongside extension wallets (verified by fable: `wallet_manager.js` merges sources) — treated as fact after Phase 6.
- I8. `bun --bun vitest` is fine for the integration suite (spawns processes and `@aztec/*` Node paths exactly as the CLI does today under `bun scripts/...`).
- I9. `vite build --outDir` and a per-run manifest path keep parallel local shards from sharing `dist`/`public` state.

### Asks
- None outstanding. Phase 0 decisions are recorded above. The new check names are proposed here and confirmed at the approval gate.

## Delivery

| Arc | Phases | Branch | Stacks on | code_review |
|---|---|---|---|---|
| 1 CI naming | 1 | `worktree-tools-self-testing` (adopted as layer 1 via `gh stack init --adopt`) | `dev` | off |
| 2 Bridge integration | 2–5 | `tools-self-testing/bridge-integration` | arc 1 | off |
| 3 Tools browser e2e | 6–10 | `tools-self-testing/tools-browser-e2e` | arc 2 | off |

Multi-arc: `gh stack init --adopt worktree-tools-self-testing --base dev`; at each arc boundary (phases green AND the arc's codex loop converged) `gh stack add <next>`; PRs opened only in the Delivery step via `gh stack submit --auto` then `gh pr edit` bodies; `gh stack sync` after `dev` moves. The PR checks are the CI proof for phases 1, 5, 10 — a red check there is fixed on the arc branch and re-pushed (bounded loop, logged). `gh stack merge` is the owner's call. Arc 1 merges with the owner running `required-checks.sh --apply --expect …` immediately before.

## Post-implementation

Executed by the implementing session from this file. `code_review` is **off**: do not run `/code-review` or any reviewer-subagent pass (owner directive, 2026-09-03).

1. **Per arc, at its boundary** (all its phases ✓, before `gh stack add`): send `/codex high` the arc's diff, this plan.md + the decision ledger, the arc map ("this is arc N of 3; later arcs build X on it"), the adversarial/security ask ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / least-privilege weaknesses?"), and both rules below verbatim.
2. **Iterative fix loop**: verify each finding against the repo (codex can misread), apply accepted fixes, commit, log the round in `lessons/phase-N.md` (consult + verdict), then RESUME the same codex session with the fix diff for a re-review. Stop when a round yields no new material findings. Still material after 3 rounds → stop and surface to the owner (scope smell).
3. **After all arcs**: one FRESH `/codex high` session over the net diff from `036709d8`, asking for cross-arc issues (seams between arcs, duplication across arcs, drift from this plan) plus both rules; same loop until clean.
4. **Delivery**: the FIRST time any PR is opened. `gh stack sync` if `dev` moved, `gh stack submit --auto`, `gh pr edit` each body (what/why, gates run, the runbook step for arc 1), `gh pr checks --watch`; a red new-workflow check is fixed on its arc branch and re-pushed. Update `implementations-plan/index.md`. Never merge.

**No-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

**Comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

Failure policy: 3 failures on one step (human-driven) or 5 (`/loop`) → stop, reassess with codex, log it.

Hardening: not scheduled. Revisit `/harden security` before the tools store/publish milestone (the plan touches CI/CD but adds no trust boundary).

## Decision ledger

**Chosen**: outline A's runner (Playwright Test), order (contracts suite → spike → browser suite), and harness location — amended with B's boundary point as a real `exports["./sandbox"]` entry. Both audits concurred on runner and order; both wanted the boundary.

**Adopted from codex (round 1, reject)**: local target must be build-time keyed, not DEV-gated (High); factory + define injection, explicit `rollupVersion` (High); the "plain wallet greys token+gas" expectation was wrong — fueled claims don't probe the feature, held-public-gas does (High → matrix cells 4/5/11); the wallet page must load the schema patch for `getWalletFeatures` and return schema-valid capabilities (High); vitest include/exclude + `tsconfig.scripts.json` boundaries (High); CI jobs need forge artifacts and the 5.0.1 vs 5.2.0 toolchain split (High); `workflow_dispatch` gates are not executable pre-merge → CI proof moved to Delivery-time PR checks (High); literal per-dep filter entries + `pull-requests: read` (Medium); stateful/order-dependent flows → stateless flows, fresh tokens per registration case, `finally` restores, serialized deployer ops, `workers: 1`, per-run dirs (High); JSON-only handle + single boot owner (Medium); facade reads rate per call, ABI pinned against the compiled interface, `minFuelFj` cell (Medium); `allowedOrigins` + framing restriction + production-bundle assertion (High); lazy wallet start before PXE init; retry-0 as the "clean week" criterion (Medium); runbook contract (`checks`+`app_id`, preserve `strict`, `--expect`, rollback, both branches, `--add` now) (High); enumerated matrix with fee combos, WETH single-hop vs identity, recovery branches, rejection/account-change paths, no `optionalFlow`, no UI copy assertions in the harness (High).

**Adopted from fable (round 1, conditional approve)**: the five conditions (build-time key; `selfpay` implements the routing it advertises; real package boundary; wallet page COEP + CORP and `WALLET_READY` before PXE init; CI builds forge artifacts) — all folded in; floating-panel fixture + large viewport (Medium); `localTarget` factory, not a const (Medium); browser tests block egress and serve the token list from a fixture (Medium); independent keccak pins for vendored bytecode (Medium); `quoter-abi` added to the CI ABI-pins step, `fetch-depth: 0`, `wallet-core` in the tools filter (Medium); worker-scoped page + serial per file (Low); measure before sizing shards (I6).

**Rejected / not taken**: fable's `packages/sandbox-harness` workspace — the export entry gives the same boundary with less surface; revisit at a third consumer. Codex's suggestion to validate new workflows via a bootstrap dispatch workflow — the PR run is the proof and needs no throwaway file. A forge selector test for the facade — redundant once the vitest ABI pin exists (fable).

**Still disputed / to be settled in Phase 6**: whether the `selfpay` routing override has a clean `BaseWallet` seam (I3); whether the SDK panel needs more than a shrink (fable Medium). Both are spike outputs, not plan forks.

## Audit verdicts

- Codex round 1 (GPT-6 Astra, high): **reject** — every blocking finding adopted above; see `audit-codex.md`.
- Fable round 1 (Fable 5.1, Plan agent): **conditional approve** with five conditions — all adopted; see `audit-fable.md`.
- Final fresh-context codex: pending.

## Seeds (DRAFT — finalized after approval)

See the ELI5 artifact. `<test>` = `bun run test:all`, `<lint>` = `bun run lint && bun run lint:actions`.
