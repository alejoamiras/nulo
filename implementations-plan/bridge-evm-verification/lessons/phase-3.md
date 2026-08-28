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
