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
*Nuance — corrected TWICE*: this triage first claimed the `fee-methods` shard is
"real-WASM-proved", citing a stale in-workflow comment. PR-0's code-review pass established the
truth from `pr-network-e2e.yml` inputs: fee-methods and heavy-concurrent run
**`proverless: true` (STUB — no real proofs at all)** post-split. Codex's original "this
fund-sensitive boundary never receives a real proof [in CI]" was therefore RIGHT. The
mitigation stands and gains weight: the Phase 4 local required-mode full-suite run is the ONLY
real-proof fee-flow coverage; the optional CI-native fee lane remains a surfaced follow-up.

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
  covers the fee flows natively (and is their ONLY real-proof coverage — CI's fee lanes are
  proverless stubs, see the corrected nuance above); a CI-native fee lane is noted as an
  optional follow-up.

# Codex audit — round 2 (final fresh-context pass, new session, xhigh, gpt-5.6-sol)

Verdict: **conditional approve** (conditions: hard-enforce native proving; repair post-review
and PR-handoff gates; make the patch/residue/provenance checks executable). Consolidation
judged "architecturally coherent"; the D7 two-PR split "defensible once its handoff and
rollback rules are corrected". ALL conditions adopted:

- **Critical 1**: Phase 4's full suite now runs `VITE_NULO_ACCELERATOR_REQUIRED=1` (silent WASM
  fallback impossible suite-wide) with per-fee-flow `/prove` evidence.
- **Critical 2**: Ask 5's fail-on-zero enforcement, if approved, ships in PR-0 (guarding PR-0's
  own authoritative CI canary); final pass recommends approving it — recommendation surfaced,
  decision stays the owner's.
- **High 1**: Phase 0's SponsoredFPC probe got PASS CRITERIA (non-null both generations +
  balance above a 10×-min-fee floor; below ⇒ STOP + reopen Ask 2).
- **High 2**: post-loop re-gate expanded (audit:vue, test:all, lint:actions, residue script,
  freeze diff, canary rerun when the loop diff touched runtime code, any touched phase gate).
- **High 3**: D3 decided by an explicit A/B (CI-equivalent `BB_BINARY_PATH` seed run, record
  requested-vs-executed bb, clear cache/unset and rerun on mismatch).
- **High 4**: Phase 1 reordered install→patch→reinstall (`bun patch` needs the package
  installed).
- **High 5**: two-PR handoff protocol added (PR-1 cut fresh from post-PR-0 dev; baseline
  re-pinned to that OID for all freeze-diff gates; up-to-date CI at merge; rollback order PR-1
  then PR-0 — reverting PR-0 alone creates the untested 1.0.6+5.2.0 pairing).
- **High 6**: residue script spec = dependency-CLOSURE ancestry + per-workspace
  `realpath`/`require.resolve` runtime verification, named `scripts/aztec-hold-residue-check.ts`,
  invoked by name in every later gate.
- **High 7**: provenance = scratch npm lock built from the exception-diff's exact resolved
  set → `npm audit signatures` (cryptographic verification) + bun-vs-npm integrity cross-check.
- **Medium**: accelerator's bundle mode documented as HYBRID (nested 5.0.1 + Vite-deduped
  5.2.0 acvm/abi leaves); explicit loopback bind + socket assert; stale Phase-2 re-diff gate
  criterion removed; "no broadcasts" qualified (Ask-2 canary is the one candidate, post-merge,
  owner-gated).

Nothing rejected in round 2.
