# Codex audit — round 1 (plan review, xhigh, gpt-5.6-sol)

Verdict: **reject** (mixed-version boundaries incompletely modeled/tested; native-prover CI
bypassable; decisive compatibility checks too late). Findings + triage (verified against the
repo before adoption):

## Critical

**C1 — "only cross-axis runtime boundary is the prover slot" is false.**
Verified in `bun.lock`: `@alejoamiras/aztec-accelerator` = exact-5.0.1 `dependencies` (nested
private copies); `@alejoamiras/private-fee-juice` = exact-5.0.1 **peerDependencies** (binds to
the CONSUMER's — post-bump 5.2.0 — modules at runtime); `@aztec-foundation/aztec-standards` =
**no dependency declarations at all** (same consumer-context binding). Three distinct binding
modes, two of which execute 5.0.1-compiled wrapper code against 5.2.0 modules.
**ADOPTED**: plan's Architecture section rewritten as a three-mode boundary inventory; Phase 2
verifies each mode; Phase 4 requires prover-ON fee-flow evidence (see C1b nuance).
*Nuance corrected*: CI's `fee-methods` shard is real-WASM-proved (its own comment: "4 real
fee-juice TX flows requiring full WASM proving"), not proof-free — the gap is NATIVE proving,
which the local full-suite prover-ON run (already in scope) closes; a CI-native fee canary is
surfaced as an optional follow-up, not silently added.

**C2 — canary bypassable via `NULO_E2E_DISABLE_ACCELERATOR`; `/prove` count advisory; D3's
server-downloaded bb unpinned.** All verified (`_network-e2e.yml` "Advisory only" comment;
CLAUDE.md documents the var as the intended rollback lever; bb fetched at runtime is not
repo-pinned). **PARTIALLY ADOPTED**: the kill-switch is a deliberate, owner-controlled
emergency rollback — removing it is a gate-policy change outside this bump's authority →
surfaced as Ask 5 (make `/prove`-count enforcing in the canary shard) + an explicit residual-
risk note in Security; the unpinned-bb-download residual is documented and mitigated by
preferring a pinned `BB_BINARY_PATH` seed where version-correct (D3 amended).

## High

**H1 — D2 cast needs evidence, not duck-typing comfort.** **ADOPTED**: D2 now requires a
structural diff of both `PrivateKernelProver` declarations (nested 5.0.1 vs root 5.2.0 .d.ts)
and the serialized `PrivateExecutionStep` shape BEFORE any cast; cast only on structural
identity; diff logged in lessons.

**H2 — spike rejection wrong; split the accelerator bump into a preparatory PR.** **ADOPTED**:
Delivery is now two sequential PRs — PR-0 bumps accelerator-server 1.0.6→2.0.0 against the
CURRENT 5.0.1 line (isolates the binary variable; independently revertable), merged on its own
green canary; PR-1 is the aztec bump with the canary moved EARLIER (new Phase 3 = first build +
prover-ON canary fail-fast, before the full battery).

**H3 — gates not executable as written.** Verified (`lockfile-exception-diff.ts` requires
`<old-lock> <new-lock>`; working-tree `git diff` is vacuous once edits are committed; bridge
re-derivation had no command). **ADOPTED**: plan baseline pinned (`21244d4a`); freeze-invariant
gate = `git diff 21244d4a...HEAD -- <paths>` + clean-tree check; exact lock-diff invocation via
`git show 21244d4a:bun.lock`; bridge re-derivation =
`BRIDGE_MANIFEST=public/testnet-bridge.json bun run --cwd apps/faucet verify:deployments`
(verified: opt-in at `apps/faucet/scripts/verify-deployments.ts:146`, manifest at
`apps/faucet/public/testnet-bridge.json`).

**H4 — SponsoredFPC funding vs existence; rollout timing; rollback untested.** **ADOPTED**:
Ask 2 default flipped to RECOMMEND the live sponsored drip canary (funding proof, zero-cost,
owner-authorized); rollout-coupling note added (faucet site redeploys only at the next stable
release — both derived addresses verified live on testnet); rollback note added (code revert
clean; PXE OPFS local stores may need a wipe on downgrade after 5.1's quarantine/resync —
acceptable pre-production).

## Medium

**M1 — overstated identity claim + notes-completeness as Fact.** **ADOPTED**: Security wording
narrowed to circuits/VKs/CRS/verifier/simulator identity (bb cpp/ts changed, un-diffed);
"migration notes complete" moved to Inferences.

**M2 — D1/D4 need executable form.** **ADOPTED**: reachability allowlist made an explicit
check; `bun install --frozen-lockfile` sanity added post-commit; patches generated against the
real installed 5.2.0 packages (bun patch flow), with a nested-vs-root resolution assertion.

## Low

**L1 — premature ✅ on Phase 0; seed says "six phases" for seven.** **ADOPTED**: cosmetic ✅
removed; seeds enumerate every phase header explicitly.

## Rejected (with reasons)

- Removing the `NULO_E2E_DISABLE_ACCELERATOR` kill-switch: it is the documented emergency
  rollback for the accelerator lane; changing required-gate semantics is an owner policy call —
  surfaced (Ask 5), not adopted unilaterally.
- Adding a new CI-native PrivateFPC canary job in this bump: the local full-suite prover-ON run
  covers the fee flows natively and CI already WASM-proves them; a CI-native fee lane is noted
  as an optional follow-up.

(Round 2 — final fresh-context pass — recorded below when run.)
