# Phase 3 · C11 · `incoming-arrival`'s calm check

## What changed

`network/incoming-arrival.test.ts`: `waitForPricedHero(page, expected?)` waits, polling every
100 ms for up to 30 s, until Home's hero shows a dollar figure other than $0.00 or, given `expected`,
exactly that figure, and returns it. `expectCalmArrival` reads `heroBefore` through it, takes an
optional `expectedHero` and returns the hero it ends on; the test passes the first call's result to
the second (Chrome, under emulated reduced motion). It returns `seen[1]`, which the assertion just
before has proven equal to `seen.at(-1)`: the plan's `seen.at(-1)` types as `string | undefined`.
`waitForHomeTotal` is unchanged, since `fiat-display` needs it to resolve on a true $0.00. The 30 s
wait is new, not a raised one.

Every run here sets `NULO_E2E_PROVERLESS=1`, Chrome's included, where the plan's Chrome command
has none: the file carries `@requires-proverless`, and `agent.sh` (`:21-34`) refuses such a file
with exit 2 before it builds anything unless that variable is 1.

## The price host in these runs

The wallet fetches `https://api.coingecko.com/api/v3/simple/price` on every Home remount while its
cache lacks a mapped id (`price/service.ts:145-158`), and the seed holds `usd-coin` only. From this
host that request gets HTTP 403 (a CloudFront error page; checked with `curl` on 2026-09-29), so the
refresh fails, backs off, and the popup gets the seeded $1 quote: the only price these runs see.
Row 43's CI figures ($1,046.00 → $1,052.00, whole dollars on 6-token steps) show the same there, as
do this phase's ($1,000.00 → $1,006.00). Were the host reachable, a real quote would land by
`fetchedAt` (`mergeMonotonic`, `service.ts:408-425`) and the 3-minute alarm could move the hero
during the sampler's window, which the test has never guarded against; the second call's exact
figure would add only the few seconds of the Settings round trip to that exposure.

## The held-price probe (step 2)

Uncommitted copies of the file (written by a scratch generator) wrap the page's
`chrome.runtime.connect` just before `setAnimationsDisabled` returns to Home. On every `price` port
opened after that, `refreshIfStale` replies and `onQuotesUpdated` events are queued until a release
(after a fetch the background delivers quotes both ways). **Base**: the file at the branch's HEAD,
the queue released only after `heroBefore` is read. **Fix**: the fixed file, the queue releasing
itself 1.5 s after the first request, and each call's wait timed. Each run is
`-t "with animations off"` (the calm test alone; the file's other six skip), retry 0.

| Run | Browser | Result | `heroBefore` | At the read, and the wait |
|---|---|---|---|---|
| Base | Chrome | failed, exit 1 (180 s) | "$0.00" | 5 price requests out, 5 replies held, the skeleton gone |
| Base | Firefox | failed, exit 1 (197 s) | "$0.00" | the same: 5 out, 5 held, no skeleton |
| Fix | Chrome | passed, exit 0 (252 s) | "$1,000.00", then "$1,006.00" | `waitForPricedHero` waited 1,520 ms on the first call and 1,510 ms on the second (each hold 1,500 ms); the second call's `expectedHero` was the first's "$1,006.00" |
| Fix | Firefox | passed, exit 0 (175 s) | "$1,000.00" | waited 1,472 ms (hold 1,501 ms); the second call is Chrome-only |

Both base runs failed at row 43's assertion, `expect(seen).toEqual([heroBefore, seen.at(-1)])`
(`:336` in the file, `:340` in the probe copy, which adds four lines above it), with the same
message: `expected [ '$1,000.00', '$1,006.00' ] to deeply equal [ '$0.00', '$1,006.00' ]`. The
sampler never records "$0.00" here because the release lands before it arms; the read the
assertion compares against is the one taken before the quotes.

## The flake bar (step 3)

The whole file, retry 0 (each of its seven tests also sets `retry: 0`), `NULO_E2E_PROVERLESS=1`,
`NODE_OPTIONS=--dns-result-order=ipv4first`, three consecutive runs per browser:

| Run | Exit | Tests passed / failed / skipped | vitest duration |
|---|---|---|---|
| Chrome 1 | 0 | 7 / 0 / 0 | 522 s |
| Chrome 2 | 0 | 7 / 0 / 0 | 508 s |
| Chrome 3 | 0 | 7 / 0 / 0 | 470 s |
| Firefox 1 | 0 | 7 / 0 / 0 | 410 s |
| Firefox 2 | 0 | 7 / 0 / 0 | 397 s |
| Firefox 3 | 0 | 7 / 0 / 0 | 393 s |

The file has seven tests on both browsers: its one `isFirefox` guard skips the reduced-motion half
of the calm test's body, not a test, so nothing is skipped. `bun run e2e:reap` after the bar: exit 0,
nothing to reap.

## Gate

- `bun run lint`: exit 0 (28 warnings and 3 infos, none in `incoming-arrival.test.ts`).
- The probes: both base runs red at row 43's assertion with a "$0.00" `heroBefore`, both fix runs
  green (above).
- The bar: 6 of 6 green (above). `bun run e2e:reap`: exit 0.
- D10: flake ledger row 43's mechanism now reads "read in the code and reproduced with the price
  replies held", its fix column names the fix and the rule, and its status is "fixed, `hygiene`
  (2026-09-29)".

The codex loop later put the second call on the first call's priced check; the fix probe and the bar
reran on that code (`post-impl.md`).
