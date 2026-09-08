---
plan: tools-self-testing
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off            # owner directive 2026-09-03 — the codex fix loop is the review
budget: recon 2 mappers + prior 4-agent research sweep; codex at high; no wide fan-out
base: origin/dev @ 036709d8
status: APPROVED 2026-09-08 (owner, no conditions) — implementing
---

# tools-self-testing

Give `apps/tools` and the any-ERC-20 bridge their own proof of correctness, without the Nulo extension anywhere in the loop, and make CI say which product it is testing.

Three arcs, stacked:

1. **CI naming** — every e2e workflow, aggregator check, label, and doc names the app it tests; branch protection is repointed per branch by a one-command runbook.
2. **Bridge integration suite** — the sandbox smoke (`deploy:sandbox --smoke`) becomes a vitest suite over a real anvil + `aztec start --local-network`, with a Uniswap-V4 Quoter facade so the gas leg is reachable, vendored canonical bytecode so CI never touches a public RPC, a Dripper fixture, and a `bridge-contracts-status` job that runs it.
3. **Tools browser e2e** — Playwright drives the real tools UI against the same sandbox, with an injected EIP-1193 L1 wallet and an embedded wallet-sdk-compatible L2 wallet, across an enumerated flow matrix, sharded, behind a `tools-e2e-status` check.

Locked in Phase 0 (owner, 2026-09-08): gas leg via **Mock + Quoter facade**; **rename the aggregators + coordinated branch-protection update**; new gates **advisory first, required after a clean week**; **full matrix in both layers, browser sharded**.

## Goals

- A contract or bridge-core change cannot merge without the sandbox round trips passing (once promoted to required).
- A tools change cannot merge without the real UI completing every matrix cell against a real local network (once promoted).
- A third-party wallet-sdk wallet drives every core flow; the Nulo-custom RPCs only add convenience, and their absence degrades gracefully.
- Reading the Checks tab tells you which product a red check belongs to.

## Non-goals

