## 1. Adversarial / security

[Severity High] SEC-1 D1’s factory→hub trust root lacks one end-to-end invariant test — `plan.md:75-78,107-108,181` separately tests cloning and hashes but never proves the Inbox actor, message portal word, clone return, `underlying()`, both factory maps, and event all agree — Add a capturing-Inbox factory test asserting that entire tuple, plus the existing L2 foreign-sender rejection.

[Severity High] SEC-2 “AZTEC + gas” can wrongly send its token remainder to the canonical FeeJuice portal — `plan.md:82` permits that portal whenever `bridgeToken == FEE_ASSET`, while `:147` uses `bridgeWithFuel(path=[])`; nothing restricts the exception to direct-gas `bridge()` — For partial `bridgeWithFuel`, require the factory portal; reserve canonical FeeJuicePortal for direct Gas and zero portal for full-fuel. The 12-field witness can remain.

[Severity Medium] SEC-3 Inline creation ordering is underspecified — `plan.md:82-83` does not require portal validation/creation before Permit2 pull; a token callback could win first creation and freeze metadata — Derive intent and call `_checkPortal/createPortal` before Permit2, then test callback creation and reverting metadata. `staticcall` already prevents state-changing `name()` reentrancy.

[Severity Medium] SEC-4 The threat model omits the router owner — current `SwapBridgeRouter.sol:142-147` lets it replace `swapTarget`, and the router also retains owner sweep authority — Add router-owner compromise to `plan.md:212,218`, plus owner/swapTarget readbacks and monitoring distinct from the guardian.

[Severity High] SEC-5 D18’s token validation is optional in the proposed type — `plan.md:127-129` declares `token?`, while `:220` relies on token-aware backup validation — Make schema 3 a discriminated union requiring `token` for `token`/`token+gas`, forbidding it for gas-only, and fail closed on missing token headers.

[Severity Medium] SEC-6 The token-list boundary overstates its safety — `plan.md:219` says poisoning “at most mislabel[s]” an address, but the origin chooses promoted addresses and an unbounded `response.json()` defeats `byteCap` before validation — Stream/cancel at the byte cap, use `redirect:"error"`, verify final origin, and label list entries untrusted while showing the address in Details.

[Severity Medium] SEC-7 Hookless routing is asserted but not structurally enforced — manifest refinement at `plan.md:125` checks only token derivations, while `:218` trusts hookless routes — Validate `hooks == 0`, currency continuity, and endpoints in schema, route construction, and swap-target tests.

[Severity High] SEC-8 D3 permits irreversible burn followed by indefinite pause — exits burn before FINISH (`plan.md:148`), and `:216` admits a lost/stolen guardian can freeze withdrawals forever — Preflight pause immediately before authwit/exit, warn that burn precedes finish, preserve the journal, and test pause between burn and withdrawal; testnet must record and monitor its dedicated guardian EOA.

[Severity Medium] SEC-9 Universal hub deployment is front-runnable as a deployment DoS — any caller can deploy the exact D2 instance before the conductor, while `plan.md:156,221` considers only the EOA nonce race — Treat an exact pre-existing hub as idempotent success after class/instance/constructor/readback verification; test that front-run.

[Severity Medium] SEC-10 Hub-wide cross-token failure needs stronger named tests — `plan.md:217` invokes per-portal isolation, but a portal-selection or burn-auth bug affects every reserve; P4 (`:189`) does not explicitly replay token-A authwits against token B — Add cross-token authwit replay and mismatched `{token,portal}` exit tests.

[Severity Medium] SEC-11 The supply-chain statement is false for TXE — `plan.md:222` says lockfile-frozen, but `run-txe-tests.sh:68-70` executes a runtime `bun add @aztec/txe@5.0.1` without a committed lock — Use a committed lockfile/root dependency; preserve CI’s `contents: read` and keep fork/TXE jobs secret-free.

[Severity Medium] SEC-12 Extreme decimals are untreated — the factory accepts any `u8` (`plan.md:78`), but gas probes, whole-token limits, and UI formatting can become nonsensical above 18, and one whole token exceeds `u128` above 38 decimals — Define base-unit-only bounds and test decimals 0, 18, 19, 38, and 255 without silently rejecting valid tokens.

## 2. Assumption attack

### Facts

[Severity Medium] FACT-1 Mainnet does not currently hide the Faucet tab — `App.vue:18-25` only changes the default, while `App.vue:39-49` renders the button unconditionally — Correct the Fact; say Arc 4 replaces the existing shell with the D4 placeholder.

[Severity High] FACT-2 Existing `BatchCall` use does not verify D11 — `fuelClaim.ts:123,170,228` uses only empty `BatchCall([])` carriers — Mark I3 unverified until P0; SDK ordering supports publish→`_register`→constructor→claim, but the real-wallet nonempty mixed batch is the required proof.

