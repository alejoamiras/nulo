---
name: e2e-testing
description: Write and run E2E tests for the Nulo browser extension using Vitest + Puppeteer. Use when user says "write e2e test", "add e2e", "browser test", "test extension", "puppeteer test", or wants to test extension UI flows.
---

# E2E Testing — Vitest + Puppeteer (Chrome Extension)

## Stack

- **Vitest** — test runner
- **Puppeteer** — browser automation via Chrome DevTools Protocol
- Extensions require `headless: false`

## Debugging

When tests fail, **don't speculate — instrument**:
- Write a standalone debug script (`npx tsx tests/e2e/debug.ts`) that launches the extension and logs page state, console messages, request failures, and hash over time
- Use Chrome DevTools MCP on the dev extension to compare working vs broken behavior
- Verify assumptions about Puppeteer/Chrome APIs before coding fixes

## Writing New Tests

Before writing any test, **explore the actual UI first** using Chrome DevTools MCP (`chrome-extension-debug` skill):
1. Open the extension page in Chrome (`chrome-extension://<ID>/src/popup/index.html`)
2. Take snapshots to see what elements, text, and structure are on each page
3. Click through the flow manually to understand what changes at each step
4. Note exactly what's visible after each action — these become your assertions

This prevents guessing at selectors and ensures tests assert on real observable state.

## Best Practices

- Collect `console.error` and `pageerror` events during each test, assert empty at the end — catches silent JS errors that assertions miss
- **Assert post-action state, not just navigation.** A route change alone doesn't prove a flow worked. After registration, verify the account address is rendered, network is shown, etc. After any mutation, check its observable side effects.
- **Browser-per-file isolation.** Each test file launches its own browser via `test.extend()` with `scope: "file"`. This is the only reliable way to get independent extension tests — shared browsers leak SW in-memory state between files.

## Gotchas

