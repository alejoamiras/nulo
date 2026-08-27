# bridge-hardening — revival goal

Standing brief for reviving and landing the abandoned hardening arc: **PRs #435–#444** on
`hardening/*` branches. The arc's own plan, audit and lessons live alongside this file
(`plan.md`, `audit-blackhat.md`, `econ-matrix.md`, `txe-ts-map.md`, `lessons/`) — but note they
exist **only on the arc branches**, not on `dev`.

## Owner decisions (settled — do not re-litigate)

| Question | Decision |
|---|---|
| L-5 zero-recipient fix vs. testnet redeploy | **Descope.** Pull the contract change out of #442; L-5 ships later in its own PR sequenced with a real redeploy. |
| Stack topology | **Merge as a stack.** Land the arc as one unit; intermediate PRs need not each be independently deployable. |
| #436 deployer-key custody risk | **Accepted.** Losing the deploying key between `deploy` and `initialize` bricks the portal permanently, no recovery path. Owner has signed off. |

## Established findings — do not re-derive

- **Nothing under `contracts/` runs in CI or in `audit:vue`.** No workflow mentions
  forge / nargo / halmos / txe; no paths-filter references `contracts/`. Every "N passed" claim
  in every PR body is an unverified local run by a departed agent. **Green CI on this stack is a
  false signal** — the checks that pass are structurally incapable of touching the contract diff.
- **#442 / #443 CI red is a correctly-firing gate.** #442 slipped a production contract change
  (`contracts/bridge/aztec/token_bridge/src/main.nr:99`, the L-5 zero-recipient assert) into a
  `test:`-scoped PR. That changed bytecode → class-id → the derived TokenBridge address, so
  `verify:deployments` reports `[DRIFT] bridge.bridge` against the live-deployed address in
  `apps/faucet/public/{testnet,mainnet}-bridge.json`. `quality-status` gates on `build-faucet`
  (`.github/workflows/pr-quick.yml:288`), so this fails a **required** check.
- **Two undisclosed scope changes found so far.** (1) the L-5 assert above; (2) #444 regressed
  invariant I2 in `contracts/bridge/evm/test/SwapBridgeRouterInvariant.t.sol:36-42` from
  real-balance sinks back to a ghost-vs-ghost comparison that can never fail — silently undoing
  the fix #438's own second commit had made. Neither was disclosed in its PR body.
- **Process gaps.** Zero reviews on all 10 PRs. Zero `/code-review`, zero fable. One codex pass,
  run retroactively over the finished stack rather than per-arc, with no `audit-codex.md` saved
  and a self-contradictory round count (PR title "r1" / commit "rounds 1-3" / plan table
  "4 rounds"). The stack is hand-chained via `--base`, not `gh stack`-managed.
- `implementations-plan/index.md` has no `bridge-hardening` entry.

## Phases

### P0 — home + honest baseline

`EnterWorktree` slug `bridge-hardening-revival`; register in `~/.agents/workspaces.md`.

Establish what actually passes, because no number in this stack is trustworthy:
`forge test` in `contracts/bridge/evm` (run `gen-remappings` first),
`contracts/bridge/aztec/scripts/run-txe-tests.sh`, the keystone nargo tests, and halmos 0.3.3
(installs clean on Linux, whole suite runs in ~6s). Record real pass/fail counts in
`lessons/phase-0.md`. Long runs go in tmux.

This is a one-time baseline, not a habit — once P4 lands, CI becomes the heavy-test gate and
local runs go back to being targeted. A red suite here **is** the finding; report it, don't
paper over it.

### P1 — descope L-5 (unblocks CI)

Pull the contract change out of #442 so the branch is honestly test-only and class-id parity with
the live deployment is restored:

