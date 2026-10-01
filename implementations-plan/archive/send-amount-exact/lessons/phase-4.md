# Phase 4 · Gates and browser proof

- **Static gates** at `d0a6c0a8`, run one after another: `bun run lint` exit 0 (1,893 files);
  `bun run typecheck:all` exit 0; `bun run test:all` exit 0 (12 workspaces; the extension 600
  files and 7,939 tests passed, 3 files and 4 tests skipped, 8 todo; this branch adds no skip or
  todo to a unit or component file); `bun run test:ci-gating` exit 0 (244 passed, 2 skipped; the
  plans gate reports 3 findings, none enforced, all in files this branch does not touch);
  `bun run build` exit 0; `bun run --cwd apps/extension build-storybook` exit 0.
- The code review's first round started once the static gates were green, with the e2e runs
  still to come; P4's gate reruns on the final commit.
- Smoke is built as `_extension-smoke-e2e.yml` builds its source run (the migration fixture, the
  Testnet default network, the empty token-seed source) and run with `--retry=0` and
  `NULO_E2E_MIGRATION_FIXTURE=1`; without that variable `migration.test.ts` and
  `backup-migration.test.ts` skip themselves (`skipIf(!HAS_FIXTURE)`). The smoke and
  network setups each kill Chromes loading their `dist/<browser>`, and `e2e:agent` rebuilds it,
  so a network run never shares a browser's `dist` with a smoke run in progress.
- **Smoke, Chrome**, at `d0a6c0a8`: exit 0, 41 files (38 passed, 3 skipped), 164 tests (157
  passed, 7 skipped), no retry. The skips are by design and none is in a file this branch touches:
  the console probe and the store captures (both opt-in), the Firefox-only popup-layout check, and
  two unconditional `test.skip`s (`appearance`, `sw-resilience`). Rebuilt with the same flags at
  `5f9450fd`, `dist/chrome` is byte-identical (592 files, SHA-256), so the run covers HEAD: the
  commits between change only tests and comments.
- **Network**, `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0
  bun run e2e:agent <file>`, at `5f9450fd`, each run its own boot:

| Browser | Run | Exit | Files | Tests | Skipped | Time |
|---|---|---|---|---|---|---|
| Firefox | `send-amount-exact` 1 | 0 | 1 passed | 1 passed | 0 | 125 s |
| Firefox | `send-amount-exact` 2 | 0 | 1 passed | 1 passed | 0 | 127 s |
| Firefox | `send-amount-exact` 3 | 0 | 1 passed | 1 passed | 0 | 121 s |
| Firefox | `fiat-send` + `send-amount-clamp` | 0 | 2 passed | 2 passed | 0 | 138 s |
| Chrome | `send-amount-exact` 1 | 0 | 1 passed | 1 passed | 0 | 117 s |
| Chrome | `send-amount-exact` 2 | 0 | 1 passed | 1 passed | 0 | 115 s |
| Chrome | `send-amount-exact` 3 | 0 | 1 passed | 1 passed | 0 | 113 s |
| Chrome | `fiat-send` + `send-amount-clamp` | 0 | 2 passed | 2 passed | 0 | 133 s |

- **Smoke, Firefox**, built at `5f9450fd`: exit 0, 41 files (39 passed, 2 skipped), 164 tests
  (153 passed, 11 skipped), no retry. The skips are by design: the two opt-in files, the four
  CDP-only `import-dead-rpc` cases, the Chrome-only `sw-resilience` case and the two
  unconditional `test.skip`s.
- The Firefox network runs ran beside smoke Chrome, which shares no `dist` with them. The smoke
  script was paused (SIGSTOP on its shell, which keeps the finished child's exit status) before it
  could rebuild `dist/firefox` under the last Firefox run and the captures, then resumed.
- `bun run e2e:reap`: nothing to reap. Fetched again: `dev` still `a7b1ff62`,
  `feat/ux-owner-picks` still `33b19cb3`; the merge-tree probe against it is clean at `5f9450fd`.
- **Final gate**, rerun on the delivered tree (the code at `5f9450fd` with the close-out's
  documents): `bun run lint` exit 0; `bun run typecheck:all` exit 0; `bun run test:all` exit 0
  (the extension 7,940 tests passed, one more than at `d0a6c0a8`: the review's new row);
  `bun run test:ci-gating` exit 0 (244 passed, 2 skipped); `bun run build` and `build-storybook`
  exit 0. The e2e runs above cover this code: the close-out changes documents only.

## Code review

- **Round 1** (`/codex high`, resuming the plan audit's session
  `01a0eb09-0547-7610-b15e-ba1f8557c586`): **conditional approve**, confidence high, conditions 1
  and 2. The plan audit's findings re-checked on the built code: 1, 3, 4 and 5 resolved; 2 the
  owner's declined residual; 6 open until P5's captures and Ask A-1. It ran 78 input, blur and
  validator cases at decimals 0, 6, 8 and 18 (each kept its value and survived a second blur),
  round-tripped exact Max to its raw balance, and found the corner never above it.
  - Finding 1 (minor, realistic): the spec reached the recipient input through a descendant
    `input` selector. Accepted: the testid alone, since `replaceInputValue` descends to the input
    (`248970ac`).
  - Finding 2 (minor): four comments narrated their code. Accepted: three deleted, the regex's
    comment names `restingAmount`, the comma comment keeps only its why (`95f3aae9`).
  - Suggestion: a grouped paste past the token's decimals through the input-to-validator table.
    Accepted as one row (`5f9450fd`). Red: dev's validator, loaded from `a7b1ff62`, refuses the
    resting form "1,234,567.123456" (`invalid`) where the branch reads 1,234,567,123,456 units,
    and dev's blur leaves a value holding a comma alone, so the row fails on dev on what it sends.
  - Not acted on: codex restated F-1 and F-2 as realistic and pre-existing, not regressions; they
    stay follow-ups and owner calls.
  - Checked by hand before round 2: every comma-bearing resting form `restingAmount` formats
    passes `GROUPED`, reads back to its own units and is a fixed point (1,728 cases, decimals 0
    to 18).
- **Round 2** (same session, on `248970ac..5f9450fd`): **approve**, confidence high, no new
  material finding. It confirmed each commit changes only what it says, both new comments are
  exact (584 cases at decimals 0 to 18, 292 of them comma-bearing, all matching `GROUPED`, keeping
  their units and surviving a second call; without the fallback "1.234,5," would read as 1.2345),
  and the new row's baseline evidence. The loop converged in two rounds.
