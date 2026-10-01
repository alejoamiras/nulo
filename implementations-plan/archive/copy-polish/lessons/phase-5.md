# Phase 5 · Browser proof and the arc gate

## The driver method

`evaluateInBackground(owner, body)` on `BrowserDriver`. Chrome evaluates the body in the
service-worker target over CDP and detaches before it resolves, so no session parks the worker's
host through a later stop. Firefox's `evaluateInBackgroundPage` frame script evaluates it in a
`Components.utils.Sandbox` with the event page's principal and the page, unwrapped, as its
prototype.

Why the sandbox, from a probe spec run once on Firefox and deleted, never committed. What the
frame script sees of the event page:

- `typeof content.chrome` → `"undefined"` (the Xray hides it);
- `typeof content.wrappedJSObject.chrome` → `"object"`;
- `content.wrappedJSObject.eval("1 + 1")` → `EvalError: call to eval() blocked by CSP`;
- `new content.wrappedJSObject.Function("return 2")()` → `EvalError: call to Function() blocked
  by CSP`;
- `typeof Components` → `"object"`.

`tests/e2e/FIREFOX.md` gains the row. Inference 2 holds on both engines: an own `set` defined on
the background's `chrome.storage.local` intercepts the storage adapter's write (the error snack
shows), and it puts the real one back after one refusal (the second Continue lands).

## The loader step, dropped

- First Chrome run, `-t "S4|S11" --retry=0` → exit 1: S4 ✓; S11 × at the loader step,
  `TimeoutError: Waiting failed: 15000ms exceeded`. A mutation observer armed before
  `stopBackground` saw no `global-loader` inserted in 15 s. Everything before it had passed: the
  refusal, the snack, the four hit tests and the 12 px gap.
- Cause: `ServiceClient.onDisconnect` calls `disconnect()` and then `connect()` in one callback
  (`packages/extension-messaging/src/background/client.ts:94-97`), and `chrome.runtime.connect`
  returns at once. `isBackgroundConnected` goes false and true in one tick, and the loader's
  batched render draws nothing. The shell's own comment says the same (`popup/app.vue:423-427`).
- The step is dropped, not simulated. Only a `runtime.connect` that throws keeps the loader up,
  and forcing that tests a state the scenario never reaches. The loader's and the barriers' order
  over the raised host rests on their stacking values (Fact 14). The plan's P5, Outcome 2,
  Security and Fact 14 now say so.

## Red, before P3

The red build is the branch head with P3's product change reverted: `popup/app.vue` and
`components/LegalAcceptanceSheet.vue` from `73256f2c^`, keeping the `toast-root` testid. Both files
were copied to scratch first and copied back after, and `git status` was clean. The armed dists
were built and copied to `dist/red-chrome` and `dist/red-firefox`, then deleted after the runs.

- Chrome, `EXTENSION_PATH=<abs>/dist/red-chrome`, `-t S11 --retry=0` → exit 1, 1 failed, 13
  skipped: `expected { card: 'legal-sheet', … } to deeply equal { card: 'snackbar', … }`. Continue,
  "Not now" and the point beside the card matched: the card was drawn under the sheet.
- Firefox, the same on `dist/red-firefox` → exit 1, the same diff.

## Green

- Chrome, `-t "S4|S11" --retry=0` → exit 0, 2 passed, 12 skipped (S4 19.6 s, S11 10.7 s).
- Firefox, the same → exit 0, 2 passed, 12 skipped (S4 28.4 s, S11 14.6 s).

## Found in the build

- P3's inset case (`components/LegalAcceptanceSheet.test.ts:139`) failed `vue-tsc`: it assigned
  `route.meta` a literal with `showBottomNav`, which the hoisted route's inferred type lacks. P3's
  gate had run lint and vitest only. It is fixed in its own commit, with `Object.assign(route, …)`
  as the suite's `beforeEach` does.
- The e2e tree is outside every tsconfig. A probe config over the five touched e2e files (deleted)
  reported only the `…PerTest` fixture-typing errors that S1 to S3 and S7 already carry.
- The e2e reads of `#toast` select by a new `data-testid="toast-root"` (CLAUDE.md § testid).