[Severity Medium] FACT-3 “Same-tx read impossible” is overbroad — recon `:15` establishes only that a private historical `PublicImmutable.read()` cannot see same-tx initialization; ordered public reads can — Qualify the Fact explicitly.

### Inferences

[Severity Medium] INF-1 I1’s raw-TXE fallback proves neither canonical publication nor rollback semantics — D17 (`plan.md:38`) deliberately bypasses the registry — Record the exact TXE limitation and keep sandbox publication a blocking gate, not corroboration.

[Severity Medium] INF-2 I2 depends on mutable live-list contents — `plan.md:226-227` hardcodes exactly two Sepolia entries — Make the canary assert origin/schema/filter/cache behavior, not UNI/WETH membership or counts.

[Severity High] INF-3 I4 cannot be pinned by one TXE wrong-metadata test — private effects are revertible only after `end_setup`; direct TXE calls do not cover every wallet fee-payment phase — Add real-wallet sandbox tests where public registration fails and a corrected retry succeeds under every supported fee mode.

[Severity Medium] INF-4 I5’s 150–200k gas estimate is unmeasured — `plan.md:227` provides no benchmark and metadata calls are attacker-controlled within caps — Add Forge gas snapshots for normal and capped metadata before accepting the estimate.

### Asks

[Severity High] ASK-1 A1 quietly changes the locked testnet deliverable from fake WETH to real WETH — compare `brief.md:29` with `plan.md:228` — Restore fake blue chips or frame A1 explicitly as an amendment to the locked brief with mintability/pool consequences.

[Severity Medium] ASK-2 A2 conflates the minimum safe claim floor with per-transaction fuel cost — `plan.md:157,228` derives `fjPerTx` from `minFuelFj` — Ask separately for the calibrated per-tx source, margin, and refresh policy.

[Severity Medium] ASK-3 A3 mixes product choices with mandatory parser defenses — TTL/caps are owner choices, but streaming abort and redirect refusal are security invariants — Split those before presenting A3.

[Severity Medium] ASK-4 A5 bundles three independent protocol/API deltas — `plan.md:228` forces one answer for D6, D8, and D9 — Request three independent approvals.

## 3. Implementation critique

[Severity High] IMP-1 Permissionless tokens do not fit the current wallet grant — `plan.md:140,165` registers arbitrary Token instances but omits `capabilities.ts`; current grants use exact addresses and explicitly warn a missing contract causes scope violation (`capabilities.ts:211-217`) — Choose and test either a full-manifest regrant per selected token or wildcard-address, function-specific Token scopes supported by the installed wallet SDK.

[Severity Medium] IMP-2 `register_token` should accept compressed words, not two `str<31>` values — `plan.md:98,153` expands two authenticated words into 62 ABI fields only to recompress them; v5.0.1 `field_compressed_string.nr:15-24` supports `from_field`/`to_bytes` — Pass `name_word`/`symbol_word`, validate them through the message, and reconstruct strings only for the Token constructor.

[Severity High] IMP-3 Per-phase gates weaken the brief — P1 lacks its required factory fork gate, and P3/P4 omit Forge/Halmos regression despite `brief.md:32`; the stated Halmos count transitions themselves are coherent — Add `fork` to P1 and Forge/Halmos to both L2 contract phases.

[Severity Medium] IMP-4 P8’s TXE gate is not executable verbatim — `plan.md:202` says only `txe`, while the legend requires `--crate <dir>` — Specify `run-txe-tests.sh --crate token_bridge_hub`; implement `--crate` as an allowlist with a committed per-crate named-test manifest.

[Severity Medium] IMP-5 The double-register test does not distinguish map protection from leaf replay — `token_of.initialize` at `plan.md:93,108` is valuable because a publish/message nullifier only blocks the same instance/leaf — Inject two distinct factory-authored leaves for one ERC-20 with differing metadata and prove the second registration fails.

## 4. Scope / over-engineering

[Severity Low] SCOPE-1 Public `derive_token` is unnecessary surface — the brief requires public discovery through `token_of`, while `plan.md:104` adds a third external view duplicating the TS keystone — Keep derivation internal and test it through `token_for`/TXE unless an actual consumer is identified.

[Severity Low] SCOPE-2 Deployment responsibilities are split across three operator surfaces — `plan.md:162,164,195` adds `DeployGeneration.s.sol`, `deploy-generation.ts`, and `pre-create-tokens.ts` — Keep one TS conductor; make Solidity a test fixture and expose pre-create as a reusable conductor helper unless standalone recovery is demonstrated.

NOT-READY (blocking SEC-1, SEC-2, SEC-5, SEC-8, INF-3, ASK-1, IMP-1, IMP-3)