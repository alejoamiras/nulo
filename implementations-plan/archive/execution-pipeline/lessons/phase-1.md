# execution-pipeline — lessons (both PRs)

## PR-a (#506, 111→106)

- **The generator inserted directives 1× here too** (as in plans 1–2): the first
  builder split left `buildStandard` at 85 lines. Cut deeper (the action loop's
  accumulators moved into `newCollectedActions()`, the tail into
  `finalizeStandardBuild`) rather than shipping the inserted directive.
- **Codex's pin audit was worth the round-trip**: seven concrete
  fault-insensitivity findings against the first pin set (chainId=0 made the
  mixed-arm drift assert a no-op; registry-call args unchecked; gasSettings and
  buildMeta provenance unpinned; single-capsule order-blind; extractContracts
  not held behind the drift assert). All strengthened + one drifted-identity pin
  added; codex re-verified 18/18.
- **bb.js under jsdom** still bites in new pin files — the `// @vitest-environment node`
  pragma is the pattern (builder pins compute real selectors).

## PR-b (#507, 106→100)

- **Biome's cognitive complexity charges lambda-nesting rent**: a `setTimeout`
  arrow inside a closure inside a factory pays +2 nesting on EVERY branch, so a
  6-branch callback scores 17. The fix that actually works is hoisting the body
  to a module-level function (nesting 0) and passing the closures in — trimming
  branches inside the nested lambda barely moves the number.
- **Two interim generator insertions** (90-line `wireExecutors`, the score-17
  timer arrow) — both cut deeper, zero shipped. Round-2 running total of the
  "regen diff catches what the count hides" rule: 7 insertions caught across 3
  plans.
- **The codex catch that mattered — a promise-settlement hop on a
  register-immediately span**: `createTransferJournal` returning just the id
  moved `registerController` one settlement hop after the durable `pending` row
  became visible. A cancel landing in that hop transitions the row terminal,
  finds no controller, and the swallowing `markJournal` lets proving continue.
  Same class as PR-a's claim-helper triplet rule: **any helper that creates a
  cancellable resource must own the create→register span and return both**.
- **Tick-precise hop pins are writable**: resolve the create promise manually,
  then `await Promise.resolve()` EXACTLY once — that drains the helper's own
  await-resumption, so `registerController` must already be called. Verified
  fault-sensitive by temporarily reinstalling the id-only return (2/2 red).
- **After a squash-merge auto-deletes the remote branch**, the local tracking
  ref goes stale and `--force-with-lease` rejects with "stale info" while
  `git fetch <branch>` says the ref doesn't exist. Fix: `git remote prune
  origin`, then a plain `push -u` (the branch is being re-created).
- **e2e note**: `tx-sendTx-delegated-authwit` is env-gated
  (`NULO_E2E_STANDARD_CONTRACTS=1`, testnet-only — the local sandbox lacks the
  canonical PublicChecks contract). 12 runnable specs is the full local gate.
