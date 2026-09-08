# audit-codex.md — Round 1 (plan audit, GPT-6 Astra @ high, read-only)

Session: `01a082b6-d99f-7de3-be75-caa4240fe9c2`. Inputs: `plan.md` (outline A, draft 1), `outline-b.md`, `recon.md`. Every factual claim below was re-verified against the worktree before adoption; the adopted/rejected log is in `plan.md` § Decision ledger.

---

VERDICT: reject (blocking findings: local-build wiring, wallet-profile expectations, isolation, and CI validation are incomplete)

Confidence: **high** on the source findings; **moderate** on browser/runtime feasibility, which still needs the spike. Below, `plan.md` means the reviewed plan; SDK paths are under `apps/tools/node_modules/@aztec/`.

**A vs B**

- Choose **A’s Playwright Test runner**. Browser fixtures, lifecycle, traces and sharding justify it. B preserves one runner by rebuilding orchestration; the repo already permits Node for browser e2e (`CLAUDE.md:48`).
- Keep **A’s harness location, with an explicit testing export**. `@nulo/bridge-core/scripts/...` is currently unexported (`packages/bridge-core/package.json:6`). Relative filesystem imports can resolve; the isolated linker does not categorically prohibit them. B identifies a boundary problem but overstates the resolution problem. A narrow `@nulo/bridge-core/testing` export is sufficient.
- Keep **contracts-suite-first**, but move a minimal local-target setup and wallet spike earlier. A’s Phase 6 cannot connect to the sandbox merely by overriding its URL; chain identity must match first. Neither outline orders that dependency correctly.

**Findings — Facts**

- **[High][impl] Built-browser configuration contradicts DEV gating.** A builds and previews `dist`, while wallet discovery and the node override are DEV-only (`plan.md:127`; `apps/tools/src/lib/network.ts:48`). Use an explicit local-target build configuration, inject its serializable identity and URLs, and retain production-host restrictions. Match `localhost` versus `127.0.0.1`: integrity compares exact hostnames (`build-integrity.ts:28`). `chain-info.ts:35` will work with a correctly resolved target; `assertNodeChainMatches` must remain enforced.

- **[High][impl] Local configuration needs a concrete injection boundary.** `network-targets.ts` is imported by both browser code and Vite (`apps/tools/vite.config.ts:11`), so filesystem reads do not belong in `chain-constants.ts`. Read local artifacts in the Node config, inject the resulting target, and reuse that loader in build verification. The current manifest writes wallet identity but no explicit rollup-version field (`packages/bridge-core/scripts/deploy-sandbox.ts:304`); specify that field or its validated derivation.

- **[High][coverage] The “plain wallet greys token+gas” expectation is wrong.** Gas choices depend on route availability (`apps/tools/src/components/send/ChoiceCards.vue:32`), while the initial public claim-with-fuel path does not check `getWalletFeatures` (`apps/tools/src/composables/deposit-flow.ts:679`). The feature probe controls **held public gas** (`deposit-flow.ts:608`). Require fueled success under plain wallets; test unsupported held-public-gas payment separately.

- **[High][impl] Implementing a custom method is insufficient.** The iframe handler rejects methods absent from its own `WalletSchema` (`wallet-sdk/dest/iframe/handlers/iframe_connection_handler.js:203`). Import the existing schema patch in the selfpay wallet page. Also return schema-valid capabilities: `version` and wallet metadata are mandatory (`aztec.js/dest/wallet/wallet.js:254`); the jsdom stub omits them (`apps/tools/tests/e2e/fixtures/sdk-boundary.ts:102`). Do not copy that stub as the transport contract.

- **[High][ci] Unit collection will pick up the new suites.** Tools excludes only `tests/e2e/**` (`apps/tools/vitest.config.ts:19`), so Playwright `.spec.ts` files enter Vitest. Bridge-core’s config likewise lacks integration exclusions (`packages/bridge-core/vitest.config.ts:5`). Add explicit include/exclude boundaries. Extend bridge typechecking too: `tsconfig.scripts.json:3` excludes the proposed `test/integration` files and integration config.

- **[High][ci] Fresh CI jobs lack deploy prerequisites.** Deployment reads Foundry `out/` artifacts directly (`packages/bridge-core/scripts/script-artifacts.ts:14`). Installing Aztec does not build them. Reuse the pinned libraries, remapping and build steps from `.github/workflows/_bridge-contracts.yml:49` in every sandbox job. TXE additionally defaults to **5.0.1** (`contracts/bridge/aztec/scripts/run-txe-tests.sh:23`), matching its separate oracle pin (`txe-server/package.json:6`). Resolve the Noir toolchain explicitly before classifying failure as infrastructure.

