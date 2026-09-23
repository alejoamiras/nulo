# audit-fable.md — Round 1 (plan audit, Fable 5.1 Plan agent, read-only)

Inputs: `plan.md` (outline A, draft 1), `outline-b.md`, `recon.md`. Every factual claim was re-verified against the worktree before adoption; the adopted/rejected log is in `plan.md` § Decision ledger.

---

VERDICT: conditional approve (conditions: (1) gate the local build on `VITE_TOOLS_TARGET === "local"`, not `import.meta.env.DEV` — `build:local` is a PROD-mode bundle; (2) the `selfpay` profile must implement the routing it advertises, not just `getWalletFeatures`; (3) give the harness a real package boundary (`exports["./sandbox"]` or B's package) since Playwright tests must call it; (4) test-wallet page serves COEP+CORP and posts WALLET_READY before PXE init; (5) CI integration job builds forge artifacts.)

## A. Outline A vs B

- **Runner: A is right.** `bun --bun vitest` (CLAUDE.md:48) is the repo's unit runtime; Playwright's browser driver under Bun is unsupported, so B's "one runner" collapses into "vitest on Node for one config", which the extension already does with Puppeteer. `@playwright/test` gives `webServer`, traces, `--shard` for free.
- **Harness location: B is substantively right, A's structure is wrong.** A says Playwright reads `handle.json` but also calls `shapeFeeState` before every flow and needs fresh tokens per file. `packages/bridge-core/package.json:6-11` exports only `.`/`./artifacts`/`./fee-juice`/`./private-fpc-artifact`; `@nulo/bridge-core/scripts/sandbox/*` will fail Node's exports resolution from `apps/tools`. A relative import works but drags bridge-core's `npm:@aztec/viem@2.38.2` into a `vue-tsc` run that includes `tests/**/*.ts` alongside tools' `viem ^2.52.2`. Minimum fix: add `"./sandbox": "./scripts/sandbox/index.ts"` (+ types) to bridge-core exports; B's package is the cleaner version of the same decision.
- **Order: A is right.** The contract suite reuses a proven script; the embedded-wallet handshake is the unproven part and should not gate the cheap signal. But A's Phase 6 spike is under-specified.
- B's "delete deploy-sandbox.ts" is fine either way; keep the CLI thin as A does.

## Findings

**[High][impl] `build:local` kills every DEV-gated affordance.** `network.ts:44` reads `VITE_AZTEC_NODE_URL` only when `import.meta.env.DEV`; `chain-info.ts` URL override is DEV-only; the plan DEV-gates `webWallets`. `vite build --mode x` still sets `NODE_ENV=production` → `DEV=false`. Serving `dist` via `vite preview` yields a bundle that ignores the node URL, has no web-wallet discovery, and runs `checkBuildIntegrity` with `isProd: true` (`build-integrity.ts:31-33`), which rejects hostname `127.0.0.1` against `host: "localhost"`. Fix: key all local behavior on `import.meta.env.VITE_TOOLS_TARGET === "local"` (a `define`, DCE'd identically in testnet/mainnet builds), bake `nodeUrl` and `webWallets` URL into the local target via defines, and set `host` to whatever agent.sh navigates to.

**[High][impl] `selfpay` profile advertises a feature the wallet lacks.** `fee-juice.ts:122-135`: a wallet-sdk `EmbeddedWallet` "routes this same shape as a claim in setup and builds an invalid transaction". Confirmed in `base_wallet.js:184-193`: `feePayer === from` → `FEE_JUICE_WITH_CLAIM`. Tools sends `selfPaidFeeJuicePayment(payer)` (`deposit-flow.ts:591-624`) whenever `walletSupports(...,"dapp-self-pay")`. The profile must override the step that maps `feePayer === from` with no claim call to `PREEXISTING_FEE_JUICE`.

**[High][impl] Test wallet page will not embed or will not be discovered.** Tools' preview/dev serve `COEP: require-corp` (`vite.config.ts:14-17,150-158`). A cross-origin iframe under require-corp must itself send COEP and `Cross-Origin-Resource-Policy: cross-origin`. Discovery (`iframe_discovery.js` `PROBE_TIMEOUT_MS = 10_000`) loads a hidden iframe and waits for WALLET_READY; registering methods "before `start()`" means after a WASM PXE boot — likely >10 s on a cold runner. Call `start()` synchronously, create the wallet lazily in `getWallet`, and use `ephemeral: true` so the probe iframe and the session iframe never contend for the OPFS store.

**[Medium][impl] SDK floating panel intercepts clicks.** `iframe_provider.js:146-162`: a 420×500 `z-index:999999` fixed panel at bottom-right, no close control, for the session's lifetime (tools passes no `container`). Playwright actionability will fail on the dock. Mitigate in a fixture and use a large viewport; Chrome throttles timers in off-screen cross-origin frames.

**[Medium][impl] `LOCAL_TARGET` cannot be a const.** `network-targets.ts` is Node-safe by contract and bundled into the app; `chain-constants.ts` states "no imports". A const sourcing `public/local-bridge.json` breaks the browser bundle or the testnet build. Make it a factory fed by defines; `verify-build-target.ts:18-19` needs the same factory.

**[Medium][impl] "Move, not rewrite" is false for the flows.** `deploy-sandbox.ts:367,473,689,769` keep module-level `feeSamples`, `flowResults`, `creditNotes`, `exitGasSamples`; `runSmoke` is order-dependent on one shared actor. Each file must mint its own notes/deposits. `provide()` needs JSON-serializable values.

**[Medium][ci] Integration job cannot deploy without forge artifacts.** `evmArtifact` reads `contracts/bridge/evm/out` (`script-artifacts.ts:12`), gitignored; only the `forge` job installs Foundry + libs + `gen-remappings`. Add `needs: forge` + artifact download, or repeat the steps with the same pins.

**[Medium][ci] Guard literals and ABI-pin filter.** `behavior-gating.test.ts:59-64` asserts exact `packages/<dep>/src/**` + `package.json` strings; the plan uses `packages/{...}/**` and omits `wallet-core`. The new quoter ABI pin skips without artifacts; `_bridge-contracts.yml` "ABI pins" runs `test -- factory-abi router-abi` only — add the new name. `contracts.yml` `changes` lacks `fetch-depth: 0`.

**[Medium][impl] Quoter facade.** Math is sound: hop1 1:1, hop2 `×rateNum/rateDen` composes to `MockSwapTarget.swap`; `proposeGasShare`/`signedMinFuelOutput` are linear so the floor is met. `IV4Quoter.sol` already declares the exact struct/selector — make `MockV4Quoter is IV4Quoter` and pin `QUOTER_ABI` in vitest against `out/IV4Quoter.sol/IV4Quoter.json`; a forge selector test is redundant. Read the mock's rate per call. Sandbox tokens must be `source: "permissionless-mint"` + `sourceContract` (`manifest-v2.ts:57,166`) or `MintStrip` never renders.

**[Medium][coverage] Egress.** `useTokenCatalog.ts:86` fetches `tokens.uniswap.org` unconditionally; every browser test leaves the runner. `page.route` it to `fixtures/token-list.json`.

**[Medium][security] Auto-approving wallet page.** Loopback-hostname check is weaker than the SDK's own `allowedOrigins` (`iframe_connection_handler.js:100-103`); set it to the tools origin. Vendored bytecode: diff-before-overwrite only detects change, not an initially poisoned fetch — pin the keccak from an independent source. `setup-aztec` still `curl | bash`es an unpinned installer (pre-existing). Runbook: use `checks` with `app_id`, preserve per-branch `strict`, add an `--expect <current>` precondition; it needs an admin token — say so.

**[Low][ci] Two toolchains in one reusable workflow.** `noir`/`hub-parity` pin 5.0.1 from Nargo.toml; integration needs 5.2.0 — derive from `packages/bridge-core/package.json`, separate cache keys.

**[Low][impl] Browser isolation.** Playwright defaults to a fresh context per test; with `ephemeral` PXE that re-syncs every test. Use a worker-scoped page + `serial` per file.

## D. Assumptions

Facts: all checked ones hold; add that `build:local` is PROD (`isProd: true`) and that COOP/COEP on tools implies COEP+CORP on the wallet page.
Inferences: I1 unsafe as written (needs CORP, lazy start, `selfpay` routing); I7 verified true (`wallet_manager.js` merges web+extension sources; tools handles `type:"web"` at `createAztecWalletSession.ts:548`); I5/I3/I8 fine; I6 unmeasured — measure before the 30-min timeout.
Asks: name the L1/L2 self-pay semantics of `dapp-self-pay` explicitly; confirm the harness boundary choice.

## E. Coverage gaps

Gas-only distinguishes identity (fee asset) from swapped (non-fee token); `exits.spec.ts` "repriced" has no fee knob on the local network — mark it harness-level; L1 wrong-chain chip / `wallet_switchEthereumChain` and `unverifiable` stops (abort node RPC via `page.route`) are cheap and missing; MintStrip mint. Phase 6's gate is manual; acceptable for a spike.

## Looks fine
Reuse of `startLocalNetwork`/`waitForL1ToL2Message`/`consumeWithdrawal`; no anvil snapshots; per-shard boots; fresh L1/L2 actors; rename cut-over ordering; `quality-status` unchanged; workflow `permissions: contents: read`; drip payload is standard wallet-sdk (`useDrip.ts:75-80`); `requestCapabilities` is in `WalletSchema` and proxied; schema patch must load in the wallet page for `selfpay` (it is idempotent).
