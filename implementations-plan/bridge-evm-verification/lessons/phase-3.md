# Phase 3 — the CI gate

## What changed

`.github/workflows/_bridge-contracts.yml`'s halmos step now runs both proof contracts in one
invocation (`--match-contract '^Formal'`) and binds each expected count to the contract that must
produce it, rather than asserting one number. It also drops the `FormalRouter.t.sol` existence
escape hatch, which made deleting the proofs a green build, and adds `set -o pipefail` since
`| tee` otherwise discards halmos's exit status.

## The finding that justified the design, found by testing the gate

While verifying the new step, halmos ran **only `FormalRouterTest`** and reported:

```
Running 4 tests for test/FormalRouter.t.sol:FormalRouterTest
Symbolic test result: 4 passed; 0 failed; time: 6.25s
```

`FormalPortalTest` produced no output at all — no error, no warning, exit 0. The cause was the
documented ordering hazard: `forge test` had run after the last `forge build --ast --force`, which
recompiles without the AST, and **halmos silently skips a contract whose AST is missing.**

That output is indistinguishable from a healthy run of the old gate. Under the previous assertion —
exactly `^Symbolic test result: 4 passed; 0 failed` — this would have been **green with the portal
proof never executing**. The proof would have looked gated from the day it landed while protecting
nothing.

The `^Formal` regex was never the problem; the artifacts were. Rebuilding the AST made both run.

## Gate verification — three negatives, one positive

The step's shell logic was extracted verbatim and run against captured `halmos.log` files, because a
gate pattern nobody has watched fire is not a gate.

| Case | Log | Gate |
|---|---|---|
| stale AST — portal proof silently skipped | real capture from the failure above | **fails**: missing `FormalPortalTest`, saw 1 summary |
| proof file moved aside | `mv test/FormalPortal.t.sol …` then rebuild | **fails**, identically — not skipped |
| both contracts run and pass | clean AST build | **passes**, exit 0 |
| a proof fails | covered by the `[1-9] failed` summary pattern | asserted |

`bun run lint:actions` exits 0.

## Why counts alone cannot police this

halmos prints one `Running N tests for <path>:<Contract>` line and one `Symbolic test result:` summary
**per contract**, with no grand total. So:

- a deleted or unbuilt proof file simply stops producing its lines — the remaining contract's summary
  still reads plausibly;
- a `check_` renamed to something else lowers one contract's count while another's could rise, and a
  single total would not notice.

Binding each count to its contract name, then requiring exactly two summaries and no non-zero failure
count, closes all three. This is the same "counts do not preserve identity" lesson that shaped Phase
2's forge assertions — it applies to the gate at least as strongly as to the tests.

## Note on the truncation gate

The plan cut it, and this phase confirms that was right for scope but records the reasoning: neither
shipped proof loops or takes a dynamic array, so `--loop` and `--default-array-lengths` cannot truncate
them. The mechanism is real and reproduced in `lessons/phase-0.md`; the moment a proof iterates over a
dynamic array, that gate becomes necessary and the `#loop-bound` fragment is the pattern to use.

## Arc-2 loop — codex closed a vacuity gap I had missed

**Round 1: "The arc catches the intended mutation today, but I would not call the proof durably sound
until one vacuity gap is closed."**

**Medium — `catch {}` accepted any revert as evidence of the guard.** The proof asserted that a second
`initialize` reverted, not that it reverted *for the reason claimed*. Codex also showed the positive
control does not close that: the control initializes `fresh`, so registry B sees `fresh` as
`msg.sender`, while the proof calls B through `locked` — a caller-sensitive mock, or any future
condition applying only to already-initialized portals, could let the control pass while the proof went
vacuous.

Fixed by matching the selector:

```solidity
} catch (bytes memory reason) {
    assertEq(bytes4(reason), NuloTokenPortal.AlreadyInitialized.selector, "rejected for the wrong reason");
```

**Verified with a third mutation the old form would have passed** — a portal that still rejects, but
with the wrong error:

```
- if (address(registry) != address(0)) revert AlreadyInitialized();
+ if (address(registry) != address(0)) revert NotInitializer();
```

```
[FAIL] check_initializedBindingsCannotChange(address,bytes32)
Symbolic test result: 0 passed; 1 failed
```

A bare `catch` would have called that green. The original two rows still hold after the change.

**Low — a fourth escape route.** `_bridge-contracts.yml`'s `run-halmos` input let the reusable workflow
pass while running no proofs at all. No caller ever set it; the input and its `if` are removed, along
with the now-empty `inputs:` block.

**Low — overlong comments.** The proof's header and `PortalReinit`'s carried shim history that belongs
in commit messages. Both trimmed. Codex judged the assertion-signalling warning and the CI AST/count
comments as earning their space, and they stay.

