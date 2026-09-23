# Cognitive shallow tail (arc 3 of the complexity-baseline burn-down)

Status: **delivered** across three batch PRs. Parent plan: [complexity-budgets](../complexity-budgets/plan.md).

## Scope

The 16–20 cognitive-complexity band of the shrink-only baseline (~51 functions at arc start), split by area into three sequential PRs, extract-helper refactors only — no rewrites, no behavior changes, bug-pins where behavior was surprising:

| Batch | Area | PR | Directives removed |
|---|---|---|---|
| A | wallet services + service-adjacent packages | #494 | 23 cognitive + 6 length |
| B | extension UI (pages, stores, composables, utils) | (batch-B PR) | 15 cognitive |
| C | faucet + operational tooling | (batch-C PR) | 13 cognitive + 4 length |

Each PR rebased on the prior merge and re-ran `bun run baseline:complexity`, so the generated manifest shrank monotonically with no hand edits.

## Method

- **Extract-helper only.** Every refactor extracts named helpers from an over-budget function; control flow, error identities, event order, and log payload arities are preserved verbatim. Lock-boundary naming conventions (`…Locked` / `…HoldingLock`) carried onto extracted wallet-service helpers.
- **Fence discipline under extraction.** Moving a fence-guarded write across a new `await` boundary reopens the race the fence closed: awaiting an internally-fenced helper still yields a microtask before the caller resumes. Caught once (batch B, `useProfileBootstrap.initNetworks`) by the codex loop; the fix re-checks the fence at resumption, and every batch was swept for the same class.
- **Deep-nested closures score their surroundings.** A small callback nested inside loops/branches (the `setTimeout` arrow in `createAztecWalletSession`) can carry a large cognitive score purely from inherited nesting — hoisting it to a named function at composable scope removes the score without touching a line of its logic.
- **Codex boundary review per batch** in one resumed session (adversarial transcription-error hunt: dropped conditions, reordered writes, orphaned docblocks, fence gaps). Verdicts: batch A approve (after docblock reattachment); batch B approve (after the fence fix); batch C verdict recorded below.

## In-band residue (justified, not refactored)

Harness/test entries in the 16–20 band stay baselined — refactoring test scaffolding for a score buys no production safety and churns pinned suites:

- `scripts/ci-cd/test-soak/cli.ts` (×2) — soak-matrix CLI, tooling-only.
- e2e fixtures `journal.ts` (×2), `extension.ts` — e2e harness plumbing; e2e is exempt from the length cap by design and its cognitive entries are the same class.
- two network e2e tests, `log-payload-ban.test.ts`, `footprint-coverage.test.ts`, `fee-strategy-clamp-properties.test.ts`, `FeeSettingsCard.test.ts` — test bodies whose "complexity" is enumerated scenario tables.

Also out of scope here: `smoke-swap-existing-testnet.ts` (owned by the held arc-2 PR #493) and everything above score 20 (arc 4 owns the three monsters; the 21–60 service band remains baselined pending owner appetite).

## Lessons

- Biome's per-function scoring counts nested closures separately — split points that move a closure out of deep nesting are the cheapest wins in the band.
- `fail(): never` via a const arrow does not narrow control flow for TS the way a `throw` statement does; a helper that must narrow its return should throw directly.
- The pre-commit formatter gate silently blocks commits when a `--write` invocation in a compound command fails unnoticed — verify with `git log -1` after every commit.
