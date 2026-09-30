# Phase 2 · C1 · the four token specs

## What changed

- `fixtures/extra-tokens.ts` (new): `extraTokensFixture(tokens)` returns a file-scoped fixture entry
  that deploys the tokens for the funded account, imports each behind
  `importTokenAndWaitForBalance`'s fresh-balance check, closes its page and resolves
  symbol → address. `holdings`, `home-cap`, `pin-to-home` and `send-picker` each extend the harness
  `test` with it (T1's factory; the fallback was not needed). Each body requests `extraTokens` so the
  fixture runs, opens its own popup and continues from `seedUsdQuoteAndReload` unchanged.
  `send-picker`'s in-file `altToken` fixture is gone.
- `fixtures/helpers.ts`: `clearPinnedTokens(page)` removes every key under the pinned-tokens prefix
  (`pinnedTokensKey("")`, Inference 4); an open page's pins follow the storage change
  (`usePinnedTokens.ts:247-252`). `pin-to-home` calls it before `seedUsdQuoteAndReload`.

Two departures from the plan's text, both forced by the compiler:

- The factory's return type is an explicit mutable tuple, `ExtraTokensFixture`, not `as const`.
  vitest 4.1.10 types a fixture entry as the mutable `[value, FixtureOptions?]`, so a readonly tuple
  does not fit. A scratch probe against vitest's own `extend` (no harness involved) gives one error,
  on the `as const` form: "The type 'readonly [...]' is 'readonly' and cannot be assigned to the
  mutable type '[Record<string, string> | FixtureFn<...>, (FixtureOptions | undefined)?]'"; the
  mutable form beside it compiles.
- `clearPinnedTokens` calls `chrome.storage.local.get()`, not `get(null)`: chrome-types declares
  `keys?: string | string[] | {…}` with no `null` (TS2769), and an omitted `keys` returns the whole
  store, per the API. The pin probe below is the runtime proof.

## The focused type check (step 2)

No gate typechecks `tests/e2e/**` (Fact 19). Scratch `tsconfig`s outside the tree extend
`apps/extension/tsconfig.json` and include `src/**/*.d.ts`, `tests/e2e/global-setup.ts` and the
files under test; `vue-tsc --noEmit -p <scratch>` from `apps/extension`.

| Run | Errors | In the five files | Elsewhere |
|---|---|---|---|
| Base, `send-picker` alone | 49 | `send-picker` 3 | `journal.ts` 20, `extension.ts` 10, `helpers.ts` 8, `aztec.ts` 5, 3 others 1 each |
| Base, the four files | 48 | 1 each in `holdings`, `home-cap`, `pin-to-home`; `send-picker` 2 | `journal.ts` 20, `helpers.ts` 8, `extension.ts` 6, `aztec.ts` 5, `global-setup.ts` 2, others |
| Change, the four files + `extra-tokens.ts` | 55 | 3 in each of the four; `extra-tokens.ts` 0 | as the base |
| Base, harness repaired | 41 | 0 | `journal.ts` 20, `helpers.ts` 8, `aztec.ts` 5, `extension.ts` 4, `global-setup.ts` 2, 2 others |
| Change, harness repaired | 41 | 0 | the same 41 |

The errors in the four files are one pre-existing harness defect, not the change:
`firstTwoAccountsFixture` (`fixtures/extension.ts:476`) types its context
`({}: Record<string, never>, use)`, which fails vitest's object-form `extend` overload
(`extension.ts:708`, `:712`), so TypeScript falls back to a builder overload and the exported
`test`'s context collapses to `AddBuilderWorker<object, …>`. Under it every spec's
`{ tokenReadyExtension }` destructuring is TS2339 (the base's 1 to 2 per file), and with the change
the factory entry adds a TS2322 and `extraTokens` a second TS2339. The repaired rows retype that one
context `object` in an uncommitted probe (`extension.ts` backed up to scratch, restored, `cmp`
byte-identical): the change then adds no error anywhere, so the plan's criterion ("no error in
`extra-tokens.ts` or the four files and no more elsewhere than the base count") holds on the
repaired harness and cannot hold on the real one. The harness fix is out of this plan's scope; it
is F-6.

## Red first, on the base (step 4)

Uncommitted probes from the base files (the in-body setup): a module-level flag throws once right
after the setup, and the run is `NULO_E2E_RETRY=1` on Chrome, so the retry reruns the deploy and the
imports against the same file-scoped wallet. Every retry failed at its first order assertion with
`TimeoutError: Waiting failed: 60000ms exceeded` (`p2-probe-base-chrome`, exit 1, 3 of 3 failed):

| File | Retry fails at | Rows after the retry's setup |
|---|---|---|
| `holdings` | the `ZED,TST` order wait | `EMPTY, EMPTY, TST, ZED, ZED` |
| `home-cap` | the `BIG,TST,MID` order wait | `BIG, BIG, MID, MID, TINY, TINY, TST` |
| `pin-to-home` | `waitForHomeOrder(page, "TST,ALT")` | `ALT, ALT, TST` |

The row column is a second run of the same probes with a dump of every `nulo:core:tokens@` row
right after the retry's setup (`p2-probe-baserows-chrome`, exit 1, 3 of 3 failed, each retry on the
same `TimeoutError`): each symbol the body deploys is there twice, and the order waits time out on
the extra rows.

## Green, on the fix (steps 5 and 6)

Uncommitted probes from the fixed files, the flag throwing once at the top of each body (after the
file-scoped fixtures resolved), `NULO_E2E_RETRY=1`, Chrome (`p2-probe-fix-chrome`):

| Probe | Result | Rows at the retry's end |
|---|---|---|
| `holdings` | passed on its retry | `EMPTY, TST, ZED` |
| `home-cap` | passed on its retry | `BIG, MID, TINY, TST` |
| `pin-to-home` | passed on its retry | `ALT, TST` |
| `pin-to-home` without `clearPinnedTokens`, throwing after the first pin | failed: its retry timed out at the first `waitForHomeOrder(page, "TST,ALT")` (ALT still pinned) | — |

The run exits 1 on the no-reset variant alone; the three fix probes passed. Each row check asserts
exactly one row per deployed symbol. Then the pin probe with the reset, alone
(`p2-probe-pin-reset-chrome`): the retry passed the same wait and the test passed, exit 0.

## The flake bar (step 7)

The four files together, retry 0, through `bun run e2e:agent` with
`NODE_OPTIONS=--dns-result-order=ipv4first`; Chrome with `NULO_E2E_PROVERLESS` unset, Firefox with
`NULO_E2E_PROVERLESS=1`:

| Run | Exit | Files passed | Tests passed / failed / skipped | vitest duration |
|---|---|---|---|---|
| Chrome 1 | 0 | 4 of 4 | 4 / 0 / 0 | 300 s |
| Chrome 2 | 0 | 4 of 4 | 4 / 0 / 0 | 330 s |
| Chrome 3 | 0 | 4 of 4 | 4 / 0 / 0 | 325 s |
| Firefox 1 | 0 | 4 of 4 | 4 / 0 / 0 | 353 s |
| Firefox 2 | 0 | 4 of 4 | 4 / 0 / 0 | 310 s |
| Firefox 3 | 0 | 4 of 4 | 4 / 0 / 0 | 315 s |

`bun run e2e:reap` after the bar: exit 0, nothing to reap.

Interruption, not a flake: the build session was cut off by an API spend limit while Firefox run 2
was going. The bar's script ran on unattended; its remaining runs and the reap completed on their
own, no run was cut short, and nothing was rerun.

## Gate

- `bun run lint`: exit 0 (29 warnings and 3 infos, none in a touched file; the complexity-baseline
  check OK).
- `bun run typecheck:all`: exit 0 in every workspace.
- The harness scans (`scripts/e2e/unresolved-names.test.ts`, `scripts/e2e/browser-seam.test.ts`,
  from `apps/extension`): exit 0, 2 files, 45 tests passed.
- The compiler check: its criterion holds on the repaired harness only (the table above; F-6).
- The probes and the bar: as above. `bun run e2e:reap`: exit 0.