**Round 2 — converged. "I found no new code or CI defect"** — bar one cleanup that the selector fix
itself created, which is worth recording as a pattern: *a fix can invalidate the comments justifying the
thing it fixed.* Three had gone stale in the same commit that made them wrong:

- the proof claimed a symbolic caller would leave it "green with the guard deleted". No longer true —
  such a path now fails on `NotInitializer.selector != AlreadyInitialized.selector`. Calling directly
  is still what *aims* the proof at the init-once guard, but it is no longer what prevents vacuity;
  the selector match is.
- the proof said the positive control makes it "exercise a registry that works". On a passing run the
  guard rejects before registry B is ever called, so the control is a forge-level statement about B's
  bindings, not a property of the proof's path.
- `PortalReinit`'s header said "exhaustive input coverage": the proof varies underlying and bridge,
  while registry and initial state stay concrete.

**Pushback that held.** Codex had said the seven readbacks and the positive control were unnecessary
once the selector matched. Asked to argue it either way rather than let them stand by default, it kept
them: *"no longer required for soundness, but they preserve the stated property explicitly and give
fixture degradation an immediate Forge-level diagnosis. That is modest, local redundancy rather than
ceremony."*

**The gate's remaining boundary, stated precisely.** With `run-halmos` gone, codex found no route to
success-with-no-execution: "Missing artifacts, files, contracts, checks, setup paths, timeouts, errors,
and failed proofs all either disturb the expected lines/counts or produce a nonzero Halmos pipeline."
One boundary is real and accepted: counts bind contracts, not individual functions, so deleting one
`check_` while adding another in the same contract keeps the count green. That is a *visible same-count
substitution* in a diff, not a silent execution failure, and a per-function allowlist was declined under
the no-ceremony mandate.

**Front-run coverage confirmed sufficient**, with one correction worth recording: `BlackhatAudit.t.sol:304`
covers rejection, zero registry, the honest FIRST initialization, deposit operation and post-init attacker
rejection — but it does **not** assert `l2Bridge`. That assertion survives in the trimmed
`PortalReinit.t.sol`, so trimming further would lose it.

## Gate closed on a real CI run, not a local one

The cross-arc pass caught that this phase's gate promised "a pushed branch run of the contracts
workflow" while the evidence recorded only local checks. Dispatched for real against `arc/proofs`
(run 33202486929) rather than editing the promise down:

```
contracts-status                    success
Suites / forge build + test         success
Suites / nargo test (keystone)      success
Suites / sole-consumer static guard success
```

and, from that run's log — the point of the exercise, since a green job says nothing about whether the
proofs executed:

```
Running 1 tests for test/FormalPortal.t.sol:FormalPortalTest
Symbolic test result: 1 passed; 0 failed; time: 0.16s
Running 4 tests for test/FormalRouter.t.sol:FormalRouterTest
Symbolic test result: 4 passed; 0 failed; time: 10.75s
```

Both contracts named, both counts as asserted, on the runner rather than on a developer machine that
happened to have the right artifacts — which is exactly the failure mode that let a build-breaking
remap regression survive an entire ten-PR arc before this workflow existed.

**Scope note on the negative checks:** the proof-file-removal check was run locally against
`FormalPortal.t.sol` only. `FormalRouterTest` shares the identical assertion shape, so it was not
re-run for it; that is an inference, not an observation.

## Post-delivery: a red smoke gate that was neither the diff nor a flake

After the three PRs were linked into a GitHub stack, #483's smoke job went red at a pre-test
assertion — `token-seed source did not propagate (NULO_E2E_TOKEN_SEEDS_BUILD_STAMP absent from
dist/chrome)` — on a diff that touches no extension source. A rerun failed identically.

Cause, from the run's `referenced_workflows`: the reusable smoke workflow was resolved from
`refs/pull/483/merge`, a merge ref GitHub chains through the stack (`arc/devendor` → #481's merge ref
→ `dev`), so the *workflow* included #485, which landed on `dev` after this stack's base and added the
stamp assertion. But `pr-smoke-e2e.yml` passes the smoke job `ref: head.sha`, so the *source built*
was the PR head — pre-#485, with nothing to emit the stamp. Workflow from one tree, source from
another; the gate could not pass.

Resolution: rebase the stack bottom-up onto current `dev` (`git rebase --onto <new base> <old base
tip>` per branch, since `gh stack link` creates no local tracking for `gh stack sync`) and
force-with-lease each branch. No code change. Recorded because the fingerprint reads exactly like a
build-cache flake and the first response — a rerun — was the wrong one.
