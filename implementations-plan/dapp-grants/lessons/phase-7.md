# Phase 7 · The delegated answers applied

The answers (plan § P6) kept every recommendation and changed two things a person sees: the
journal page's sentence for a scope-refused send, and that send's card in History and on Home
(UI impact row 5).

## Merge

- `SSH_AUTH_SOCK= git fetch origin dev`: `dev` had moved to `4387b112` (#720). Merged with a
  signed merge commit, `98c15ce9`, no rebase.
- One conflict, `implementations-plan/index.md`: both sides had appended a plan line. Both kept,
  dev's first. `git diff 4387b112 HEAD --stat` then listed only this branch's files; codex round 3
  checked the same.

## Red first, at `98c15ce9`

- The tests, written before the code:
  - `journal-state.test.ts` gains "error.kind === 'scope_refused' → 'Not allowed', on the red failed
    card", and `categoricalLabel`'s `scope_refused` pin expects the new sentence;
  - `TransactionTerminalCard.test.ts`'s testid case also reads `tx-terminal-subtitle`.
- `bun --bun vitest run src/utils/journal-state.test.ts
  src/components/composite/activity/TransactionTerminalCard.test.ts` from `apps/extension`: exit
  1; 2 files failed; 90 tests, 3 failed, 87 passed:
  - the subtitle was "Transaction failed", while state, icon and colour already matched the red
    failed card;
  - the context was the old sentence;
  - no element carried `tx-terminal-subtitle`.
- Regression control: `popup_bound` → "Transaction failed", green before and after.
- `scope-refusal.test.ts`'s History assertion was not run red: it reads a testid that did not exist
  before this phase, and the unit cases above hold the red. It ran green in the gate below.

## Green, at `2f7b1a91`

- The same command: exit 0; 2 files, 90 tests passed.

## The gate, at `2f7b1a91`

One step at a time, nothing else running in this worktree; every e2e run at retry 0.

- `bun run lint`: exit 0; 1908 files, 29 warnings and 3 infos, as before; complexity-baseline
  check OK.
- `bun run typecheck:all`: exit 0; every workspace exited 0.
- `bun run test:all`: exit 0. Extension 609 files passed, 3 skipped; 8094 tests passed, 4 skipped,
  8 todo. wallet-bridge 508, extension-messaging 240, wallet-core 247, aztec-runtime 250 passed and
  2 skipped, wallet-crypto 120, design 402, third-party-notices 66, legal 54, landing 40,
  resolve-asset 14, wallet-sdk-schema-patch 11, passkey-rp 5 passed and 6 skipped. The rises since
  `a1b6966b` are #720's tests and this phase's one.
- `bun run test:ci-gating`: exit 0; 244 passed, 2 skipped, 0 failed (246 tests, 17 files).
- `bun run build`: exit 0.
- Smoke, Chrome: the armed build (`VITE_NULO_E2E_MIGRATION_FIXTURE=1`,
  `VITE_NULO_E2E_DEFAULT_NET=testnet`, `VITE_NULO_E2E_TOKEN_SEEDS=1`,
  `VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1`, both token-seed markers found in `dist/chrome`), copied to
  `dist/smoke2` and `dist/smoke3`; three parallel shards (`--shard=i/3`), each with its own
  `EXTENSION_PATH` and `NULO_E2E_MIGRATION_FIXTURE=1`.

  | Shard | Files | Tests | Exit |
  |---|---|---|---|
  | 1/3 | 14: 12 passed, 2 skipped | 52: 50 passed, 2 skipped | 0 |
  | 2/3 | 14: 13 passed, 1 skipped | 38: 34 passed, 4 skipped | 0 |
  | 3/3 | 14: 14 passed | 76: 75 passed, 1 skipped | 0 |
  | Sum | 42: 39 passed, 3 skipped | 166: 159 passed, 7 skipped | 0 |

  One file and two tests more than P5's run: #720's `keyboard-guards.test.ts`. The skips are P5's:
  `action-popup-layout.test.ts` runs on Firefox only, the probe and the store captures only with
  their environment variable, and one case each in `appearance.test.ts` and `sw-resilience.test.ts`
  is `test.skip` on every browser.
- Smoke, Firefox: the same steps over `dist/firefox` (markers found), copies at `dist/smoke2` and
  `dist/smoke3`, `NULO_E2E_BROWSER=firefox`.

  | Shard | Files | Tests | Exit |
  |---|---|---|---|
  | 1/3 | 14: 13 passed, 1 skipped | 52: 51 passed, 1 skipped | 0 |
  | 2/3 | 14: 13 passed, 1 skipped | 38: 34 passed, 4 skipped | 0 |
  | 3/3 | 14: 14 passed | 76: 70 passed, 6 skipped | 0 |
  | Sum | 42: 40 passed, 2 skipped | 166: 155 passed, 11 skipped | 0 |

  The skips are P5's Firefox ones: the probe and the store captures, `import-dead-rpc.test.ts`'s
  CDP Fetch block and one `sw-resilience.test.ts` case (`CHROME_ONLY`), and the two `test.skip`
  cases.

## Network, first attempt: red on the spec's own read

- The four files, one `e2e:agent` invocation per browser, retry 0, at `2f7b1a91`. Chrome, prover
  on: exit 1; 8 ran, 7 passed, 1 failed. Firefox, proverless: exit 1; the same 7 passed and the
  same 1 failed. `authwit-variants`, `data-privateEvents` and `cap-request-rerequest` passed on both.
- Both failures: `scope-refusal.test.ts`, `TypeError: Cannot read properties of null (reading
  'evaluate')` in `readHistoryCard`, after its wait for the card's subtitle had resolved.
- Cause: every page opener applies `patchPagePolling`, which replaces `waitForSelector` for a CSS
  selector with a `waitForFunction` wait that returns `null`, never the element handle Puppeteer's
  type promises (`tests/e2e/fixtures/extension.ts`). No other spec uses the returned handle. Not a
  flake and not the product: the wait itself proved the subtitle visible.
- Fix, `c7a05b39`: wait, then read the subtitle with `$eval`, as the spec already reads the
  capability row. The e2e-testing skill gains the trap, beside the `waitForFunction` options one.
- `bun run e2e:reap` after the two runs: nothing to reap.

## Network, at `c7a05b39`

- `bun run lint` exit 0 and `bun run typecheck:all` exit 0 first, on the changed spec.
- The same four files, one invocation per browser, retry 0:
  - Chrome, prover on: exit 0; 4 files, 8 ran, 8 passed, 0 skipped (scope-refusal 1,
    data-privateEvents 2, authwit-variants 4, cap-request-rerequest 1).
  - Firefox, proverless (build stamp found): exit 0; 4 files, 8 ran, 8 passed, 0 skipped.
- `scope-refusal.test.ts` read History's card as "Not allowed" on both browsers, with the journal
  page's new sentence and the envelope.
- `bun run e2e:reap`: nothing to reap.

## Captures, O1 (b) as decided

- One capture run per browser through `e2e:agent`, with the capture spec that is never committed,
  on `2f7b1a91`'s product code (`c7a05b39` changes no product file). Chrome: exit 0, the variant's
  test passed. Firefox, proverless: exit 0, passed.
- The journal page, developer mode off, light and dark on Chrome and Firefox: "The app asked for
  more than you allowed. Nothing was sent.", which wraps before "was sent." at 360 px; Outcome
  "Not allowed"; State "Failed". The lone "it." that opened the offered sentence's second line is
  gone.
- History, Chrome, light: the card "Transfer (public)" with the "NULO-PLAYGROUND" chip, subtitle
  "Not allowed" in red, the red badge on its icon.
- The shots and their index stay outside the repo, beside the as-offered (b) shots, for the
  decision page. `bun run e2e:reap` after: nothing to reap.

## Codex

Round 3 on `98c15ce9..2f7b1a91` approved with no finding (`post-impl.md`). `c7a05b39` changes only
the spec's read and the skill, after that round; it was not sent to codex.
