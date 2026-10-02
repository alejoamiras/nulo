# Phase 3 · C1 · the scratch page, and the vitest defect on record

## The change

- Both drivers' `openScratchPage` load `/src/setup/index.html#/install`: Chrome through its `goto`
  with close-on-throw, Firefox through `gotoExtensionPage` on one path for both profile states.
- The contract (`fixtures/browser/index.ts`) now states the requirement, a page whose lifetime no
  onboarding state decides, and names the dependency: no product code opens the setup page (only
  the rollup input at `vite.config.ts:300` references it), so deleting it fails every launch.
- `opts: { freshProfile }` is gone from the interface, the forwarder, both drivers and the caller;
  `freshProfile` stays in the fixture for the first-run-tab check.
- `FIREFOX.md`'s row and `onboarding-tab.test.ts`'s comment now say both browsers honour the
  popup's `window.close()`.
- The e2e tree sits outside every typecheck gate (`apps/extension/tsconfig.json` includes only
  `src/`). A scratch `tsc` over the touched e2e files reported 63 errors, all older than this
  change and none on a touched line; the three driver files have none.

## The probe (uncommitted; its source is in the build's scratch directory)

A temporary smoke spec wrapped `driver.openScratchPage` and replayed `launchExtension()` ten times
on a fresh profile per browser, at retry 0:

1. an inert helper page (the setup page) waits for the worker's liveness, so every page after it
   boots against a warm worker. The earlier probe (`ux-feedback/lessons/final-pass.md`) lost the
   popup only once the worker had answered its first lookup, and never against a cold worker;
2. the driver's own `openScratchPage` opens the scratch page;
3. a second popup opens, and the probe waits until it closes itself: the onboarding redirect
   firing while `nulo:onboarding:completed` is still unset.

`launchExtension()` then reads liveness, closes the first-run tab and writes both seeds on the
scratch page, so it resolves only if the scratch page survived all of them.

| Run | Scratch page | Launches resolved | Forced popup closed itself |
|---|---|---|---|
| base, Chrome | popup (`/src/popup/index.html#/`) | **0 of 10**, each `Attempted to use detached Frame '…'` | 10 of 10 |
| base, Firefox | onboarding page (fresh profile) | 10 of 10 | 10 of 10 |
| fix, Chrome | setup page | **10 of 10** | 10 of 10 |
| fix, Firefox | setup page | **10 of 10** | 10 of 10 |

The base probe detects the defect on Chrome every time once the redirect is forced before the
seed. Firefox's base survived because its fresh-profile scratch page is the onboarding page, which
reads the flag at mount, long before the seed; the plan's other Firefox exposure (the popup on a
reused profile) is what the full smoke runs cover. Both browsers closed the forced popup ten times
in ten, which is the evidence behind the corrected comments.

## vitest's fixture retry: confirmed, and already reported upstream

A standalone repro (below) ran once inside `packages/wallet-core` on the installed vitest 4.1.10,
under `bun --bun vitest` and under Node 24.21.0: three attempts; the first failed with the setup's
error, and the two retries got `resource` undefined (`{"setups":1,"seen":["undefined","undefined"]}`).
The cause is `@vitest/runner` 4.1.10 `chunk-artifact.js:350-357`: the fixture enters
`cachedFixtures` before its setup is awaited, and the cleanup that removes it is registered only
after the setup succeeded.

Upstream already tracks it: vitest-dev/vitest#11237, "A fixture whose setup throws is never set up
again" (open since 2026-09-11, `p3-minor-bug`, reported on 5.0.0), with fix PR #11238 open and
awaiting review. Upstream `main` still has the same code
(`packages/vitest/src/runtime/runner/fixture.ts:424-434`), and the latest release is 5.0.2.
Filing a new issue would duplicate #11237, so the draft below is a confirmation comment on it,
for the owner to post or skip.

The same report covers file and worker scope: a rejected setup promise stays cached and is handed
to every later request. `send-picker`'s file-scoped fixture (C2) relies on exactly that today: a
failed setup is rethrown to every retry. Once a vitest release carries #11238, a failed file-scoped
setup re-runs on retry instead. The ledger row's "check any vitest bump with a fixture-retry repro"
covers both halves: on that bump, recheck C2 (see `phase-4.md`).

