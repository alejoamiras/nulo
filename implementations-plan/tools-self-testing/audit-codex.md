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

---

# Final fresh-context pass on plan v2 (GPT-6 Astra @ high, read-only)

Session: `01a082ca-4e9a-7ff3-b740-21eb42839f1f`. Inputs: `plan.md` v2, `recon.md`, both round-1 audits, `outline-b.md`. Every claim re-verified; all adopted into v3 (see `plan.md` § Decision ledger).

---

VERDICT: reject (blocking findings: unreachable baseline matrix cells, unresolved spike prerequisites, incorrect coverage boundaries, and unsafe protection cut-over)

Confidence: **high** on source findings; **moderate** on runtime feasibility. Below, `plan.md` and audit filenames refer to `implementations-plan/tools-self-testing/`; `SDK/` means `apps/tools/node_modules/@aztec/`.

**Facts**

- **[High][coverage] The baseline success case cannot exercise the stated payment.** Cells 1–3 specify token-only, plain wallet, sponsored (`plan.md:184`). Tools explicitly requires held public FJ or private credit and forbids falling back to sponsorship (`apps/tools/src/composables/deposit-flow.ts:596`, `:624`). Sponsorship alone therefore produces a stop, breaking Phase 8’s first gate. Give plain-wallet success cases sufficient private credit; keep sponsored contract-level cases separately identified.

- **[High][ledger] Phase 6 still lacks its prerequisites.** Round 1 explicitly requested local identity before the spike (`audit-codex.md:15`), but Phase 6 changes only discovery and the node URL (`plan.md:260`); identity and local drip metadata arrive in Phase 7. Discovery still sends the target’s chain/version (`apps/tools/src/lib/chain-info.ts:35`), and drip still imports committed deployments (`apps/tools/src/contracts/deployments.ts:7`). Move minimal target, manifest and drip wiring before the spike. Also correct the claimed connect-time identity enforcement: the current probe runs after mount and only warns in dev (`apps/tools/src/main.ts:25`).

- **[High][coverage] Several integration checkmarks test behavior owned by tools.** Repricing is implemented in `apps/tools/src/composables/useHubExit.ts:92`, and private-credit refusal before authorization is enforced at `:420`. Reimplementing those decisions in bridge-core’s harness would prove the duplicate. Cell 26’s “no fee knob” rejection of browser coverage (`plan.md:209`) is unjustified: intercept the fee-estimate RPC between review and send, then assert no authorization/send occurred. Put app decisions in tools tests; retain contract assertions in integration.

- **[Medium][coverage] Cell 30’s expected error is wrong.** The iframe handler returns `Unknown wallet method` when the schema lacks a method, or invokes the missing implementation after schema patching (`SDK/wallet-sdk/dest/iframe/handlers/iframe_connection_handler.js:203`). Tools recognizes only `Unsupported wallet method` as unsupported (`apps/tools/src/composables/useAddDripToken.ts:60`). Explicitly include the compatibility fix and test actual transport errors; do not teach the fake wallet to emit the convenient expected wording.

- **[Medium][gate] Two validation gates remain incomplete.** Phase 7’s environment assignment applies only to the build, while verification receives neither artifacts nor output directory (`plan.md:266`); today verification reads shared `dist` and `public` (`apps/tools/scripts/verify-build-target.ts:22`). Add explicit shared loader/CLI arguments and pass them to both commands. Phase 5 also omits `resolve-asset` from its bridge dependency filter (`plan.md:254`), despite that direct dependency (`packages/bridge-core/package.json:21`) and the guard’s literal requirements (`scripts/ci-cd/behavior-gating.test.ts:62`).

- **[High][security] “The sandbox binds loopback” is false for the reused Aztec launcher.** It disables admin authentication without configuring a bind host (`packages/bridge-core/scripts/sandbox/local-network.ts:339`). The installed CLI passes only the admin port; its HTTP helper consequently receives an undefined host ([CLI:127](/home/homelab/.aztec/versions/5.2.0/node_modules/@aztec/aztec/dest/cli/aztec_start_action.js:127), [server:557](/home/homelab/.aztec/versions/5.2.0/node_modules/@aztec/foundation/dest/json-rpc/server/safe_json_rpc_server.js:557)). Specify actual network confinement and validate listening addresses. Loopback URLs in the handle do not establish confinement.

**Inferences**

- **[High][impl] I3’s obvious override lacks the information it needs.** `completeFeeOptions` receives `feePayer`, but not payload calls (`SDK/wallet-sdk/src/base-wallet/base_wallet.ts:448`); embedded sending invokes it separately (`SDK/wallets/src/embedded/embedded_wallet.ts:171`). Reclassifying every sender-as-payer request would break legitimate claim-in-setup transactions. Use a payload-aware seam, without mutable per-request flags, and prove both held-FJ payment and genuine fueled claims through simulation and sending.

