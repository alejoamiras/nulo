# Phase 5 · Browser proof and the arc gate

## Red run on `85c4d20f`'s behaviour

- How: the nine production files this build changed (`journal-state.ts`, `background.ts`,
  `error-envelope.ts`, `queued-journal.ts`, `errors.ts`, `dispatcher.ts`,
  `method-scope-checkers.ts`, `scope-enforcement.ts`, `jobs/types.ts`) were swapped for their
  `85c4d20f` content by a script that kept copies in the scratch directory. `error-envelope.ts` also
  carried the two envelope constants the spec imports, spelled without `ScopeViolationError`, which
  no base code reads. `e2e:agent` built the wallet from that tree and ran `scope-refusal.test.ts`;
  the copies went back and `git status` showed only the new spec.
- `NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/scope-refusal.test.ts
  --retry=0` (Chrome, prover on): exit 1, 1 ran, 0 passed, 1 failed, 0 skipped. Red on the envelope
  and the category, as planned:
  - the dApp's error was `"The wallet could not process the request."`, not the scope envelope;
  - the journal detail read "Popup closed early" / "The popup closed before this transaction could
    finish.", not "Not allowed" and the O1 (b) sentence.
- Green there: the answer's and the stored transaction grant list the other contract, no window
  opened for the send, exactly one `dapp_execute` row exists, its state is "Failed", and the error
  block is absent with developer mode off. The run fails at that combined assertion, so the
  developer-mode text was not reached on the base; P1 pins it at unit level.

## Green at HEAD, and the network runs

- Chrome, prover on: `NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent
  tests/e2e/network/scope-refusal.test.ts tests/e2e/network/data-privateEvents.test.ts
  tests/e2e/network/authwit-variants.test.ts tests/e2e/network/cap-request-rerequest.test.ts
  --retry=0`: exit 0; 4 files, 8 ran, 8 passed, 0 skipped (scope-refusal 1, data-privateEvents 2,
  authwit-variants 4, cap-request-rerequest 1).
- Firefox, proverless (`NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1`, the same command and
  files): exit 0; 4 files, 8 ran, 8 passed, 0 skipped. The build stamp confirmed the proverless
  build.

## A red `test:all` run, and its cause

- The first `bun run test:all` of this phase ran beside the Firefox network run (its wallet build
  and sandbox boot) and exited 1: `src/presto/client.test.ts › returns one PrestoClient per module
  instance` timed out at 5000 ms on its cold `import("./client")` after `vi.resetModules()`; every
  other test passed (extension 8071 passed, 1 failed).
- The cause is known and filed: `implementations-plan/follow-ups.md` records that this test makes
  the same cold dynamic import after `vi.resetModules()` that #719 took out of two other timed
  tests, and times out under load. The load here was this build's own concurrent e2e run. The file
  touches nothing this build changed. The gate was rerun alone, with nothing else running.
- The rerun, alone: `bun run test:all` exit 0, every workspace exited 0. Extension 606 files passed,
  3 skipped; 8072 tests passed, 4 skipped, 8 todo. wallet-bridge 508, extension-messaging 240,
  wallet-core 247, aztec-runtime 250 passed and 2 skipped, wallet-crypto 120, design 401,
  third-party-notices 66, legal 54, landing 40, resolve-asset 14, wallet-sdk-schema-patch 11,
  passkey-rp 5 passed and 6 skipped.

## Flake bar

`scope-refusal.test.ts` and `data-privateEvents.test.ts`, three consecutive retry-0 runs per
browser. Run 1 of each is the four-file run above; runs 2 and 3 ran only the two files.

| Run | Chrome, prover on | Firefox, proverless |
|---|---|---|
| 1 | exit 0; 3 ran, 3 passed, 0 skipped | exit 0; 3 ran, 3 passed, 0 skipped |
| 2 | exit 0; 3 ran, 3 passed, 0 skipped | exit 0; 3 ran, 3 passed, 0 skipped |
| 3 | exit 0; 3 ran, 3 passed, 0 skipped | exit 0; 3 ran, 3 passed, 0 skipped |

## Local gates

- `bun run lint`: exit 0; 1903 files, 29 warnings and 3 infos, the same as before this phase;
  complexity-baseline check OK.
- `bun run typecheck:all`: exit 0; every workspace exited 0.
- `bun run test:all`: the quiet rerun above.

## Smoke

The CI smoke job's build per browser (`VITE_NULO_E2E_MIGRATION_FIXTURE=1`,
`VITE_NULO_E2E_DEFAULT_NET=testnet`, `VITE_NULO_E2E_TOKEN_SEEDS=1`,
`VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1`, the token-seed markers checked in the bundle), then
`NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0`.

- Chrome, at `1b914571`: exit 0; 41 files, 38 passed and 3 skipped; 164 tests, 157 passed and 7
  skipped. The skips are by design: `action-popup-layout.test.ts` runs on Firefox only, and
  `_probe-console-capture.test.ts` and `store-captures.test.ts` run only when their environment
  variable is set.
- Firefox, first attempt, unsharded at `0dc997fd`: stopped by hand after 6 of 41 files had passed
  and none had failed, when the owner asked (2026-09-29) for sharded e2e runs. It is not counted.
- Firefox, sharded as the owner asked: the same armed build (`dist/firefox`, built at `0dc997fd`)
  copied to `dist/smoke2` and `dist/smoke3`, so no shard's path prefixes another's; three parallel
  shards (`--shard=i/3`), each with its own `EXTENSION_PATH`, `NULO_E2E_MIGRATION_FIXTURE=1` and
  `--retry=0`.

  | Shard | Files | Tests | Exit |
  |---|---|---|---|
  | 1/3 | 14: 13 passed, 1 skipped | 52: 51 passed, 1 skipped | 0 |
  | 2/3 | 14: 13 passed, 1 skipped | 45: 41 passed, 4 skipped | 0 |
  | 3/3 | 13: 13 passed | 67: 61 passed, 6 skipped | 0 |
  | Sum | 41: 39 passed, 2 skipped | 164: 153 passed, 11 skipped | 0 |

  The skips are by design: the probe and the store captures run only when their environment
  variable is set, `import-dead-rpc.test.ts`'s CDP Fetch block and one `sw-resilience.test.ts` case
  are Chrome-only (`CHROME_ONLY`), and one case each in `appearance.test.ts` and
  `sw-resilience.test.ts` is `test.skip` on every browser.

## The rest of the gate

- `bun run build`: exit 0, at `0dc997fd`.
- `bun run test:ci-gating`: exit 0; 244 passed, 2 skipped, 0 failed (246 tests, 17 files). The
  plans gate's three `path-token` reports are in files this build does not touch; 0 enforced.
- `bun run e2e:reap`: exit 0, nothing to reap.
- The only commit between the network runs and these steps is `0dc997fd`, a one-line comment
  change in `method-scope-checkers.ts` (the codex loop's round 1).
- `git fetch origin dev` hung inside `ssh` with the SSH agent set; `SSH_AUTH_SOCK= git fetch
  origin dev` returned at once. `dev` had not moved from `85c4d20f`.

Layers: typecheck, lint, unit, component, CI-gating, build, e2e (smoke on both browsers),
e2e-live-network (both browsers).
