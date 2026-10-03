# Arc 11, estimate-reuse: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh): REVISE, one blocker. Opus: REVISE, text changes only.** The batch plan's Decisions block records every finding with its disposition.
- **The blocker.** A combined snapshot producer (`builtReuseSnapshot`) would have moved a read in each producer: PT's fingerprint before `requireActiveProfile`, PO's `builtFees` before `crypto.randomUUID()`. It was dropped. Both producers swap only the primary lookup.

## Build

- **Base.** Rebased onto `origin/harden-dedupe` at `fe9e6777` (#773), newer than the named `eb06c37d`; none of the newer commits touches this arc's files.
- **Phase 1** (`c23ee9de`, test only) is green on unchanged code: two new pins files (both ladders, step by step), the producers' snapshot entries and read order, the activity record field by field, `addTransaction`'s stored bytes, in-lock call order and duplicate refusal, and every estimate cancel checkpoint.
- **The stored row's `status` is the enum's number.** The raw-bytes pin first expected `"pending"`; `TxStatus.Pending` serializes as `0`.
- **`[0]?.[1]` fails Biome** (`noUnsafeOptionalChaining`) when the result is then dereferenced; `mock.calls[0][1]` is the fix.
- **Phase 2** in two commits (`e13b2d53`, `21293c89`). Test edits were limited to the import specifiers, the two `recordedTx` bodies and the `add` helpers. The new `recordedTx` also asserts a single argument and `Object.keys(input)` equal to the positional field order, since key order is evaluation order in a literal.
- **Phase 3a needed a correction before its fix landed.** Two mistakes, both in the tests, found when the fix ran:
  - A `mockRejectedValueOnce` replaces the traced implementation, so the trace never records `predictedWorstMinFees`. The pin now asserts the trace up to the read and counts the read on the mock.
  - `fpc` and `fj` take the folded pipeline (`discovery-aware-estimator.ts`), not `discoverPrivateAuthwits`; the executor pair now discovers through the folded build's probe.

  The unpushed 3a commit was amended, then re-proved red at its parent before the fix was reapplied.
- **3a red output** (at `21293c89`): 18 failed, 140 passed across the two files.
  - The 16 VO cases: `block not found` escapes; `undefined is not an object (evaluating '(await predictedWorstMinFees(node)).mul')`; `null is not an object (…)`; `(await predictedWorstMinFees(node)).mul is not a function. (In '(await predictedWorstMinFees(node)).mul(multiplier)', …)`.
  - The executor pair: the confirm rejects with `block not found` instead of rebuilding, or of refusing on the preview.
  - The unknown-priority bare-object pin is green at both commits, as intended.
- **3b** (`e93a3400`) touches `operation-estimate-reuse.ts` alone; the composition expression is byte-identical.

## Engine probes (build time)

Every reference expression, bound to the production local names, on Firefox 153.0.4, Chrome 152, Node 24 and Bun 1.4.2:

| expression | Firefox | V8 (Chrome, Node) | Bun |
|---|---|---|---|
| `GasFees.mul` on an unknown or prototype priority | `NaN can't be converted to BigInt because it isn't an integer` | `The number NaN cannot be converted to a BigInt because it is not an integer` | `Not an integer` |
| VO composition, `undefined` / `null` reply | `can't access property "mul" of undefined` / `of null` | `Cannot read properties of undefined (reading 'mul')` | `undefined is not an object (evaluating '(await predictedWorstMinFees(node)).mul')` |
| VO composition, bare-object reply | `(intermediate value).mul is not a function` | same | `(await predictedWorstMinFees(node)).mul is not a function. (In …)` |
| VT re-wrap, `undefined` reply | `can't access property "feePerDaGas", basis is undefined` | `Cannot read properties of undefined (reading 'feePerDaGas')` | `… (evaluating 'basis.feePerDaGas')` |
| rejected alternative (a named `basis`), `undefined` reply | `can't access property "mul", basis is undefined` | same as the composition | `… (evaluating 'basis.mul')` |
| PO lookup before / `findPrimaryEndpoint(built.network)` | `built.network.endpoints is undefined` / `network.endpoints is undefined` | identical | `'built.network.endpoints.find'` / `'network.endpoints.find'` |

The PO difference reaches only the best-effort `try`'s debug line. The rejected alternative would have changed Firefox's and Bun's text, which is why the fix keeps the composition inline.

## Mutation check

- **Method.** 77 mutants over the plan's 17 categories, each applied alone to the source, the execution and transaction suites run, the file restored from a scratch copy (never git). A kill is a test that ran and failed.
- **Result: 76 killed, 1 survivor, now killed.** Deleting `assertEstimateBinding` on the NO_FROM confirm (`enforcePreview`) left every test green; the next commit pins it (an `estimateId` paired with another `previewId` is refused before the snapshot is consumed), and the re-run kills it.

| # | category | mutants | killed |
|--:|---|--:|--:|
| 1 | `?? endpoints[0]` at PT, PO, VT, VO | 4 | 4 |
| 2 | PT pending hoisted above the profile read; PO above the FPC read | 2 | 2 |
| 3 | fingerprint from a fresh read (PT, PO) | 2 | 2 |
| 4 | `profileId` from the fence (PT, PO) | 2 | 2 |
| 5 | multiplier as `?? DEFAULT`; `normal` as the default | 2 | 2 |
| 6 | each `primaryEndpointMoved` clause; VT's `!primary` reject | 4 | 4 |
| 7 | each chain field (2), FPC field (4), VT input (7) | 13 | 13 |
| 8 | each ladder's TTL guard | 2 | 2 |
| 9 | `feeReadFailed` guard deleted / as `=== undefined`; `getNode` inside the `try` | 3 | 3 |
| 10 | each producer eligibility clause (PT 2; PO 6, plus the null-fingerprint exit) | 9 | 9 |
| 11 | same-typed field swaps and `networkId` from the fence, per recorder | 9 | 9 |
| 12 | RS without the `await` | 1 | 1 |
| 13 | `Tx` keys reordered; duplicate check deleted; owner check after it | 3 | 3 |
| 14 | each cancel checkpoint (12); `throwIfAborted` with a non-empty id | 13 | 13 |
| 15 | `primaryMethodCalls` eager (2 paths); the first call only | 3 | 3 |
| 16 | `offchainOutputOf` without `BigInt` | 1 | 1 |
| 17 | binding deleted (standard, NO_FROM); foreign lookup accepted; `assertWithinPreview` deleted | 4 | 3, then 4 |

## Gates

`bash gates.sh` at `f639d7f4`, and again at `494274b9` (after the review's comment-only commit, with this log staged): lint, typecheck:all, test:all (extension 9,293 passed), test:ci-gating and audit:vue all green. `audit:vue` builds; the tree stayed clean, so the generated declaration files are unchanged.

## Code review

- **Round 1** (Codex, GPT-6 Astra, xhigh, the plan-audit session resumed): CONVERGED, no blocker or should-fix; two comment nits, both adopted in a comment-only commit.
  - `reuseFeeMultiplier`'s doc claimed "the multiplier a fresh build finalizes with", false for an unknown key (a fresh build defaults it; reuse keeps the failure). Reworded.
  - `offchainOutputOf`'s doc narrated its body and `ReuseEntryBase`'s "Cache lifecycle." added nothing: both deleted. `primaryMethodCalls`'s paragraph condensed to its one invariant.
- **What the reviewer checked independently:** all twelve built-in `Object.prototype` keys yield a non-number from the table, so `feeReadFailed` rethrows the original error object for every one; the catch covers only the read and `.mul`, never `getNode`, the chain or FPC steps, or fingerprinting; consumption precedes validation, so a rejection cannot re-expose the signed request. It reproduced four mutants in memory (both TTL guards, the unknown-priority rethrow, the NO_FROM binding).
- **Correction.** The review prompt said 86 mutants; the run had 77 (the table above).
- No round 2: round 1 had no material finding.
