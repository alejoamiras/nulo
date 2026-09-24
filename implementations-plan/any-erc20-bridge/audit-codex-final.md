## A. Adversarial / security

[Severity High] Fee-on-transfer is not rejected on exits — `plan.md:76,236` adds exact-input checks only, while `NuloTokenPortal.sol:183-185` consumes the Outbox message and merely calls `safeTransfer`; an asymmetric or later-enabled transfer tax can make the user permanently receive less than the L2 amount burned — Require exact portal-debit and recipient-credit deltas on withdrawal, with asymmetric/toggleable-tax tests.

[Severity High] The live deployment gates do not bind the router to the trusted factory — `plan.md:185` limits `live-intent` readbacks to owners, `swapTarget`, `L2_HUB`, and `l1_factory`; a router constructed with another factory restores the original arbitrary-portal drain class despite D23 — Verify every live immutable: router→factory/Permit2/FeeJuicePortal, factory→implementation/Inbox/version/hub, implementation→factory/Inbox/Outbox/hub, and swap target→PoolManager/FJ/WETH, including code hashes.

[Severity High] A compromised RPC can cause up to 50% economic loss, contrary to the threat analysis — `plan.md:233,239` includes compromised RPCs but claims quote manipulation stays “within slippage”; slippage is relative to the RPC-supplied quote, so a false quote can authorize a catastrophically poor floor, bounded only by D14’s 50% slice — Corroborate prices with an independent endpoint or on-chain sanity source, or explicitly classify RPC compromise as accepted mispricing risk.

[Severity Medium] Per-clone reserves do not contain hub or Token-class exploits — `plan.md:238` presents per-token L1 isolation inside the hub-risk discussion, but all clones trust one hub and every L2 token shares one class; an auth, portal-selection, or mint/burn bug is generation-wide — Limit the containment claim to malicious ERC-20 behavior and model hub/class compromise as affecting every reserve.

## B. Assumption attack

### Facts

[Severity Medium] The factory record is not the claimed authoritative source of the complete registration leaf — `plan.md:85` stores only `registerIndex`, while `plan.md:147` expects `registerKey`; checkpoint polling currently consumes the returned message hash (`journal.ts:70-73`) — Store `registerKey`, or specify and keystone-test complete Inbox-leaf recomputation from the record.

[Severity Medium] The stated “~3 slots, ~70k gas” is false — the declared member order at `plan.md:85` occupies five Solidity slots: portal, two words, decimals, then the full-width index — Reorder and safely narrow the index if three slots are required, otherwise correct the estimate and snapshots.

### Inferences

[Severity High] I4’s “persisted publication is inert” fallback is wrong — `contract_instance_registry_contract/src/main.nr:154-156` emits the token address as a duplicate-preventing nullifier; if publication survived `_register` failure, every corrected `register_token` would fail while no hub entrypoint can initialize the token separately — Treat rollback as load-bearing; P6 must prove atomic rollback for every fee mode, and failure requires redesign.

[Severity Medium] I7 is already contradicted by repository evidence — `contracts/bridge/aztec/scripts/compile.sh:7-10` states that plain `aztec-nargo compile` produces non-transpiled artifacts — Use the existing `aztec compile` plus `bb` path in CI instead of leaving this as a spike question.

[Severity Medium] I6’s Halmos name assertion cannot detect vacuous proofs — `plan.md:249` assumes symbolic CREATE2/EXTCODECOPY works, while `plan.md:204` acknowledges it may not; a named check can still pass after path pruning or unsupported modeling — Require warning-free execution and mutation/failing-canary checks, or concretize clone deployment and prove only the supported logic.

### Asks

[Severity High] A7 directly reopens locked D3 — `plan.md:24` says pause bits are globally owner-confirmed, yet `plan.md:250` asks whether to add per-portal bits — Remove A7 and retain blast radius solely as an accepted consequence.

[Severity Medium] A6 is not an optional UX preference — without per-token re-consent, exact-address wallet grants make arbitrary tokens unusable, while wildcard burns are unsafe (`plan.md:43`) — Reframe A6 as a required consequence; a “no” blocks the feature absent a wallet-capability change.

[Severity Medium] A2 hides materially different calibration cases — public combined registration, private registration plus claim, and sponsored/FJWC/private-FPC fees do not have one demonstrated cost — Define `fjRegister` as a measured worst-case gas-unit budget with margin and refresh rules across privacy and fee modes.

[Severity Medium] A5’s four deltas remain marked “adopted” before independent owner answers — `plan.md:27,29-30,250` still gives D6/D8/D9 settled status — Record A5a–A5d separately as pending or accepted before implementation.

## C. Implementation critique

[Severity Medium] `token_for == 0` conflicts with the chosen storage API — D29 and P6 branch on zero (`plan.md:50,216`), while `plan.md:210,248` requires uninitialized `PublicImmutable.read()` to revert — Make the public discovery view return zero using `is_initialized()/read_unsafe()`; keep hard-reverting reads inside claims and exits.

[Severity High] Resume validation does not enforce D30’s authoritative metadata rule — P7 re-derives only the portal (`plan.md:220`), but the L2 token also depends on the factory-frozen words and decimals (`plan.md:51,176`) — On every resume/import, read `registrations[erc20]` and verify words, decimals, register index/key, and derived L2 token before granting or executing.

[Severity Medium] The gas-share algorithm is not valid for nonlinear pools — D14 extrapolates a dust quote linearly, while D31 later makes an underestimated real quote revert at `minFuelFj`; a larger permissible slice may have succeeded — Use an exact-output quote or bounded search, or surface “amount too small” before signing.

[Severity Medium] P3’s claimed artifact-parity gate is not actually executed by the phase — `plan.md:208-209` lists ordinary gates but no local compile/parity command, and PR/CI submission occurs only after all arcs (`plan.md:254,258`) — Add an explicit pinned compile-and-diff gate to P3.

## D. Decision trail

[Severity High] D18’s rejection rationale was invalidated by D30 — `plan.md:39` calls wider token binding redundant because portal identifies the token, but `plan.md:51` later establishes that portal does not determine metadata or L2 token — The recovery key need not necessarily widen, but authoritative token-block validation must.

[Severity Medium] D14’s rejection of quote search should be revisited after D31 — the later hard floor turns linear-estimation error into transaction failure — Prefer exact-output or bounded search over a single dust-rate extrapolation.

[Severity Medium] D34 was accepted by redefining scope without owner approval — `brief.md:31` says `apps/extension` changes are out of scope; adding an extension network test is still such a change — Obtain an explicit exception or place the real-wallet test in an external integration harness.

[Severity Low] D2 retains stale genesis ordering after D32 — `plan.md:23` places Token-class publication after factory deployment, while `plan.md:53,177` places both class publications first — Make D2 defer explicitly to D32.

VERDICT: conditional approve (with conditions: 1. enforce exact-out withdrawals; 2. add complete live cross-binding and honest RPC-price guarantees; 3. fix registration discovery/key and authoritative resume validation; 4. make rollback and compile/parity gates genuinely blocking; 5. resolve A1/A2/A5/A6/A8 individually and remove A7)