- revert the assert at `token_bridge/src/main.nr:99`
- revert the recompiled `token_bridge/target/token_bridge_contract-TokenBridge.json`
- revert the class-id pin in `packages/bridge-core/src/noir-artifact-classids.test.ts`
- remove the two now-unsupported tests (`claim_public_zero_recipient_rejected`,
  `claim_private_zero_recipient_rejected`)
- restore the L-5 row in `plan.md`'s disposition table and note the follow-up

File L-5 as its own `fix(bridge):` PR, sequenced with a real redeploy, out of this arc's scope.
**Never** hand-edit manifest addresses to force green — that points the faucet at a contract that
isn't deployed. Note `apps/faucet/package.json` has `deploy:testnet` only; there is no
`deploy:mainnet` script, which the future L-5 PR will need.

### P2 — undisclosed-change sweep

For each of the 10 PRs, diff what the code actually changes against what the PR body claims. Two
are known (above); find the rest. Restore I2 to #438's real-balance form. Report every mismatch
before fixing it.

### P3 — test quality

Complete each branch's own intent. Do not invent new scope.

- **#435** — hermetic-ize the M-1 validation test; it's RPC-gated even though `_validateRoute`
  makes no PoolManager calls, so the arc's Medium finding currently has weaker regression cover
  than its High. `test_FE` → `vm.expectRevert(stdError.arithmeticError)` instead of a bare
  `expectRevert`. `test_FF` overclaims — the mock Permit2 never validates witnesses, so it can't
  prove "migration invalidates a pending signature"; rename to what it proves or drop it as
  subsumed by the existing 12-field witness fuzz. Fix the stale "4 tests" claim (3 exist).
- **#436** — land `PortalReinit.fork.t.sol` (explicitly deferred, never written). Add an
  `initializer()` preflight read to both deploy conductors so a wrong-key resume fails fast.
  `audit-blackhat.md`'s H-1 section still says "move initialization into the constructor",
  contradicting the guard that actually shipped.
- **#437** — add the hermetic fake-PoolManager partial-fill regression the plan already tracks as
  a follow-up; every existing settlement test seeds liquidity so deep (L=1e24 against ≤1000-ether
  trades) that a partial fill can never occur, so "zero residue" passes vacuously w.r.t. the bug
  it should catch. Pin the `weth bridge shortfall` and reverse-unwrap revert paths. Fix the stale
  `_settle Case C` comment at `UniswapFuelSwap.sol:270`.
- **#438** — invariant I3 is unfalsifiable: the swap target is `setOutput(1 ether, 0)` on install
  (`:94`) *and* after every rotation (`:180`), so report always equals transfer and 128k handler
  calls prove nothing. Add a hostile-target handler action. `donate()` (`:150`) scales by `1e6`
  for both 6-decimal USDC and 18-decimal FJ, capping FJ donations at ~5×10⁻¹⁰ against a 1-ether
  real flow. Pin `[fuzz]`/`[invariant]` in `foundry.toml` — runs, depth and `fail_on_revert` are
  all unpinned tool defaults today. Broaden the Noir fuzz past adjacent `(x, x+1)` pairs. Add the
  settlement fuzz the plan promised and never shipped.
- **#439** — **two of four checks are vacuous.** `check_sweep_revertsForNonOwner` passes with
  `onlyOwner` stripped off `sweep()`, a direct fund-drain primitive (verified empirically).
  Cause: failure is signalled with `revert("string")` at `FormalRouter.t.sol:136,148`, which
  Halmos cannot see — it only detects forge-std `assert*`/`fail()` or an EVM Panic. Use
  `assertTrue(false, ...)`. Also decouple the sweep recipient from the symbolic caller (`:134`),
  so the incidental `caller == address(0)` path can't mask a real failure.
  `check_setSwapTarget_revertsForNonOwner` shares the defect and escapes only by luck. Re-run the
  strip-`onlyOwner` experiment after fixing to confirm it now FAILS with a counterexample. Pin
  `halmos==0.3.3`. The two accounting proofs are genuinely sound — keep them symbolic, don't
  downgrade to fuzz.