## The card's settled read

`readSnackOverSheet` first read the card once `waitUntilStill` saw it hold still. Its pending check
matches `[class*="-enter-from"]`, which the card's CSS-module enter class (`_enter_from_…`) never
matches, so a throttled frame could hold the card mid-rise through three equal reads. The read now
waits for opacity 1 and no running animation on the card, as `network/snack-placement.test.ts`'s
`settledCard` does (`3ec1bb40`). The Chrome smoke parts had loaded the helper before that change;
every other run below carries it, the Chrome flake bar included.

## Gates

Every row exits 0.

- **Local**, on `4a341223` (test and docs commits followed):
  - `bun run lint` → 1,944 files, 28 warnings and 3 infos (the base's), complexity-baseline OK.
  - `bun run typecheck:all` → every workspace.
  - `bun run test:all` → 14 workspace scripts; the extension 625 files passed and 3 skipped,
    8,461 tests passed, 4 skipped, 7 todo. The known `useFullBackupImport` flake did not fire.
  - `bun run test:ci-gating` → 244 passed, 2 skipped, 0 failed (246 tests, 17 files).
  - `bun run build`, and `bun run --cwd apps/extension build-storybook`.
- **Smoke**, armed builds, three parallel parts per browser (`dist/<browser>`, `dist/smoke2`,
  `dist/smoke3`, each its own `EXTENSION_PATH`, `NULO_E2E_MIGRATION_FIXTURE=1`). The config's
  retry 2 stood, and no case needed it: no part printed a `PASSED ON RETRY` line.

  | Browser | Part | Files passed / skipped | Tests passed / skipped |
  |---|---|---|---|
  | Chrome | 1/3 | 13 / 2 | 52 / 2 |
  | Chrome | 2/3 | 13 / 1 | 43 / 4 |
  | Chrome | 3/3 | 14 / 0 | 71 / 1 |
  | Chrome | sum | 40 / 3 of 43 | 166 / 7 of 173 |
  | Firefox | 1/3 | 14 / 1 | 53 / 1 |
  | Firefox | 2/3 | 13 / 1 | 43 / 4 |
  | Firefox | 3/3 | 14 / 0 | 66 / 6 |
  | Firefox | sum | 41 / 2 of 43 | 162 / 11 of 173 |

  `legal-acceptance.test.ts` ran 14 of 14 and `imported-account-lifecycle.test.ts` 1 of 1 on
  both. The skips are the suite's own: `store-captures` (opt-in), `_probe-console-capture`,
  `action-popup-layout` on Chrome, one `appearance` case, one or two `sw-resilience` cases, and on
  Firefox four `import-dead-rpc` cases; none is in a file this plan touched.
- **Flake bar**, `legal-acceptance.test.ts --retry=0` on the armed dist, three consecutive runs per
  browser: Chrome 14 of 14 each (S11 11.7 s, 11.6 s, 10.6 s); Firefox 14 of 14 each (S11 15.0 s,
  15.1 s, 16.0 s).
- **Network**, `NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent
  tests/e2e/network/snack-placement.test.ts tests/e2e/network/cap-window.test.ts --retry=0`:
  - Chrome, prover on → 2 files, 8 of 8 passed, 0 skipped (cap-window 5, snack-placement 3).
  - Firefox, `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1` → 2 files, 7 of 8 passed, 1 skipped:
    cap-window's reduced-motion case, the suite's Chrome-only one (Firefox's BiDi session cannot
    emulate media features). snack-placement 3 of 3, cap-window 4 of 5.
- `bun run e2e:reap` → exit 0, nothing left to reap. ✓

## Codex, build round 1

Session `01a0f35b-bdfa-7dc0-977c-9ffc6c1c54f2` (GPT-6 Astra, high, read-only) on `8b7b7421`:
**changes requested**. It agreed with dropping the loader step (an integrity failure on a restored
session can raise a barrier before the lock, and the barrier's `body` teleport at 10000 stays above
the raised host), and found no path from a snack to the consent action and no raise that outlives
the sheet. It scanned 684 files and found 40 reviewed hits, none open or stale.

- **F1** (minor, material by its reading): every snack rises 20 px into place and drops 20 px away
  over 0.15 s, so for that moment its lower edge covers Continue's top 8 px, and S11 reads only the
  settled card. The geometry is right (`ToastManagerBase.vue:280-298`; the gap is 12 px).
  **Rejected as a code change**: a tap in that band lands on the card's padding, which runs
  nothing, and the card's controls sit centred at least 13 px above its edge, so the tap is lost
  and never misdirected. The motion is the snack's on every screen, so changing it for the sheet is
  an owner UI call. The plan's Outcome 2, UI impact row 3 and a Decision-ledger line now say so.
- **F2** (minor, material): `CLAUSE_DASH` hits the empty-value glyph inside a label
  ("Balance: — FJ"), and the reviewed list admitted only text no screen shows. **Accepted**,
  `9b2d2c3c`: the list takes such a hit with a reason, a scanner case pins the match, and the
  CLAUDE.md bullet says the same.
- **F3** (nit): the header's "Every string this replaced had passed review" is history.
  **Accepted**, `6e2c69ab`: deleted.

After both fixes the guard runs 15 of 15, and Biome is clean.

## Codex, build round 2

The same session, resumed with the fix diff (`8b7b7421..50f8e684`), the F1 rejection's reasons
and both rules: **approve**, no new material finding and no comment nit, confidence high. F2 and
F3 are "right and complete"; the F1 rejection "holds": both buttons stay outside the 8 px band,
the card runs nothing on a tap, and the guarantee is narrowed to the settled card. The loop
converged in two rounds.

## The final gate

`dev` moved to `9cbe4862` (three test and plan commits); it was merged in with a signed merge
commit (`bf355a86`), and the guard found no new hit. Every row below ran on `bf355a86` and exits 0.
`dev`'s docs-only `9d984244` (CLAUDE.md, the plans README) was merged after (`810231c1`), so the
code the rows ran is the head's; lint, the plans gate and `test:ci-gating` ran again on the head.

- `bun run lint` → 1,944 files, 28 warnings and 3 infos (the base's), complexity-baseline OK.
- `bun run typecheck:all` → every workspace.
- `bun run test:all` → 14 workspace scripts; the extension 625 files passed and 3 skipped, 8,462
  tests passed, 4 skipped, 7 todo (the new scanner case is the one more). The known
  `useFullBackupImport` flake did not fire, and `dev`'s fix for it is merged.
- `bun run test:ci-gating` → 244 passed, 2 skipped, 0 failed (246 tests, 17 files).
- `bun run build`, and `bun run --cwd apps/extension build-storybook`.
- **Smoke**, armed builds, three parallel parts per browser, the same counts as P5's, no
  `PASSED ON RETRY` line, `legal-acceptance.test.ts` 14 of 14 and
  `imported-account-lifecycle.test.ts` 1 of 1 on both:

  | Browser | Part | Files passed / skipped | Tests passed / skipped |
  |---|---|---|---|
  | Chrome | 1/3 | 13 / 2 | 52 / 2 |
  | Chrome | 2/3 | 13 / 1 | 43 / 4 |
  | Chrome | 3/3 | 14 / 0 | 71 / 1 |
  | Chrome | sum | 40 / 3 of 43 | 166 / 7 of 173 |
  | Firefox | 1/3 | 14 / 1 | 53 / 1 |
  | Firefox | 2/3 | 13 / 1 | 43 / 4 |
  | Firefox | 3/3 | 14 / 0 | 66 / 6 |
  | Firefox | sum | 41 / 2 of 43 | 162 / 11 of 173 |

- **Flake bar**, three consecutive retry-0 runs per browser: Chrome 14 of 14 each (S11 12.1 s,
  12.0 s, 10.7 s); Firefox 14 of 14 each (S11 15.6 s, 16.3 s, 14.4 s).
- **Network**, the same command as P5's: Chrome, prover on → 2 files, 8 of 8 passed; Firefox,
  proverless → 2 files, 7 of 8 passed, 1 skipped (cap-window's reduced-motion case, Chrome-only).
- `bun run e2e:reap` → exit 0, nothing to reap.