### The repro

```ts
import { afterAll, expect, test as base } from "vitest"

let setups = 0
const seen: string[] = []

const test = base.extend<{ resource: string }>({
	resource: async ({}, use) => {
		setups++
		if (setups === 1) throw new Error("setup fails once")
		await use("ready")
	},
})

test("a retry gets the fixture after its setup failed once", { retry: 2 }, ({ resource }) => {
	seen.push(String(resource))
	expect(resource).toBe("ready")
})

afterAll(() => {
	console.log(`REPRO ${JSON.stringify({ setups, seen })}`)
})
```

Output on 4.1.10: `× … (retry x2)`, then `→ setup fails once`, `→ expected undefined to be 'ready'`
twice, and `REPRO {"setups":1,"seen":["undefined","undefined"]}`.

### Draft comment for vitest-dev/vitest#11237 (the owner's call)

> Confirming this on 4.1.10 as well, so it predates 5.0. Minimal repro (one test-scoped fixture
> whose setup throws once, `retry: 2`): the first attempt fails with the setup's error, and both
> retries receive the fixture as `undefined` while the setup counter stays at 1. It reproduces
> the same under Node 24 and Bun 1.4. In practice, a flaky fixture setup under `retry` shows up as
> two follow-on failures that look like a different bug. The fix in #11238 would resolve it for us.

## Ledger

Row 38 in `.claude/skills/e2e-testing/SKILL.md` § 5: the fingerprint, the self-close as the
supported hypothesis (a browser disconnect takes the same path), the runner defect, the probe
evidence, and the status "trigger fixed; runner defect open upstream (#11237, fix PR #11238)".

## Gate

- `bun run lint`: exit 0 (29 warnings and 3 infos, none in a file this branch touches).
  `bun run typecheck:all`: exit 0.
- Smoke, per browser: `<smoke flags> bun run --cwd apps/extension build:<b>` (exit 0), then three
  consecutive runs of `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e --retry=0`:

  | Browser | Run 1 | Run 2 | Run 3 |
  |---|---|---|---|
  | Chrome | exit 0, 157 passed, 7 skipped (1149 s) | exit 0, 157 passed, 7 skipped (1069 s) | exit 0, 157 passed, 7 skipped (1110 s) |
  | Firefox | exit 0, 153 passed, 11 skipped (1268 s) | exit 0, 153 passed, 11 skipped (1401 s) | exit 0, 153 passed, 11 skipped (1277 s) |

  Every skip is a standing one: `_probe-console-capture` ×3 (`PROBE_ENABLED` unset),
  `store-captures` (`STORE_CAPTURES` unset), and the unconditional `test.skip`s in `appearance`
  (theme persistence) and `sw-resilience` (strict mode off), on both browsers; Chrome skips
  `action-popup-layout`'s Firefox-only bottom-nav test; Firefox skips `import-dead-rpc` ×4 and
  `sw-resilience`'s open-popup kill (both `CHROME_ONLY`).
- Network, once each at retry 0 with `NODE_OPTIONS=--dns-result-order=ipv4first`:

  | File | Chrome | Firefox (proverless) |
  |---|---|---|
  | `backup-restore-integrity` | exit 0, 2 passed (201 s, prover-ON) | exit 0, 2 passed (192 s) |
  | `incoming-arrival` | exit 0, 7 passed (455 s, proverless) | exit 0, 7 passed (428 s) |

- `bun run e2e:reap`: exit 0, nothing to reap (no owned run, no orphaned data dir or Firefox
  launch).

Each browser's network runs overlapped the other browser's smoke runs (Firefox's network leg with
Chrome's runs 1 and 2; Chrome's network leg and P4's Chrome runs with Firefox's runs 2 and 3):
different `dist/<browser>` directories, and neither suite's orphan sweep matches the other
browser's processes. The smoke runs were green under that load.

A comment-only edit landed after the smoke bars started: the Firefox driver's own doc comment on
`openScratchPage` went (it restated the contract in `index.ts`), and `onboarding-tab.test.ts`'s
comment was reworded. Both files lint clean.
