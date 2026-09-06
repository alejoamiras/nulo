---
name: e2e-testing
description: Write, run, and deflake the Nulo extension's Puppeteer e2e suites (smoke + network). Use when the user says "e2e", "smoke", "network suite", "puppeteer", "flaky test", "stopServiceWorker", "e2e:agent", or wants to test an extension UI or dApp flow end to end.
---

# E2E testing — Vitest + Puppeteer on the Nulo extension

This skill owns the Puppeteer layer under `apps/extension/tests/e2e/`: how to run it, how to write a
test that stays green, how to kill the service worker for real, how to tell a flake from a break, and
the ledger of every flake this repo has root-caused. Boundaries:

- Live debugging of a running extension (DevTools MCP, the Logger page) → `chrome-extension-debug`.
- The generic parallel-agent isolation pattern (ports, process groups, data dirs) → `run-isolation`;
  this skill describes THIS repo's instance of it.
- The in-process tier below e2e (real service graph over dumb fakes) →
  `apps/extension/tests/COMPOSITION-TESTS.md`. Escalate to e2e the moment an assertion needs
  simulation, proving, real derivation, or Barretenberg.
- Layout, per-file purposes, and the helper table → `apps/extension/tests/e2e/README.md`.

Every rule below names the code that carries it. If a name here does not resolve on the tree, the
tree wins — fix the skill in the same PR.

## 1. Run it

### The three configs

| Suite | Config | Includes | Global setup | Timeouts (test/hook) | Retry |
|---|---|---|---|---|---|
| smoke | `vitest.e2e.config.ts` | `tests/e2e/*.test.ts` | `global-setup-smoke.ts` (no sandbox) | 60s / 90s | 2 in config (three attempts); `--retry=0` on the CLI to override |
| network | `vitest.e2e.network.config.ts` | `tests/e2e/network/**` | `global-setup.ts` (anvil + aztec node + playground) | 30s / 300s | `NULO_E2E_RETRY` ?? 2 (three attempts) |
| all | `vitest.e2e.all.config.ts` | both | `global-setup.ts` | 30s / 300s | `NULO_E2E_RETRY` ?? 2 |

All three run `pool: "forks"`, `isolate: true`, `fileParallelism: false` — one Chrome per file,
files sequential. All three take `reporters: e2eReporters()` from `vite.shared.ts`: an explicit
reporters array suppresses vitest's automatic `github-actions` annotator, so that function re-adds it
and appends `RetryErrorReporter` (prints the first-attempt errors of a test that passed on retry).
Never inline a reporters array in a config.

Commands (root `package.json`):

```bash
cd apps/extension && bun run test:e2e [files]            # smoke — no sandbox
bun run e2e:agent [files] [--shard=N/M]                  # network — owns a sandbox per run
NULO_E2E_PROVERLESS=1 bun run e2e:agent [files]          # network, proverless build (CI's shard pool)
bun run test:e2e:all                                     # smoke + network on one sandbox
bun run e2e:reap                                         # kill leftover sandboxes by owned pid
```

`test:e2e:network` at the root runs the config bare: no port pack, no armed build, `global-setup.ts`
falls back to `8545/8080/8880/40400/5174`. Use it only against a sandbox you already own.

### Hazards that mass-fail a run

- **Both global setups `pkill` every Chrome loaded from THIS dist path**, at setup and at teardown.
  Parallel worktrees are safe; smoke and network on ONE worktree are not. Tell a reviewer running
  locally not to invoke any e2e config.
- **Heavy suites run alone on the host.** A concurrent `audit:vue`, a proving run, or a second
  suite starves the sandbox and the browsers; the signature is timeouts across unrelated files.
  Rerun before triage. Shard for wall-clock (`--shard=N/M` across agents), never overlap.
- **Reap at session end**, not at the next run: `bun run e2e:reap`. Orphans hold their LMDB store
  open; the data dir is on real disk (`~/.cache/nulo-e2e`, `lockfile.ts` `E2E_DATA_ROOT`), so RAM is
  not pinned, but ports and CPU are.

### The agent runner — `apps/extension/scripts/e2e/agent.sh`

1. Scans the file paths passed as arguments (or all of `tests/e2e/network` when none) for
   `@requires-proverless`; any hit without `NULO_E2E_PROVERLESS=1` exits 2 with the remedy. A vitest
   name filter is not a path — pass the file. Prover-ON is the default; the proverless build is a double opt-in
   (`VITE_NULO_E2E_PROVERLESS=1` + `_CONFIRM=1`) and mutually exclusive with
   `VITE_NULO_ACCELERATOR_REQUIRED`.
