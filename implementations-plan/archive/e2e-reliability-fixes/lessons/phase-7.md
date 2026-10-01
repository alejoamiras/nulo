# Phase 7 · C6 · Home's settled token card (addendum)

## The change

- `rows.test.ts`: `goBackTo(page, expected)` is now `backToHome(page)`. After the hash and the
  visible `tx-card` it also waits for `tokens-empty-import-link`, which `TokensView.vue` draws
  only once the card has settled empty (`isSettled && !hasAnyRow`). Its three callers are the
  Home test's returns from the transaction page; the second and third precede the position reads
  (`coveredAt` and `pointerClick` on the fiat span, then `centreOf` and the hit test on the icon).
- The empty state already carries that testid inside it, and `TokensView.test.ts` and
  `network/default-token-seeding.test.ts` already read it as the empty-state marker, so no testid
  is added and no product file changes.

## The probe (uncommitted; its generator and sources are in the build's scratch directory)

A generator wrote two copies of the file into `tests/e2e/`, each run once per browser at retry 0,
filtered to the Home test, and deleted after the run:

1. From just before the last return to Home, the page's `chrome.runtime.connect` is wrapped: on
   every `token-balance` port it opens, `getTokenBalances` responses are queued instead of
   delivered, until a release.
2. **Base**: the file before the fix. The icon is measured by the test's own `centreOf`; then the
   probe releases the queue, waits for the settled empty state and lets the test's own hit test
   run at the measured point.
3. **Fix**: the fixed file. The queue releases itself 1.5 s after the first request, and the
   test runs unchanged from `backToHome` on.

| Run | Held requests | At the measurement | Row shift after it | Hit test | Exit |
|---|---|---|---|---|---|
| base, Chrome | 2, released 62 ms after the first | card unsettled, no ghost rows | +107.4px | `'nothing'`: `expected 'nothing' to be 'tx-card'` | 1, the recorded failure |
| base, Firefox | 2, released 170 ms after the first | card unsettled, no ghost rows | +107.4px | `'nothing'`, the same assertion | 1, the recorded failure |
| fix, Chrome | 2, released at 1,500 ms | settled empty; `backToHome` waited 1,637 ms | none | `tx-card`; the rest of the test passes | 0 |
| fix, Firefox | 2, released at 1,500 ms | settled empty; `backToHome` waited 1,526 ms | none | `tx-card`; the rest of the test passes | 0 |

The two requests are the token card's and the balance hero's. The shift matches the driver's
measurement: the card goes from its 32px header to its 139px empty state.

## Gate

- `bun run lint`: exit 0 (warnings only, none in a file this branch touches).
- The probe: as in the table above, the base red with the recorded assertion on both browsers
  and the fix green on both.
- The flake bar, after `<smoke flags> bun run --cwd apps/extension build:<b>` (exit 0), three
  consecutive runs of `tests/e2e/rows.test.ts` at retry 0:

  | Browser | Run 1 | Run 2 | Run 3 |
  |---|---|---|---|
  | Chrome | exit 0, 5 passed (15 s) | exit 0, 5 passed (15 s) | exit 0, 5 passed (15 s) |
  | Firefox | exit 0, 5 passed (23 s) | exit 0, 5 passed (22 s) | exit 0, 5 passed (23 s) |

- `bun run e2e:reap`: exit 0, nothing to reap.

The original failure needed a loaded host to open the window; the probe forces it open, which is
the evidence that the helper now closes it. P6's full smoke on both browsers runs the file again.
