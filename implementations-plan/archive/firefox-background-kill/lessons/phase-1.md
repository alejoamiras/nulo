# Phase 1 — The seam method and the restart spec

## What shipped

- `BrowserDriver.stopBackground(browser, extensionId)` and `backgroundAlive(browser, extensionId)`, exported
  from `fixtures/browser` as `stopBackground(owner)` / `backgroundAlive(owner)` over a structural
  `BackgroundOwner` (`{ browser, extensionId }` — every `ExtensionContext` is one).
- **Chrome:** `stopServiceWorker`'s body moved from `fixtures/helpers.ts` into `fixtures/browser/chrome.ts`
  unchanged (unattached `Target.closeTarget`, the two proofs of "gone", the 15 s budget); `assertChromeOnly`
  had no other caller and is gone. `backgroundAlive` is the old `findServiceWorkerTarget` as a boolean.
- **Firefox:** the privileged termination is the spike's helper, placed in `firefox.ts` by the owner from
  `pxe-timer-throttling/spike/spike.patch`; this session changed only its signature line (a `Browser`
  instead of an `ExtensionContext`) and wired `stopBackground` around it — read the background's
  `timeOrigin`, terminate, poll until the page is gone or a different one runs, 15 s budget, named errors.
  `backgroundAlive` answers from the same frame script (`"the background page is not running"` → `false`,
  anything else rethrown).
- All nine `CHROME_ONLY.backgroundKill` files call `stopBackground` now (a mechanical rename; the two
  canaries also swap `findServiceWorkerTarget` for `backgroundAlive`). None is un-skipped yet.
- `firefox-background-restart.test.ts` ends the background alone. New in it: a key written to
  `storage.session` before the kill and read after — a reload wipes that area, a background death does not,
  so the spec now shows the lock is strict mode's and that the add-on was not reloaded.
- Seam debt: `WORKER_DEBT` lost `fixtures/helpers.ts` (2); `WAIT_DEBT` is empty.

## The finding that cost a run

**Firefox leaves an event page running while an extension page is open — and reports the termination as
done.** The first version of the spec opened a popup before the kill (to watch it lock itself, as
`sw-resilience` case 2 does on Chrome). The helper returned `terminated`; the background's `timeOrigin`
never changed and `stopBackground` timed out at 15 s. With every extension page closed first (the spike's
order) the same call ends the page at once. The privileged call is a polite suspension, not a crash, and
Firefox declines it silently when the page is busy. Consequences:

- `stopBackground`'s Firefox error says "close every extension page first"; the driver contract says it too.
- "An open popup outlives the kill" cannot be produced on Firefox with this mechanism — that case stays
  Chrome-only in phase 2, in-file, with this reason (Ask A2).
- A dApp page with a live content script does **not** hold the background: the playground stayed open
  across the passing kill.

## Gate

| Command | Result |
|---|---|
| `bun run lint` | exit 0 |
| `bun run --cwd apps/extension test -- scripts/e2e/browser-seam.test.ts scripts/e2e/firefox-driver.test.ts` | 55 passed (2 files) |
| Firefox, `network/firefox-background-restart.test.ts` (proverless, `--retry=0`) | first run **failed** (popup open across the kill — above); after the reorder: exit 0, 1 passed, 29.6 s |
| Firefox, `network/pxe-host-state.test.ts` | exit 0 — 1 passed, 20.6 s |
| Chrome, `network/pxe-host-state.test.ts` | exit 0 — 1 passed, 18.2 s |
| Chrome smoke, `sw-resilience.test.ts` (fixture build, `--retry=0`) | exit 0 — 4 passed / 1 skipped (the skip pre-exists): the moved kill body, five kills |

A one-off `vue-tsc` over `tests/e2e/**` (temporary tsconfig, deleted) shows no error naming the new exports
or the removed imports in any touched file; what it does show in them is the fixture-typing residue every
spec carries.