- **[High][ci] Pre-merge dispatch gates are not executable as written.** Phases 1/10 dispatch newly named workflows before they exist on the default branch; GitHub requires that presence for `workflow_dispatch`. Establish a bootstrap workflow or use PR-triggered validation after local review converges. This requires revising the “first PR only at final delivery” dependency. [GitHub documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

- **[Medium][ci] Filters and permissions need executable checks.** The guard requires literal dependency `src/**` and `package.json` entries; broader `/**` patterns do not satisfy it (`scripts/ci-cd/behavior-gating.test.ts:60`). Adapt its coverage semantics and add actual bridge/tools graph assertions; listing workflows alone checks only negations. Include patches, lockfile and setup inputs. Give the paths-filter job `pull-requests: read`, as the existing workflow does (`contracts.yml:19`); keep execution jobs read-only.

**Findings — Inferences**

- **[High][impl] Fresh actors do not isolate shared state.** Registration is token-global, pause is hub-global, and deployment already documents nonce collisions (`deploy-sandbox.ts:200,1031,1162`). Allocate fresh tokens for registration cases and actors per independent fee cell/retry; restore pause/rate changes in `finally`; serialize shared deployer/relayer operations. Preserve randomized Permit2 nonces (`deploy-sandbox.ts:353`). Start with one browser worker per sandbox, parallelizing through shards. Write manifests and builds under run-specific directories rather than shared `public/local-bridge.json`/`dist`.

- **[Medium][impl] The handle is not a portable runtime object.** `Fr`/`AztecAddress` instances need explicit serialization and reconstruction across `provide()` and `handle.json` (`plan.md:91`). Pass strings and deployment records; reconstruct clients/wallets locally. Assign boot/teardown to one owner—the architecture currently assigns it to both global setup and `agent.sh`. Vitest documents serializable provided data. [Vitest documentation](https://main.vitest.dev/config/globalsetup)

- **[Medium][impl] Quoter equality is conditional.** Identity first hop followed by `floor(amount × rateNum/rateDen)` composes correctly. But `signedMinFuelOutput` can exceed output when `minFuelFj` binds (`packages/bridge-core/src/gas-share.ts:73`); settlement correctly reverts (`SwapBridgeRouter.sol:225`). Test dust, half-cap, nonzero slippage, both currency orderings and changed rates. Constructor-cached rates diverge after `MockSwapTarget.setRate` (`MockSwapTarget.sol:30`). Pin compiled ABI against the actual TS ABI, not merely a duplicated selector string; the existing ABI test otherwise skips without artifacts (`router-abi.test.ts:36`).

- **[High][security] Loopback is not caller authorization.** A hostile website can attempt to embed an auto-approving local wallet. Configure the handler’s exact `allowedOrigins` (`iframe_connection_handler.js:100`), constrain framing to the tools origin, and reject unexpected chain/app requests. `noindex` provides no protection. Keep the wallet as a separate build entry and assert its assets/URLs are absent from both production targets.

- **[Medium][assumption] I1/I5/I6/I8 remain unproven.** Start discovery before expensive PXE initialization: probing times out after ten seconds (`iframe_discovery.js:13`). Assert isolation inside the wallet iframe as well as tools. Preview currently serves COOP/COEP but not generated CSP (`apps/tools/vite.config.ts:163`); exercise real response policies with an explicit wallet `frame-src`. Benchmark complete shard inventories. A clean week should use retry-zero results, not Phase 8’s retry-one success.

**Findings — Asks**

- **[High][ci] Surface the cut-over contract.** Before changing protection, verify new checks on the mergeable SHA. Rename only selected contexts, preserve other checks/app bindings and each branch’s `strict`, verify both PATCH results, and retain rollback data. Coordinate `main` with its promotion rather than assuming the dev merge updates both branches. Implement the later `--add` mode explicitly (`plan.md:175,226`). Define who owns promotion and what constitutes a clean week.

- **[High][coverage] Replace the spec list with an enumerated matrix.** Phase 9 omits explicit public-only/private-only/both-empty fee combinations, WETH single-hop versus FeeJuice identity routes (`route-discovery.ts:84,99`), browser repricing, interrupted-claim recovery, and rejection/account-change paths. Recovery has materially different pending/dropped/consumed branches (`apps/tools/src/lib/fuel-claim-state.ts:63`). Require named executed cells in both applicable layers. Do not preserve `optionalFlow`’s swallowed failures (`deploy-sandbox.ts:490`), or put UI stop-copy assertions inside the shared contract harness.

**Looks fine**

- Standard iframe proxying includes all requested methods, including capabilities, address book and batch (`aztec.js/dest/wallet/wallet.js:313,386,424`); emoji confirmation is compatible with wallet-side auto-approval (`iframe_provider.js:109`).
- The proposed Quoter selector matches `quote.ts:12`.
- No snapshots, owned teardown, vendored bytecode and pinned Playwright are sound choices. Verify bytecode against independently established hashes; a poisoned response and its own hash prove only consistency.
- Extension independence, advisory-first rollout and `code_review: off` remain intact.