- **[High][ledger] Fresh actors per file do not adopt round 1’s isolation requirement.** The audit required actors per independent fee cell/retry (`audit-codex.md:37`); v2 specifies per-file actors and worker-scoped pages (`plan.md:138`). Successful funded flows mutate the balances needed by subsequent zero/short cases. Define per-cell/retry actor allocation, browser-state reset, and exact balance/note-count postconditions. Replace ambiguous `FeeState` labels with a small explicit fixture specification: the current type cannot express “both” or a short amount (`plan.md:103`).

- **[Medium][impl] I9 solves filesystem collisions, but leaves configuration loading underspecified.** `TARGETS.local` constructed from a bare define can execute when Node imports `network-targets.ts`, before Vite substitutes anything (`plan.md:265`; `apps/tools/vite.config.ts:11`). Keep the factory pure; construct the browser local target only behind an explicit guarded build constant. Make Node verification call the artifacts loader directly. Production build checks must run for **both** targets; Phase 7 currently names only testnet.

- **[Medium][security] The adopted response-policy checks disappeared.** Round 1 requested actual CSP enforcement and isolation assertions in both frames (`audit-codex.md:45`). Preview currently serves only COOP/COEP, while CSP is written to `_headers` (`apps/tools/vite.config.ts:104`, `:163`). Serve the generated local policy, explicitly allow the wallet frame, and assert both `crossOriginIsolated` values. Restore rejection of unexpected app/chain requests too (`audit-codex.md:43`). I1/I2/I5/I8 remain empirical; I6’s measurement gate is appropriate.

**Asks**

- **[High][ledger] Coordinate protection separately for each destination branch.** Round 1 explicitly required main’s own promotion coordination (`audit-codex.md:49`); v2 instead switches both branches before merging into dev (`plan.md:161`). Existing main release PRs may still produce legacy names. Preserve the locked rename decision, but require green new contexts on each destination’s eligible SHA before switching that branch. Document refreshing stale dev PRs under `strict:false`; retain main’s `strict:true`. Save a reviewed expectation first: `--expect "$(print …)"` protects only the tiny read/write interval. Preserve unrelated checks/app bindings and verify both writes, including partial-failure recovery.

- **[High][coverage] The locked full matrix is still not explicit.** Gas-only identity/WETH cells omit visibility, and fueled cells cover both-empty rather than separately public-empty/private-empty states (`plan.md:194`). First-time fueled private registration is also unnamed despite its distinct registration-then-credit payment path (`apps/tools/src/composables/deposit-flow.ts:368`). Enumerate the combinations and expected payer/balance effects. Surface whether “add token” includes successful optional registration; cell 30 proves only absence handling.

**Looks fine**