- **SW "target found" ≠ ready.** `browser.waitForTarget(type=service_worker)` only means Chrome registered the script. The SW may still be loading WASM, config, or initializing services. Poll an app-specific readiness signal (e.g. `chrome.storage.session` heartbeat) before opening pages.
- **Puppeteer SW evaluate ≠ extension context.** `chrome.storage` and other extension APIs aren't available when calling `evaluate()` on a service worker target. Open an actual extension page to access these APIs.
- Route transitions are async (e.g. registration) — poll `window.location.hash`, don't wait for text
- Modals/overlays don't change the route — detect by snapshot content
- Many interactive elements are divs, not `<button>` — use `text/` selectors in puppeteer
- `networkidle0` will timeout on extension pages (persistent connections) — use `domcontentloaded`
- Don't filter console errors as "benign" — investigate and fix them. Previous "benign" errors turned out to be a broken favicon path and missing SW readiness check.
- **Never use `chrome.runtime.reload()` for state reset** — it kills the extension and all its page contexts, crashing the browser connection. Use browser-per-file isolation instead.
- **Vitest orders files by mtime, not alphabetically** — don't rely on file execution order. Design tests to be order-independent via fixtures.
- **`Button.vue` doesn't set HTML `disabled` attribute** — it uses CSS `pointer-events: none` instead. `btn.disabled` is always `false`. To check if a Button is enabled, use `getComputedStyle(btn).pointerEvents !== "none"`. If you skip this, click handlers like `handleMint` silently return early via their own `if (!isAllowed) return` guard.
- **An instant `page.$$` count can read 0 on a stably-populated feed.** Vue lists that refresh by ARRAY REPLACEMENT swap their children inside a sub-frame window; a count read landing in it sees 0 while 250ms samples on either side show every card. POSITIVE count assertions must poll (`waitForFunction(count >= N)`); ZERO assertions may stay instant (a dip can't false-fail a zero — pair them with a MutationObserver for flash detection). A `waitForSelector` resolving does NOT make the very next `$$` safe.
- **Vitest swallows console output for PASSING tests** — instrumentation that `console.log`s yields data only on failure. Write debug samples to a file (`appendFileSync` to a tmp path) so passing runs produce evidence too.
- **Inline sampling loops HEAL the race they're hunting.** A sampler inserted between the wait and the assertion delays the assertion past the dip → the flake "disappears" under instrumentation. Run the sampler in a detached promise at the ORIGINAL assertion timing and await it after the assertions.
- **Verify what a run actually executed before reasoning from it.** Editing/reverting a test file while an `e2e:agent` sandbox is still building means vitest reads the file as of test-phase start, not launch — a "pass with instrumentation" may have run without it.

## CI-log + flake forensics (learned the hard way, THREE sessions running)

- **`gh run view --log` interleaves the STEP'S SOURCE SCRIPT with runtime output.** Every line of the
  workflow's `run:` block is echoed with near-identical timestamps before execution — grepping the log
  for strings like `exit 86` or `retrying` will match the SOURCE and fake a runtime event. Two separate
  sessions "confirmed" a boot-retry/port-collision story from source echoes. Discipline: match on
  timestamps advancing, count actual invocation markers (`[e2e:agent] resolving ports...` appears once
  per real attempt), and pull logs via `gh api .../jobs/<id>/logs` when the CLI view returns empty.
- **`[aztec-node] Error: Address already in use` during sandbox boot is COSMETIC on aztec 5.0.1.** The
  `aztec start --local-network` wrapper (`~/.aztec/versions/<v>/…/scripts/aztec.sh`) launches its OWN
  `anvil --port "$ANVIL_PORT"` even though global-setup already started ours on that port; the inner
  bind fails, the wrapper continues, the node boots fine (~30s). Do not diagnose port collisions from
  this line alone — check whether the node reached ready + deployments after it.
- **Sandbox-boot signature `deploy_aztec_l1_contracts … required arguments were not provided:
  --batch` → node never healthy → exit 86 = a `~/.aztec/current` DRIFT poisoning forge resolution
  (ROOT-CAUSED + FIXED 2026-08-06).** `@aztec/ethereum`'s `resolveFoundryBinary` checks
  `$FORGE_BIN` → **`~/.aztec/current/internal-bin/forge`** → `~/.aztec/current/bin/aztec-forge` →
  `~/.foundry/bin` → PATH — the `current` checks outrank PATH, so global-setup's internal-bin PATH
  prepend never protected the L1 deploy. Any `aztec-up install` on the machine re-points `current`; an install carrying a newer
  forge fork (whose `forge script` requires `--batch`) then breaks the deploy for EVERY version's
  boot, deterministically, while CI stays green (fresh runners have `current` == the pin). Fix in
  `global-setup.ts`: resolve the whole toolchain from the repo's `@aztec/aztec.js` pin
  (`~/.aztec/versions/<pin>`, CI's own rule) and export `FORGE_BIN`/`ANVIL_BIN` into the node spawn
  env (the resolver's highest-priority source). Diagnosis discipline: global-setup truncates
  `[aztec-node]` lines to 200 chars — the missing-argument NAMES get cut off; reproduce the boot
  manually to see full stderr before theorizing. The cosmetic os-error-98 line precedes this as
  usual — don't conflate.
- **Full-backup import has a bounded two-stage clock**: restore (slow on hosted runners) THEN possibly
  the app's own 30s recovery wait before it routes (`import.vue` completeImportWithRecovery). Any
  navigation wait below restore+30s+margin fails STRUCTURALLY whenever the recovery leg runs — it looks
  like flake because fast bootstraps skip the leg. Import-driver nav waits are sized 300s; affected
  spec budgets 900s.
- **The seeded-ACTIVE network is baked at build time and fresh-extension flows bootstrap on it** before
  any fixture can switch. CI egress to the public Alpha mainnet RPC blackholes, and each blocked call
  eats the node client's full 60s-abort × retry envelope — so e2e builds pin
  `VITE_NULO_E2E_DEFAULT_NET=testnet` (smoke workflow + agent.sh; never ships, prod default unaffected).
- **Never relaunch `e2e:agent` immediately after killing a run mid-flight.** Observed: a TaskStop'd
  run's sandbox was still dying when the relaunch booted; the fresh suite then collapsed mid-run with
  mass timeouts (28 passed, then 32 files of unrelated-looking failures). The `os error 48` boot line
  is NOT the tell — it also appears on fully green runs (see the cosmetic-anvil bullet above). Before
  relaunching after a kill, verify no aztec/anvil survivors hold the previous run's ports; when a run
  collapses mid-suite like this, suspect the environment before the code.
- **Vitest globalSetup contract (FIXED, was silent for the suite's whole life)**: with a `default`
  export present, a named `teardown` export is IGNORED — the teardown must be the default's RETURN
  value (vitest loader: `if (m.default) return { file, setup: m.default }`). Both `global-setup.ts`
  and `global-setup-smoke.ts` had the dead-named-teardown bug; both now return the teardown, and a
  setup that fails midway tears down what it already started before rethrowing.
- **Do NOT add bash signal traps around foreground vitest** (tried, review-killed with empirical
  proof): bash DEFERS INT/TERM traps until the foreground child exits, so a trap can never fire
  during the build/suite windows it would protect — and a deferred trap that fires after the child
  finishes CLOBBERS the real exit code (green run → 130; exit-86 → retry swallowed). Pre-vitest the
  agent owns no processes; sandbox lifecycle belongs to the TS side: the wired global teardown
  (ownership-gated, KILL-escalated), its signal hooks (fire-and-forget kills, lock left in place as
  the reap record), and the next run's liveness-checked orphan reap via the progressively-written
  `owned.json` (pids recorded per-spawn, not post-deploy).
- **Lock-ownership rule**: only the run that WROTE `owned.json` may clear it; the reuse path updates
  deployment fields in place without claiming ownership (overwriting with an empty pid map orphans
  the prior run's live sandbox beyond reap).
- **Release-gate tradeoff (deliberate, owner-visible)**: the encrypted backup-roundtrip SKIPS on
  artifact smoke runs (`NULO_E2E_ARTIFACT_RUN=1`, the explicit flag set for BOTH artifact delivery
  paths — never key on bare `EXTENSION_PATH`): prod-shaped builds seed Alpha-active and CI cannot
  reach that RPC. Coverage lives on every PR via the pinned in-job build; the release gate keeps
  every other smoke test. Revisit if an official CI-reachable mainnet RPC appears.
- **A kill-recovery test must model ALL designed outcomes, not just the flattering one.** The
  sw-restart-mid-restore test flaked for months (silent 240s park, ≥4 red CI runs) because a
  PRE-finalize SW kill triggers the import composable's designed rollback (`deleteProfile` of the
  orphan → wallet legitimately resets to register), while the test only accepted the recovery
  outcome. Under CI proving load the restore stretches, the kill lands pre-finalize more often, and
  the "flake" was the product doing exactly what it was coded to do. Map the implementation's
  outcome space (read the error paths, not just the happy path) BEFORE writing the assertion.
  Three hardening rules for the accepted alternate leg (each closed a codex-audit finding):
  (1) *completion signal, not first-visible effect* — the profile row vanishes in `deleteProfile`'s
  phase 1, but the deletion TOMBSTONE (`nulo:core:profile-tombstones@`) clears only after the
  coordinator's full purge, so "row gone" alone accepts a half-done or wedged purge;
  (2) *provenance-gate the alternate leg* — a clean register end-state is only PROVEN rollback if
  the row demonstrably existed first (the mid-restore marker); without that it's equally consistent
  with a restore that crashed before creating anything, which must FAIL;
  (3) *converge the legs* — never `return` early around the test's load-bearing assertions; drive
  the product's designed retry path so the on-chain checks execute on EVERY pass, or a required
  gate can sit green for weeks while its raison-d'être assertions never run.
- **One-shot route checks race vue-router settling — use settle loops.** `ensureUnlocked` samples the
  hash ONCE and no-ops off-auth; a fresh popup transiently shows `/popup` (an index route that
  immediately pushes general) before the guard settles on auth, so a one-shot sample in that window
  means nobody ever types the password. Recovery waits should loop: general → done; auth → unlock →
  re-check; terminal-reset route → verify completion via raw storage (row AND tombstone gone, see
  above) before ending the wait. Always fall through to the loop's sleep after an unlock attempt
  (oscillation must not hot-spin), and record the LAST unlock error into the timeout diagnostics —
  a swallowed `.catch(() => {})` turns a selector regression into an opaque park.
- **Instrument long navigation waits with a route-trajectory recorder** (poll `window.location.hash`
  on an interval and push transitions into a `window.__nuloRouteTrace` array — vue-router's hash
  history navigates via pushState, so `hashchange`/`popstate` listeners see NOTHING). On timeout,
  dump trace + parked hash + storage key names into the thrown Error message (vitest prints it with
  the failure; console.error can interleave away from the test's block in CI logs). A silent
  multi-minute park is undiagnosable from CI logs after the fact.

## References

- [Chrome Extension Testing with Puppeteer (official)](https://developer.chrome.com/docs/extensions/how-to/test/puppeteer)
- [Puppeteer API](https://pptr.dev/api)
- [Puppeteer Chrome Extensions guide](https://pptr.dev/guides/chrome-extensions)
- [MetaMask e2e test setup](https://github.com/MetaMask/metamask-extension) — see `test/e2e/`

- **tmpfs exhaustion after many network-e2e runs**: each run leaves a `/tmp/nulo-aztec-<pid>-<ts>`
  sandbox data dir (~hundreds of MB); `/tmp` is RAM-backed tmpfs, so ~15 runs in a day ate 12 GB
  of RAM and Chrome/extension pages started timing out at RANDOM early stages (popup boot, popup
  windows) with healthy-looking load averages. If unrelated e2e stages start flaking rotationally
  on a long-lived box, check `df -h /tmp` FIRST and `rm -rf /tmp/nulo-aztec-*` between sessions
  (no run active). Diagnosed 2026-07-20 — a green suite at 20:00 degraded to rotating boot
  timeouts by 22:00 with identical code (verified via a pre-change checkout that failed the same
  way).

## backup-restore-sw-restart: two DESIGNED outcomes, not one

The mid-restore SW-kill scenario has two legitimate endings, decided by where the kill lands
relative to `finalizeRestore` (the test asserts BOTH since #308 — do not "fix" a rollback ending
back into a recovery expectation):

- **RECOVERED** (kill post-finalize): reopen → auth → unlock → general, registrations survive.
- **ROLLED BACK** (kill pre-finalize): the import page's catch deletes the orphan profile — the
  reopened popup has zero profiles and legitimately routes to REGISTER. The test asserts the
  rollback completed (row gone, tombstone cleared) and then re-imports cleanly.

Two flake mechanisms this design killed (worth remembering as PATTERNS):

1. **One-shot route sampling parks flows.** The fresh popup can transiently show `/popup` (an
   index route that immediately pushes general) before the auth guard settles. A helper that
   samples the hash ONCE (`ensureUnlocked`'s "not on auth → return") no-ops in that window —
   nobody ever types the password and the downstream long wait parks silently. Use a settle LOOP
   around unlock, never a single sample.
2. **vue-router hash navigation fires NO `hashchange`** (it navigates via pushState). A
   `hashchange`-listener route recorder logs nothing; record routes by POLLING (see the test's
   `__nuloRouteTrace`).

Related product gap (tracked separately): restore writes networks with Local LAST, and recovery
seeds defaults only when ZERO network rows exist — a kill mid-network-writes leaves the profile
without "Local" permanently.

## Deflake-arc lessons (2026-08-11, `implementations-plan/e2e-deflake/`)

- **`navigateByHash`'s hash-equality wait proves nothing about router commitment.**
  Setting `location.hash` updates the URL synchronously; a competing in-flight
  `router.push` then supersedes the navigation and the hash REVERTS — the destination
  page never mounts and any following selector wait parks. Reproduced solo/idle
  (load-independent logic race). Fix pattern: settle-STABLE navigation — destination
  selector mounted AND hash held continuously across a monotonic dwell; one
  re-navigation for the characterized race; a second revert fails loudly (recurring
  redirects are a product signal, never normalized). See `resetProfile`.
- **A plain `waitForFunction` is NEVER a stability check** — it resolves on its first
  truthy poll; `timeout` is a ceiling, not a dwell. A real dwell tracks continuity
  in page state (`performance.now()` marker nulled on any deviation) and returns true
  only after N continuous ms. (Round-2 codex catch — the fake version shipped first.)
- **Write-gated retries starve on silent failures.** The token-balance projection
  pipeline persists NO failure record (unlike the gas pipeline post-#355), so
  "attempt still running" and "attempt failed" are indistinguishable from storage.
  A retry that waits for the previous attempt's WRITE before re-kicking locks up
  after one silent failure — bound the re-kick cadence with a documented envelope;
  keep the ACCEPTANCE signal causal (freshness + exact value).
- **Freshness-gate imported-state assertions.** An imported backup already carries
  the expected balances with nonzero `updatedAt` — a value-only poll can pass with
  ZERO post-import sync. Capture the baseline `updatedAt` first; require
  `> baseline` AND the exact raw value AND a card-scoped render assert.
- **Purge completion = row (proven present pre-submit) + exact tombstone + owned
  roots all gone.** `reset.vue` AWAITS the full purge before navigating — route
  waits sized for a hop race the cascade. Tombstone absence ALONE is also true
  before deletion starts. See `captureSoleProfileId` + `waitForProfilePurged`.
- **Execute popup: "op rows rendered" ≠ "approvable".** `waitForExecuteContent`
  is strictly weaker than the confirm button's native `disabled` (init + metadata +
  fee-selection gates). Wait on the LIVE disabled attribute + `pointerEvents`
  (`waitForExecuteApprovable`) — never re-derive the Vue boolean logic. Timings are
  appended to `.e2e-state/exec-approvable-timings.log` (1–402ms warm; CI cold-shard
  multiplier is the budget rationale).
- **Preserve FULL gate-run logs (tee to a file), never bare `tail`.** A clipped
  failure block cost a diagnosis once; the very next preserved red was root-caused
  from its dump in minutes.
- **CI setup no longer installs foundry-toolchain** — the aztec pin's `internal-bin`
  (own pinned+retried foundry) is the only consumed toolchain, now preflight-asserted
  in `setup-aztec` (fails loudly if an installer regression drops it).
- **The smoke `backup-roundtrip` post-import route wait is OPEN (owner)**: the route
  is gated on `isLogined`, flipped only after the RPC-bound `syncTransactions`
  against the seeded public testnet — an RPC-dependency, not a timeout problem.
  Diagnostics (route trace + parked-state dump) are armed; do NOT raise the bound.

## PR-workflow silence — check mergeability first

If a push to a PR branch triggers NO workflows at all (not even Quality; only Cloudflare checks
appear), check `gh pr view <n> --json mergeStateStatus` — a `DIRTY` (conflicted) PR gets no
`pull_request` merge-ref, so ALL pull_request-triggered workflows silently skip. Fix = merge the
base branch in and push; the run fires immediately. Don't debug the workflows.

## Local resource leaks: the sandbox datadir is on tmpfs (RAM)

`global-setup.ts` puts `AZTEC_DATA_DIR` under `tmpdir()` — i.e. **tmpfs, which is RAM-backed**.
Each run's aztec LMDB store can be multiple GB. The reaper (owned.json lock, liveness-checked
orphan reap, kill-by-process-group) only runs at the START of the NEXT e2e run, so when you STOP
running e2e the last run's orphans are never reaped. An orphaned aztec process holds its datadir
open even after the dir is `rm`'d → the space stays pinned **in RAM as a deleted-but-open file** →
swap fills → the box thrashes.

### Symptom you'll hit first (it doesn't look like an e2e problem)

Under this pressure your OWN tooling breaks before any test does:
- The agent shell's stdout capture fails — commands that print output return "exit 1" with no
  output, while no-output commands (`true`, `rm`) still succeed. (Redirect to a REAL-disk file and
  `Read` it — `df -h /tmp; free -h > ~/x.txt` — to see through the broken capture.)
- In-page e2e operations time out spuriously (e.g. `backup-roundtrip`'s 30s `DecompressionStream`
  capture). A test that is GREEN on CI but RED locally with a timeout is very likely this, not code.

### Diagnose

`df -h /tmp` shows high "used" but `du -sh /tmp/*` sums to far less → the gap is deleted-open files
held by LIVE processes. `ps -eo pid,rss,etimes,cmd | grep -E 'aztec|anvil'` finds the holders.

### Recover (order matters)

1. Kill the HOLDERS first — `rm` alone won't reclaim RAM while a process holds the fd open. Prefer
   killing by process-group from the run's `owned.json` (kill `-pgid`). `pkill -f nulo-aztec` /
   `pkill -f anvil` is the orphan-recovery LAST resort — it can hit ANOTHER agent's live run
   (kill by owned pgid, not by name; see the run-isolation rule).
2. Then `rm -rf /tmp/nulo-aztec-* /tmp/nulo-e2e-*` and `sync`.
3. Confirm recovery: a plain `echo` through the shell works again.

### Avoid

- **Reap your own runs at session end**, not just implicitly at next-run-start. After a burst of
  `e2e:agent` runs, kill the owned pgids + clear the datadirs before walking away.
- Don't spin up e2e in a throwaway worktree (e.g. an A/B baseline) and then `git worktree remove`
  it without reaping its sandbox first — that orphans its holders.
- **Best fix (infra, separate PR): move `AZTEC_DATA_DIR` off tmpfs onto real disk** (`~/.cache/…`
  or the gitignored `.e2e-state/…`). Then a leaked run wastes cheap disk you reap later instead of
  RAM that breaks the machine.

## Build-time-armed tests: silent-unarmed-run trap (bitten twice — 2026-08)

Several e2e fixtures are compiled INTO the wallet bundle at BUILD time via `VITE_NULO_E2E_*` flags
(proverless incoming-poll gate, migration-fixture sentinels). A test that needs one of these,
run against an UNARMED dist, does not error — the hook is tree-shaken out, `?.` no-ops, and the
test polls into a multi-minute timeout that looks exactly like a product bug or machine flake.
Both suffered instances: `backup-migration.test.ts` (env set at runtime but dist built unarmed)
and `account-switch-isolation.test.ts` (bare `bun run e2e:agent <file>` builds unarmed; CI always
arms, so it's deterministically red locally / green on CI). Third instance (2026-08-15): a
mid-session PRODUCTION build (`bun run build:chrome` to package the extension for manual install)
silently OVERWROTE the armed dist — the next `test:e2e` run failed its 5 migration tests with
90s waits, twice, and read as branch breakage. The same 5 deterministic failures across runs is
the un-armed signature (load flake scatters; disarming repeats exactly). **After ANY other build
in the session, re-arm before smoke**: `VITE_NULO_E2E_MIGRATION_FIXTURE=1
VITE_NULO_E2E_DEFAULT_NET=testnet bun run build:chrome` (CI parity, `_smoke-e2e.yml`).
Fourth instance (2026-08-12): `bun run audit:vue` ends with a plain `build` — running it as a
pre-push gate silently un-arms the dist, so the armed-smoke gate that follows it reds on the
same 90s-import signature. Gate ordering matters: audit:vue first, THEN the armed build, THEN
armed smoke.

### Rules

- **A runtime env var can never arm a build-time flag.** Arming is `VITE_…=1` at `bun run build`
  time; the runtime twin only tells the TEST the dist is supposed to be armed.
- **Every build-armed test file carries a formal marker** (`@requires-proverless` today) that
  `scripts/e2e/agent.sh` scans BEFORE spending ports/build — unarmed runs are refused with the
  exact remedial command. Add a marker (+ scan clause) when introducing a new build-armed fixture.
- **Every build-armed test file also carries a `beforeAll` dist preflight** (grep the loaded
  extension's `assets/*.js` for the compile-time stamp; hard-abort with the remedial command) —
  the belt for direct-vitest invocations that bypass agent.sh. Idioms:
  `backup-migration.test.ts` (arming-contract test), `account-switch-isolation.test.ts`
  (beforeAll stamp scan).
- **Diagnosing "deterministic local red, CI green" on a gated test**: FIRST grep the local dist
  for the fixture's stamp/strings (`grep -rl "NULO_E2E_PROVERLESS_BUILD_STAMP" dist/chrome`)
  before suspecting timing or hardware — absence proves an unarmed build in seconds.

## Suite-wide mass failure across UNRELATED files (timeouts, retry x2 everywhere)

If a full `e2e:agent` run fails DOZENS of unrelated files while a targeted run of the same
files is green, suspect the RUN ENVIRONMENT before any code path:

1. **Concurrent heavy load on the same host is the #1 cause.** A full vitest suite,
   `audit:vue` (build + tests), or a proving run executing in PARALLEL with the e2e suite
   starves the sandbox and the browser — 25s silent-call timeouts and 70s feed waits blow
   across the board. Run the e2e suite ALONE; treat its wall-clock as reserved.
2. **`[aztec-node] Error: Address already in use (os error 98)` printed once at node boot is
   BENIGN** — it appears in green runs too (a sub-service retries on another port). Do NOT
   chase it as the root cause of a red suite.
3. Orphaned sandboxes from dead runs (ppid 1, old `lstart`, absent from `~/.agents/ports.md`)
   are still worth reaping — by OWN pgid only (`kill -TERM -<pgid>`), never `pkill -f` —
   but verify the claim: in the observed incident the orphans held unrelated ports and the
   re-run reproduced the boot line anyway.
4. A green isolated re-run of a few failed files confirms environment, not code. Re-run the
   full suite solo before touching any test.

### CI variant: every shard dead at sandbox BOOT with the same module/setup error

When the whole CI network matrix (all shards + heavies + canary) fails identically at
`e2e-setup` while local solo runs are green, suspect the FRESH toolchain install, not the
tests (2026-08-12: `snappy@7.4.0` published that day broke every fresh `aztec-up` install with
`ERR_MODULE_NOT_FOUND: @napi-rs/snappy-wasm32-wasi`; local runs never saw it because the
pre-existing `~/.aztec` predated the publish). Protocol: (1) read the FIRST error in the
`[aztec-node]` boot log — the `Address already in use (os error 98)` line above it is benign
noise (see rule 2); (2) correlate `registry.npmjs.org/<pkg>` publish times against the failure
window; (3) reproduce with a bare `npm install <pkg>@<ver>` + load-check OUTSIDE CI before
burning reruns — if it reproduces, reruns can NEVER go green and the fix is a toolchain pin
(see the `aztec-update` skill), not patience. Two same-signature rerun failures = stop
assuming "transient".

## Deflake-round-2 lessons (2026-08-14, `implementations-plan/deflake-round-2/`)

- **A wait is only as honest as the SIGNAL it polls.** Visibility (`offsetParent`) is a
  rendering artifact: a `<Transition>`-leaving dropdown keeps its items visible while the
  component state is already closed — a one-shot sample mid-close reads "open", skips the
  trigger, and the option click times out (the appearance retry-flake, reproduced under CPU
  load). Gate on STATE attributes (`data-dropdown-open`, `data-toggle-active`), never on a
  visibility snapshot; expose the state attribute if it doesn't exist.
- **Retry-masked flakes are now diagnosable from CI**: `RetryErrorReporter` (all three e2e
  configs, single-owned in `vite.shared.ts#e2eReporters`) prints the retained first-attempt
  errors of retried passes. NOTE: an explicit `reporters` list suppresses vitest's auto-added
  `github-actions` annotations reporter — `e2eReporters()` re-adds it; never inline a
  reporters array in a config.
- **Local flake repro recipe**: run the file with `--retry=0` (first-attempt errors become
  terminal) in batches, no-load baseline first, then under OWNED CPU hogs (setsid + kill by
  pgid). One failing run with the real waiter identified beats 30 green speculation cycles.
- **Red-team a pin against deletion of what it guards.** A disabled-binding pin that passes
  with the binding term removed pins nothing (the harness's OTHER gates held it disabled) —
  establish the enabled state first, flip exactly the guarded flag, assert the transition.
- **An exactness upgrade finds producer dirt the fuzzy assert absorbed** (block-forcing mints
  accumulating raw dust the display rounding hid) — audit every producer feeding an assert
  you tighten, especially fixtures with no current consumer (no run can red on them).
- **Labeled PR opens leave duplicate check-runs — noisy, not blocking.** Opening a labeled
  PR fires opened+labeled events; the concurrency-cancelled duplicates leave FAILURE
  aggregator check-runs beside the survivors' successes on the same SHA. A measured probe
  (deflake-round-3 `lessons/phase-1.md`) shows the PR going CLEAN once the survivors land,
  with those FAILUREs still present — a cancelled run's aggregator always finishes first,
  so it is always the OLDER check-run and loses. **Do not reflex-push an empty commit.**
  If you see BLOCKED with every gate terminal-green, CAPTURE FIRST — full
  `/commits/<sha>/check-runs`, repeated `mergeStateStatus` reads over ≥2 minutes, and the
  base branch's protection config — because two arcs have now destroyed that state by
  remedying immediately, and the round-2 blocks remain unexplained.
