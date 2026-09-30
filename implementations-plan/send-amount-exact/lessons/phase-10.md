# P10 · A-1: the review sheet fits, then wraps

The owner's `review` answer ("fit", 2026-09-29): the review sheet's amount line shrinks until
every digit fits, down to 60%, then wraps to a second line.

## Red, on `d411db53` plus the tests (no fit in the sheet)

`bun --bun vitest run src/popup/components/modules/send/` from `apps/extension`: 3 failed, 275
passed. Each failure is the missing scale on `send-review-amount`: `expected '' to be '1'`
(an amount that fits), `'0.68'` (one that fits at 68%) and `'0.6'` (one that needs 45%, drawn at
the floor). Each row also reads the line's text, so the ruler cannot leak into it.

## Fix

§ The rebuild, A-1, as planned: the ruler holds the amount and its `<small>` symbol in the line's
own classes; the fit runs when the summary mounts with the popup, when the amount or the symbol
changes, and on `loadingdone`; the drawn scale is `max(fit, HERO_MIN_SCALE)`; `overflow-wrap:
anywhere` breaks the line only past that floor. The symbol's type is a fixed 11 px, so the line's
width is not proportional to the scale: the fit's first estimate is then an upper bound, and its
downward check still lands on the largest hundredth that fits.

Gate: `bun --bun vitest run src/popup/components/modules/send/` 278 passed, 12 files; with the P2
command's files as well, 486 passed, 20 files; `bun run lint` exit 0 (29 warnings and 3 infos, as
before, none in the changed files); `bun run typecheck:all` exit 0.

## The browser

`send-amount-exact.test.ts` through the isolated runner at retry 0:

| Browser | Exit | Time | Executed | Passed | Skipped |
|---|---|---|---|---|---|
| Chrome | 0 | 140 s | 1 | 1 | 0 |
| Firefox | 0 | 166 s | 1 | 1 | 0 |

Every check of P7 passes in both browsers, the review's amount line included: no overflow, at
18 px or more.

`bun run e2e:reap`: nothing to reap. ✓
