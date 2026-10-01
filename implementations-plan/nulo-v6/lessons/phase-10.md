# Phase 10 · Close-out

## Step 2 · Lessons

- **The two `lessons.md` entries tagged 5.2.0 hold on 6.0.0-rc.1**, checked against the installed
  packages on 2026-10-01:
  - The node client: rc.1's `createAztecNodeClient` builds its fetch with `makeFetch([1, 2, 3],
    false)` (`@aztec-labs/stdlib` `dest/interfaces/aztec-node.js`), and `defaultFetch`
    (`@aztec-labs/foundation` `dest/json-rpc/client/fetch.js`) throws `NoRetryError` on a 4xx while
    a JSON-RPC error on HTTP 200 returns as a reply. So it still retries a failed POST three times
    and never a node's refusal. Re-dated to 6.0.0-rc.1.
  - The fee-juice import: `@aztec-labs/protocol-contracts/fee-juice` (`dest/fee-juice/index.js`)
    still loads `artifacts/FeeJuice.json` at import, now 702,469 bytes, and the package still
    declares no `sideEffects`. `apps/extension/src/wallet/utils/fee-juice-balance.ts` keeps it out
    of the barrel. Re-dated, with the new scope and size.
- **The `bun test` entry holds too.** A scratch `bun test` file importing rc.1's
  `@aztec-labs/foundation/dest/curves/bn254/field.js` with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`
  failed at load with `TypeError: expect.addEqualityTesters is not a function` (Bun 1.4.2), so
  only its scope is renamed.
- **New gotchas went to the `aztec-update` skill's Gotchas**, since `lessons.md` stood at 8,131 of
  8,192 bytes: rc.1's `SimulationResult` beside the e2e typecheck gap; the first CI run on a new
  line without a toolchain cache; the two steps that call the GitHub API with no token (presto-
  server's bb fetch, the landing prebuild) and the private `PRESTO_HOME` plus warm-up for local
  prover-ON canaries; upstream's JSON-RPC client printing the node URL, so scripts use the silent
  client. Each is from this plan's `lessons/phase-5.md`.

## Step 3 · Follow-ups

- P8 and P9 did not run: unleashed's V6 manifest waits on its generation deploy, and the owner did
  not call the store upload. Both moved to `follow-ups.md` § Aztec V6 with their steps here as
  the spec, together with the plan's other follow-ups.
- Two of the plan's follow-ups did not move: the e2e mint guard, fixed in arc A (`10aa5acc`), and
  the stores' review outcomes, which exist only if P9 runs.
- The tools extraction's P1 entry is deleted: P7's landing checks passed.
- "The gas link and USDC on mainnet" became "The gas link": the mainnet USDC seed left with Alpha.

## Validation gate

<!-- FILL: test:ci-gating, lint, lessons.md bytes. -->