- **#440** — `apps/faucet/src/composables/useFuel.ts:211` still hardcodes
  `Date.now()/1000 + 1800`, a third signing site that both the PR body and `econ-matrix.md:16`
  claim doesn't exist. Add a reachability test that the shared constant is actually consumed at
  each call site (value-only pins don't catch a reverted refactor). Add error copy for a
  deadline-expiry revert, which the tightening makes more likely.
- **#441** — `fuel-target.test.ts` never asserts against the canonical `PRIVATE_FPC_ADDRESS`, so
  any address-shaped constant passes; import it and compare directly. Route the 3 remaining
  inline ternaries (`useDeposit.ts:761,953`, `useFuel.ts:120`) through the helper.
- **#442** — mirror the pause and zero-recipient tests for `exit_to_l1_private` (guards exist,
  only the public path is tested); add `claim_private` double-claim; `set_token` owner-gate and
  single-shot tests; direct-bypass tests for `burn_public` / `mint_to_private` / `burn_private`;
  an `assert_bridge` `only_self` probe; insufficient-balance exits. Noir `should_fail` passes
  vacuously if an earlier step reverts — upgrade to `should_fail_with` per the arc's own lessons
  doc. 24 tests exist; the body says 16.
- **#443** — the "conformance oracle" is a hand-transcribed copy of the Solidity rules inside the
  test file; nothing executes `_validateRoute`, and all 3 cases assert `toBeNull()`, leaving the
  oracle's 8 rejection branches uncovered. Add mutation cases. Delete dead line `:39` (duplicate
  of `:34`); fix tautological `:24`. Rescope the header comment claiming parity with
  `RouteGrammarFuzz`.
- **#444** — `assertSame(observedInit, account.address, ...)` is vacuous:
  `assertRuntimeMatchesTemplate` returns its own input, so the comparison is true by
  construction. `MAINNET_RPC` is a Sepolia URL and the fork tests now default to hitting a live
  public RPC instead of skipping. Test the `committedRefs` drift branch in
  `rebuildAndVerifyPortal`.

### P4 — CI wiring (the biggest lever)

Add `contracts.yml` + `_bridge-contracts.yml` per the repo's per-package convention,
`dorny/paths-filter`ed on `contracts/bridge/**`, running the hermetic forge set + keystone nargo
+ halmos (~6s, so runtime is not an argument against gating it). TXE behind a manual/self-hosted
gate until the oracle server ships in CI images. Pin `forge-std`, `v4-core@v4.0.0` and OZ to
commit SHAs per the supply-chain default — the README currently installs by floating tag.

This closes the plan's own tracked follow-up and is what makes every test in the arc mean
anything going forward.

### P5 — the quality loops this arc never got

Per arc, in stack order: `/code-review max --fix`, then an iterative codex `xhigh` fix loop until
clean. Save `audit-codex.md` this time. Reconcile the round-count contradiction. Then one final
cross-arc pass.

### P6 — docs

Add `bridge-hardening` to `implementations-plan/index.md`. `plan.md` documents only Arcs 1–5 —
write 6–10. Fix `audit-blackhat.md`'s stale H-1 text and the L-5 disposition row. Record the
accepted deployer-key custody risk (see decisions table) so the next reader doesn't re-raise it.

### P7 — land

Restack properly under `gh stack`, un-draft in order, babysit to green, then land the arc as one
unit. PR titles ≤93 chars, budgeting the squash `(#NN)` suffix.

## Non-negotiables

- Never weaken, neutralize, or remove a gate to get green. Flake → re-run. Real breakage → fix.
- Never force green by editing deployment manifests.
- Ask before any deploy or anything touching operator secrets.
- Network e2e runs alone on this box.
- Keep commit signing on (this machine signs non-interactively).
- Complete what each branch set out to do; do not over-engineer past it.