2. Claims a fresh port pack (`resolve-ports.ts`: bind-and-release in a static window below the
   kernel's ephemeral floor, written to the worktree-local `.e2e-state/ports.json`). There is no
   host-wide registry file; safety is probabilistic plus the bind test.
3. Builds the wallet armed: `VITE_LOCAL_NETWORK_RPC_URL` (this sandbox), `VITE_NULO_E2E_DEFAULT_NET=
   testnet`, `VITE_NULO_E2E_PRICE_MAP=1`, `VITE_NULO_E2E_MIGRATION_FIXTURE=1`,
   `VITE_NULO_E2E_TOKEN_SEEDS=1` + `_CONFIRM=1`, plus the proverless pair when asked. Then asserts
   the bundle before spending a sandbox (exit 2 on a miss): the sandbox URL literal, the
   migration-fixture stamp, the token-seed stamp and key, the accelerator stamp when armed, the
   proverless stamp when armed, the fee multiplier when set. The price map has no stamp check.
4. Runs vitest with `E2E_REQUIRE_SETUP=1` (a sandbox or deploy failure is `FATAL`, never a silent
   `describe.skipIf` — the suite once showed `61 skipped, exit 0` for weeks) and the runtime
   declarations the tests read (`NULO_E2E_MIGRATION_FIXTURE=1`, the `*_URL`s).
5. `classify-exit.ts` maps the run through `.e2e-state/{boot-started,boot-ready,tests-started}`:
   boot started, never ready, no test ran → exit 86 (CI retries the agent once on 86 only); anything
   else passes through. A test that ran cannot masquerade as infra.

Reuse never happens under `e2e:agent` (fresh ports every run); `reconcilePriorLock` in
`global-setup.ts` only reaps the previous pack. A normal run's teardown kills what it spawned and
clears its lock, so reuse fires only when a prior pack SURVIVED (a `kill -9` of the vitest group
after deploy) and the next bare `vitest run --config vitest.e2e.network.config.ts` carries the same
ports: pids alive, endpoints healthy, and the node's `l1ContractAddresses` equal to the lock's (a
stranger on a reused port fails identity).

### Build-armed tests

Several fixtures are compiled INTO the bundle by `VITE_NULO_E2E_*` flags and tree-shaken out
otherwise: the proverless `ProofGate`, the restore and incoming-poll gates, the migration fixture,
the token-seed reader, the price map. Against an unarmed dist nothing raises by itself — the hook is
gone, optional chaining no-ops, and an unguarded test polls into a multi-minute timeout
that looks exactly like a product bug (a guarded one fails fast in its `beforeAll` stamp check). A
runtime env var can never arm a build-time flag.

- The signature is the SAME deterministic set of failures run after run (load flake scatters).
- Diagnose before theorising: `grep -rl NULO_E2E_PROVERLESS_BUILD_STAMP apps/extension/dist/chrome`
  (or the stamp of the feature in question). A later plain `bun run build` — including the one at
  the end of `bun run audit:vue` — silently disarms the dist.
- Smoke needs its fixtures armed AND the migration one declared: build with
  `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1
  VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build:chrome` (the seed pair keeps the fresh wallet off
  the live seed RPC — `_smoke-e2e.yml` says why), run with `NULO_E2E_MIGRATION_FIXTURE=1`.
  `migration.test.ts` skips without the declaration; `backup-migration.test.ts` throws with the
  remedy.
- A file that depends on the PROVERLESS build carries the `@requires-proverless` marker (the only
  marker `agent.sh` scans) AND a `beforeAll` that greps the loaded bundle for the stamp
  (`account-switch-isolation.test.ts` is the idiom) — the belt for direct vitest invocations. Other
  armed features need their own guard (`backup-migration.test.ts` throws with the remedy;
  `default-token-seeding.test.ts` has none and simply times out unarmed).

### Env vars the suite reads

| Var | Meaning |
|---|---|
| `HEADLESS=0` | windowed Chrome; default is headless (`launchExtension`) |
| `NULO_E2E_RETRY` | vitest `retry` for the network and all configs (default 2); smoke ignores it — pass `--retry=0` |
| `E2E_REQUIRE_SETUP=1` | sandbox/deploy failures are fatal (set by `agent.sh`) |
| `NULO_E2E_PROVERLESS=1` | `agent.sh` arms the proverless build pair |
| `NULO_E2E_MIGRATION_FIXTURE=1` | runtime declaration that the dist carries the migration fixture |
| `NULO_E2E_ARTIFACT_RUN=1` | smoke against a built artifact (release/nightly): blocks the price host, skips the encrypted `backup-roundtrip` spec; set for BOTH artifact paths, never keyed on bare `EXTENSION_PATH` |
| `EXTENSION_PATH` | smoke: load this unpacked dir instead of `dist/chrome` |
| `NULO_E2E_DATA_ROOT` | sandbox data-dir root (default `~/.cache/nulo-e2e`) |
| `NULO_E2E_STAGE_LOG=1` (+`_OUT`) | append per-import stage-trajectory records (`helpers/import-stage-timing.ts`) |
| `NULO_E2E_OPENPOPUP_LOG=1` | log `openPopup`'s fast-path/fallback timing |
| `NULO_E2E_CONSOLE_PROBE=1`, `NULO_E2E_PROBE=1` | enable the two `_probe-*` files (skipped by default; probes, not gates) |
| `NULO_E2E_STANDARD_CONTRACTS=1` | opt `tx-sendTx-delegated-authwit` into the standard-contracts variant |
| `ANVIL_URL`, `AZTEC_NODE_URL`, `PLAYGROUND_URL`, `TOOLS_URL`, `TOOLS_DEV_PORT`, `*_PORT` | the port pack (`agent.sh` exports them from `ports.json`) |
| `VITE_NULO_FEE_MULTIPLIER` | build-time fee envelope widening; CI sets `10` to absorb devnet base-fee drift |

### Retry policy is a per-class decision

- PR gates run `retry: 0` (`pr-network-e2e.yml` passes it on every lane; smoke's config keeps 2).
  A masked flake in a required gate is worse than a visible one.
- Nightly omits the input, so the config default (2) plus the exit-86 boot retry applies: absorb,
  then ship.
- Per-test `retry: 0` is mandatory for DESTRUCTIVE scenarios (a password change, a MAC tamper, a
  profile delete mid-file): a retry re-enters against mutated state and buries the real failure
  (`imported-account-lifecycle`, `frozen-account-canary`, `transfers` say why at the top).
- Never add a per-test `retry: 1|2` to hide a flake; root-cause it (§4) or file it in the ledger.
  Smoke's config-level 2 exists because the smoke gate is required on every PR; it is not licence
  for per-test overrides, and a local repro always runs at 0.

### CI topology

- **Smoke** — `pr-smoke-e2e.yml` → `_smoke-e2e.yml`. Runs when the diff trips the `smoke-surface`
  paths filter, when the PR targets `main`, on the `e2e:smoke` label, or on dispatch; 20-minute job; in-job
  armed build by default, or an artifact (`artifact_name` / `extension_path`) for nightly/release.
  Required check `smoke-e2e-status` on both branches.
- **Network** — `pr-network-e2e.yml` → `_network-e2e.yml`. Filter `extension-network`, label
  `e2e:network`. Lanes: 5 vitest shards (`--shard=N/5`, SHA-1 of the file path, proverless, retry 0,
  the 5 dedicated files excluded); two heavy single-file lanes (`fee-methods`,
  `concurrent-sendtx-confirm`, proverless); the **canary** lane prover-ON with the SHA-256-pinned
  `accelerator-server` and `VITE_NULO_ACCELERATOR_REQUIRED=1` (`transfers`, `tx-sendTx-default`,
  `frozen-account-canary`) — a canary run with zero `Proving succeeded` lines fails; the
  `disable_accelerator` dispatch input (or the `NULO_E2E_DISABLE_ACCELERATOR` variable) is the
  rollback to WASM. Exit 86 retries the agent once. After every run the built bundle is grepped for
  `(PROBE|nulo:probe:|VITE_E2E_PROBE)` and any hit fails the workflow (`_network-e2e.yml` skips the
  grep only when its `probe` input is `"1"`, a caller-set investigation mode, not a dispatch option):
  string constants shipped in `dist/` must not contain `PROBE`.
  `scripts/ci-cd/behavior-gating.test.ts` pins the filters and the exclude list against the lanes.
- **Nightly** (`nightly.yml`, the only scheduled workflow) mirrors the lanes with config-default
  retries and publishes a prerelease on full green. **Soak** (`network-e2e-soak.yml`) is manual,
  N iterations at retry 0.
- A red required gate is a flake → rerun once, or breakage → fix. Never advisory, never
  `continue-on-error`, never removed from the required set (CLAUDE.md § Quality gates).

## 2. Write a test

### Selectors

Only `data-testid` (rows: `data-<entity>-id` / `data-<entity>-name`). Never text, role, aria-label,
placeholder, class, or structure. `waitForToast` is the one sanctioned text assertion. If an element
has no testid, add one BEFORE the test. This is convention plus review — no lint rule or scanner
enforces it, so a reviewer has to.

### Start from the right fixture (`fixtures/extension.ts`)

Each fixture builds its own starting state; they are siblings, not a chain, with one exception:
`dappConnectedExtension` takes `registeredExtension`'s browser and mutates it (the file's registered
and connected states share one Chrome). Pick by the state you need and the scope you can afford:

| Fixture | Starting state | Scope |
|---|---|---|
| `extension` | fresh install, liveness reached, first-run tab closed | file |
| `freshExtensionPerTest` | same, relaunched per test | test |
| `registeredExtension` / `…PerTest` | one password profile on `#/popup/general` | file / test |
| `dappConnectedExtension` / `…PerTest` | playground handshake done | file / test |
| `dappConnectedExtensionWithAccountsCap`, `…WithTransactionCap`, `…WithFirstTwoAccountsCap` | handshake plus the named capability grant | test |
| `localNetworkExtension` | profile switched to the sandbox network | file |
| `tokenReadyExtension`, `feeJuiceReadyExtension`, `feeJuiceImportedExtension` | funded token / fee-juice states on the sandbox | file |

A file-scoped browser is shared by the file's tests, so a test that mutates the profile takes a
`PerTest` fixture. Shared browsers leak worker memory between files, which is why the unit is the
file and never the run. Design files order-independent.

### Never bypass the helpers

`clickByTestId` / `clickSelector` (not `page.click` / `handle.click` — raw CDP element clicks hang in
`Runtime.callFunctionOn`), `typeIntoInput` / `replaceInputValue` (not `handle.type`),
`patchPagePolling` (auto-applied by every page opener: `raf` polling is throttled on unfocused tabs,
so waits use `polling: 200`), `withTimeoutMessage` (turns a bare `TimeoutError` into a diagnostic
without swallowing frame-detach or CDP-disconnect errors), `closeStuckPopup` (a `<Transition>` stuck
mid-leave under headless rAF throttling — only after asserting the real post-mutation signal, never
as a substitute for closing through the UI). `waitForPopup` matches a NEW `#/windows/<kind>` target by
URL because every interaction URL carries a unique `requestId`; `callExpectingNoPopup` diffs targets
by identity because plain popup pages change URL under a lock redirect.

### What to assert

- **Post-action state, not the route.** A hash change proves nothing; assert the rendered address,
  the persisted row, the updated balance.
- **Positive counts poll; a zero count is instant only AFTER completion evidence.** Vue lists that
  refresh by array replacement swap children inside a sub-frame window; `page.$$` right after a
  resolved `waitForSelector` can read 0. An absence read before the action's own completion signal
  proves nothing either — wait for that signal (or observe for a bounded window), then read zero;
  pair it with a MutationObserver if a flash matters.
- **State attributes, not visibility.** `offsetParent` and bounding rects are paint artefacts; a
  leaving `<Transition>` is visible while `isOpen` is already false. Gate on `data-dropdown-open`,
  `data-toggle-active`, `data-restore-stage`, `data-boot-outcome`; add one if it is missing.
- **Freshness-gated balances.** An imported backup already carries the expected value. Capture
  `captureBalanceBaseline` first and require `updatedAt` newer AND the exact raw value AND the
  token-scoped render (`waitForFreshBalanceRow`, `waitForTokenCardAmount`); body-text scans
  false-match `$1,000.00` and `11,000`.
- **Approvable ≠ rendered.** The execute confirm button also gates on fee estimation. Use
  `waitForExecuteApprovable`, which reads the live `disabled` AND `pointer-events`; `Button` binds
  the HTML attribute only when it renders a real `<button>`, and the CSS class is the universal
  signal. Cold callers pass 120s (`frozen-account-canary`, `cancel-mid-prove`).
- **A wait is only as honest as its signal.** `waitForFunction` resolves on the first truthy poll —
  it is a ceiling, not a dwell. A settled check tracks continuity (`resetProfile`'s
  `__nuloResetNavTrace`: navigate, require the destination selector AND the hash to hold across a
  short dwell, allow exactly one re-navigation, fail on a second).
- **Lock state comes from storage.** `ensureUnlocked` reads `nulo:core:session`, presses the
  product's `boot-retry` once if the shell reports an unreachable boot, never types on a stale
  marker, and proves the unlock by a newer well-formed record. Password profiles only.
- **Storage reads: key and shape.** `ValueStorage` persists `JSON.stringify(value)` — a raw
  `chrome.storage.local.get` returns a string; config lives at `nulo:config`. Verify both before
  concluding "absent".
- **Imported-account rows by badge, never by name.** An imported account carries its source
  profile's name and collides with the target's own default-named row (`helpers/account-io.ts`);
  prefer a stable id or badge for any row whose display name is not unique by construction.
- **Helpers state their starting route** or navigate there (`importToken`, `switchAccountByAddress`
  need `#/popup/general`).
- **Drive a popup to its own closing action.** `popupStore.open()` on a key that is already open
  updates the payload and order reactively but leaves the open flag true, so a popup whose DOM was
  force-cleared while the store still says open will not remount on the next open of that key.
- **Prove the disruption happened**, not only the downstream state — a test whose kill never killed
  passed for months for reasons unrelated to its subject (ledger #16–19). Red-team a pin by removing
  what it guards: if it still passes, another gate was holding it.

### Product couplings the harness respects

- **Worker readiness is the heartbeat**, not the target: `browser.waitForTarget(service_worker)`
  means Chrome registered the script; `launchExtension` waits for `nulo:liveness` in
  `chrome.storage.session` (30s). After a restart, gate on a heartbeat STRICTLY NEWER than the last
  value the OLD worker wrote (the value survives it in storage; a truthy check lies). The heartbeat
  ticks every 10s, so a snapshot taken BEFORE the kill can be beaten by the old worker's final tick
  and pass before any replacement boots. A read taken AFTER `stopServiceWorker` returns is a safe
  threshold — the old instance is gone, so anything newer than it came from a replacement — but it
  may already BE the replacement's first write, in which case "strictly newer" waits one more tick;
  that is fine for a recovery gate and wrong for a test that times the FIRST heartbeat
  (`sw-resilience`), which must keep its pre-kill baseline and reason about the window. The callers
  today snapshot pre-kill; the gap is not always absorbed downstream, so do not copy the pattern
  into a new test without a downstream wait that would fail on a dead replacement. Read from an
  extension page; a 0 means an invalid or unavailable baseline (no `chrome.storage`, key missing, or
  the read failed), never a value to gate on.
- **Read `chrome.storage` from an extension page**, never through a session on the worker target:
  that attachment is exactly what parks the worker's DevTools host across a restart (§3), and a page
  outlives the worker. `openPopup`, or the blank popup inside `launchExtension`.
- **`consoleErrors` is structurally blind to app `console.*`.** The console sniffer, first script in
  every extension page, reroutes the sniffed `console.*` methods to the worker's LoggerService, so
  `page.on("console")` sees only browser-emitted entries and the sniffer's saved originals
  (`console._log`). `pageerror` is reliable for uncaught throws and rejections. `readSwLogTrail`
  (`fixtures/journal.ts`, `nulo:logs`, 2s flush debounce, bounded) reads the worker's log ring — but
  that flush is gated on `developerMode`, which e2e profiles do not enable, so it returns an empty
  trail unless the test turned Developer Mode on first; empty means not retained. An error the app
  catches and merely logs reaches neither fixture array. Assert on DOM, storage, or stage evidence
  instead. Approval sub-windows carry no listeners at all.
- **`chrome.runtime.reload()` disables an unpacked `--load-extension` build** (every later
  `chrome-extension://` goto is `ERR_BLOCKED_BY_CLIENT`). Never use it for harness state reset; when
  the product calls it (the migration barrier's Retry), click, wait for the pre-reload write, then
  `browser.close()` and relaunch over the same `userDataDir` (`migration.test.ts` `retryAndReopen`).
- **The first-run onboarding tab.** `onInstalled` (`reason === "install"`) opens it before
  `launchExtension` can seed `nulo:onboarding:completed`; the fixture closes it by the id the worker
  stores in `nulo:onboarding:tab-id` BEFORE flipping the flag (a mounted onboarding page that reads the
  flag replaces itself with a popup window and drops the id). On a fresh profile the id is required
  within 5s and the launch fails otherwise; a reused `userDataDir` opens no tab. Onboarding specs open
  their own tab via `openOnboarding`.
- **Passkeys: the virtual authenticator is per FrameTreeNode**, not per browser context, and PRF
  state is not serialisable over CDP. Register, lock/unlock and reset→import are drivable in the SAME
  popup (`fixtures/passkey.ts` `setupPasskeyVirtualAuth`); cross-popup and cross-authenticator flows
  are not (`implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md`). Keep the anchor popup open.
- **A mid-restore kill is two deliberately gated scenarios**, each enforcing its own contract: a
  kill at `service-restore` must roll back, a kill at `account-state` must recover. The
  `restore-gate` rendezvous anchors the kill at the named phase; a torn refusal is the failure
  (`network/backup-restore-sw-restart.test.ts`).
- **A popup that outlives a worker restart keeps a logged-in shell.** Under strict security the
  replacement worker has no in-memory session; the reconnecting popup's boot lands `locked`, but
  `landOnLockScreen` only routes to auth when no profile is selected, so an already-logged-in popup
  stays put with `isLogined` true. Its next Lock click emits no `onActiveProfileChanged`
  (`SessionManager.close()` emits only over an in-memory session), so nothing navigates. A passkey
  profile's persisted record survives the restart (never silently restored) and is cleared by that
  click; a password profile's bearerless record was already dropped at boot. A test that keeps a
  popup open across `stopServiceWorker` locks by waiting for the record to be gone and then navigates
  itself; a fresh `openPopup` boots from storage and lands on auth by itself (ledger #29).
- **The playground sends every tx `NO_WAIT`**: `waitForPgResult` proves the node accepted the
  submission (a real proof on the canary lane), not mining. A test that needs the block waits on the
  node (`waitForTxMined` in `fixtures/aztec.ts`), as both canaries do; the wallet-UI `transfers` flow
  waits through prove → mine in the popup itself.

## 3. Kill or restart the service worker

There is ONE helper: `stopServiceWorker(ext)` in `fixtures/helpers.ts`. Import it; never copy it,
never call `worker.close()` or `Runtime.terminateExecution` in a test.

Why, in six lines. Chrome parks a stopped worker's DevTools host while any CDP session is attached and
hands that host — same target id — to the worker's next start, which under MV3 is milliseconds away.
Puppeteer's `worker.close()` is attach → `Target.closeTarget` → detach, so under load the stop lands
before the detach, the restarted worker inherits the old target, and `targetdestroyed` never fires
(three lost stops in sixteen under two cores). The helper sends `Target.closeTarget` from an
UNATTACHED browser-level session and races three outcomes: `targetdestroyed` by object identity, a
`performance.timeOrigin` strictly newer than the pre-stop reading on whichever worker target is live
(only a new instance can produce it; Puppeteer's own transient auto-attach can still park a host), and
a 15s deadline. Every probe races its own 2s budget, attach included, and releases its session without
awaiting. `Runtime.terminateExecution` aborts running scripts and leaves the worker alive with its
memory, session record and heartbeat intact — a test built on it exercises nothing.

After the call, the OLD instance is gone. Whether a new one is running depends on the test: a page
holding a port reconnects and wakes it at once; `cold-wake-discovery` closes the popup, clears the
alarms, and opens the dApp page BEFORE the kill (a content script injects without messaging) so the
click is provably the first wake event, then asserts no worker target exists before clicking. Then
gate on the strictly-newer heartbeat from an extension page (§2), and expect the popup's boot path
(`popup/boot-session.ts`, `auth-guard.ts`): under strict security a restart drops the session, so
`ensureUnlocked` with a budget sized to the bootstrap (120s on the prover-ON canary) is the
recovery, not a route wait.

A stage that can outlast Chrome's idle reaper (a prover-ON canary) checks `findServiceWorkerTarget`
first: an absent worker is already the restart, so it proceeds to recovery with a warning; a present
one gets the real kill (`restartServiceWorker` in the two canaries). Called with no worker alive, the
helper's own 15s `waitForTarget` throws — nothing in it wakes one.

Stage gates are `chrome.storage.session` rendezvous compiled in by the proverless build, each with
its own protocol: `proof-gate.ts` is presence-only and parks a tx right before `pxe.proveTx`;
`restore-gate.ts` names the phase (`service-restore` / `account-state`) and the worker ACKS by
writing `held` on the same record; `incoming-poll-gate.ts` matches a hold on `{profileId,
networkId, accountAddress, contract, txHash}` and publishes `discovery-held` / `released` /
`committed` on a separate status key. "Armed" is not "reached": wait for the ack
(`waitForRestoreGateHeld`, `waitForIncomingPollPhase`) before killing or asserting. `token-seeds.ts`
is a separately armed reader that must be written before the trigger. A gate's safety timeout
(15–20s) RELEASES with a loud log rather than failing the test, and the journal's `proving` stage is
written before the proof gate is entered and stays through real proving, so it does not prove a
park: a test that depends on the hold needs evidence that excludes a timed-out release (the ack, a
stage that can only exist while held, or an in-flight count that stays put across the window).
Always release in `finally`.

## 4. Diagnose a red run

### Flake or breakage

- A red gate is one of two things. Rerun once on a genuine flake fingerprint; fix breakage. Never
  neutralise the signal.
- **Discriminators**: the failure MOVES between reruns (different victims) and the captured page is a
  healthy wallet parked on the wrong route → flake; the SAME test fails three identical solo runs at
  retry 0 → real. All three retries red is NOT proof of breakage: retries run back to back
  inside the same starved window. Use the diff — no change near the failing subsystem plus a known
  fingerprint plus a busy queue → rerun first.
- Count fixture SHARING, not failures: twenty-two "identical" reds that share one fixture's setup
  call are one bug (`implementations-plan/e2e-full-network-recovery/lessons/the-actual-bug.md`).

### Reproduce like CI

```bash
cd apps/extension
taskset -c 0,1 bun run test:e2e --retry=0 tests/e2e/<file>.test.ts                       # smoke, ×N rounds
NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 taskset -c 0,1 bun run e2e:agent tests/e2e/network/<file>.test.ts
NULO_E2E_RETRY=0 taskset -c 0,1 bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts   # prover-ON
```

Two cores is the amplifier: races that live in a 100ms window on a workstation widen to seconds. Run
the loop alone on the host, freeze the tree between rounds, and validate the fix under the SAME
amplifier (three rounds green is the bar this repo has used; `implementations-plan/e2e-flake-fixes/`
shows a 3/16 → 0/16 before/after). A fix is not "raise the constant": a bigger deadline hides the
worker that refused to die.

### Evidence channels

- `pageerror` (uncaught throws, unhandled rejections) and `readSwLogTrail` (poll past the 2s
  debounce; empty means not retained, not nothing happened).
- Do not rely on console output from a passing test reaching you. Probe by writing uniquely-keyed
  records to `chrome.storage` from inside the extension and dumping them to a real-disk JSONL with
  `appendFileSync`; test the dump path with one no-op probe first. Probe files are
  `_probe-*.test.ts`, env-gated, skipped by default; product-side probe strings must never ship (the
  CI `PROBE` grep).
- An inline sampler between the wait and the assertion HEALS the race it hunts. Run the sampler in a
  detached promise at the original assertion timing and await it afterwards.
- A route trajectory must POLL `location.hash` (vue-router uses `pushState`; `hashchange` never
  fires). A stage trajectory uses a pre-armed MutationObserver on the marker plus ONE final read
  bounded by its own small race — a 200ms poll adds ~1,500 evaluations and perturbs what it measures;
  an unbounded final read can hang the 300s `protocolTimeout` on a wedged renderer.
- Attribute a navigation race by wrapping `$router.push/replace` with stack capture in a throwaway
  probe and matching the chunk file + byte offset against the built bundle
  (`implementations-plan/mac-identity-binding/lessons/phase-2-smoke-deflake.md`: four correct fixes
  where symptom-guessing produced wrong ones).
- `.e2e-state/exec-approvable-timings.log` (every `waitForExecuteApprovable`), `NULO_E2E_STAGE_LOG`
  records, `RetryErrorReporter` output, and `.e2e-state/` uploaded by CI on failure.
- Probe first, hypothesise second. Prototype a disruptive primitive (kill, disconnect, reload) in a
  twenty-line probe before hardening any wait on it — two arcs hardened waits on a kill that never
  killed.

### CI log forensics

- `gh run view --log` echoes the step's SOURCE script with near-identical timestamps before runtime
  output; grepping for `exit 86` or `retrying` matches the source and fabricates an event (two
  sessions confirmed a nonexistent boot-retry story this way). Use
  `gh api repos/{owner}/{repo}/actions/jobs/<id>/logs`, match on timestamps advancing, count real
  invocation markers, and mine at attempt level for reruns that cleared a first-attempt red.
- `[aztec-node] Address already in use (os error 98)` at boot is cosmetic (the wrapper's inner anvil
  loses a bind the setup already holds). The fatal boot signature is
  `deploy_aztec_l1_contracts … required arguments were not provided: --batch` — a `~/.aztec/current`
  drift; the setup resolves the toolchain from the pinned `@aztec/aztec.js` and exports
  `FORGE_BIN`/`ANVIL_BIN` into the node's env.
- A PR with ABSENT (not red) Actions is a CONFLICTING PR: GitHub builds no merge ref. Check
  `gh pr view --json mergeable,mergeStateStatus` before debugging CI.
- Every visible check green but `mergeStateStatus: BLOCKED`: capture `/commits/<sha>/check-runs`
  and repeated `mergeStateStatus` reads over two minutes BEFORE any remedy — an empty commit destroys
  the evidence (the duplicate-aggregator residue is still open, ledger #28).

### Certifying a deflake

A qualifying green run: all required checks green, `run_attempt == 1` on every job, zero retry
markers in RUNTIME logs, no exit-86 annotation, the workload jobs ran BY NAME (a paths-filter skip is
not a pass). Certification triggers are empty commits so N consecutive greens describe ONE tree; any
change to what is certified resets the count.

## 5. Flake ledger

Every named fingerprint with a root cause. Full stories live in the linked plans; `(open)` rows carry
the sanctioned response.

| # | Fingerprint | Mechanism | Fix | Status |
|---|---|---|---|---|
| 1 | `stopServiceWorker: the service-worker target was still alive 15s after close()` (also `Target.detachFromTarget: No session with given id`) | attached `worker.close()` races Chrome's parked DevTools host; restarted worker keeps the target id | unattached `Target.closeTarget` + `performance.timeOrigin` witness (`fixtures/helpers.ts`) | fixed, `e2e-flake-fixes` (2026-09-05) |
| 2 | `Expected no popup but 1 new popup target(s) appeared: …#/popup/auth` (`wallet-locked-mid-session`) | URL-keyed popup diff; an existing page re-routed to `#/popup/auth` under the lock redirect; the unowned first-run tab fed it | identity-keyed diff in `callExpectingNoPopup`; `launchExtension` closes the first-run tab before the flag flip | fixed, `e2e-flake-fixes` |
| 3 | `ensureUnlocked: lock state never settled within 30s (hash: #/popup/auth, …)` after a restart on the prover-ON canary | slow bootstrap under load, AND a first post-restart RPC rejection with no retry path (`isSessionChecked` stuck) | `resolveBootSession` + `lookupActiveProfileWithBackoff` (60s), `data-boot-outcome` + `boot-retry`; harness presses retry once, `decisionBudgetMs: 120_000` on the canary | fixed (2026-09-02) |
| 4 | `waitForExecuteApprovable: not approvable after 10000ms: {…feeMethod:null…}` on `tx-sendTx-multicall-chunked (#33)` while #32 passes | cold-shard fee estimation on the heaviest (7-call) simulation under the default 10s budget | none yet | **open** — rerun once; a second red on a quiet queue → run the file locally before touching the budget or estimation |
| 5 | canary prove-duration variance: `transfers` blows its 600s prove wait, or the canary's grant returns `status:"error"` on code-identical pushes | shared-runner prover-ON duration variance | `pg-error-text` dump on mismatch; sanctioned rerun | **open** — owner decision if it recurs (budget vs runner size) |
| 6 | `TimeoutError: 10000ms exceeded` in `clickByTestId("execute-confirm-btn")` | "ops rendered" ≠ approvable (fee estimation settle) | `waitForExecuteApprovable`; 120s for cold callers | fixed, `e2e-deflake` |
| 7 | `TimeoutError: 5000ms exceeded` at `resetProfile`'s first selector | one-shot hash-equality wait raced vue-router; a competing `router.push` reverted the hash | settle-stable navigation with a monotonic dwell and one bounded re-navigation | fixed, `e2e-deflake` |
| 8 | `TimeoutError: 120000ms exceeded` in the old `waitForBalance` | freshness-blind body-text balance scan | `waitForFreshBalanceRow`; `waitForBalance` retired | fixed, `e2e-deflake`, `deflake-round-2` |
| 9 | `TimeoutError: 30000ms exceeded` waiting for the post-reset route (`opfs-storage`) | route wait raced the awaited purge cascade; tombstone absence is ambiguous | `captureSoleProfileId` + `waitForProfilePurged` first, route second | fixed, `e2e-deflake` |
| 10 | `TimeoutError: 90000ms exceeded` after a full-backup import (`backup-roundtrip`) | route gated on `isLogined`, which waited on an RPC-bound sync | bounded 45s account-state preflight + registration budget | fixed (2026-08-13) |
| 11 | `theme-dark-btn` click timeout in `appearance` | one-shot `offsetParent` sample raced the dropdown's leave transition | `data-dropdown-open` / `data-toggle-active` gates | fixed, `deflake-round-2` |
| 12 | `connectPlayground:awaitVerifyPopup — Timed out after waiting 30000ms` | approval popups' `:disabled` omitted `!requestId`; a click after mount but before `loadInteractionPayload` hit a silent early return | `!requestId` / `!session` in every `:disabled` gate | fixed, `network-followups` (19 investigation rounds) |
| 13 | `waitForPgResult` 30s timeout on the SECOND RPC of every `dappConnectedExtension` test | `handleSetActive` read a route-param computed after an `await`; the helper's own navigation made it `undefined`, so the popup's network watcher bailed | snapshot the reactive value before the `await` | fixed, `e2e-full-network-recovery` |
| 14 | every fixture times out at 30s polling `nulo:liveness`; `__dirname` in `dist/chrome/assets/noirc_abi_wasm-*.js` | dual-bundle package lost its `module` field and the worker got the Node CJS build | conditional `exports` map in the patch | fixed, `e2e-network-recovery` |
| 15 | `61 skipped`, exit 0 | deploy failure provided `aztecTestConfig: undefined`; every `describe.skipIf` skipped | `E2E_REQUIRE_SETUP=1` fail-loud | fixed, `e2e-network-recovery` |
| 16 | `sw-resilience` "strict mode ON → lock on respawn" skipped as "intrinsically flaky" | the kill never killed (`Runtime.terminateExecution`) | real kill; the test passed for the first time | fixed, `deflake-round-3` |
| 17 | `sw-resilience` "strict OFF → silent restore" premise never held | config toggle sent via `chrome.runtime.sendMessage` to a port-only service; silently dropped | drive the real Settings toggle and assert the flag | fixed, `deflake-round-3` |
| 18 | stale post-restart heartbeat satisfied a truthy liveness gate | the dead worker's value survives in `chrome.storage.session` | strictly-newer gate against a pre-kill snapshot | fixed, `deflake-round-2` |
| 19 | `backup-restore-sw-restart` / `frozen-account-canary` restart stage vacuous | same fake kill | `restore-gate` rendezvous rewrite (`deflake-round-4`); canaries consolidated onto the shared helper (`e2e-skill-refresh`) | fixed |
| 20 | `"Client disconnected"` from `deleteProfile` ~800ms after a real mid-restore kill | messaging client flipped to connected on a doomed port; the gap-issued call was rejected client-side | rollback gated on the worker's liveness advancing | fixed, `deflake-round-4` |
| 21 | `pxe op rejected: profile <id> is deleted (generation superseded)` after delete + same-id re-import | offscreen lifecycle map conflated the erased incarnation with its successor | fall-through for `deleted(different-gen)`; `profile-reimport-matrix` pins it | fixed upstream |
| 22 | `importFullBackup` 300s lapse (`backup-restore-sw-restart` designed retry) | one undifferentiated wait spanning restore + activation | labelled stage trajectory on lapse; no stage warranted an early-fail window (30 imports measured) | closed, `import-stage-deadlines` |
| 23 | `consoleErrors` empty on a visibly logged app error | console sniffer (§2) | permanent by design; use `pageerror` + `readSwLogTrail` | closed |
| 24 | deterministic 5 migration reds at ~90s locally, green in CI | unarmed dist (`VITE_NULO_E2E_*` flags) | markers + stamp preflight + `agent.sh` assertions | fixed |
| 25 | `foundryup` HTTP 502 in CI setup | unpinned, unconsumed toolchain step | step deleted; bundled toolchain asserted in `setup-aztec` | fixed, `e2e-deflake` |
| 26 | random early-stage timeouts in unrelated tooling after many local runs | sandbox datadir on tmpfs pinned RAM via deleted-but-open LMDB files | datadir on real disk + `e2e:reap` (#310) | fixed |
| 27 | `authwit-lifecycle` revoke pin passed before revoke existed | `handleSendTx` ignored a session-authorised `opts.from` (sent as account A) | `resolveNetworkAndAccount(requestedFrom)` | fixed, `network-e2e-required` |
| 28 | every check green, `mergeStateStatus: BLOCKED` on a labelled PR | duplicate concurrency-cancelled runs leave FAILURE aggregators; the believed "latest-per-name" mechanism was refuted by measurement | `pr-quick.yml` dropped `labeled` triggers; blocks remain unexplained | **open** — capture evidence before remedying |
| 29 | `passkey-execution-canary`: `waitForHash(#/popup/auth)` 15s timeout after the header lock, first seen on the first REAL restart the stage ever ran | the replacement worker holds no in-memory session, so `SessionManager.close()` clears the persisted record without emitting `onActiveProfileChanged`; the event-driven redirect never fires and the open popup keeps its page (`e2e-skill-refresh/lessons/phase-1.md`) | harness: wait for the record to be gone, then `navigateByHash("#/popup/auth")`; product shape is the owner's call | fixed in the harness; **product edge open** |

## 6. Editing the harness

### `global-setup.ts` is a coordinator over stage functions

`reconcilePriorLock`, `ensureAnvil`, `ensureAztecNode` + `spawnAztecNode`, `ensureDevServer`,
`finishBoot`, `provideWithoutSandbox`. Rules from its audits, each guarding a real failure:

- **Probe first, gate second.** Every `ensure*` starts with its health probe; binary and pin gates
  sit inside the "not already running" branch, or a healthy pre-existing node with an unusable pin
  throws under `E2E_REQUIRE_SETUP=1`.
- **`markBootStarted()` stays between `writeProvisionalLock()` and the first spawn.** Its position
  is the exit-86 contract.
- **Ownership order after a spawn: handle → `weStarted* = true` → `recordSpawnedPid()`**, before
  listeners and the readiness wait; `ensureDevServer` takes `setHandle`/`setStarted` callbacks for
  this reason. Never reset a `weStarted*` flag on a kill path; teardown's data-dir removal keys off it.
- **The reuse path owns nothing**: no provisional lock, `weOwnLock` false, `clearLock()` only under
  `if (priorLock)` after a reap; `markBootReady()` without `markBootStarted()`.
- **Skip exits share provides, not cleanup**: cleanup in the stage, `provideWithoutSandbox` +
  `return` in the coordinator.
- **Log pipes are per child**; anvil is stderr-only with `address already in use` in its needle set.
- **The default export's RETURN VALUE is the teardown.** A named `teardown` export beside a default is
  silently ignored by vitest (both setups leaked for the suite's whole life).
- **No bash signal trap in `agent.sh`**: bash defers INT/TERM until the foreground child exits, so a
  trap protects nothing and clobbers the classified exit code; `process.on("exit")` in the setup does
  a synchronous best-effort SIGTERM and never clears the lock (a survivor must stay findable).
- **Proof for a change here**: the full network suite on CI, the reuse drill (bare vitest on a
  pinned pack, `kill -9` the vitest group after deploy so the pack survives, run again →
  `reusing prior sandbox (identity check passed)`), the reap drill (`e2e:agent` after →
  `prior lock is for different ports — reaping orphans`), the fail-loud negative (empty `HOME` on
  free ports → the anvil FATAL before any spawn).

### Adding a build-armed feature

Static import behind an `if (import.meta.env.VITE_NULO_E2E_X)` guard so DCE removes it — a dynamic
`import()` emits a chunk that SHIPS from a dead branch; double opt-in (`_CONFIRM`) for anything that
changes execution semantics; a `*_BUILD_STAMP` string; the `agent.sh` bundle assertion; the CI
negative grep; on every file that needs it, a `beforeAll` stamp check — plus the
`@requires-proverless` marker if the feature rides the proverless build (no other marker is
scanned; a new build flag needs its own runner guard). The trust boundary in prod is the absent
listener, not `chrome.storage` access.

### Adding a stage gate

Presence-only `chrome.storage.session` key (present = hold), `remove()` on release AND on a loud
safety timeout, placed so it is not a new cancel checkpoint (the proof gate sits after the
coordinator's pre-prove `checkCancelled` and before the post-prove one).

## 7. References

- `apps/extension/tests/e2e/README.md` — layout, per-file purposes, helper table, what each
  worktree owns.
- `CI.md` § e2e, `.github/workflows/{pr-smoke-e2e,_smoke-e2e,pr-network-e2e,_network-e2e,nightly,
  network-e2e-soak}.yml`.
- Plans (`implementations-plan/`): `e2e-flake-fixes` (the parked-host mechanism, five codex rounds),
  `e2e-deflake` (+ `flake-ledger.md`), `deflake-round-2`, `deflake-round-3` (the kill primitive
  measured), `deflake-round-4` (crash-truth suite), `import-stage-deadlines`, `mac-identity-binding`
  (post-unlock races), `e2e-full-network-recovery` (probe-first), `e2e-network-recovery`,
  `network-e2e-required`, `network-followups`, `parallel-e2e-isolation`, `e2e-proverless-stub`,
  `passkey-e2e`, `migration-lifecycle`, `e2e-skill-refresh` (this rewrite).
