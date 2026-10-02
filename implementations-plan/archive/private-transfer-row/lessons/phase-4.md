# Phase 4 · End to end, the as-built pictures, and the owner's sign-off

- **Built.** `apps/extension/tests/e2e/network/tx-transfer-row.test.ts`, one test on
  `dappConnectedExtensionWithTransactionCap`: mint to the granted account, import the sandbox Token
  from Home, then the playground's `sendTx default` and `createAuthWit (callIntent)` with a random
  254-bit nonce, each window read and rejected. The payload row's title is read from the text of
  the row its testid names, since the title has no testid of its own. The first cut read the
  nonce's hover text off any titled descendant of its row; codex round 1 flagged that as a
  structural query, and the value now carries `${prefix}-transfer-nonce-value`.
- **Every run** went under the host e2e lock with `NODE_OPTIONS=--dns-result-order=ipv4first`, one
  at a time, and each runner tore down only its own sandbox and browsers.
- **Network (step 3), first run, at `466434b1`** (before the rebase): `NULO_E2E_RETRY=0
  NULO_E2E_SHOT_DIR=<scratch> bun run e2e:agent tests/e2e/network/tx-transfer-row.test.ts
  tests/e2e/network/authwit-variants.test.ts tests/e2e/network/tx-sendTx-multicall.test.ts`,
  prover-ON on the runner's own sandbox: 3 files, 7 tests passed, 0 failed, 231 s. The node's boot
  printed `Error: Address already in use (os error 98)` and still came up ready; nothing failed.
- **Smoke (step 2), first run, at `466434b1`:** the armed `build:chrome`, then
  `NULO_E2E_MIGRATION_FIXTURE=1 NULO_E2E_BROWSER=chrome bun run --cwd apps/extension test:e2e
  --retry=0`: 40 files passed and 3 skipped (the env-gated probe and two capture files), 166 tests
  passed, 7 skipped, 0 failed, 1118 s.
- **Final runs, at `a3654bed`** (rebased on `dev` @ `c09c4972`, after the codex loop, whose round 1
  touched `CallArguments.vue` and the spec): network, the same command, 3 files, 7 tests passed,
  0 failed, 199 s; smoke, the same commands, 40 files passed and 3 skipped, 166 tests passed,
  7 skipped, 0 failed, 1142 s.
- **Pictures.** The spec's `shotSend` shots of both windows in both themes, and a throwaway harness
  outside the tree that renders the real `OperationCard` for five surfaces before and after. The
  "before" side serves the base revision's copies of the four changed modules (`git show
  <base>:<path>`) through a Vite `load` hook, so both sides render the same request. The pictures
  went to the owner on the as-built Artifact.
- **Sign-off.** The owner signed off the as-built pictures on 2026-10-01, relayed by the
  coordinating session, verbatim: "regarding the questions of private row: A2: drop. Playground:
  follow-up. And the artfiact looks great. singed-off". I4 becomes a follow-up; the
  more-than-32-fields test is dropped. Quoted in `plan.md` (UI impact). P4's gate holds: both
  suites exit 0 at retry 0 with their SHAs above, and the sign-off is quoted.