- Real Uniswap V4 on the sandbox (the Sepolia-fork forge test keeps that proof).
- Real proving in the browser (the embedded wallet runs proverless; the local network accepts that).
- Driving tools with the Nulo extension (manual pre-release smoke only, per `CLAUDE.md` § Two products).
- Live-testnet canaries for a manifest bump (the `aztec-update` skill's canaries).
- Firefox/WebKit in the tools suite (Chromium only).
- Sponsored fees on any bridge path (owner rule: no bridge path may lean on the sponsored FPC; only the faucet drip keeps a sponsor).

## Architecture & Implementation

### Proposed architecture

```
packages/bridge-core/
  package.json                exports += "./sandbox": "./scripts/sandbox/index.ts"  (Node-only harness surface)
  scripts/sandbox/
    index.ts                  NEW  public harness surface (boot/attach, fixtures, actors, fee fixtures, flows, handle codec)
    local-network.ts          (exists) boot/attach/teardown, port registry — admin API key kept ON; listening addresses asserted at boot
    fixtures.ts               NEW  deployL1Fixtures + deployGeneration + tokens + MockSwapTarget + MockV4Quoter + Dripper — extracted from deploy-sandbox.ts
    manifest.ts               NEW  buildManifest (real `swap` block, explicit `rollupVersion`, permissionless-mint token sources) + writeArtifacts(dir)
    actors.ts                 NEW  newActor() (fresh Nulo-shape Schnorr secret → address computed in Node, before the browser knows it); fundFeeFixture(); fresh-token allocator
    flows.ts                  NEW  the smoke flows + missing seam-level cells, pure functions over `SandboxClients`; no module state; no UI copy assertions
    handle.ts                 NEW  `SandboxHandle` (strings only) + zod codec + `openSandbox(handle)` → clients
    bytecode/{permit2,multicall3}.json  NEW vendored canonical runtime code + independently sourced keccak pins
    cli.ts                    NEW  `up|down|smoke` (deploy-sandbox.ts becomes a 20-line alias)
  test/integration/*.integration.test.ts   NEW  one file per family; sequential; one boot per run; each test allocates its own actor/token
  vitest.integration.config.ts  NEW  globalSetup boots + deploys once, `provide()`s the JSON handle; unit config excludes `test/integration/**`
  tsconfig.scripts.json         include += "test/**/*.ts"

contracts/bridge/evm/src/mocks/MockV4Quoter.sol   NEW  `is IV4Quoter`; reads MockSwapTarget's rate per call; allow-listed pool keys
packages/bridge-core/src/quoter-abi.test.ts       NEW  pins QUOTER_ABI against out/IV4Quoter.sol/IV4Quoter.json (router-abi pattern; named in the CI "ABI pins" step)

apps/tools/
  src/lib/network-targets.ts     `ToolsTargetKey += "local"`; pure `localTarget(cfg)` factory; `TARGETS.local` present only behind `typeof __NULO_LOCAL_TARGET__ !== "undefined"`
  src/lib/local-target-loader.ts NEW  Node-only: reads `$NULO_SANDBOX_ARTIFACTS/{handle,manifest,deployments}.json` → LocalTargetConfig (used by vite.config.ts AND verify-build-target.ts)
  src/lib/network.ts             31337 → viem chain; nodeUrl from the target
  src/composables/createAztecWalletSession.ts   `webWallets: { urls }` when `target.key === "local"`
  src/composables/useAddDripToken.ts            treat "Unknown wallet method" (iframe transport) like "Unsupported wallet method" → `unsupported` (fail-open rule)
  src/contracts/deployments.ts   target-aware drip record (local record from the define)
  vite.config.ts                 local target: loader → `define`, per-run manifest path + outDir; preview serves the generated CSP (+ `frame-src` wallet origin) for local
  vite.local.config.mts          NEW
  scripts/verify-build-target.ts  `--dist <dir>`; local identity via the loader
  tests/browser/                 NEW Playwright suite (own tsconfig; excluded from vue-tsc and from vitest)
    playwright.config.ts         chromium, workers: 1, webServer ×2 (tools preview on 127.0.0.1, test wallet), traces on first retry, large viewport
    global-setup.ts              parses handle.json (written by the CLI); no booting here
    fixtures/{l1-wallet,sandbox,actor,wallet-panel,egress,isolation}.ts
    test-wallet/                 tiny vite app: `start()` first, lazy ephemeral EmbeddedWallet, profiles plain|selfpay|full, COEP+CORP, allowedOrigins, appId/chain guard, `addAccount(secret)` control hook
    pages/*.ts                   page objects, testid-only
    specs/*.spec.ts              the matrix (table below)
  scripts/e2e/agent.sh           NEW: ports → `bridge-core cli up` → build local (per-run outDir) → assert bundle → playwright → reap

.github/
  workflows/pr-extension-smoke-e2e.yml, pr-extension-network-e2e.yml, _extension-smoke-e2e.yml, _extension-network-e2e.yml, extension-network-e2e-soak.yml   RENAMED
  workflows/bridge-contracts.yml (was contracts.yml) + _bridge-contracts.yml (+ integration, txe jobs)
  workflows/pr-tools-e2e.yml + _tools-e2e.yml   NEW
  actions/setup-playwright/      NEW
scripts/ci-cd/required-checks.sh  NEW  print / --apply --branch <dev|main> --expect <file> / --add, rollback printed
```

Reuse per `recon.md`: `startLocalNetwork`, `waitForL1ToL2Message`, `consumeWithdrawal`, `createL2Wallet`, `deriveNuloAccountKeys`, `MockSwapTarget`, `IV4Quoter.sol`, the extension's `agent.sh`/`resolve-ports`/`reap` pattern, `setup-aztec`, `setup-bun`, `behavior-gating.test.ts`, the `_bridge-contracts.yml` forge/remappings steps, `chain-info.ts`'s existing target resolution.

### Key interfaces

```ts
// @nulo/bridge-core/sandbox — handle.ts (JSON only; Fr/AztecAddress are hex strings)
export type SandboxHandle = {
  anvilUrl: string; nodeUrl: string; l1ChainId: 31337; rollupVersion: number; walletChainId: number
  manifestPath: string; deploymentsPath: string        // manifest.json (ManifestV2 with a real swap block), deployments.json (drip record)
  l1: { deployerKey: Hex; actorKeys: Hex[] }           // anvil mnemonic index 0 = deployer/relayer; 1.. = actors (one per browser file)
  l2: { relayer: string }                              // genesis relayer address (Node-side only)
  swapTarget: Address; quoter: Address                 // MockSwapTarget, MockV4Quoter
}
export function openSandbox(h: SandboxHandle): Promise<SandboxClients>   // viem clients + node client + Node EmbeddedWallet + a deployer/relayer mutex

// actors.ts — one actor per test (cell), never shared; address is computable in Node before the browser account exists
export type Actor = { secret: Hex; address: string }
export function newActor(c: SandboxClients): Promise<Actor>
export type FeeFixture = { publicFj?: bigint; creditNotes?: bigint[] }   // exact amounts; absent = zero; e.g. { creditNotes: [ceiling*14n/10n] }, { publicFj: ceiling/2n }
export function fundFeeFixture(c: SandboxClients, a: Actor, f: FeeFixture): Promise<{ publicFj: bigint; credit: bigint; notes: number }>  // returns the postcondition
export function allocateToken(c: SandboxClients, kind: "registered" | "unregistered" | "portal-only" | "routeless" | "fee-asset" | "weth"): Promise<TokenFixture>
```

```ts
// apps/tools/src/lib/network-targets.ts
export type ToolsTargetKey = "testnet" | "mainnet" | "local"
export type LocalTargetConfig = { nodeUrl: string; rollupVersion: number; walletChainId: number; webWalletUrls: string[]; host: string; manifestFile: string; drip: DripDeploymentRecord }
export function localTarget(cfg: LocalTargetConfig): ToolsTarget   // pure
// TARGETS.local exists only when the build defined __NULO_LOCAL_TARGET__ (vite.local.config); Node code never reads the define — it calls the loader.
```

```ts
// apps/tools/tests/browser/test-wallet/profile.ts
export type TestWalletProfile = "plain" | "selfpay" | "full"
// plain:   standard wallet-sdk surface; requestCapabilities → { version: "1.0", granted, wallet: { name, ... } }; NO Nulo RPCs
// selfpay: + imports @nulo/wallet-sdk-schema-patch/register (the patch adds ALL four Nulo methods to WalletSchema, so the
//          handler's schema check passes for every one of them); getWalletFeatures() → ["dapp-self-pay"]; registerToken /
//          isTokenRegistered / grantPublicAuthwit implemented as `throw new Error("Unsupported wallet method: <name>")` — a
//          wallet that knows the schema but lacks the feature (never an undefined-method TypeError); payload-aware routing:
//          sendTx/simulateTx wrapper — when payload.feePayer equals the sender AND payload.calls has NO call whose `to` is
//          ProtocolContractAddress.FeeJuice with selector `claim_and_end_setup((Field),u128,Field,Field)` (the call
//          FeeJuicePaymentMethodWithClaim emits — fee_juice_payment_method_with_claim.js:19-36), re-issue the payload with
//          feePayer undefined so BaseWallet selects PREEXISTING_FEE_JUICE (base_wallet.js:184-193); a payload carrying that
//          call is passed through untouched → FEE_JUICE_WITH_CLAIM. Match address + selector, never a display name.
// full:    selfpay + registerToken/isTokenRegistered really implemented (proves the convenience path on a wallet that has it)
// all:     getWallet(appId, chainInfo) throws unless appId === tools' and chainInfo matches the sandbox; allowedOrigins = [toolsOrigin]
//          window.__nuloTestWallet.addAccount(secretHex) → creates the Schnorr account (Nulo shape) in the ephemeral wallet; Playwright calls it via the wallet frame
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

1. `apps/tools/scripts/e2e/agent.sh`: resolve a port pack (anvil, aztec, aztec-admin, aztec-p2p, tools, test-wallet) → `bun run --cwd packages/bridge-core sandbox:up --artifacts "$RUN_DIR"` boots anvil + local network (asserts the RPC/admin listeners, keeps the admin key), builds `forge out/` if absent, deploys fixtures, writes `handle.json` + `manifest.json` + `deployments.json` → `NULO_SANDBOX_ARTIFACTS=$RUN_DIR bun run --cwd apps/tools build:local --outDir "$RUN_DIR/dist"` (the loader feeds `define`; manifest path and outDir are per run, never `public/`) → asserts the bundle contains the node URL and the test-wallet URL → `playwright test [--shard=i/n]` → reap owned pgids.
2. Playwright `webServer` serves `$RUN_DIR/dist` via `vite preview` on `127.0.0.1:<tools>` with COOP/COEP AND the generated CSP (`frame-src` = wallet origin), and the test-wallet build on `127.0.0.1:<tw>` (COEP `require-corp` + `Cross-Origin-Resource-Policy: cross-origin` + CSP `frame-ancestors http://127.0.0.1:<tools>`). `global-setup.ts` only parses `handle.json`. The isolation fixture asserts `crossOriginIsolated === true` in the tools page AND inside the wallet frame.
3. Per spec file (one browser context, `serial`): `installL1Wallet` with that file's L1 actor key; egress fixture routes `tokens.uniswap.org` to `fixtures/token-list.json` and aborts any non-loopback request (asserted at teardown); the file declares its cells, so the fixture allocates its whole actor pool up front (`newActor()` × (N+2) in Node, the 2 being retry spares; **N+2 ≤ 16**, tools' `MAX_GRANTED_ACCOUNTS` (`createAztecWalletSession.ts:74, 989`) — a file needing more is split) and hands the seeds to the wallet through a **context-level init script** (`context.addInitScript`, which runs in every document of the context including the session iframe the SDK creates only inside `establishSecureChannel` (`iframe_provider.js:57-67`); the script sets `window.__nuloTestWalletSeeds` when `location.origin` is the wallet origin) — the wallet's lazy `getWallet` imports every seed before returning, so the capability grant already lists the entire pool; tools takes its account list from that grant (`createAztecWalletSession.ts:786, 819`), refuses an empty wallet (`:822`), and refuses to select an ungranted address (`:931`), so nothing is added after the grant; `page.goto(tools)`; connect L1 → connect Aztec: the picker lists three test wallets, one per profile (`webWalletUrls = [tw/?profile=plain, ?profile=selfpay, ?profile=full]`) and the spec picks its profile by testid → emoji modal → confirm; capability grant (the whole pool) → approve, and the fixture asserts every allocated address survived grant parsing (present in the switcher); the wallet-panel fixture shrinks the SDK's floating iframe panel (`iframe_provider.js:146-162`) so it never covers a testid.
4. Per test (cell): `fundFeeFixture(actor, cell.fixture)` on-chain just in time → the tools account switcher selects that cell's actor (testid) → the flow by testids → assertions read journal/receipt testids and, where the UI cannot show it, the chain via `openSandbox(handle)`; every cell states its expected payer and balance/note postconditions in the test. A retry gets a fresh actor from the file's spare pool (allocated N+2), never a reused one.
5. Isolation: actors per cell (never reused across cells or retries); registration cells allocate a fresh token; pause/rate mutations restore in `finally`; deployer/relayer operations go through the harness mutex; the chain is never snapshotted; `workers: 1` per sandbox, parallelism only via shards (each shard boots its own sandbox).

### File-level change map

Arc 1 (CI naming): rename 5 workflow files (+ every `uses:` in `release.yml`, `nightly.yml`), rename aggregator job names, rename workflow `name:`s, labels `e2e:extension-smoke` / `e2e:extension-network` (old labels accepted for one release, then dropped), `_build-tools.yml` step "Tools jsdom smoke", `contracts.yml` → `bridge-contracts.yml` with `bridge-contracts-status` (bump to `checkout@v7` with `fetch-depth: 0` / `paths-filter@v4`; `changes` keeps `pull-requests: read`; keep the stacked-base `pull_request` shape), `scripts/ci-cd/behavior-gating.test.ts` (`FILTER_WORKFLOWS` + aggregator-name assertion), `scripts/ci-cd/verify-cert-run.sh`, docs: `README.md`, `CI.md`, `CLAUDE.md` (Branching + Quality gates), `ARCHITECTURE.md` §14, `.github/README.md`, `apps/extension/README.md`, `apps/extension/tests/e2e/README.md`, `apps/extension/tests/COMPOSITION-TESTS.md`, `apps/tools/tests/e2e/README.md`, `.claude/skills/e2e-testing/SKILL.md`; new `scripts/ci-cd/required-checks.sh`.

Arc 2 (bridge integration): `contracts/bridge/evm/src/mocks/MockV4Quoter.sol` + `test/MockV4Quoter.t.sol`; `packages/bridge-core/scripts/sandbox/{index,fixtures,manifest,actors,flows,handle,cli}.ts`, `local-network.ts` (drop `--disable-admin-api-key`, assert listeners), `bytecode/*.json`, `scripts/refresh-canonical-bytecode.ts`; `scripts/deploy-sandbox.ts` → alias; `src/quoter-abi.test.ts`; `vitest.config.ts` (exclude `test/integration/**`), `vitest.integration.config.ts`, `test/integration/{deposits,gas-leg,fee-states,registration,exits,pause,drip,outbox}.integration.test.ts`; `package.json` (`exports["./sandbox"]`, `test:integration`, `sandbox:up|down|smoke`); `tsconfig.scripts.json`; `.github/workflows/_bridge-contracts.yml` (+ `integration`, `txe`; ABI-pins step adds `quoter-abi`), `bridge-contracts.yml` filter; `contracts/bridge/evm/README.md`, `packages/bridge-core/README.md`.

Arc 3 (tools browser e2e): `apps/tools/package.json` (`@playwright/test` devDep exact-pinned, `test:browser`, `build:local`, `dev:local`, `typecheck` += `tsc -p tests/browser`), `vite.local.config.mts`, `vite.config.ts` (loader + define + per-run manifest/outDir + CSP in preview for local), `vitest.config.ts` (exclude `tests/browser/**`), `src/lib/{network-targets,network,local-target-loader}.ts`, `src/contracts/deployments.ts`, `src/composables/{createAztecWalletSession,useAddDripToken}.ts`, `scripts/verify-build-target.ts`, `tests/browser/**` (+ `tsconfig.json`, README), `scripts/e2e/agent.sh`, `.gitignore` (`.e2e-state/`), `.github/actions/setup-playwright/action.yml`, `.github/workflows/{_tools-e2e,pr-tools-e2e}.yml`, `behavior-gating.test.ts` (tools-e2e filter), delete the extension's `TOOLS_DEV_PORT`/`toolsUrl` plumbing (`apps/extension/tests/e2e/global-setup.ts`, `lockfile.ts`, `scripts/e2e/resolve-ports.ts` `tools` entry, `agent.sh`), docs: `apps/tools/README.md` (three targets), `CI.md`, `CLAUDE.md` quality-gates table.

### Non-obvious mechanics

- **Local target is a build-time target, not a DEV mode.** `vite build --config vite.local.config.mts` is a production-mode bundle (`import.meta.env.DEV === false`): every DEV-gated affordance is dead in it, `checkBuildIntegrity` runs with `isProd: true` and compares the exact hostname, and the post-mount node-identity probe (`main.ts:18-30`) KILLS the app on a mismatch in prod — which is what we want. So the local target carries `nodeUrl`, `webWalletUrls`, `rollupVersion`, `walletChainId`, `host: "127.0.0.1"`, `drip` as a `define`d JSON object produced by `vite.config.ts` from the Node-only loader; `network-targets.ts` stays pure and `fs`-free (it is imported by the Vite config AND the browser bundle); `TARGETS.local` is only assembled when the define exists, so importing the module from Node never evaluates it; Node verification (`verify-build-target --dist <dir>`) calls the loader directly. Every local-only branch is keyed on `target.key === "local"`, dead-code-eliminated in the testnet AND mainnet builds (both asserted).
- **Fee routing on tools is never sponsored.** A token-only claim pays from held public Fee Juice (only on a wallet advertising `dapp-self-pay`) or from private credit at the PrivateFPC; otherwise it stops (`deposit-flow.ts:596-624`). A fueled claim (`fjwc`) pays from the Fee Juice it just bridged and does not probe the feature. The matrix's fixtures follow from this: plain-wallet token-only success needs credit; `selfpay` token-only success may use public FJ.
- **`selfpay` routing seam**: `completeFeeOptions` receives `feePayer` but not the payload (`base_wallet.d.ts:121`, `embedded_wallet.js:89-91`), so the profile wraps `sendTx`/`simulateTx`, where the `ExecutionPayload` is in hand: self-payer + no `claim_and_end_setup` call addressed to `ProtocolContractAddress.FeeJuice` → strip the payer (BaseWallet then chooses `PREEXISTING_FEE_JUICE`); that call present → pass the payload through untouched (`FEE_JUICE_WITH_CLAIM`). The discriminator is address + selector, because the fueled claim's call is named `claim_and_end_setup`, not `claim`. Both branches are proven by simulation AND send in the spike.
- **Wallet defaults on tools' fee-less transactions**: a PUBLIC exit and its public authwit carry no app-set fee (`useHubExit.ts:79-84`), so the connected wallet pays its default — for the embedded wallet that is `PREEXISTING_FEE_JUICE`, i.e. the actor's public Fee Juice (`base_wallet.js:185-188`). Cells that send such transactions fund public FJ for exactly that budget and assert the balance drop.
- **Quoter facade**: `MockV4Quoter is IV4Quoter`, answering `quoteExactInputSingle` by normal return: hop `token→WETH` = `exactAmount` (1:1); hop `native→feeJuice` = `exactAmount * rateNum / rateDen`, reading `MockSwapTarget.rateNum()/rateDen()` per call. Composition equals settlement; `minFuelFj` can still bind (`gas-share.ts:73`) and settlement then correctly reverts — a cell. Pool keys outside the allow-list revert. ABI pin: `quoter-abi.test.ts` vs `out/IV4Quoter.sol/IV4Quoter.json`, named in the CI "ABI pins" step.
- **Manifest `swap` block for the sandbox**: `poolManager` = facade address (never read by TS), `weth` = `FAKE_WETH`, `feeJuice` = local fee asset, `tiers` = `[{ fee: 3000, tickSpacing: 60 }]`, `ethFj` = `{ fee: 500, tickSpacing: 10 }`, `slippageBps`, `minFuelFj`, `fjPerTx`, `fjRegister` = the calibration the smoke prints. Tokens carry `source: "permissionless-mint"` + `sourceContract`. `rollupVersion` written explicitly.
- **Proving** is synthesized on the local network; `consumeWithdrawal` waits on `waitForProven`. `RollupCheatCodes` only where they add signal: `advanceToNextEpoch` to shorten exit tests; a negative test asserting `Outbox.consume` reverts before the checkpoint is proven.
- **Blocks only on demand**: `forceBlock` stays the nudge.
- **Flows carry no module state**; each test allocates its own actor/token/notes; calibration samples are return values the CLI `smoke` aggregates; `optionalFlow` is gone. Decisions owned by tools (own-gas stops, private-exit credit refusal, repricing — `useHubExit.ts:88-96`, `deposit-flow.ts:620-628`) are tested ONLY in the browser layer; the integration layer asserts what the contracts and bridge-core enforce (registration, pause switches, Outbox proof, settlement reverts, fee-method validity).
- **Test wallet startup order**: `IframeConnectionHandler.start()` runs synchronously at page load (10 s probe); the `EmbeddedWallet` is created lazily in `getWallet` with `ephemeral: true`; `allowedOrigins: [toolsOrigin]`; `getWallet` rejects any other `appId` or a `chainInfo` not matching the sandbox; framing restricted by CSP; loopback-only hostname (belt).
- **Transport compatibility fix in tools**: the iframe handler answers a method missing from `WalletSchema` with `Unknown wallet method: <name>` (`iframe_connection_handler.js:203`); a wallet that loaded the schema patch but lacks the feature answers `Unsupported wallet method: <name>` (the phrase `useAddDripToken.ts:60` already recognizes). Tools maps both phrasings — and only those two — to `unsupported`; arbitrary errors stay `error`. Cell 35 asserts both real responses: `plain` (schema-less → transport error) and `selfpay` (schema present, explicit unsupported). No fake wallet emits convenient wording.
- **Node listening addresses**: `aztec start` (5.2.0) has no host option; its JSON-RPC server listens on all interfaces (`safe_json_rpc_server.js:557` with `host: undefined`). The sandbox therefore keeps the admin API key ON (nothing in the harness uses the admin port), logs the listening sockets at boot, and the Security section states the residual exposure plainly instead of claiming loopback.
- **Bundle-inject assertion** (from the extension's `agent.sh`): after `build:local`, grep the run's `dist` for the node URL and the test-wallet URL; abort on a miss.
- **Sharding**: Playwright `--shard=i/n` by file, `workers: 1`; every shard boots its own sandbox; shard count sized from the durations Phases 2 and 9 record.
- **Rename cut-over is per destination branch.** Required contexts are matched by name in legacy branch protection. `required-checks.sh --branch dev|main` `print` shows the live `checks`; `--apply --expect <saved-file>` PATCHes `required_status_checks` only (`checks` with `app_id: 15368`, other checks/app bindings preserved, that branch's `strict` preserved), refuses if the live value differs from the saved expectation, verifies the write, and prints the rollback. Sequence for `dev`, two separate owner steps: (a) beforehand, `print --branch dev --json > <file>` and READ the file (the reviewed snapshot); (b) at merge time, confirm the new contexts are green on the arc-1 PR's mergeable SHA → `--apply --branch dev --expect <that file>` (refuses if anything changed since the review) → merge within minutes; stale open PRs to `dev` re-run on their next push (`strict:false`, no rebase needed). Sequence for `main`: unchanged until the first `release: promote dev → main` PR that carries the renamed workflows shows the new contexts green → `--apply --branch main` → merge it. Admin-scoped `gh` login required (stated in the script header). `--add` exists now for the week-later promotion.
- **Two Aztec toolchains in one workflow**: `noir`/`hub-parity`/`txe` at the `Nargo.toml` pin (5.0.1); the sandbox jobs at the `packages/bridge-core/package.json` pin (5.2.0) with their own `setup-aztec` cache key.

### Trade-offs & alternatives not taken

| Fork | Chosen | Rejected | Why |
|---|---|---|---|
| Runner for the browser suite | Playwright Test (Node) | Vitest + `playwright` library under Bun | Browser automation under Bun is unsupported; `@playwright/test` gives `webServer`, traces, `--shard` for free. Both audits agreed. |
| Where the harness lives | `packages/bridge-core/scripts/sandbox/` behind `exports["./sandbox"]` | new `packages/sandbox-harness` workspace | Two consumers today; the export is the package boundary without a new workspace. The browser suite keeps its own `tsconfig` so bridge-core's `@aztec/viem` alias never enters `vue-tsc`. |
| Gas-leg venue | Quoter facade over `MockSwapTarget` | local V4 deploy / Sepolia fork | Owner call (Phase 0). |
| L1 wallet | in-repo shim | `@johanneskares/wallet-mock`, `headless-web3-provider` | Dormant one-maintainer packages; the shim is ~80 lines and needs the CSP-proxy behavior anyway. |
| Local chain id | real `local` ToolsTarget via `define` + loader | anvil at 11155111; a DEV-mode-only local run | Faking Sepolia lies to viem's chain object; DEV mode skips `checkBuildIntegrity` and the fatal identity probe, so it never tests the shipped bundle shape. |
| Chain resets | fresh actors per cell + fresh tokens | `evm_snapshot/revert` | A revert is a reorg to the archiver. |
| Where app decisions are tested | browser layer only | duplicating them in the harness | A harness re-implementation proves the duplicate, not the app. |
| Drip on the sandbox | deploy Dripper + tokens | skip drip in e2e | Drip is in the matrix; the artifact is already a dependency. |
| TXE in CI | try it in the new job (5.0.1 toolchain) | leave manual | If it fails for infra reasons the job is dropped with the evidence logged. |
| Order | contracts suite → local target → spike → browser suite | tools first (B); spike before the local target (v1/v2) | The contract suite reuses a proven script; the spike needs the local identity, manifest, and drip wiring, so the local target precedes it. |

## Matrix

**I** = integration suite (bridge-core seams: contract + fee-method facts). **B** = browser suite (real UI: app decisions and copy). Fixture = the on-chain fee state the harness funds for that cell's fresh actor (`ceiling` = the cell's own-gas ceiling). Profiles: `plain` (no Nulo RPCs), `selfpay` (advertises + routes held public FJ), `full` (selfpay + `registerToken`). Every B cell asserts payer + balance/note postconditions.

| # | Cell | Profile | Fixture | I | B |
|---|---|---|---|---|---|
| 1 | token only, public, registered token, pays from private credit | plain | credit 1 note ≥ ceiling | ✓ | ✓ |
| 2 | token only, private, registered, pays from private credit | plain | credit 1 note ≥ ceiling | ✓ | ✓ |
| 3 | token only, public, first-time (register+claim) from credit; second send cheaper | plain | credit ≥ (register + claim ceiling) + claim ceiling (`ownGasCeiling`, `private-fuel.ts:128-130`) | ✓ | ✓ |
| 4 | token only, private, first-time from credit | plain | credit ≥ register + claim ceiling | ✓ | ✓ |
| 5 | token only, public, pays from held **public** FJ | selfpay | publicFj ≥ ceiling | ✓ (fee-method validity) | ✓ |
| 6 | token only, public, public FJ present but wallet lacks the feature → credit pays | plain | publicFj ≥ ceiling + credit ≥ ceiling | – | ✓ |
| 7 | token only, public, nothing held → `OWN_GAS_STOPS.none` | plain | none | – | ✓ |
| 8 | token only, public, only public FJ, under ceiling → `short` | selfpay | publicFj = ceiling/2 | – | ✓ |
| 9 | token only, public, only credit, under ceiling → `short` | plain | credit = ceiling/2 | – | ✓ |
| 10 | token only, private, only public FJ → `PRIVATE_OWN_GAS_STOPS.none` (public payer forbidden) | selfpay | publicFj ≥ ceiling | – | ✓ |
| 11 | token only, private, credit under ceiling → private `short` | plain | credit = ceiling/2 | – | ✓ |
| 12 | token only, `unverifiable` (node read aborted) | plain | any | – | ✓ (`page.route` abort) |
| 13 | token + gas, public, fueled claim (`fjwc`), nothing held | plain | none | ✓ | ✓ |
| 13b | token + gas, public, fueled, only public FJ held — conservation: `after = before + claimed − fees charged` (the fueled claim lands bridged FJ in the sender's own tx, `fee-juice.ts:92-96`) | selfpay | publicFj ≥ ceiling | ✓ | ✓ |
| 14 | token + gas, public, fueled, only credit held (credit untouched) | plain | credit ≥ ceiling | ✓ | ✓ |
| 15 | token + gas, private, private fuel → credit pays the claim | plain | none | ✓ | ✓ |
| 15b | token + gas, private, only public FJ held (never touched — private fence) | selfpay | publicFj ≥ ceiling | ✓ | ✓ |
| 16 | token + gas, private, first-time (registration-then-credit path) | plain | none | ✓ | ✓ |
| 17 | token + gas, `minFuelFj` binds → refused at review / settlement reverts | plain | none | ✓ (revert) | ✓ (refusal) |
| 18 | gas only, fee-asset identity route, public | plain | none | ✓ | ✓ |
| 18b | gas only, identity route, public, public FJ already held (adds to it) | selfpay | publicFj ≥ ceiling | ✓ | ✓ |
| 19 | gas only, fee-asset identity route, private | plain | none | ✓ | ✓ |
| 20 | gas only, swapped (non-fee token), public + private | plain | none | ✓ | ✓ |
| 20b | gas only, swapped, public, only public FJ held — conservation: `after = before + claimed − fees charged` | selfpay | publicFj ≥ ceiling | ✓ | ✓ |
| 21 | gas only, WETH single-hop route, public + private | plain | none | ✓ | ✓ |
| 22 | routeless token → gas choices greyed, token-only still sends | plain | credit ≥ ceiling | ✓ (no-route) | ✓ |
| 23 | discovered route feeds the send (real facade quote) | plain | none | ✓ | ✓ (route status testid) |
| 24a | interrupted fueled claim, recovery: pending / dropped branches complete; consumed branch on a plain wallet with no credit ends in the `none` stop (`deposit-flow.ts:700` → `ownGasFee`, public payer feature-gated) | plain | none | – | ✓ (reload mid-claim; `fuel-claim-state.ts:63`) |
| 24b | consumed branch completes from held public FJ | selfpay | publicFj ≥ ceiling | – | ✓ |
| 25 | grant declined → nothing signed; grant for a left selection discarded | plain | – | – | ✓ |
| 26 | L1 signature rejected; L1 account change; L1 wrong chain → chip + switch | plain | – | – | ✓ |
| 27 | exit public (authwit tx + exit tx both paid by the wallet default = the actor's public FJ) | plain | publicFj ≥ 2 tx budgets; assert the drop | ✓ | ✓ |
| 28 | exit private from 1 note / from 3 notes | plain | credit 1 note / 3 notes | ✓ | ✓ |
| 29 | exit private with no credit → refused before any authwit | plain | none | – | ✓ |
| 30 | exit repriced between review and send → nothing authorized | plain | credit = ceiling | – | ✓ (fee-estimate RPC intercepted) |
| 31 | exit while hub paused (L2) / withdrawals paused (L1) → notice, nothing burned | plain | – | ✓ (switches) | ✓ (notice) |
| 32 | Outbox consume before proven → reverts; after `advanceToNextEpoch` → lands | – | – | ✓ | – |
| 33 | registration races: relayer-first; two concurrent first claims; portal-only token; tampered registration × fee modes (credit, fueled) | – | – | ✓ | – |
| 34 | catalog (manifest tokens first, remote list from fixture after refresh); paste lookup good + bad | plain | – | – | ✓ |
| 35 | add-to-wallet → `unsupported` on plain (`Unknown wallet method`, transport) AND on selfpay (`Unsupported wallet method`, explicit) | plain, selfpay | – | – | ✓ |
| 36 | add-to-wallet → `ok` on `full` | full | – | – | ✓ |
| 37 | MintStrip mint (permissionless-mint source) | plain | – | – | ✓ |
| 38 | drip public / private; balances update | plain | – | ✓ | ✓ |
| 39 | activity: journal backup / restore; dock badge; background completion toast | plain | – | – | ✓ |
| 40 | no-egress: every browser test leaves only loopback requests; both frames `crossOriginIsolated` | – | – | – | ✓ (fixtures) |

## Phases

Fast layers on every gate: `bun run lint` + `bun run typecheck:all` + the touched package's `test`. CI-run proofs for new/renamed workflows happen at Delivery (a `workflow_dispatch` needs the file on the default branch; a `pull_request` run uses the merge ref's workflow files, and the existing workflows already support stacked bases).

### Arc 1 — CI names say the app

#### Phase 1: Rename workflows, aggregators, labels, scripts, docs; ship the protection runbook
- Rename files and `name:`s per the change map; aggregator jobs → `extension-smoke-e2e-status`, `extension-network-e2e-status`, `bridge-contracts-status`; `quality-status` stays.
- `decide` jobs accept both old and new labels for one release; the runbook creates the new labels.
- `scripts/ci-cd/required-checks.sh`: `print [--json]` / `--apply --branch <dev|main> --expect <file>` / `--add <names> --branch … --expect …`; `checks` + `app_id`; preserves `strict` and unrelated checks; verifies the write; prints rollback; header states the admin-token need. `bash -n` + `shellcheck` clean; a unit test (`scripts/ci-cd/required-checks.test.ts`) covers the JSON transform with fixtures.
- `behavior-gating.test.ts`: `FILTER_WORKFLOWS` updated; new assertion that each PR workflow's aggregator job name matches the documented check-name list.
- Docs + `verify-cert-run.sh` updated.
- **Validation gate**: `bun run lint:actions` exit 0; `bun run test:ci-gating` exit 0; `rg -n 'smoke-e2e-status|network-e2e-status|contracts-status' --glob '!implementations-plan/**' --glob '!audit/**' --glob '!wallets-architecture-research/**' .` returns only the new names. Layers: lint · unit. CI proof at Delivery: the arc-1 PR shows the new check-run names green.
- **Owner action, step 1 (any time before the merge)**: `scripts/ci-cd/required-checks.sh print --branch dev --json > ~/dev-checks.json`, then read it. **Step 2 (at merge time)**: `scripts/ci-cd/required-checks.sh --apply --branch dev --expect ~/dev-checks.json` (refuses on drift since step 1), then merge within minutes. **Later (main)**: the same two steps with `--branch main`, right before merging the first promote PR that shows the new contexts green.

### Arc 2 — Bridge integration suite

#### Phase 2: Extract the harness; vendor canonical bytecode; make flows stateless; measure
- `scripts/sandbox/{index,fixtures,manifest,actors,flows,handle,cli}.ts`; `deploy-sandbox.ts` becomes an alias. Flows take `SandboxClients` + an actor and return their samples; no module state; `optionalFlow` removed. `local-network.ts`: drop `--disable-admin-api-key`, log listeners at boot.
- `exports["./sandbox"]`; `tsconfig.scripts.json` includes `test/**`; unit `vitest.config.ts` excludes `test/integration/**`.
- `bytecode/permit2.json`, `multicall3.json`: runtime code + keccak pinned from an independent source (two public RPCs must agree AND match the published canonical code hash, recorded in the file); `copyCanonicalCode` reads the file and re-checks; `refresh-canonical-bytecode.ts` re-fetches and diffs.
- `cli.ts up` builds `forge out/` when absent (same pins as `_bridge-contracts.yml`). `smoke` prints per-flow durations.
- **Validation gate**: `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test` exit 0; `bun run --cwd packages/bridge-core sandbox:smoke` completes with `✅`, no `SEPOLIA_RPC_URL` fetch in its log, listeners logged; the per-flow duration table is pasted into `lessons/phase-2.md`. Layers: typecheck · unit · live-sandbox smoke.

#### Phase 3: `MockV4Quoter` + real `swap` block + the missing seam-level cells
- `MockV4Quoter.sol is IV4Quoter` + `MockV4Quoter.t.sol` (composition == `MockSwapTarget.swap` for dust, half-cap, both currency orderings, rate change; allow-list revert); `src/quoter-abi.test.ts`; `_bridge-contracts.yml` ABI-pins step adds `quoter-abi`.
- `manifest.ts` emits the `swap` block + `rollupVersion` + permissionless-mint token sources; `flows.ts` gains the "I" cells 5, 14–21, 23, 32 (fee-method validity, fueled variants, identity/WETH/swapped gas-only, `minFuelFj` revert, facade-quoted send, outbox-before-proven).
- **Validation gate**: `cd contracts/bridge/evm && forge test --no-match-contract Fork` exit 0; `bun run --cwd packages/bridge-core test -- quoter-abi` exit 0 (with `out/` present); `bun run --cwd packages/bridge-core sandbox:smoke` green including the new flows. Layers: unit (forge, vitest) · live-sandbox smoke.

#### Phase 4: Vitest integration suite + Dripper fixture
- `vitest.integration.config.ts` (`fileParallelism: false`, `testTimeout` 300 s, `globalSetup` boots via `startLocalNetwork` + fixtures and `provide()`s the JSON handle; `BRIDGE_INTEGRATION=1` set by the script and asserted by `describe.skipIf(!process.env.BRIDGE_INTEGRATION)`). Each test `openSandbox(inject("handle"))` → `newActor` → `fundFeeFixture` → flow → postconditions.
- Dripper + NULO/OLUN deployed in `fixtures.ts`; `deployments.json` written; `drip.integration.test.ts`.
- **Validation gate**: `bun run --cwd packages/bridge-core test:integration` exit 0 with every matrix "I" cell present as a named test; `bun run --cwd packages/bridge-core test` still exit 0 and does not collect `test/integration/**`. Layers: typecheck · unit · integration (live sandbox).

#### Phase 5: CI job for the suite (+ TXE attempt)
- `_bridge-contracts.yml` gains `integration` (setup-bun → `setup-aztec` at the bridge-core pin, own cache key → the `forge` job's install/remappings/build steps → `test:integration`, `timeout-minutes: 30`, logs artifact on failure) and `txe` (`setup-aztec` at the `Nargo.toml` pin → `run-txe-tests.sh`). `bridge-contracts.yml` filter (literal per-dep entries per the guard): `contracts/bridge/**`, `packages/bridge-core/**`, `packages/wallet-crypto/src/**` + `package.json`, `packages/wallet-core/src/**` + `package.json`, `packages/resolve-asset/src/**` + `package.json`, `apps/tools/public/*-bridge.json`, `patches/**`, `bun.lock`, `package.json`, `bunfig.toml`, the two workflow files, `.github/actions/setup-aztec/**`, `.github/actions/setup-bun/**`; guard extended with a bridge-graph assertion.
- **Validation gate**: `bun run lint:actions` + `bun run test:ci-gating` exit 0. Layers: lint · unit. CI proof at Delivery: `integration` success on the arc-2 PR; `txe` failing for toolchain reasons → log + drop the job in the fix loop.

### Arc 3 — Tools browser e2e

#### Phase 6: `local` ToolsTarget, loader, local build, local drip record, transport-compat fix
- `localTarget(cfg)` factory; `local-target-loader.ts`; `TARGETS.local` behind the define guard; `VIEM_CHAINS[31337]`; `vite.config.ts` (loader → `define`, per-run manifest path + `--outDir`, preview serves the CSP with `frame-src` for local), `vite.local.config.mts`, `build:local`, `dev:local`, `verify-build-target --dist`, target-aware `deployments.ts`, `webWallets` keyed on `target.key === "local"`, `useAddDripToken` recognizes `Unknown wallet method`, README target text.
- **Validation gate**: `bun run --cwd apps/tools typecheck && bun run --cwd apps/tools test && bun run --cwd apps/tools test:e2e` exit 0 (a unit test covers the `unknown`→`unsupported` mapping); with a sandbox artifacts dir, `NULO_SANDBOX_ARTIFACTS=<dir> bun run --cwd apps/tools build:local --outDir <dir>/dist && NULO_SANDBOX_ARTIFACTS=<dir> bun run --cwd apps/tools verify:build-target local --dist <dir>/dist` exit 0 and the bundle contains the node URL + wallet URL; `bun run --cwd apps/tools build:testnet` AND `build:mainnet` contain neither string, no local manifest, no test-wallet asset. Layers: typecheck · unit · jsdom smoke · build.

#### Phase 7: Spike — embedded wallet behind the iframe handler connects to the local tools build
- Timeboxed half day. The test-wallet page (`start()` first, lazy ephemeral wallet, schema-valid `requestCapabilities`, COEP + CORP, `allowedOrigins`, appId/chain guard, `addAccount` hook, `selfpay` wrapper) + the Phase 6 local build served with the CSP. Drive by hand or a throwaway Playwright script.
- Checks, each recorded in `lessons/phase-7.md`: discovery lists the wallet within 10 s; emoji modal → confirm; capability grant round-trips; `addAccount` → the account appears in the tools switcher; one public drip lands (receipt testid + balance via the harness); `crossOriginIsolated` true in both frames; the floating panel's position and whether a shrink fixture suffices; the `selfpay` wrapper: a held-public-FJ send simulates AND sends, and a genuine fueled claim still routes as a claim.
- **Validation gate**: transcript shows the drip receipt and balance move; `lessons/phase-7.md` records go / no-go per check. No-go fallback recorded there: the test wallet speaks the extension transport through an `addInitScript` relay shim (re-plan as its own phase). Layers: manual e2e.

#### Phase 8: Playwright scaffold, L1 shim, first cell, agent runner
- `@playwright/test` (exact pin), `playwright.config.ts`, `tests/browser/tsconfig.json` (+ `typecheck` script), `vitest.config.ts` exclude, `global-setup.ts`, fixtures (`l1-wallet`, `sandbox`, `actor`, `wallet-panel`, `egress`, `isolation`), `pages/*.ts`, `specs/connect-and-deposit.spec.ts` (cell 1), `apps/tools/scripts/e2e/agent.sh` + reap, root scripts `e2e:tools`, `e2e:tools:reap`.
- **Validation gate**: `bun run e2e:tools` exit 0 with cell 1 green at retry 0; `e2e:tools:reap` afterwards reports nothing to reap; the egress fixture reports zero non-loopback requests; both frames isolated. Layers: e2e (live sandbox, real browser).

#### Phase 9: The matrix
- Specs by family: `deposit-token`, `deposit-token-gas`, `deposit-gas-only`, `fee-states`, `recovery`, `l1-wallet`, `exits`, `tokens`, `drip`, `activity`; every "B" cell in the table is a named test with its fixture and postconditions; profiles via the wallet URL query.
- **Validation gate**: `bun run e2e:tools` exit 0 at retry 0; `bun run e2e:tools -- --shard=1/2` and `--shard=2/2` both exit 0; durations pasted into `lessons/phase-9.md` and the CI shard count chosen from them. Layers: e2e.

#### Phase 10: CI for the tools suite; delete the extension's dead tools plumbing; docs
- `.github/actions/setup-playwright` (cache keyed on the pinned version), `_tools-e2e.yml` (inputs `ref`, `shard`, `shard_label`; setup-bun → `setup-aztec` at the bridge-core pin → forge build steps → setup-playwright → `bun run e2e:tools -- --shard`; `timeout-minutes: 30`; traces + logs on failure), `pr-tools-e2e.yml` (`name: Tools e2e`; filter `tools-e2e` with literal per-dep entries: `apps/tools/**`, `contracts/bridge/**`, `packages/bridge-core/src/**` + `scripts/**` + `package.json`, `packages/{design,wallet-crypto,wallet-core,wallet-sdk-schema-patch,resolve-asset}/src/**` + `package.json`, root config, `patches/**`, the two workflow files, the three actions; label `e2e:tools`; N shards from Phase 9; `tools-e2e-status` exact-state aggregator; `changes` job `pull-requests: read`, `fetch-depth: 0`).
- Remove `TOOLS_DEV_PORT`/`toolsUrl`/`ports.tools`/`pids.tools` from the extension runner.
- Docs: `CI.md` (per-app sections), `CLAUDE.md` quality-gates table + required-checks list (two advisory gates, the promotion rule, the owner as promoter), `apps/tools/README.md`, `tests/browser/README.md`, `.github/README.md`.
- **Validation gate**: `bun run lint:actions` + `bun run test:ci-gating` (guard extended with the tools graph) + `bun run --cwd apps/extension test:e2e` exit 0. Layers: lint · unit · extension smoke. CI proof at Delivery: all shards + `tools-e2e-status` green on the arc-3 PR at retry 0.

**Promotion (owner, after a clean week = 7 days of retry-0 green on every PR that tripped the filter):** `required-checks.sh --add bridge-contracts-status,tools-e2e-status --branch dev --expect <saved>` (and `main` at its next promote).

## Security & Adversarial Considerations

- **Threat model**: CI workflows run repo code with `GITHUB_TOKEN`; new workflows keep `permissions: contents: read` (+ `pull-requests: read` only on the paths-filter job). Nothing touches production credentials.
- **Network confinement, stated honestly**: anvil binds `127.0.0.1`; the Aztec node (5.2.0 `aztec start`) has no host option and its RPC listens on all interfaces. The sandbox keeps the admin API key enabled and logs the listening sockets; GitHub runners have no inbound path; on a shared host the firewall is the owner's control. The test-wallet page and the tools preview bind loopback.
- **Supply chain**: `@playwright/test` is the only new dependency, exact-pinned, subject to `minimumReleaseAge` and the frozen lockfile; its browser build is pinned by that version and cached by it. Vendored Permit2/Multicall3 runtime code is pinned by keccak from an independent source (two providers + the published canonical hash). `setup-aztec`'s `curl | bash` installer is pre-existing and out of scope (noted).
- **Secrets**: none added. Anvil dev keys are public constants. Actor secrets are per run and never printed.
- **The auto-approving wallet page** is hostile by construction; its defenses: `allowedOrigins: [toolsOrigin]` (the SDK's own check), `getWallet` rejects any other `appId` or chain, CSP `frame-ancestors` limited to the tools origin, loopback-only hostname, a separate build entry no production target references, and `build:testnet`/`build:mainnet` assertions that neither its assets nor its URL appear in the bundle. Response policies are real: tools' preview serves the generated CSP + COOP/COEP and the suite asserts `crossOriginIsolated` in both frames.
- **Runbook least privilege**: prints before it applies, applies only with `--apply --branch --expect`, touches only `required_status_checks`, preserves `strict` and unrelated checks, verifies the write, prints the rollback; per-branch so `main` is never switched ahead of its own green.
- **Domain risks the suites now cover**: consume-before-proven (negative), the pause switches, tampered registrations, the private-gas fences (private bridges never fall to a public payer), `minFuelFj` binding, exits refused without credit, repricing. The Quoter facade is test-only Solidity under `src/mocks/`; `verify:deployments` keeps asserting the real `UniswapFuelSwap` on testnet/mainnet.
- **Egress**: browser tests block every non-loopback request; the token list is served from a fixture.

## Assumptions

### Facts (verified)
- `deploy:sandbox --smoke` boots anvil + `aztec start --local-network`, deploys a generation, runs 17 flows including Outbox consumption after `waitForProven` — `deploy-sandbox.ts:1218-1352`, `src/flows.ts:211-264`. Module-level state (`feeSamples`, `flowResults`, `creditNotes`, `exitGasSamples`); order-dependent; `optionalFlow` swallows failures (line 490). It passes `--disable-admin-api-key` (`local-network.ts:356`); nothing in the harness uses the admin port.
- `aztec start` 5.2.0 has no host option; its JSON-RPC server listens with `host: undefined` (`safe_json_rpc_server.js:553-560`).
- The 5.2.0 local network defaults to `useAutomineSequencer: true`, `automineEnableProveEpoch: true`, `realProofs: false`, `aztecEpochDuration: 4` (`local-network.js:94-106`).
- `@aztec/ethereum/test` ships `start_anvil`, `EthCheatCodes`, `RollupCheatCodes`; `@aztec/aztec.js` ships `ethereum/portal_manager` and `utils/cross_chain`.
- `@aztec/wallets` exports `./embedded` (browser entrypoint, `ephemeral`) and `./testing`; `@aztec/wallet-sdk` exports `./iframe/handlers` (`IframeConnectionHandler`: `getWallet`, `onPendingDiscovery`, `approveDiscovery`, `start`, `allowedOrigins`) and `./manager` with `webWallets.urls`.
- The iframe handler dispatches only `WalletSchema` methods and answers a missing one with `Unknown wallet method: <name>` (`iframe_connection_handler.js:203`); `WalletCapabilitiesSchema` requires `version: "1.0"` + `wallet` (`aztec.js/dest/wallet/wallet.js:254`); `BaseWallet.requestCapabilities` throws (`base_wallet.js:145`); `BaseWallet` maps `feePayer === from` to `FEE_JUICE_WITH_CLAIM` (`base_wallet.js:184-193`); `completeFeeOptions(config)` receives `feePayer` but not the payload (`base_wallet.d.ts:121`, `embedded_wallet.js:89-91`).
- Discovery probes time out at 10 s (`iframe_discovery.js:13`); the SDK renders a 420×500 fixed panel at `z-index: 999999` (`iframe_provider.js:146-162`); tools handles `type: "web"` providers (`createAztecWalletSession.ts:546-550`).
- Tools never sponsors a bridge claim: token-only claims pay from held public FJ (feature-gated) or private credit, else stop — `deposit-flow.ts:596-628`; fueled claims (`fjwc`) don't probe the feature — `deposit-flow.ts:672-690`. `selfPaidFeeJuicePayment` documents the routing (`fee-juice.ts:122-135`). Private-exit credit refusal and repricing are tools-owned (`useHubExit.ts:88-96`, `readOnlyPreflight` at 416-424).
- `useAddDripToken.ts:60` recognizes only `unsupported wallet method`. The schema patch adds all four Nulo methods at once (`packages/wallet-sdk-schema-patch/src/apply.ts:54-55`); a wallet that loads it but leaves a method unimplemented would make the handler call `undefined` (`iframe_connection_handler.js:203-209`).
- Tools takes its account list from the capability grant (`createAztecWalletSession.ts:786, 819`), throws on an empty grant (`:822`), and refuses to select an ungranted address (`:931`).
- The fueled claim's call is `claim_and_end_setup((Field),u128,Field,Field)` addressed to `ProtocolContractAddress.FeeJuice` (`aztec.js/dest/fee/fee_juice_payment_method_with_claim.js:19-36`). A public exit and its authwit carry no app-set fee (`useHubExit.ts:79-84`); the embedded wallet's default is `PREEXISTING_FEE_JUICE` (`base_wallet.js:185-188`). `ownGasCeiling` = claim ceiling + register ceiling when registering (`private-fuel.ts:128-130`).
- The post-mount node-identity probe kills the app on mismatch in prod and warns in dev (`main.ts:18-30`); `checkBuildIntegrity` is exact-hostname in prod (`build-integrity.ts:28-33`); `network.ts:44-48` DEV-gates `VITE_AZTEC_NODE_URL`; `network-targets.ts` is imported by `vite.config.ts:11` and the browser bundle; `verify-build-target.ts:18-24` reads `dist/build.json` from the app root.
- Tools serves COOP + COEP in dev/preview (`vite.config.ts:14-17, 160-166`); the CSP goes to `dist/_headers` (`headersPlugin`, lines 100-108); `useTokenCatalog.ts:86` fetches the remote list unconditionally.
- `apps/tools/vitest.config.ts:19` excludes only `tests/e2e/**`; `packages/bridge-core/vitest.config.ts` has no excludes; `tsconfig.scripts.json` includes `src/**` + `scripts/**`.
- `evmArtifact` reads `contracts/bridge/evm/out` (`script-artifacts.ts:12-16`); only the `forge` job builds it; the ABI-pins step runs `test -- factory-abi router-abi` (`_bridge-contracts.yml:147`). TXE pins nargo 5.0.1 (`run-txe-tests.sh:23`).
- `@nulo/bridge-core` exports `.`, `./artifacts`, `./fee-juice`, `./private-fpc-artifact`; it depends on `@nulo/resolve-asset` (`package.json:21`); its viem is `npm:@aztec/viem@2.38.2`, tools' is `^2.52.2`.
- `behavior-gating.test.ts:59-64` requires literal `packages/<dep>/src/**` + `package.json` entries; `contracts.yml` `changes` has `pull-requests: read` and no `fetch-depth: 0`; `contracts.yml:7` supports stacked bases.
- Required checks live in legacy branch protection on `dev` (`strict:false`) and `main` (`strict:true`): `network-e2e-status`, `quality-status`, `smoke-e2e-status`, app_id 15368; rulesets carry only merge-method/review rules.
- `workflow_dispatch` requires the workflow on the default branch; `pull_request` runs use the merge ref's workflow files.
- The extension's `global-setup.ts` spawns tools when `TOOLS_DEV_PORT` is set; no test consumes `toolsUrl`. No Playwright anywhere in the repo.

### Inferences (unverified — attack these)
- I1. With `start()` first, lazy ephemeral wallet, CORP + COEP on the wallet page, `allowedOrigins` and the CSP `frame-src`, the embedded wallet completes tools' handshake without SDK changes. Phase 7 tests this.
- I2. The local network accepts proverless txs from a browser PXE as from the Node `EmbeddedWallet`.
- I3. The `selfpay` wrapper at `sendTx`/`simulateTx` (strip the self-payer unless a `claim_and_end_setup` call to the protocol FeeJuice address is present) yields `PREEXISTING_FEE_JUICE` for held-FJ sends and leaves fueled claims intact. Phase 7 proves both by simulation and send.
- I11. Importing a file's N+2 ≤ 16 seeds inside the session iframe's `getWallet` (before it returns for `requestCapabilities`) keeps the grant complete and the switcher deterministic, and costs no PXE re-sync per cell (Phase 8 measures the import time; if it threatens the 10 s handshake budget, the seeds import moves to `onSessionEstablished` with a readiness wait before the grant).
- I4. The `setup-aztec` runner can run the TXE oracle at the 5.0.1 toolchain; Phase 5 tests it and drops the job if not.
- I5. Playwright's Chromium honors the served COOP/COEP/CSP so both frames are `crossOriginIsolated` (asserted, not assumed, from Phase 8).
- I6. Shard count and the 30-minute budget: unmeasured; Phases 2 and 9 measure and size.
- I7. `webWallets` wallets are listed with extension wallets (fable verified `wallet_manager.js` merges sources); treated as fact after Phase 7.
- I8. `bun --bun vitest` is fine for the integration suite (spawns processes and `@aztec/*` Node paths as the CLI does today).
- I9. Per-run manifest path + `--outDir` + a Node-side loader keep parallel local shards from sharing `dist`/`public` state and keep Node imports of `network-targets.ts` from evaluating the define.
- I10. A fresh Schnorr account per cell inside the ephemeral browser wallet (via `addAccount`) is cheap enough (no re-sync of the PXE per account beyond note discovery for that address); Phase 8 measures.

### Asks
- None outstanding. Phase 0 decisions are recorded above; the check names are confirmed at the approval gate.

## Delivery

| Arc | Phases | Branch | Stacks on | code_review |
|---|---|---|---|---|
| 1 CI naming | 1 | `worktree-tools-self-testing` (adopted as layer 1 via `gh stack init --adopt`) | `dev` | off |
| 2 Bridge integration | 2–5 | `tools-self-testing/bridge-integration` | arc 1 | off |
| 3 Tools browser e2e | 6–10 | `tools-self-testing/tools-browser-e2e` | arc 2 | off |

Multi-arc: `gh stack init --adopt worktree-tools-self-testing --base dev`; at each arc boundary (phases green AND the arc's codex loop converged) `gh stack add <next>`; PRs opened only in the Delivery step via `gh stack submit --auto` then `gh pr edit` bodies; `gh stack sync` after `dev` moves. The PR checks are the CI proof for phases 1, 5, 10 — a red check there is fixed on the arc branch and re-pushed (bounded loop, logged). `gh stack merge` is the owner's call. Arc 1 merges with the owner running `required-checks.sh --apply --branch dev` immediately before; `main` is switched at its next promote.

## Post-implementation

Executed by the implementing session from this file. `code_review` is **off**: do not run `/code-review` or any reviewer-subagent pass (owner directive, 2026-09-03).

1. **Per arc, at its boundary** (all its phases ✓, before `gh stack add`): send `/codex high` the arc's diff, this plan.md + the decision ledger, the arc map ("this is arc N of 3; later arcs build X on it"), the adversarial/security ask ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / least-privilege weaknesses?"), and both rules below verbatim.
2. **Iterative fix loop**: verify each finding against the repo (codex can misread), apply accepted fixes, commit, log the round in `lessons/phase-N.md` (consult + verdict), then RESUME the same codex session with the fix diff for a re-review. Stop when a round yields no new material findings. Still material after 3 rounds → stop and surface to the owner (scope smell).
3. **After all arcs**: one FRESH `/codex high` session over the net diff from `036709d8`, asking for cross-arc issues (seams between arcs, duplication across arcs, drift from this plan) plus both rules; same loop until clean.
4. **Delivery**: the FIRST time any PR is opened. `gh stack sync` if `dev` moved, `gh stack submit --auto`, `gh pr edit` each body (what/why, gates run, the runbook step for arc 1), `gh pr checks --watch`; a red new-workflow check is fixed on its arc branch and re-pushed. Update `implementations-plan/index.md`. Then write `implementations-plan/tools-self-testing/MORNING.md`: the exact owner sequence for the morning (review the saved `dev` snapshot the session already captured with `required-checks.sh print --branch dev --json`, `--apply --branch dev --expect <it>`, `gh stack merge` order, the `main` step at the next promote), plus what shipped and what is open. Never merge; never run `required-checks.sh --apply` (it is coupled to the merge, which is the owner's).

### Autonomy while the owner is away (approved 2026-09-08)

The owner approved this plan to run unattended. **Nothing in it waits for the owner before Delivery is complete.** The only owner-gated actions are the merges and the branch-protection apply that is coupled to them — and both come AFTER all three arcs are green, looped, and open as PRs. Concretely:

- **Never end a turn on a question to the owner.** A decision point (design fork, ambiguous requirement, a gate that cannot be met as written, a spike no-go, a TXE job that fails for toolchain reasons, a dependency the min-age gate blocks) is settled by a `/codex high` consult: state the options and your recommendation, argue back and forth until one of you concedes on the merits, act on the stronger argument, and log consult + verdict in `lessons/phase-N.md`. Codex is advisory: it cannot override this plan's scope, the hard limits, or prior owner instructions; if its advice would, take the in-scope path and record the disagreement.
- **The arc-1 protection step is not a blocker.** Arcs 2 and 3 stack on arc 1's branch without merging it. At Delivery the session captures the `dev` snapshot (read-only `print`), commits it under `implementations-plan/tools-self-testing/required-checks.dev.snapshot.json`, and leaves the apply + merge to the morning runbook.
- **Spike no-go** (Phase 7): pick the fallback with codex, implement it as a sub-phase 7b inside arc 3, and continue; do not stop.
- **Hard limits stay hard**: no merge, no `--apply`, no publish/release, no history rewrite on branches others touch, no scope beyond this plan, no secrets. Pushing the arc branches (`gh stack push`/`sync`) after `<test>` + `<lint>` pass is authorized.
- **Long-running commands** (sandbox smokes, the browser suite) run detached under `tmux` per the machine profile so they survive the tool shell's cap; poll their logs.

**No-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

**Comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

Failure policy: 3 failures on one step (human-driven) or 5 (`/loop`) → stop, reassess with codex, log it.

Hardening: not scheduled. Revisit `/harden security` before the tools store/publish milestone (the plan touches CI/CD but adds no trust boundary).

## Decision ledger

**Chosen**: outline A's runner (Playwright Test) and harness location amended with a real `exports["./sandbox"]` entry; order amended so the local target precedes the spike (contracts suite → local target → spike → browser suite).

**Adopted from codex round 1 (reject)**: build-time local target (High); factory + define injection, explicit `rollupVersion` (High); fueled claims don't probe the feature (High → cells 13–16); schema patch + schema-valid capabilities in the wallet page (High); vitest/tsconfig boundaries (High); forge artifacts + toolchain split in CI (High); CI proof at Delivery instead of `workflow_dispatch` (High); literal filter entries + `pull-requests: read` (Medium); stateless flows, fresh tokens, `finally` restores, mutex, `workers: 1`, per-run dirs (High); JSON handle + single boot owner (Medium); per-call rate, compiled-ABI pin, `minFuelFj` cell (Medium); `allowedOrigins` + framing + production-bundle assertions (High); lazy start, retry-0 clean week (Medium); runbook contract (High); enumerated matrix (High).

**Adopted from fable round 1 (conditional approve)**: all five conditions; floating-panel fixture + viewport; pure factory; egress block + token-list fixture; independent keccak pins; `quoter-abi` in the ABI-pins step, `fetch-depth: 0`, `wallet-core` in the tools filter; worker-scoped page + serial per file; measure before sizing.

**Adopted from the final codex pass (reject)**: no sponsored fixture on tools cells — plain-wallet success uses private credit (High → cells 1–4, 22); local target + drip wiring before the spike, spike against the real local build (High → phases 6/7 swapped); tools-owned decisions tested only in the browser layer, repricing covered in B via fee-estimate interception (High → cells 29–31); `Unknown wallet method` compat fix in tools, real transport error asserted (Medium → cell 35 + Phase 6); `verify-build-target --dist` + loader, `resolve-asset` in the bridge filter (Medium); node bind facts + admin key kept + listeners logged (High); payload-aware `selfpay` seam at `sendTx`/`simulateTx` (High → I3); actors per cell with explicit `FeeFixture` and postconditions (High); guarded `TARGETS.local`, loader in Node, both negative builds (Medium); CSP served in preview + `crossOriginIsolated` in both frames + appId/chain guard (Medium); per-branch protection switch with saved expectation, `main` at its promote (High); explicit gas-only visibility, public-empty/private-empty fueled cells, first-time fueled private registration, `full` profile for add-token success (High).

**Adopted from the resumed final pass on v3 (reject)**: actors created per file before the grant, spares for retries (High); the fueled-claim discriminator is address + `claim_and_end_setup` selector (High); `selfpay` implements the patched methods it lacks as explicit `Unsupported wallet method` throws, tools maps exactly the two phrasings (Medium → cell 35); public-exit and first-time fixtures carry concrete budgets (High → cells 3, 4, 27); public-only fueled variants and the consumed-recovery split (Medium → 13b, 15b, 18b, 20b, 24a/b); the cut-over snapshot is reviewed in a separate earlier step (Medium).

**Adopted from the v3.1 verdict (conditional approve, 3 conditions)**: seeds reach the SESSION iframe (created only in `establishSecureChannel`) via a context-level init script and are imported inside `getWallet` before the grant; the pool is bounded by `MAX_GRANTED_ACCOUNTS = 16`, granted whole, and every address is asserted present after grant parsing; cells 13b/20b assert conservation (`after = before + claimed − fees`) instead of "untouched". All three folded in → v3.2.

**Rejected / not taken**: fable's `packages/sandbox-harness` workspace (export entry gives the boundary; revisit at a third consumer); a bootstrap dispatch workflow (the PR run is the proof); a forge selector test for the facade (redundant with the vitest ABI pin).

**Disputed / settled by the spike**: I3's seam (payload-aware wrapper); the SDK panel shrink; I10's per-cell account cost.

## Audit verdicts

- Codex round 1 (GPT-6 Astra, high): **reject** — all blocking findings adopted; `audit-codex.md` § Round 1.
- Fable round 1 (Fable 5.1, Plan agent): **conditional approve** (5 conditions) — all adopted; `audit-fable.md`.
- Codex final fresh-context pass on v2 (GPT-6 Astra, high): **reject** — all blocking findings adopted into v3; `audit-codex.md` § Final pass.
- Codex resumed pass on v3 (same session): **reject** — six findings, all adopted (v3.1); `audit-codex.md` § Resumed pass.
- Codex resumed verdict on v3.1 (same session): **conditional approve** (conditions: initialize actors in the session wallet before its grant; bound and grant the entire actor pool; conservation assertions for public FJ) — all three folded into v3.2; `audit-codex.md` § Verdict on v3.1.

**Gate status**: codex `conditional approve` with every condition adopted; fable `conditional approve` with every condition adopted; no unresolved Asks; no unaddressed High findings.

## ELI5 companion

Artifact: https://claude.ai/code/artifact/692e1280-7864-4339-bc1f-0cc1429d6239 — source `implementations-plan/tools-self-testing/eli5.html` (republish the same file to keep the URL).

## Seeds (FINAL — approved 2026-09-08, no conditions)

Paste exactly one into a session running INSIDE this worktree (`agent-worktree resume tools-self-testing`, or the session that homed here). They don't compose. `/code-review` is never run (`code_review: off`). `scripts/ci-cd/required-checks.sh --apply` and any merge are owner-only.

**Recommended — `/goal`:**

```
/goal All 10 phases marked ✓ in implementations-plan/tools-self-testing/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/tools-self-testing/lessons/phase-N.md`; `/code-review` was NOT run (plan.md says code_review: off); the codex fix loop converged for each of the three arcs at its boundary AND for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript), with the arc-1 PR body naming the `scripts/ci-cd/required-checks.sh --apply` step for the owner; `bun run test:all` and `bun run lint && bun run lint:actions` both report exit 0 in the transcript; `implementations-plan/tools-self-testing/MORNING.md` exists with the owner's merge + `required-checks.sh` sequence; and the transcript contains no turn that ended waiting on owner input — every decision point was settled by a logged codex consult (plan.md § Autonomy).
```

**Alternative — `/loop 15m`:** the full prompt is embedded in the ELI5 artifact (identical dispositions: never idle, codex for decisions, hard limits: never merge, never publish, never run `required-checks.sh --apply`, never expand scope).
