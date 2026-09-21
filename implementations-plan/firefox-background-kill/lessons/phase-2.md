# Phase 2 — The port

## What shipped

Six of the seven non-canary background-kill files run on Firefox. Each lost its
`describe.skipIf(isFirefox)(CHROME_ONLY.backgroundKill, …)` for a real title; none needed a new wait.

| File | What changed beyond the un-skip |
|---|---|
| `sw-resilience.test.ts` | case 2 ("an open popup outlives the kill") skips in-file on Firefox — the phase 1 mechanism; the header no longer says Chrome |
| `sw-restart-network.test.ts` | — |
| `imported-account-lifecycle.test.ts` | its one direct `page.reload()` is `reloadExtensionPage` (`RELOAD_DEBT` entry gone) |
| `network/cold-wake-discovery.test.ts` | the `service_worker` target read is `backgroundAlive(ext)` (`WORKER_DEBT` entry gone) |
| `network/connect-locked-queue-sw-restart.test.ts` | — |
| `network/balance-row-reconciliation.test.ts` | — |

**Not portable:** `network/backup-restore-sw-restart.test.ts`. Both of its kills land under the open restore
page — the page's own catch owning the rollback is what the file tests — and Firefox leaves an event page
running while an extension page is open (phase 1). It keeps a whole-file skip under a reason that says so.

`CHROME_ONLY` now carries three true reasons instead of one that had become false ("Firefox exposes no
background context"): `backgroundKillUnderPage` (that file), `canary` (the two execution canaries, pinned to
Chrome by the owner's rule and by `behavior-gating.test.ts`'s `CHROME_ONLY_CANARY`), `cdpFetch`
(`import-dead-rpc`). Four files skip whole-file on Firefox, down from ten. The canaries were renamed onto
`stopBackground` / `backgroundAlive` and re-labelled; they are not ported (Ask A1 default).

Three unused `Page` type imports that predate this plan went with the files they sat in.

## What held without change

- **The recovery gate is browser-neutral.** `readLivenessBaseline` + `waitForWorkerLiveness` read
  `storage.session` from an extension page; the area survives a background-only kill on Firefox as on
  Chrome, so the strictly-newer heartbeat gate works as written.
- **"What wakes the successor" was already in every spec**: each opens a popup (or, in `cold-wake`, clicks the
  dApp) right after the kill. Chrome did not need it; Firefox does; nothing had to be added.
- **`cold-wake-discovery` fits Firefox better than Chrome**: nothing restarts the event page, so "the click is
  provably the first wake" needs no luck. 8.6 s on Firefox, 7.0 s on Chrome.
- **The first heartbeat lands inside its 10 s bound on Firefox** (`sw-resilience` case 4: 2.6 s).

## The unsettled dApp call (Ask A3 — measured, not fixed)

A `sendTx` parked in its proving stage (the proverless proof gate, held) when the background is killed, the
dApp page left alone, then a popup opened to wake a successor. One run per browser:

| | Firefox | Chrome |
|---|---|---|
| kill → `stopBackground` resolved | 48 ms | 22 ms |
| dApp's pending `sendTx`, 150 s untouched | unsettled | unsettled |
| …and 60 s after a popup woke the new background (210 s total) | unsettled | unsettled |

So it is not a Firefox matter and not a PXE-host matter: **a dApp call in flight when the background dies is
never answered on either browser** — no rejection, no timeout the wallet owns. The previous plan saw
120–180 s on Firefox only because it never ran Chrome. A product question (reject pending calls on boot, or
leave the dApp's own timeout to it) for its own plan; nothing here changes it.

## Gate

| Command | Result |
|---|---|
| `bun run lint` | exit 0 |
| `bun run --cwd apps/extension test -- scripts/e2e/browser-seam.test.ts scripts/e2e/firefox-driver.test.ts scripts/e2e/unresolved-names.test.ts` | 56 passed (3 files) |
| Firefox network, the three ported files (proverless, `--retry=0`) | exit 0 — 3 passed: balance-row 28.2 s, cold-wake 8.6 s, locked-queue 21.5 s |
| Firefox smoke, the three ported files (fixture build, `--retry=0`) | exit 0 — 5 passed / 2 skipped (the pre-existing skip and case 2) |
| Chrome network, the same three | exit 0 — 3 passed: 24.2 s, 7.0 s, 19.9 s |
| Chrome smoke, the same three | exit 0 — 6 passed / 1 skipped (pre-existing) |

Every e2e step ran alone on the host, first try, no retries. The temporary measurement spec was deleted
after its two runs and never staged.
