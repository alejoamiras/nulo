## 1. What I missed

[Severity High] M1 Factory-attested metadata can differ from wizard metadata, changing the L2 Token address after funds deposit — `plan.md:150,154` derives/registers the Token before `createPortal`, but a token may vary metadata by caller/block and the factory’s words determine the initialization hash (`:85,116,165`) — Treat `PortalCreated` words as authoritative; after the L1 receipt, re-derive/regrant/register the actual Token and rewrite the sealed record. For existing portals, recover words from the creation event or `token_for`.

[Severity High] M2 “First-time” is racy across users and relayers — another actor can consume the sole register leaf before `register_and_claim_public`, or two deposits can both classify themselves first-time while only one creates the portal — At claim time query `token_for`: use ordinary `claim_public` if registered, otherwise attempt combined registration and retry as claim-only after a registration race; test relayer-first and concurrent deposits.

[Severity High] M3 CI can pass with Noir source and committed artifacts disagreeing — Arc 2 explicitly says CI does not compile the hub (`plan.md:173`); class-ID tests merely inspect the committed artifact — Compile the hub with pinned 5.0.1 in CI and compare normalized bytecode/class ID to the committed artifact.

[Severity High] M4 Per-token regrant needs stale-selection and partial-grant handling — D22 (`plan.md:43,150`) assumes request success authorizes the currently selected token, but selection can change while the wallet prompt is open and wallets may narrow grants — Add a selection epoch, serialize regrants, verify returned contracts/simulation/transaction scopes contain the current Token, and discard stale completions.

[Severity Medium] M5 Halmos counts can pass after replacing a meaningful proof with a trivial one — `plan.md:184,191-200` and `_bridge-contracts.yml` enforce only counts per contract — Commit expected `check_*` names and verify names plus counts from `halmos.log`.

## 2. What I over-asserted

[Severity Medium] O1 SEC-1 was a useful test request, not a High blocker — D1’s trust root was already structurally sound and independently verified; only the end-to-end tuple pin was absent — Downgrade the original finding to Medium; the revision resolves it.

[Severity Medium] O2 SEC-5 and SEC-8 were overstated as blockers — the old recovery domain already bound token identity through the portal, while no preflight can eliminate D3’s pause-after-burn race — Keep the union and warning, but classify the residual D3 consequence as owner-accepted systemic risk.

[Severity Low] O3 IMP-3’s High severity confused gate compliance with evidence — rerunning unchanged Forge/Halmos during P3/P4 says nothing about L2 correctness — The literal brief requirement is now met, but M3 is the meaningful missing gate.

[Severity Low] O4 INF-3 said rollback could not be pinned, too strongly — v5.0.1 classifies app-phase private nullifiers as revertible; retry-after-failure is observable — The revised TXE retry plus real-wallet sandbox matrix is sufficient.

## 3. Where I was anchored

[Severity Medium] V1 “Second manifest shadows the first” is stale shorthand — current `dispatcher.ts:304-327,384-415` performs field-aware widening and replacement; `dispatcher.test.ts:1603-1643` proves a new address re-prompts and persists the popup-returned union — Rewrite D22 around current merge semantics and still verify the selected scope as in M4.

[Severity Low] V2 D11’s enqueue ordering is source-supported — `private_kernel_circuit_output_composer.nr:246-258` sorts public calls by side-effect counter, and public `PublicImmutable.initialize/read` uses sequential AVM nullifier/storage operations (`public_immutable.nr:150-185`) — Keep `register_and_claim_public`, with P0/P6 retaining the end-to-end proof.

## 4. Disputed items

[Severity Low] D21 should keep `str<31>` unless the spike proves more than compilation — v5.0.1 `FieldCompressedString` exposes only `from_field`, `from_string`, and `to_bytes`; no source usage proves the unchecked bytes→string round-trip. My local compile probe was blocked by Nargo’s read-only package-cache lock — Require exact word round-trip, identical Token-address keystone, and a measurable proving-cost win before switching; compile success alone is insufficient.

[Severity Low] Keep the 12-field witness — D23 derives intent unambiguously from entrypoint, `fuelAmount == totalAmount`, and the portal biconditional — Do not add a redundant `intent` value that can disagree and churn the witness keystone.

[Severity High] An ownerless hub is acceptable for testnet, not yet for value-bearing mainnet — L1 pause can stop redemption but cannot repair hub state or migrate stranded reserves (`plan.md:226-227`) — Keep this plan ownerless, but make `/harden security` an explicit blocking mainnet decision on recovery/migration, not merely a recorded follow-up.

## 5. Eight blocker dispositions

[Severity Low] B-SEC-1 resolved — D1 tuple test is explicit at `plan.md:191` — No further fix.

[Severity Low] B-SEC-2 resolved — D23 scopes canonical versus factory portals per entrypoint — No further fix.

[Severity Low] B-SEC-5 resolved — D18 is now a fail-closed discriminated union — No further fix.

[Severity Medium] B-SEC-8 partially — preflight, warning, and journal retention exist, but pause-after-burn remains intrinsic to D3 — Record it as accepted, not eliminated.

[Severity Low] B-INF-3 resolved — P0/P4 retry and P6 fee-mode matrix cover it — No further fix.

[Severity High] B-ASK-1 not resolved — A1 is honestly framed but still awaits owner approval (`plan.md:239`) — Obtain the decision before testnet implementation.

[Severity High] B-IMP-1 partially — D22 chooses regrant, but M4’s scope verification and race semantics remain — Add them to P7/P8 tests.

[Severity Low] B-IMP-3 resolved mechanically — required gates are listed, though M3 remains the substantive CI hole — Add deterministic Noir compilation.

NOT-READY (M1, M2, M3, M4, B-ASK-1)