- Delivery-time PR validation is viable: PR workflows run against merge refs; existing workflows deliberately support stacked bases (`.github/workflows/contracts.yml:7`). Preserve that behavior in the new workflow. [GitHub documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- The narrow sandbox export, Playwright runner, Quoter facade, independent bytecode pins, separate toolchains and no-snapshot approach are sound.
- Advisory-first promotion, extension independence and `code_review: off` remain intact.

---

# Resumed pass on plan v3 (same session, GPT-6 Astra @ high)

All six findings verified and adopted into v3.1 (see `plan.md` § Decision ledger).

---

VERDICT: reject (blocking findings: account-grant lifecycle, selfpay claim discrimination, and incomplete fee fixtures)

Confidence: **high**. References to `plan.md` mean `implementations-plan/tools-self-testing/plan.md`; `SDK/` means `apps/tools/node_modules/@aztec/`.

- **[High][impl] Adding an account does not update tools’ existing grant.** The sequence connects and grants capabilities before creating each actor (`plan.md:148–149`). Tools populates its account list from the capability response (`apps/tools/src/composables/createAztecWalletSession.ts:786`, `:819`) and rejects selection of an ungranted address (`:931`). An initially empty wallet also fails connection (`:822`). Create the first actor before the initial grant, and explicitly refresh capabilities after subsequent additions. Specify how the fixture triggers that refresh without directly mutating tools’ account state.

- **[High][impl] The selfpay discriminator names the wrong function.** The wrapper checks for FeeJuice `claim` (`plan.md:127`, `:164`), but genuine fueled payment carries **`claim_and_end_setup((Field),u128,Field,Field)`**, addressed to the protocol FeeJuice contract (`SDK/aztec.js/dest/fee/fee_juice_payment_method_with_claim.js:19–36`). A literal implementation strips the payer from precisely the transaction it must preserve. Match the protocol address and actual selector, rather than a display name. Preserve that payload unchanged; retain the planned simulation/send checks.

- **[Medium][ledger] The transport fix still covers only the plain profile.** Selfpay imports the entire schema patch (`plan.md:126`), which adds `registerToken` too (`packages/wallet-sdk-schema-patch/src/apply.ts:54`). Consequently the handler passes its schema check and calls an undefined implementation, producing a TypeError rather than either recognized wording (`SDK/wallet-sdk/dest/iframe/handlers/iframe_connection_handler.js:203–209`). Cell 35 still fails. Either give selfpay explicit unsupported-method implementations, or make tools narrowly classify this actual missing-implementation response. Do not broadly classify arbitrary TypeErrors as unsupported.

- **[High][coverage] Several success fixtures remain insufficient or unspecified.** Public exit cell 27 has no fee fixture (`plan.md:225`). Tools supplies no payment method for either its public authwit transaction or exit (`apps/tools/src/composables/useHubExit.ts:79–84`); the plain EmbeddedWallet defaults to spending public FJ (`SDK/wallet-sdk/dest/base-wallet/base_wallet.js:185–188`). Fund both transactions explicitly. Cell 4’s “credit ≥ register ceiling” also needs the **registration plus claim** ceiling (`packages/bridge-core/src/private-fuel.ts:128–130`), and cell 3 must budget its second send. Give these cells concrete transaction budgets and assert the resulting balances.

- **[Medium][coverage] The matrix still does not distinguish all promised fee states.** Cells 13–21 cover empty balances and, once, credit-only; none covers a fueled flow with public FJ present and private credit absent (`plan.md:211–219`). Add the public-only variants across the applicable public/private fueled paths. Also specify cell 24’s consumed-claim outcome: a plain wallet with no private credit cannot subsequently pay a token claim from the public FJ it recovered. The consumed branch returns to `ownGasFee` (`apps/tools/src/composables/deposit-flow.ts:700`), whose public payer remains feature-gated. State whether this case should stop, or supply the fixture/profile needed for successful completion.

- **[Medium][gate] The concrete cut-over command defeats the reviewed-snapshot intent.** Although the contract now accepts a saved expectation, Phase 1 immediately overwrites that file from live state and applies it in the same command (`plan.md:253`). This still detects only changes during the brief read/write interval. Capture and review the snapshot beforehand; make the one-command apply consume that existing file. Keep the per-branch sequencing and write verification.

**Resolved**

- Token-only sponsored baselines; target/loader/drip prerequisites before the spike.
- Tools-owned decision coverage, including browser repricing.
- Explicit verification output directory, both production negative builds, and `resolve-asset` filtering.
- Per-cell actor allocation in principle; the remaining issue is publishing their grants.
- Served CSP, isolation assertions, app/chain guards, and honest node-exposure documentation.
- Per-branch protection sequencing, preservation of unrelated checks, and Delivery-time PR validation.
- Successful optional add-token coverage through the `full` profile.

---

# Verdict on plan v3.1 (same session, GPT-6 Astra @ high)

Three conditions, all verified and adopted into v3.2 (see `plan.md` § Decision ledger).

---

VERDICT: conditional approve (conditions: initialize actors in the session wallet before its grant, bound and grant the entire actor pool, and clarify public-FJ balance assertions)

Confidence: **high**. `plan.md` below refers to `implementations-plan/tools-self-testing/plan.md`.

- **[High][impl] The pre-grant initialization now has a lifecycle ordering problem.** Step 3 calls `frame.evaluate(addAccount(...))` before navigating tools or connecting (`plan.md:153`). The SDK creates the actual session iframe only during `establishSecureChannel` (`apps/tools/node_modules/@aztec/wallet-sdk/dest/iframe/provider/iframe_provider.js:57–67`). Populating another page would not populate this ephemeral wallet. Pass the file’s actor seeds into the session iframe’s bootstrap, and have its lazy `getWallet` finish importing them before returning for `requestCapabilities`. Keep discovery startup immediate.

- **[Medium][impl] Bound the pool and grant the spares too.** I11 assumes all N+2 actors remain selectable (`plan.md:355`), but tools caps granted accounts at **16** and drops later entries (`apps/tools/src/composables/createAztecWalletSession.ts:74`, `:989`). Require `N+2 ≤ 16`, splitting files when necessary, and assert every allocated address survives grant parsing. Step 3 currently says “all N accounts,” whereas retries select the extra two (`plan.md:153–154`); explicitly grant the entire pool.

- **[Medium][coverage] Replace “public FJ untouched” with a conservation assertion.** Cells 13b and 20b use that wording, while 18b correctly says the public arrival adds to the balance (`plan.md:218`, `:225`, `:228`). Public fueled payment claims bridged FJ into the sender’s payment transaction (`packages/bridge-core/src/fee-juice.ts:92–96`). Assert `after = before + claimed − charged fees` across the relevant transactions. The initial funds remaining available must not become an erroneous `after === before` expectation.

**Resolved**

- Address-and-selector discrimination for `claim_and_end_setup`.
- Explicit unsupported implementations on selfpay and narrowly scoped error mapping.
- First-time claim and public-exit fee budgets.
- Added public-only fee variants and separate consumed-recovery outcomes.
- Separately reviewed protection snapshots and per-branch cut-over.
- Pre-grant actor allocation is the right approach; the two lifecycle/pool conditions above finish specifying it.