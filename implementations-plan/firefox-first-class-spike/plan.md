---
plan: firefox-first-class-spike
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 2 agents; foreign reviewer at high; code-review off (standing owner directive)
status: APPROVED by the owner 2026-09-18 (plan v3) — implementing; no phase green yet
---

# Firefox as a first-class target

**Goal.** Firefox gets the same treatment Chrome has today: the same smoke and network e2e suites run against the Firefox build, per PR (sharded), nightly, and in the release chain. The one user-facing Firefox bug found on the way (passkey profile creation fails) is fixed.

**Done line (owner, 2026-09-18).** Every Firefox CI stage is live and has been green once, all **advisory**. Promotion to required checks is written into the runbook as dated follow-up switches, not waited for here. The nightly and release stages can only go green after merge, so the plan has two closing states: **delivered** (stack open, PR lanes green) and **completed** (owner's post-merge checklist shows the nightly and release Firefox jobs green). The index is marked completed only at the second.

**Owner decisions (2026-09-18).**
- Network e2e on Firefox = the full sharded suite per PR, like Chrome (a thin canary was recommended and declined). That includes the portable heavy lanes and real-proving canaries, not only the proverless pool.
- Tests that kill or reach into the background script stay Chrome-only, skipped on Firefox as whole files.
- AMO scope = manifest items only (`data_collection_permissions`, gecko id). Source package and submission are out.
- `/code-review` off.
- **2026-09-20 — the Phase 2 lint gate is met for real, not excepted.** Offered a narrow exception for the one `FILE_TOO_LARGE` error, the owner chose to shrink the file instead, as a seventh arc on the stack (Phase 9), and chose option A for the Token artifact: strip the embedded Noir debug source at build time rather than load the artifact at runtime. This widens the "manifest items only" AMO scope above by exactly that: the bundle must pass `web-ext lint`. Source package and submission stay out.

Read `recon.md` first: it holds the reuse map, the portability census and the spike findings this plan builds on.

## Architecture & Implementation

### Shape

One suite, two browsers. The browser is a seam **under** the existing fixtures: shared test bodies, browser-specific launch, disposal and discovery. **Chrome's target-based logic stays byte-identical**; it moves behind the seam, it is not rewritten. Test files keep calling `launchExtension`, `openPopup`, `waitForPopup`, `setupPasskeyVirtualAuth`.

```
NULO_E2E_BROWSER = chrome (default) | firefox      # unknown value → throw at global-setup

tests/e2e/fixtures/browser/
  index.ts              # reads the env once; exports e2eBrowser, isFirefox, CHROME_ONLY reasons
  chrome.ts             # today's puppeteer.launch body + service_worker id discovery, moved verbatim
  firefox.ts            # geckodriver lifecycle, classic session, add-on install, BiDi attach, disposer
  webdriver-classic.ts  # small typed fetch client, every request bounded by AbortSignal.timeout
  bidi-attach.ts        # transport that answers session.new / session.end locally
  ownership.ts          # per-launch pid files + profile dirs (works for smoke AND network)
```

### Key interfaces

```ts
// fixtures/browser/index.ts
export type E2eBrowser = "chrome" | "firefox"
export const e2eBrowser: E2eBrowser
export const isFirefox: boolean
export const CHROME_ONLY = {
  backgroundKill: "kills the MV3 service worker over CDP; Firefox exposes no background context",
  cdpFetch: "arms CDP Fetch interception on held targets; BiDi has no equivalent",
} as const

// added to ExtensionContext
extensionOrigin: string          // chrome-extension://<id> | moz-extension://<pinned uuid>
extensionUrl(path: string): string
/** Idempotent. The ONLY way a test ends a browser. Chrome: browser.close().
 *  Firefox: disconnect → delete session → kill owned geckodriver group → drop the pid file;
 *  removes the profile dir only when this launch created it. */
close(): Promise<void>
```

`fixtures/passkey.ts`: the exported setup keeps `cleanup()` and the authenticator options; the CDP-typed members `anchorSession` / `perPopupSessions` are removed if the implementation-time grep confirms no test reads them. Firefox adds ONE classic authenticator per session (its test token is session-global).

### Control flow on Firefox (critical path)

1. `global-setup*` resolves `extensionPath` (`EXTENSION_PATH`, else `dist/<browser>`), validates `manifest.json`; for Firefox it checks `geckodriver` and the Firefox binary exist and fails loud with the install command.
2. `firefox.ts` picks **three** ports (geckodriver HTTP, BiDi websocket, Marionette via `--marionette-port`) with `resolve-ports.ts`'s bind-and-release allocator immediately before the spawn — it is an allocator, not a reservation registry, so a lost race surfaces as a geckodriver bind error and one bounded retry with fresh ports. It spawns geckodriver `detached` on `127.0.0.1` and writes a per-launch record through `ownership.ts` before anything else can fail. A record holds pid, the process start time read from `/proc/<pid>/stat`, the profile dir and whether this launch created it. Records are one file per launch (never the singleton `OwnedState` pattern).
3. Profile dir: the caller's `userDataDir` if one was passed (relaunch tests own theirs), else a new `nulo-firefox-<pid>-<ts>` dir under `NULO_E2E_DATA_ROOT` (real disk). Passed as `-profile <dir>`.
4. `POST /session` with `webSocketUrl: true`, `-headless` unless `HEADLESS=0`, and prefs: the two soft-token prefs; `extensions.webextensions.uuids` pinning the gecko id to a fixed test UUID; `extensions.webextensions.keepStorageOnUninstall` and `keepUuidOnUninstall` so a relaunch on the same profile keeps storage and origin.
5. `installAddon(extensionPath)` (temporary). The origin is the pinned UUID — known before any page exists, and valid on a relaunch that opens no onboarding tab.
6. `bidi-attach.ts` connects Puppeteer to the session's BiDi socket. From here on it is ordinary Puppeteer.
7. Any failure in 2–6 runs the same disposer in `finally`. The disposer confirms the process group has exited before it deletes a profile dir. `e2e:reap` sweeps stale records and `nulo-firefox-*` dirs, and signals a recorded pid only when its start time still matches — a recycled pid belongs to someone else.

### File-level change map

| Change | Files |
|---|---|
| PRF fix + tests | `src/wallet/utils/passkey-ceremony.ts`, `passkey-ceremony.test.ts` |
| Manifest | `manifest/manifest.firefox.config.ts`, `src/manifest.test.ts` |
| Browser seam (new) | `tests/e2e/fixtures/browser/*` |
| Seam adoption | `fixtures/extension.ts` (launcher out, `close()` in); every `chrome-extension://` literal → `extensionUrl()` (the 9 in `recon.md` plus `migration.test.ts:133`, `onboarding-tab.test.ts:129,272,283`, `network/session-profileSwitch.test.ts:36`; the implementation-time grep is authoritative, not this list); the `browser.close()` sites that hold an `ExtensionContext` → `ctx.close()`. `tests/e2e/scripts/check-derivation-parity.ts` is a standalone Chrome tool with no context: it keeps `browser.close()` and is exempted by name in the guard |
| Discovery on Firefox | decided by Phase 4 probe T: either nothing (Puppeteer's BiDi `targets()` / `waitForTarget` / `targetcreated` work and the finders in `popups.ts`, `playground.ts`, `journal.ts` plus the 7 test files calling `browser.targets()` run unchanged) or Firefox-only implementations behind the same function signatures |
| Runner | `scripts/e2e/agent.sh` (build target + the ~10 `dist/chrome` assertions, lines 92-179), `scripts/e2e/resolve-ports.ts`, `tests/e2e/reap.ts`, `global-setup.ts` (`EXTENSION_PATH` seam), `global-setup-smoke.ts` |
| Skip tags | whole-file `describe.skipIf(isFirefox)` on the 9 `stopServiceWorker` users + `import-dead-rpc.test.ts` |
| CI (new) | `.github/actions/setup-geckodriver/action.yml`, `.github/workflows/pr-extension-smoke-e2e-firefox.yml`, `.github/workflows/pr-extension-network-e2e-firefox.yml` |
| CI (adapted) | `.github/actions/setup-puppeteer` (`browser` input), `_extension-smoke-e2e.yml` + `_extension-network-e2e.yml` (`browser` input; artifact, cache and log names namespaced by browser), `nightly.yml`, `release.yml`, `scripts/ci-cd/behavior-gating.test.ts` |
| Deleted | `scripts/firefox-smoke.mjs` + `smoke:firefox`, the three spike scripts |
| Docs | `CLAUDE.md`, `CI.md`, `.github/README.md`, `tests/e2e/README.md`, `SECURITY.md`, skills `e2e-testing` + `chrome-extension-debug` |

`pr-extension-smoke-e2e.yml` and `pr-extension-network-e2e.yml` — the files that produce the required checks — are **not edited**.

### Non-obvious mechanics

- **Advisory without `continue-on-error`.** That key is not allowed on a job that `uses:` a reusable workflow. PR legs are advisory by living in separate workflow files whose aggregators (`extension-smoke-e2e-firefox-status`, `extension-network-e2e-firefox-status`) are not in any branch's required set. In `nightly.yml` and `release.yml` the Firefox job sits outside `status` / `attach-assets.needs` — the same way `verify-live` is advisory today. A red Firefox job can turn a run red; it cannot block a merge or a release.
- **A Firefox run never emits a required check name.** No Firefox dispatch input is added to the two required workflows: a dispatched run reports its aggregator on the head SHA, and a Firefox result under `extension-network-e2e-status` would poison the required check for that commit.
- **A popup window with no profile self-closes within 3 s.** Helpers never open Nulo's popup page in a popup-type window before a profile exists.
- **`POST /window/new` hangs while a popup window is current.** The classic client never creates windows.
- **The PRF fallback keeps the identity it already knows.** The fallback `get` is restricted to the created credential (`allowCredentials`), its `rawId` is asserted equal to the created one, and the caller's `userHandle` is returned — an assertion may legally omit `userHandle` when `allowCredentials` is set, which would otherwise mint a second profile id.
- **Test builds only.** `VITE_NULO_PRESTO_REQUIRED` and the proverless flags belong to test builds; `_build-extension.yml` already rejects their markers in a production artifact. Firefox test builds are made exactly the way `_extension-network-e2e.yml` makes Chrome's.
- **Versions.** Firefox = what the pinned Puppeteer resolves (153.0.4 today), asserted in the log at launch. geckodriver 0.37.1 by tarball + binary SHA-256.

### Trade-offs and alternatives not taken

- **v1 of this plan rewrote every `targets()` finder onto `pages()`.** Both audits rejected it: `pages()` is async and polls, `callExpectingNoPopup` needs `targetcreated` to catch transient windows, `captureTargetInventory` needs a synchronous read. Replaced by shape D above.
- **Env var vs vitest `projects`.** Global-setup owns ports, the node and the build per run; CI wants separate jobs anyway. Env var.
- **Hybrid always vs hybrid only for passkey tests.** One launch path, uniform teardown, one extra process. Hybrid always.
- **Outline B — a separate small Firefox suite.** Zero risk to Chrome, but the opposite of "same treatment" and it forks helpers on day two. Fallback only if Phase 3 cannot keep Chrome green.
- **Outline C — Selenium for Firefox.** Everything it was wanted for works on the hybrid; a second driver is a second fixture stack.

## Phases

Fast layers (`bun run lint`, `bun run typecheck`) run after every meaningful step, not only at the gate. E2E commands are run from `apps/extension` with an absolute `cd` prefix, solo on the host, never concurrently with `audit:vue` or a codex run.

### Phase 1 — PRF fallback fix ✓

`runCreate` returns the create-time PRF when `results` is present; otherwise it falls back to a `get` restricted to the created credential, asserts the assertion's `rawId` matches, and returns the caller's `userHandle`. Unit tests drive the exported `runPasskeyCeremony` with a stubbed `navigator.credentials`: (a) results at create → no `get`; (b) `enabled: true`, no results → one `get`, its PRF, the ORIGINAL `userHandle` even when the assertion omits it; (c) fallback assertion with a different `rawId` → throws; (d) no `prf` extension → throws; (e) fallback without results → throws; (f) abort signal reaches both ceremonies. The PR body states that Firefox users see two prompts.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/wallet/utils/passkey-ceremony.test.ts && bun run audit:vue` — all exit 0, the six cases listed as passed. Layers: lint, typecheck, unit, build.

### Phase 2 — Firefox manifest items ✓

`data_collection_permissions: { required: ["none"] }`, `strict_min_version: "153.0"`, gecko id unchanged (`wallet@nulo.sh`) — the owner's answers to A1–A3; `manifest.test.ts` pins all three.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/manifest.test.ts && bun run --cwd apps/extension build:firefox`, then `bunx web-ext@<exact version, ≥7 days old, recorded in lessons> lint --source-dir apps/extension/dist/firefox` reports 0 errors. Layers: lint, typecheck, unit, build.

### Phase 3 — Browser seam, Chrome only ✓

`fixtures/browser/{index,chrome}.ts`; `extensionUrl()`; `ctx.close()` adopted at all 36 sites; the `EXTENSION_PATH` seam in network `global-setup.ts`. No Firefox code, no finder changes. A new static guard at `apps/extension/scripts/e2e/browser-seam.test.ts` — under `scripts/**/*.test.ts`, which the unit config includes; `tests/e2e/**` is excluded from it and a test placed there would never run — fails if an executable `chrome-extension://` literal or `browser.close()` call appears under `tests/e2e/` outside `fixtures/browser/chrome.ts`, skipping comments, itself, and the one named standalone tool.

**Validation gate.** `bun run lint && bun run typecheck && bun run test`; local `bun run test:e2e` (full Chrome smoke) exits 0; then push the branch and run the **complete Chrome CI topology on it**: `gh workflow run pr-extension-smoke-e2e.yml --ref <branch>` and `gh workflow run pr-extension-network-e2e.yml --ref <branch>` — both runs' `status` jobs conclude `success` (network CI runs `retry: 0` across all five shards, the heavy lanes and the canaries; smoke keeps its configured two retries). The acceptance is **bound to the tested SHA**: any later commit on this arc invalidates it and the two dispatches are re-run before the arc's loop is declared converged. These are genuine Chrome runs of the required suite, so the check-runs they emit on that SHA are earned, not borrowed. Layers: lint, typecheck, unit, smoke e2e, full network e2e on CI.

### Phase 4 — Firefox driver + feasibility probes (kill criteria) ✓

`firefox.ts`, `webdriver-classic.ts`, `bidi-attach.ts`, `ownership.ts`, reap pattern, `agent.sh` browser plumbing. Probes live in `tests/e2e/probes/` with their own `vitest.e2e.probes.config.ts` so no Chrome shard glob picks them up; they are deleted at the end of Phase 6.

- **Probe T (discovery).** On BiDi: `browser.targets()` lists an extension-opened window, `target.type() === "page"`, `browser.waitForTarget()` resolves for one, `targetcreated` fires. Pass → finders run unchanged. Fail → Firefox-only finder implementations that must preserve four behaviours, each with its own probe assertion: (i) **transient-window detection** — `callExpectingNoPopup` must still catch a window that opens and closes inside the call, from BiDi `browsingContext.contextCreated` events, never from before/after snapshots; (ii) **request identity** — `waitForPopup` keeps matching the window to its request id / `#/windows/{kind}` URL, not "any new page"; (iii) **readiness** — the returned page has its frame loaded before a test touches it; (iv) **a synchronous inventory** for `captureTargetInventory`, served from an event-maintained cache so diagnostics can never hang. If (i) cannot be met, the affected tests are not quietly weakened: that is an owner decision.
- **Probe 1.** On an existing profile, the playground discovers the wallet through the content script; the approval window is found and a `data-testid` in it is clicked.
- **Probe 2.** An execute/confirm window opened from the popup is reachable the same way.
- **Probe 3.** A Presto-required Firefox test build sends one transaction end to end from the stand-in window, with Presto activity in its log (a balance read does not prove proving).
- **Probe R.** Relaunch on the same profile, reinstalling the temporary add-on: storage and the pinned origin survive; the storage migration engine runs on the second start exactly as `migration.test.ts` expects; the install-triggered onboarding tab behaves as that test assumes (installing always fires the first-run path, so "no onboarding tab on relaunch" must be checked, not assumed); `ctx.close()` leaves no geckodriver or Firefox process and no ownership record. Pass is evidence for this one test's needs, not a claim that a temporary reinstall equals a Chrome restart.

**Kill criteria.** Probe 1 or 2 failing on both BiDi and classic window handles, or Probe 3 failing, means the network suite on Firefox is not achievable as planned. Stop, log it, surface to the owner. Shrinking to smoke-only or adding any Chrome-only file beyond the ten listed needs the owner's explicit approval, not a logged reason.

**Validation gate.** `bun run lint && bun run typecheck`; then `NULO_E2E_BROWSER=firefox bun run e2e:agent:probes` — a root script this phase adds, which reuses `agent.sh`'s stack bring-up with the probes config — prints `PROBE T PASS`, `PROBE 1 PASS`, `PROBE 2 PASS`, `PROBE 3 PASS`, `PROBE R PASS` (Probe T may instead print its documented FAIL once the Firefox-only finders are implemented and the other four pass through them). Results in `lessons/phase-4.md`. Layers: e2e (local network) on Firefox.

### Phase 5 — Smoke suite on Firefox ✓

Classic passkey implementation; `journal.swEvaluate` no-op on Firefox; whole-file `describe.skipIf(isFirefox)` with `CHROME_ONLY` reasons; a guard inside `stopServiceWorker` that throws if called on Firefox; delete `firefox-smoke.mjs` and the spike scripts.

**Validation gate.** `bun run lint && bun run typecheck`. `test:e2e` does not build, so first build the Firefox smoke artifact with the same flags `_extension-smoke-e2e.yml:68-82` gives Chrome's: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:firefox`. Then `NULO_E2E_BROWSER=firefox NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` exits 0 **twice in a row**. The browser adds exactly four whole-file exclusions on top of the suite's existing conditional skips (`sw-resilience`, `sw-restart-network`, `imported-account-lifecycle`, `import-dead-rpc`); `migration.test.ts` and `backup-migration.test.ts` must RUN, not skip, on Firefox (the fixture flag is what arms them); `bun run test:e2e` on Chrome still exits 0; after the runs, no owned geckodriver/Firefox process, pid file or profile dir remains. Layers: lint, typecheck, smoke e2e on both browsers.

### Phase 6 — Network suite on Firefox ✓

Run what CI runs, lane by lane, with each lane's exact env and arguments as `_extension-network-e2e.yml:122-125,227-248` composes them, locally and sequentially (or split across agent runs). Every lane runs under one preamble, the executable form of CI's env (`_extension-network-e2e.yml:122-137`):

```bash
export NULO_E2E_BROWSER=firefox NULO_E2E_RETRY=0 VITE_NULO_FEE_MULTIPLIER=10
EX=()   # one --exclude per file in the pool's exclude_files list, as CI builds EXCLUDE_ARGS (lines 233-237)
for f in fee-methods selfpay-phase concurrent-sendtx-confirm transfers tx-sendTx-default frozen-account-canary; do
  EX+=(--exclude "tests/e2e/network/$f.test.ts")
done
```

The canary lane needs `presto-server` started the way CI starts it (`PRESTO_ALLOW_ALL=1`, line 193): the default server rejects the extension's origin.

| Lane | Command |
|---|---|
| Pool, N = 1..5 | `NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=N/5 "${EX[@]}"` |
| heavy | `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/fee-methods.test.ts tests/e2e/network/selfpay-phase.test.ts` |
| heavy-concurrent | `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/concurrent-sendtx-confirm.test.ts` (its barrier only exists in a proverless build) |
| canary, real proving | `VITE_NULO_PRESTO_REQUIRED=1 bun run e2e:agent tests/e2e/network/transfers.test.ts tests/e2e/network/tx-sendTx-default.test.ts` with `PRESTO_ALLOW_ALL=1 presto-server` running; `frozen-account-canary` is Chrome-only | Every failure is fixed in a fixture, fixed in the product (own commit, called out), or brought to the owner. Delete `tests/e2e/probes/`.

**Validation gate.** All five pool shards and every portable dedicated lane exit 0 on Firefox. The Chrome-only set is exactly the six network files in `recon.md`. Layers: network e2e on Firefox, proverless and real-proving.

### Phase 7 — CI lanes (all advisory) ✓

1. `setup-geckodriver` composite action on the `setup-presto-server` template (tarball SHA-256, single-member tar check, binary SHA-256 re-verified on cache hits).
2. `browser` input on `setup-puppeteer` and the two reusable e2e workflows; artifact, log and cache names namespaced by browser — cache **restore prefixes** included (`setup-puppeteer`'s current prefix is browser-independent, so a Firefox run could restore or evict Chrome's cache). These three shared files are the one place a Firefox change can break Chrome; their `browser` input defaults to `chrome` and every Chrome code path stays textually unchanged.
3. New `pr-extension-{smoke,network}-e2e-firefox.yml`: the Chrome callers' path filters and labels, **plus** each Firefox caller's own filename and `.github/actions/setup-geckodriver/**` — the copied filters name only the Chrome callers, so without this a PR touching only the Firefox lanes would skip them and report success. `behavior-gating.test.ts` pins that coverage. Skip draft PRs, own `concurrency` group, own aggregators. Permissions: `contents: read` workflow-wide plus `pull-requests: read` on the `changes` job only — `dorny/paths-filter` reads the PR's file list through the API and fails without it. No write scope, no secret, no environment.
4. `nightly.yml`: Firefox smoke + Firefox network jobs outside `status`. `release.yml`: `smoke-firefox-against-artifact` (needs `build-firefox`) outside `attach-assets.needs`.
5. `behavior-gating.test.ts` extended: pins the Firefox lanes and asserts no Firefox job appears in a required aggregator's `needs`.

**Validation gate (pre-PR).** `bun run lint:actions` and `bun run test:ci-gating` exit 0. **No workflow is dispatched from the branch**: `nightly.yml` always builds `origin/dev`, `release.yml` builds the tag's commit and reaches a `production` environment, so a branch dispatch tests the wrong code and risks side effects.
**Acceptance at delivery.** When arc 6's PR opens, the two Firefox workflows run from the PR's own workflow files and their aggregators conclude `success`; the three required checks are unchanged in name and result. CI-only fixes after that PR opens are expected and land on arc 6 — the one deliberate exception to "no churn after PR open".
**Post-merge checklist (owner-triggered, recorded in `CLAUDE.md`).** First scheduled nightly on `dev` shows both Firefox jobs green; first release shows `smoke-firefox-against-artifact` green. Either red → fix forward or revert arc 6; nothing else depends on it. Until both are ticked the plan is **delivered, not completed**: `index.md` says "delivered — awaiting nightly + release evidence", and the owner's done line is not claimed.

### Phase 8 — Docs and skills ✓

`CLAUDE.md` (quality-gate tables; staged-rollout switches: release-chain Firefox smoke → `attach-assets.needs` after one clean release; PR Firefox smoke → required after 14 consecutive green nightlies; PR Firefox network → required after 30; the post-merge checklist), `CI.md`, `.github/README.md`, `tests/e2e/README.md`, `SECURITY.md` (geckodriver pin; the trusted-co-tenant statement), `e2e-testing` skill (Firefox section), `chrome-extension-debug` skill (replace the "no such frame" claim with the hybrid).

**Validation gate.** `bun run lint` and `bash scripts/check-no-brand.sh` exit 0; every path and command named in new doc text exists (spot check logged in `lessons/phase-8.md`). Layers: lint, path guard.

### Phase 9 — Every shipped file under the linter's parse limit (light amendment, 2026-09-20) ✓

**Why.** `addons-linter` refuses to parse any non-binary file (JS, CSS, HTML, JSON) of 5 MiB or more and reports `FILE_TOO_LARGE` — an error, and a file nobody scanned. The Firefox bundle has one: `assets/offscreen-*.js`, 20.3 MB. Phase 2's gate (`web-ext lint` → 0 errors) cannot pass until it is gone.

**What the spike found (2026-09-20).** Two causes, two fixes:
1. `vite.config.ts` has no chunking rule, so everything the offscreen page imports lands in one file. Rolldown's `output.codeSplitting` with one `node_modules` group and `maxSize: 4_000_000` turns it into ~4 MB pieces; the build passes.
2. One piece stays at 6.1 MB because it is a single module: the Wonderland Token artifact (`@wonderland-token-artifact`, 5.3 MB on disk), a JSON import a bundler cannot split. 1.46 MB of it is `file_map` — the Noir source text, used only to print source snippets in simulation error traces. Emptying it (`file_map: {}`) takes the minified artifact from 4.07 MB to 2.63 MB and **leaves the contract class id unchanged** (measured for both aliased artifacts: Token `0x0225da0f…`, PrivateFPC `0x032bc73c…`, identical before and after). `debug_symbols` inside `functions` stay.

**Changes** (all in `apps/extension`; `apps/tools` and the wallet packages are not touched):
1. `vite.config.ts` — `build.rollupOptions.output.codeSplitting: { groups: [{ name: "vendor", test: /node_modules/, maxSize: 4_000_000, entriesAware: true }] }`. Shared config, so Chrome's bundle changes the same way. `entriesAware` keeps a module out of entries that never imported it: without it a grouped module can reach the service worker and run an initializer that expects a DOM.
2. `scripts/strip-artifact-file-map.ts` — a `pre` vite plugin that, for exactly the files `artifactAliases` resolves to, returns the JSON with `file_map: {}`. The alias paths run through `apps/extension/node_modules` symlinks while Vite hands plugins the real path under `node_modules/.bun`, so both sides are compared after `realpathSync` + `normalizePath`; the build fails if either aliased artifact was never seen, so a miss cannot be silent. Build and dev server alike; the vitest configs do not load it, so unit tests keep reading the full artifacts.
3. `scripts/parse-limit-guard.ts` — a build-only vite plugin whose `closeBundle` walks the finished `outDir` and fails the build when any file the linter parses is ≥ 4,718,592 bytes (4.5 MiB: the linter's 5 MiB minus headroom), naming it. The finished directory, not `generateBundle`: @crxjs emits its manifest assets last and Vite copies `public/` straight to disk, so the bundle object is not everything that ships. Sizes are bytes on disk. The extension list is the linter's own (`getScanner` in addons-linter 10.10.0): `.html .htm .js .jsm .mjs .json .properties .ftl .dtd` — CSS and everything else go to its binary scanner, which has no limit. In the build rather than a workflow step: it runs in every lane and locally, for both browsers, and no workflow file changes. The rule is a pure function with a unit test.
4. Tests: the strip plugin (only the aliased files; `file_map` emptied, everything else byte-equal after a JSON round-trip; a non-artifact `.json` untouched), the guard's rule, one case pinning that `extractCallStack` over an artifact with an empty `file_map` returns the unresolved opcode locations instead of throwing (the resolver does throw on the missing file; both callers catch it — this pins that the real error is never masked), and one `@vitest-environment node` case pinning that the class id of each aliased artifact is the same with and without `file_map` — the claim this phase rests on, so it cannot silently stop being true on an artifact bump.
5. Docs: `FIREFOX.md` (the limit, the two mechanisms, what to do when the guard fires), `SECURITY.md` if the bundle-scan statement needs it, `lessons/phase-9.md`.

**UI impact:** none. **Behavioural difference:** a simulation error inside the Wonderland Token or the PrivateFPC no longer carries Noir source snippets in its trace (function names and opcodes remain). Developer-facing log detail only.

**Risks.** (a) Regrouping changes which chunk a module lives in, and with it side-effect timing and what the service worker or a content script pulls in; @crxjs writes loaders and the manifest, it does not restore module semantics. `entriesAware` bounds it; the smoke + network suites on both browsers are the proof. (a′) @crxjs adds every content-script dependency to `web_accessible_resources`, and the content script matches every site, so regrouping can make a previously internal chunk readable by any page. The gate diffs the generated manifest's WAR list against the pre-change build, and a widened list is a finding, never patched by widening a pattern. (b) `maxSize` is a target, not a cap: a future single module over the limit defeats it — which is what the guard is for; the answer then is option B (ship that artifact compressed, load it at runtime), recorded here so it is not rediscovered. (c) Chunk count rises (~130 → ~420 files); extension pages load from disk, so no network cost, but the zip's file count grows.

**Validation gate.** `bun run lint && bun run typecheck && bun run test` exit 0; `build:chrome` and `build:firefox` exit 0 with the guard active; `bunx web-ext@10.6.0 lint --source-dir apps/extension/dist/firefox --self-hosted` reports **0 errors** (this is also Phase 2's gate — Phase 2 is ticked on this evidence); the generated `web_accessible_resources` of both builds equal the pre-change lists (or every addition is explained in `lessons/phase-9.md`); locally the Firefox and Chrome smoke suites exit 0 on builds made with the smoke flags (`FIREFOX.md`; smoke does not build, and the lint artifact is a different build); **one real proof on the WASM backend per browser** — `tests/e2e/network/transfers.test.ts`, prover on, no `presto-server` and `VITE_NULO_PRESTO_REQUIRED` unset — because CI's prover-ON lanes require native Presto proofs and so never load the WASM prover, its workers or its fallback assets, which are exactly what was rechunked; on the arc's PR the three required checks and both Firefox aggregators conclude success. Layers: lint, typecheck, unit, build, web-ext lint, smoke + network e2e on both browsers.

**Plan audit (codex, GPT-6 Astra `high`, single pass — light tier): conditional approve.** Six conditions, all verified against the installed tools and folded in above: real-path matching for the strip plugin with a fail-closed "artifact never seen" check; `entriesAware: true`; the guard reads the finished output directory in bytes with the linter's own extension list; a WASM-backend proof per browser added to the gate; a `web_accessible_resources` diff added to the gate; the "empty `file_map` never throws" claim corrected (it throws inside the resolver and is caught) with a regression case.

**Amended during implementation (2026-09-20) — five things the spike got wrong or missed; details in `lessons/phase-9.md`.**
1. The 6.1 MB module was not the Wonderland Token: it is `@aztec/noir-contracts.js`'s `token_contract-Token.json` (7.0 MB on disk, imported by `artifact-catalog.ts`). The strip list is now `debugStrippedArtifacts` in `vite.shared.ts` — the two aliased artifacts plus that one — and the fail-closed check covers all three.
2. `file_map` alone leaves that artifact at 4.66 MB minified, 54 KB under the guard. The strip therefore also empties each function's `debug_symbols` (1.06 MB), bringing it to 3.6 MB. This is the shape `@aztec/stdlib` itself uses for "no debug info" (`emptyFunctionArtifact`/`emptyContractArtifact`), and it is the cleaner path: `getFunctionDebugMetadata` returns nothing and `extractCallStack` hands back the raw opcode locations through its `!debug` branch, rather than through a thrown-and-caught resolver error. The plugin is `scripts/strip-artifact-debug-info.ts`. Class id measured unchanged for all three. **Behavioural difference, restated:** a simulation error in those three contracts carries raw opcode locations and the circuit's own assertion message, no Noir file/line — opcode locations that could not be resolved to source without `file_map` anyway.
3. The vendor grouping excludes `@aztec/wallet-sdk`. With the plain `/node_modules/` test the content script's two web-accessible chunks (`crypto`, `handlers`) became three differently-named `vendor~content…` chunks — same modules, one more file readable by every page. With the exclusion both browsers' `web_accessible_resources` equal the pre-change lists exactly.
4. **The size cut (`maxSize`) is gone — it broke the offscreen page at runtime.** Three of the pieces it cut imported each other, and the one that ran first read `l1ContractsConfigMappings` as `undefined` (`can't access property "aztecSlotDuration", e is undefined`, 27 times in the Firefox smoke; the wallet never started). The bundle built, linted and passed every unit test. Rolldown's own answer, `output.strictExecutionOrder`, is unusable here: it wraps every module, and @crxjs 2.7.1 decodes its manifest by taking the last string literal of the manifest chunk, which the wrapper's runtime import then is. So the cut is structural instead (`scripts/vendor-chunks.ts`): one chunk per package for the proving/simulation/contract scopes (`@aztec/`, `@noir-lang/`, `@aztec-foundation/`, `@alejoamiras/`), each JSON module of those packages cut out first into a chunk of its own, everything else left to the bundler. A JSON module imports nothing, and package boundaries cross far fewer import cycles than a size cut does — but that is no proof: packages can depend on each other, and a group carries its modules' dependencies along. So the grouping is not what holds the line; a new build guard is: `scripts/chunk-cycle-guard.ts`, fails either build when chunks sit on a static import cycle — read from the bundler's own `chunk.imports`. Proven both ways: 0 cycles in the pre-change build and in the final one; the size-cut build fails naming its three chunks.
   The strip is a production-build guarantee only: the dev server prebundles dependencies through the optimizer, which does not run the plugin's `transform` — this corrects "build and dev server alike" in change 2 above. Nothing the dev server produces is shipped or linted.
5. **Only `.vue` files are routes** (`usePages({ extensions: ["vue"] })`). The route directories hold 53 helper and test `.ts` modules, and every one was registered as a route and shipped as a lazy chunk — 37 `*.test-*.js` files in the build the linter was reading, on both browsers, on `dev` today. Found because rolldown named vendor chunks after them. No route a user can reach changes.

### Phase 10 — The toolbar popup lays out in a Firefox panel (owner-found, 2026-09-20) ✓

**Why.** The owner, testing the Firefox build by hand: *"the UI looks a little bit broken, like the footer, doesn't stick to the bottom of the extension, it keeps re-adjusting for example when I go to holdings."* No test could have seen it: the suite opens the popup document in a window, and no WebDriver or BiDi command reaches a panel.

**Measured, in the real panel (headless, opened from Firefox's privileged scope).** The panel, `html` and `body` are a steady 360 × 600. `#app` is not: 520 px on Home, 320 on Holdings, 456 on History, 600 on Settings — its content height — and the bottom nav is `position: absolute; bottom: 0` inside it. Firefox lays a panel's document out to find its preferred height, so the `height: 100%` chain through `html` and `body` is indefinite and `body` gets its 600 px from `min-height` alone; a `100%` child of that resolves as `auto`. (The first hypothesis — the panel re-measuring itself per route — was wrong; the measurement is what said so.)

**Changes.**
1. `src/popup/index.scss` — `#app { height: 100vh; min-height: var(--base-height) }`. The viewport is definite on every surface (popup, side panel, approval windows); the `min-height` keeps today's behaviour in a window shorter than the popup.
2. `fixtures/browser/webdriver-classic.ts` — `chromeScript` (exclusive; switches the session to Firefox's privileged context and always back) and `listWindows`, which the silent-close watcher now uses so it can never read Firefox's own window list mid-switch and report every page closed.
3. `fixtures/browser/firefox-action-popup.ts` — `openActionPopup`, `evaluateInActionPopup` (a frame script in the panel).
4. `tests/e2e/action-popup-layout.test.ts` — Firefox only: on every tab, `#app` and the nav's bottom edge equal the viewport height. `data-testid="bottom-nav"` added to the nav.
5. `FIREFOX.md` row.
6. **Scrollbars, and a CSS pass** (owner, same day: *"the horizontal scroll-bar on Settings … appears on firefox, it does not appear on Chrome"*, then *"Shared base.css -- but I guess this means we need to do a review of the extension's general CSS"*). The popup's only scrollbar rule was `*::-webkit-scrollbar { display: none }` — Chromium/WebKit syntax Firefox ignores. `packages/design/src/base.css` gains the standard `* { scrollbar-width: none }` beside it (hash pin updated deliberately), and the landing's `overrides.css` restores it next to the webkit restore it already had. The tools app inherits `base.css` unoverridden, so on Firefox it now hides scrollbars as it already does on Chrome — the owner chose the shared file knowing that. The pass itself: every vendor-prefixed or Chromium-only construct in `apps/extension/src` + `packages/design/src` was inventoried (14 kinds, 26 sites). Two more needed a Firefox twin — `-moz-osx-font-smoothing` on the icon font, `appearance: textfield` beside the WebKit spin-button rule. The rest already had one or are inert (`-webkit-line-clamp`, which Firefox implements; `-webkit-user-drag` on a canvas; doubled `transform-style`/`backface-visibility`; CodeMirror's scrollbar theme, which sets `scrollbarWidth` too). Then 16 popup routes were screenshotted at 360×600 in both browsers and diffed: layout is pixel-tight; what differs is a uniform ~1 px text baseline (font metrics) and the side-panel row Firefox hides by design.

**UI impact:** on Firefox only — scrollbars disappear from the popup and the onboarding tab, as on Chrome; and the popup's bottom nav moves from wherever the page's content ended to the popup's bottom edge — where it already is on Chrome. Before/after screenshots of the real panel are attached to the arc's PR. **Every other surface:** `100vh` and the old `100%` resolve to the same height in Chrome's popup (600 px), its side panel and the approval windows, so no visual change is expected and the Chrome smoke is the check. They differ in one case: a window a user has dragged narrower than the popup's 360 px minimum on a browser with classic (non-overlay) scrollbars — `100vh` includes the horizontal scrollbar's thickness, so the shell overflows by that much. The wallet creates no window that narrow; accepted.

**Owner sign-off.** The bug report above is the owner's; to *"going ahead as arc 8 (surface-detected fixed height, no browser sniffing). Needs your eyes on a headed build afterwards"* the owner answered *"Sounds good. Keep going."* (2026-09-20). The shipped fix is simpler than the one described then (no surface detection — one CSS declaration). **Visual confirmation on a headed Firefox is the owner's.** Height: confirmed 2026-09-20 on a build of this branch — *"Height bug is now fixed."* Scrollbars: confirmed 2026-09-20 on the next build — *"Nice! fixed."* The rounded corners the owner also noticed are Firefox's own panel chrome (every toolbar popup has them); an extension cannot change that, and nothing here tries.

**Validation gate.** `bun run lint && bun run typecheck && bun run test` exit 0; `action-popup-layout.test.ts` **fails** on a Firefox build with the old stylesheet and **passes** with the new one; Firefox and Chrome smoke exit 0; on the arc's PR the three required checks and both Firefox aggregators conclude success.

### Phase 11 — Absorb what dev gained while the stack was open (2026-09-20) ✓

**Why.** The owner asked for the stack to be merged, *"mindful"* of dev: twelve commits had landed under it — the Terms gate (#627, #628), the send-fee privacy notice (#631), third-party notices in the build (#639–#642), a Presto bump — none of which had ever run on Firefox. A rebase was refused by the session's permission layer as a history rewrite, so dev was **merged** into the bottom branch and cascaded upward, arc by arc; no branch was force-pushed.

**What the merge needed, by the arc that owns it.**
- Arc 3 (seam): dev's `legal-acceptance.test.ts` closed browsers directly and wrote the extension scheme by hand — the seam guard failed; it now uses `ctx.close()` / `extensionUrl()`. `fixtures/extension.ts` conflicted where dev's Terms seeding met the seam's `close`; both kept.
- Arc 4 (driver): the same spec called `browser.waitForTarget` — the guard failed; it goes through the seam.
- Arc 6 (CI lanes): dev added `packages/legal` and `packages/third-party-notices` to the Chrome smoke and network filters — the twin-filter pin failed; the Firefox lanes follow.
- Arc 7 (chunk split): dev fixed the same test-modules-as-routes leak in its own module with a pinned test (`scripts/pages-options.ts`); dev's version is taken and this stack's inline `extensions: ["vue"]` dropped. The builds pass with both guards on, `web_accessible_resources` are identical to arc 7's, the largest parsed file is unchanged (4,138,965 bytes), `web-ext lint` is 0 errors, and the notices assertion passes on both targets.

**What only a Firefox run could see (this arc).** With the above, every pre-existing spec still passed on Firefox and dev's two new smoke files failed (14 tests):
1. **`page.reload()` on an extension page** (nine specs, and `network/legal-acceptance-wall.test.ts`) — the documented process-swap strand. They use `reloadExtensionPage`; the seam guard gains a shrink-only rule for direct `reload()` calls, which is how this slipped in.
2. **A fixture race dev introduced** (S1–S3): `openOnboarding` evaluated in the setup popup *after* flipping `onboarding:completed` to false. The popup reads that flag while it mounts and, with no wallet, opens the onboarding tab and `window.close()`s — Firefox honours the close. The Terms state is now seeded before the flip.
3. **The licences tab** (S10): the product works — the tab opens and loads — but a `tabs.create` tab onto `text/plain` stays `about:blank` in Puppeteer's BiDi target map for good. New driver method `waitForOpenedUrl` (Chrome: a page target with that URL; Firefox: the browser's own window list).
4. **`send-fee-privacy.test.ts` refuses an RPC origin through CDP `Fetch`.** Rather than an eleventh Chrome-only file, `interceptRpc` becomes a driver method: Chrome keeps the CDP body verbatim (`fixtures/browser/chrome-rpc-intercept.ts`, moved from `helpers/`); Firefox registers one `http-on-modify-request` observer in the parent process through `chromeScript`, which sees every channel whichever context opened it. `hits()` / `failures()` become async, since Firefox reads them over the wire. Only `refuse` exists on Firefox: the one spec that redirects (`import-dead-rpc`) stays Chrome-only, as planned.

**Not changed.** Dev's route scan still routes the sixteen non-test helper modules beside the pages (its test pins exactly that); harmless, and dev's to decide. The Chrome-only set is still the ten files.

**UI impact:** none — test, fixture, CI-filter and docs changes only.

**Known while the stack is open.** Arcs 4–8 each run Firefox smoke on their own head, where fixes 1–4 are not yet present: their advisory `extension-smoke-e2e-firefox-status` (and the Firefox network lane's `legal-acceptance-wall` shard) will be red on those heads and green on this arc's. The stack merges atomically, so dev never sees an intermediate state.

**Validation gate.** `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `lint:actions` exit 0 at this arc's head; `legal-acceptance.test.ts` and `send-fee-privacy.test.ts` pass on Firefox and on Chrome, and `import-dead-rpc.test.ts` on Chrome, at `--retry=0`; the full Firefox and Chrome smoke suites exit 0; on this arc's PR the three required checks and both Firefox aggregators conclude success; every lower PR's three required checks conclude success.

## Security & Adversarial Considerations

- **Threat model.** New production surface = the PRF fix and two manifest keys. Everything else is test/CI code. Attackers of interest: supply chain (a swapped geckodriver or Firefox binary inside CI) and another local process on a shared dev host.
- **Loopback is not isolation.** geckodriver HTTP, the BiDi socket and Marionette are unauthenticated; any local process can drive the browser. This plan **accepts trusted host co-tenants explicitly** and says so in `SECURITY.md`: a malicious local process is out of scope, not mitigated. Trust does not cover accidents, so cross-agent safety rests on ownership, not on goodwill: start-time-verified pids, exit confirmed before a profile is deleted. Mitigations: `127.0.0.1` only, all three ports from the registry, no widened `--allow-hosts` / `--allow-origins`, bounded requests, disposer in `finally`, per-launch ownership. E2E runs use only local-network keys; no funded or production key is ever loaded in a test profile.
- **Pinned binaries.** geckodriver by tarball + binary SHA-256. Firefox and Chrome come from Puppeteer's resolver over TLS, version fixed by the pinned Puppeteer, not hash-pinned — stated, not fixed here. `web-ext` runs at an exact version, never floating.
- **Least privilege.** New workflows: `contents: read`, no secrets, no environment.
- **Gate integrity.** Firefox runs cannot emit a required check name, are absent from every required aggregator's `needs` (pinned by `behavior-gating.test.ts`), and the required `checks` list is not edited. No required workflow file is touched.
- **No branch dispatch of `release.yml` / `nightly.yml`.** Branch-authored YAML could ignore `dry_run` and reach `environment: production`.
- **Soft-token prefs** live only in a throwaway profile's launch capabilities. They cannot enter an extension bundle, so no bundle grep is added (a guard that cannot fire is noise).
- **The `session.new` shim** answers two messages and forwards the rest untouched.
- **PRF fix.** No downgrade: UV stays required, the fallback is restricted to and verified against the created credential, and no PRF after `get` still throws. WebAuthn platform API only, no new crypto.
- **`data_collection_permissions`** is a public declaration; `none` may be untrue for a wallet that sends addresses to RPC nodes and price APIs. Owner decides (A2).
- **No name-based process kills for Firefox.**

## Assumptions

**Facts** (verified in this worktree, by the spike, or by an auditor with file:line)
1. At `HEAD`, `runCreate` throws when `prf.enabled` is true and `results` is absent (`passkey-ceremony.ts:109-110`); the working tree carries the v1 fix.
2. `runGet` returns `userHandle: undefined` when the assertion omits it (`passkey-ceremony.ts:136-141`).
3. Firefox 153.0.4's virtual authenticator: `enabled: true` without `results` at create, deterministic 32-byte PRF on `get`, incl. from `moz-extension://` with RP ID `passkey.nulo.sh`; requires the two soft-token prefs.
4. With the v1 fix the real create-with-passkey UI reaches home on Firefox.
5. Puppeteer attaches to a geckodriver-owned session when `session.new` is answered locally; an extension-opened popup window appears in `browser.pages()`.
6. Required checks on `dev`: `quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status` (`CLAUDE.md:71`, `behavior-gating.test.ts:83-85`). `main` still lists the legacy names until its cut-over.
7. `continue-on-error` is not valid on a reusable-workflow caller job; every existing use is on a `steps:` job.
8. `nightly.yml` always operates on `origin/dev`; `release.yml` checks out the resolved tag and `attach-assets` uses `environment: production` (`release.yml:266`).
9. Both PR e2e workflows accept `workflow_dispatch` and then force a full run (`pr-extension-network-e2e.yml:4,114`).
10. `smoke-against-artifact` needs only `build-chrome`; `attach-assets` waits on no Firefox test (`release.yml:246-255`).
11. 36 `browser.close()` sites in 16 files, one of them a standalone Puppeteer tool with no `ExtensionContext` (`tests/e2e/scripts/check-derivation-parity.ts:60,207`); `OwnedState` is a singleton written only by network global-setup; `reap.ts:48` matches only `nulo-aztec-*`; orphan cleanup checks pid liveness only (`lockfile.ts:100,113`); `resolve-ports.ts` is a bind-and-release allocator, not a registry.
13. The unit config includes `scripts/**/*.test.ts` and excludes `tests/e2e/**` (`vitest.config.ts:34-48`). Network CI runs `retry: "0"`; smoke hardcodes two retries (`vitest.e2e.config.ts:41`).
14. The Chrome PR callers declare `contents: read` + `pull-requests: read` (`pr-extension-smoke-e2e.yml:18-21`); `dorny/paths-filter` needs the second.
15. `concurrent-sendtx-confirm` and `fee-methods`/`selfpay-phase` run proverless in CI; the real-proving lane is `transfers` + `tx-sendTx-default` + `frozen-account-canary` with `VITE_NULO_PRESTO_REQUIRED=1` (`pr-extension-network-e2e.yml`, `_extension-network-e2e.yml:122-125`).
16. The dedicated network lanes are split by load, not by browser; five of their six files are portable.

**Inferences** (unverified; each has a phase that tests it)
1. Real authenticators on Firefox behave like the virtual one for PRF-at-create. Moderate. The fix is correct either way.
2. Puppeteer's BiDi `targets()` / `waitForTarget` / `targetcreated` work for extension windows (`puppeteer-core/.../bidi/Browser.js:198-205,302` implements them). → Probe T.
3. A temporary add-on gets its `host_permissions` and content-script matches without a click. → Probe 1.
4. The Firefox test build proves natively through Presto from the stand-in window. → Probe 3.
5. `keepStorageOnUninstall` + a pinned UUID give `migration.test.ts` what it needs from a relaunch. An experiment, not an equivalence claim. → Probe R.
6. The Actions run-start throttle tolerates the extra jobs. **Unknown, and no probe can answer it before merge**; it is learned by living with the lanes. `cancel-in-progress` does not reduce job starts; skipping drafts does. If the throttle bites, narrowing the Firefox lanes' triggers is a **scope change only the owner can make** (it undoes "same treatment"); an autonomous session surfaces it and holds.

**Owner answers (2026-09-18) — verdict: APPROVED.** These resolve every Ask below; the Ask text is kept for the record.
- **A1:** gecko id stays `wallet@nulo.sh`.
- **A2:** `data_collection_permissions: { required: ["none"] }`. (The planner flagged that RPC and price-API traffic might fall under Mozilla's categories; the owner chose `none`.)
- **A3:** `strict_min_version: "153.0"`. Above 150, so no passkey version gate is needed and Phase 2 carries no product work. Consequence: the add-on will not install on an older Firefox, so `firefox.ts` asserts the launched browser is ≥ 153 and fails loud if the pinned Puppeteer ever resolves a lower one; ESR 140 users are not supported.
- **A4:** accepted — both canaries stay Chrome-only for now. No follow-up scheduled.
- **A5:** confirmed. Firefox and Chrome lanes run **in parallel**: they are separate workflows with separate concurrency groups, so Firefox adds job starts and runner minutes, not wall-clock, as long as runners are available.
- **A6:** accepted as-is — no extra dialog copy. Phase 1 carries no UI work.

**Asks** (resolved above)
- **A1. Gecko id.** Confirm `wallet@nulo.sh` or name another. Permanent on first AMO publish.
- **A2. `data_collection_permissions`.** `required: ["none"]`, or declared categories?
- **A3. `strict_min_version`.** `150.0` (passkeys work from extension pages; drops ESR 140) or `140.0` (keeps ESR)? Only 152/153 were tested here; 150 rests on MDN. **Choosing 140 adds product work to Phase 2**: a version check that hides the passkey method below 150 on Firefox (the create-profile toggle and the unlock path), with component tests for both sides of the threshold. Choosing 150 adds none.
- **A4. Chrome-only canaries.** `frozen-account-canary` and `passkey-execution-canary` both kill the service worker, so `@aztec`-bump gating and passkey-signed execution get no Firefox network coverage. Accept, or add a follow-up to split each canary's execution half from its restart half?
- **A5. CI cost.** Same treatment ≈ 5 pool shards + the portable dedicated lanes + canaries, each a full build, on every network-touching non-draft PR. Confirm, knowing the run-start throttle has bitten before.
- **A6. Two prompts.** Whenever the fallback path runs — any authenticator that returns no PRF output at create, which is what Firefox's virtual authenticator does; real devices unverified — the user sees two passkey prompts (create, then get). Accept as-is, or add copy? **Choosing copy adds product work to Phase 1**: a second-step line in `PasskeyCeremonyDialog` shown only while the fallback `get` is pending, a `data-testid`, and a component test. Accepting adds none.

## Delivery

Multi-arc, stacked with `gh stack`. Arcs revert **top-down** (each builds on the one below). Arc 2 is independently revertable. Arc 1 is independently revertable only until arc 4 lands: from then on the Firefox passkey smokes expect the fix, so reverting arc 1 alone reds the advisory Firefox lanes (never a required check). `code_review: off` for every arc.

| Arc | Branch | Phases | PR title |
|---|---|---|---|
| 1 | `worktree-firefox-first-class-spike` (adopted) | 1 | `fix(passkey): fall back to a get ceremony when create returns no prf output` |
| 2 | `firefox-manifest-items` | 2 | `feat(firefox): declare data collection permissions and a minimum version` |
| 3 | `firefox-browser-seam` | 3 | `refactor(e2e): put browser launch, urls and disposal behind a seam` |
| 4 | `firefox-driver-probes` | 4, 5 | `test(e2e): run the smoke suite on firefox` |
| 5 | `e2e-firefox-network` | 6 | `test(e2e): run the network suite on firefox` |
| 6 | `ci-firefox-lanes` | 7, 8 | `ci(firefox): advisory firefox lanes in pr, nightly and release workflows` |
| 7 | `firefox-offscreen-chunk-split` | 9 (closes 2) | `build(extension): keep every shipped file under the firefox linter's parse limit` |
| 8 | `firefox-popup-panel-height` | 10 | `fix(popup): keep the bottom nav on the popup's bottom edge in a firefox panel` |
| 9 | `firefox-spec-portability` | 11 | `test(e2e): run the terms gate and the dead-rpc send spec on firefox` |

Arc 1 is a user-facing fix and may be merged ahead of the rest at the owner's call. Titles stay ≤ 93 characters. No PR (draft included) opens before every quality loop below has converged. Merging is always the owner's action.

## Post-implementation

Executed by the implementing session from this file.

**Per arc, at the arc boundary** (after the arc's phase gates pass, BEFORE `gh stack add <next-arc-branch>`), scoped to that arc's diff:

1. `/code-review` is **not run** (`code_review: off`).
2. **Codex audit** — `/codex high` with: the arc's diff; this plan + the decision ledger; the arc map ("arc N of 6; later arcs build X on it", so seams for later arcs are not flagged as dead code); the adversarial ask ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't?"); and both rules below verbatim. Tell codex: **do not run any vitest e2e config or build.** Run codex under tmux and wait on its output file; never concurrently with `audit:vue`.
3. **Iterative fix loop** — verify each factual claim against the repo first; apply accepted fixes; commit; log the round (consult + verdict) in `lessons/phase-N.md`; RESUME the same codex session with the fix diff. Repeat until a round yields no new material findings. Rejected nitpicks do not count. Still material after 3 rounds → stop and surface to the owner.

**After all six arcs are green and looped:** one **final cross-arc integration pass** — a FRESH `/codex high` session over the net diff from the plan baseline, asking for cross-arc issues (seams between arcs, duplication across arcs, drift from this plan), same rules, same loop-until-clean.

4. **Delivery** — only now: `gh stack sync` if `dev` moved, `gh stack submit --auto --open`, `gh pr edit` each body, `gh pr checks --watch`. Arc 6's acceptance (Firefox aggregators green on its PR) is checked here. Then set `implementations-plan/index.md` to "delivered — awaiting nightly + release evidence" and hand the owner the post-merge checklist. "Completed" is written only after the owner reports both post-merge items green; `agent-worktree done firefox-first-class-spike` is suggested after merge.

**The no-over-engineering rule** (verbatim in every codex prompt, initial and resumed): "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."

**The comment-quality rule** (verbatim, same treatment): "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."

**Dispositions for an autonomous session.** Never idle waiting for input; a decision you would normally bring to the owner goes to `/codex high` and is logged with its verdict in lessons. Hard limits stay hard: never merge, never publish or deploy, never dispatch `release.yml` or `nightly.yml` from a branch, never weaken, rename or edit a required check or its workflow file, never add a Chrome-only file or shrink scope without the owner. The same step failing 5 times means stop and reassess with codex. Failed probes are surfaced, not worked around.

**Post-implementation hardening.** No `/harden` pass scheduled: no new trust boundary ships to users.

## Decision ledger

**Chosen:** shape D (both auditors' fourth outline) — Chrome fixtures untouched behind a seam; Firefox driver + pinned UUID + classic authenticator; Firefox PR lanes in separate workflow files. v1's `pages()` rewrite, outline B and outline C are rejected (reasons under Trade-offs).

| # | Finding (source) | Decision |
|---|---|---|
| 1 | Branch dispatch of `nightly.yml`/`release.yml` tests the wrong code, defaults to publishing, shares the `nightly` concurrency group, reaches `production` (codex High, fable High) | **Adopted.** Both gates removed; replaced by PR-time acceptance + an owner post-merge checklist; added to hard limits |
| 2 | `continue-on-error` invalid on `uses:` jobs; artifact names collide across browsers (codex High, fable High) | **Adopted.** Separate workflow files; jobs outside aggregators; names namespaced by browser |
| 3 | `pages()` is not a mechanical substitution (codex High, fable High) | **Adopted.** Chrome logic unchanged; Probe T decides Firefox discovery |
| 4 | No teardown contract; shim swallows `session.end`; profile removal breaks relaunch tests; attach-before-`pages()` ordering (codex High, fable High) | **Adopted.** Idempotent `ctx.close()` at all 36 sites; caller-owned profiles preserved; pinned UUID removes origin discovery |
| 5 | Ownership record does not fit per-test launches; smoke writes no lock; reap pattern; Marionette port (codex High, fable High/Medium) | **Adopted.** `ownership.ts` per-launch pid files; three registry ports; second reap pattern |
| 6 | Loopback ≠ isolation (codex High) | **Adopted as an explicit trust statement**, not as container isolation — isolating every local e2e run is out of proportion for test tooling; recorded in `SECURITY.md` |
| 7 | PRF fallback drops the known `userHandle`; does not pin the assertion to the created credential (codex Medium, fable Medium) | **Adopted.** Both, plus tests (b), (c), (f) |
| 8 | Stale required-check names; Firefox aggregator naming (codex High, fable High) | **Adopted.** Fact 6 corrected; `extension-*-firefox-status` |
| 9 | Heavy lanes are split by load, not browser; skipping them means no real proof on Firefox (codex High, fable Medium) | **Adopted.** Portable dedicated lanes + canaries run on Firefox |
| 10 | Phase 4 gate too weak; `e2e:agent --shard` bypasses the proverless guard; wrong runner for `behavior-gating.test.ts`; `lint` does not run the path guard (codex High, fable High) | **Adopted.** Full Chrome CI topology by dispatch of the PR workflows; `NULO_E2E_PROVERLESS=1` + CI's excludes; `bun run test:ci-gating`; `check-no-brand.sh` called directly |
| 11 | Probes need Firefox plumbing first and must stay out of suite discovery (codex Medium, fable Medium) | **Adopted.** Probes moved after the driver, own dir + config, deleted in Phase 6 |
| 12 | Probe 3 must show a proved transaction, not a balance (codex Medium) | **Adopted** |
| 13 | Arcs revert only top-down (both Medium) | **Adopted** as an honest statement in Delivery |
| 14 | Pin `web-ext`; verify the Firefox version selected (codex Medium) | **Adopted** |
| 15 | Bundle grep for both soft-token pref names (codex Medium) vs "protects nothing" (fable Low) | **Rejected** (fable's argument holds: launch prefs cannot enter a bundle) |
| 16 | Additional skips / shrinking scope need owner approval, not a logged reason (codex Medium) | **Adopted** in the kill criteria and hard limits |
| 17 | Surface `passkey-execution-canary`, CI cost, two prompts (fable) | **Adopted** as Asks A4–A6 |
| 18 | `needs:` on Chrome smoke success to cut Firefox job starts (fable Medium) | **Rejected**: cross-workflow `needs` does not exist, and `workflow_run` chaining would hide Firefox results from the PR. Draft-skip adopted instead |
| 19 | Add a Firefox dispatch input to the required PR workflows for pre-PR CI validation (considered by main) | **Rejected**: a dispatched Firefox run would report under a required check name on the head SHA |

| 20 | New PR workflows need `pull-requests: read` for `dorny/paths-filter` (final codex High) | **Adopted**, scoped to the `changes` job |
| 21 | The static seam guard sat under `tests/e2e/**`, which the unit config excludes — it would never run; one more missed URL; a standalone tool has no context (final codex High/Medium) | **Adopted.** Guard moved under `scripts/**/*.test.ts`, scoped to executable usages, tool exempted by name, grep made authoritative |
| 22 | Phase 6 commands did not reproduce CI: heavy lanes are proverless, the canary needs the Presto-required build (final codex High) | **Adopted.** Per-lane command table taken from the workflow |
| 23 | Marking the plan completed before nightly/release evidence contradicts the done line (final codex High) | **Adopted.** Two closing states: delivered, then completed on the owner's checklist |
| 24 | Ownership: allocator is not a registry; stale pids need identity verification; confirm exit before deleting profiles (final codex Medium) | **Adopted.** Start-time-verified records, bounded port retry, exit-confirmed teardown |
| 25 | Probe T's failure branch underspecified; Probe R must check migration + onboarding, not just storage (final codex Medium) | **Adopted.** Four preserved behaviours with assertions; Probe R extended |
| 26 | A3 and A6 imply product work the phases lacked; "two prompts" is a fallback-path property (final codex Medium) | **Adopted.** Conditional work written into Phases 1 and 2 |
| 27 | Cache restore prefixes; Phase 3 acceptance bound to the tested SHA; smoke retries ≠ 0; `cleanup()` not `dispose()`; arc 1 revert exception; co-tenant comparison misleading (final codex Medium) | **Adopted**, each where it applies |

| 28 | Phase 5 gate could not hold (`test:e2e` does not build; migration tests skip unarmed); Phase 6 commands lacked the fee multiplier, executable retry/browser settings, an exclude array and Presto's origin flag; Firefox callers' filters omitted their own files; false Chrome-pipe claim; throttle fallback was a silent scope escape (codex v3 re-review, High/Medium/Low) | **Adopted**, all five |

**Partially resolved, stated honestly:** rows 3, 5 and 9–10 are resolved at plan level only; their proof is Probe T, Probe R and the Phase 6 lane table passing. **Still disputed:** none. **Unknown with no probe:** Inference 1 (real authenticators) and Inference 6 (CI capacity).

## Audit verdicts

- **Codex round 1 (plan v1):** reject — unsafe CI dispatches, incomplete browser lifecycle ownership, behaviour-changing page discovery, invalid validation gates. All four blocking findings adopted above. Transcript: `audit-codex.md`.
- **Fable round 1 (plan v1):** conditional approve with six conditions; all six adopted (ledger rows 2, 1, 4, 3, 8+10, 9). Transcript: `audit-fable.md`.
- **Final fresh-context codex pass (plan v2):** reject — ineffective validation gates, insufficient PR-workflow permissions, completion before the owner's done line. It judged the PRF fallback, the whole-file Chrome exceptions, the geckodriver pin, the seam-not-second-framework shape and all three ledger rejections sound. All findings adopted (ledger rows 20–27) into v3. Transcript: `audit-codex.md`.
- **Codex re-review of v3 (same session resumed):** **conditional approve (with conditions: finish the executable validation commands and add Firefox-specific trigger coverage)**. No remaining finding against the two-state completion rule. Both conditions are met in this revision (ledger row 28): the Phase 5 build + fixture flags, the Phase 6 preamble / exclude array / `PRESTO_ALLOW_ALL`, the Firefox callers' own path-filter entries pinned by `behavior-gating.test.ts`, the false Chrome-pipe comparison removed, and the throttle fallback marked owner-only.

## Seeds

ELI5 Artifact: https://claude.ai/artifact/9WSR5p3x2DvCYwtehQ9igF — source `implementations-plan/firefox-first-class-spike/eli5.html` (republishing that file keeps the URL). Canonical seeds, finalized after the owner's approval. Run exactly one, in a session started inside this worktree (`agent-worktree resume firefox-first-class-spike`). `/goal` is recommended; the `/loop 15m` alternative is in the ELI5 and differs only in cadence.

```
/goal All 8 phases marked ✓ in implementations-plan/firefox-first-class-spike/plan.md (the per-phase headers in the file, not the chat, not the task list), each ✓ backed by that phase's Validation gate as written in plan.md reported passing in the transcript, including for Phase 3 the two dispatched Chrome CI runs' status jobs concluding success on the arc's final SHA and for Phase 4 the five PROBE lines; the owner's answers in plan.md are implemented exactly (gecko id wallet@nulo.sh, data_collection_permissions required ["none"], strict_min_version 153.0 with a launch-time Firefox >= 153 assertion, no extra passkey dialog copy, both canaries Chrome-only); for each phase the agent has printed `LESSONS_FILE=implementations-plan/firefox-first-class-spike/lessons/phase-N.md` in the transcript; /code-review was NOT run (code_review: off); the codex fix loop converged for EVERY arc at its boundary (6 arcs) plus the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the 6-PR stack exists on GitHub, created only AFTER all loops converged (`gh stack view` output in the transcript), with `extension-smoke-e2e-firefox-status` and `extension-network-e2e-firefox-status` concluding success on the top PR and the three required checks green; `bun run audit:vue`, `bun run lint:actions` and `bun run test:ci-gating` all report exit 0 in the transcript; implementations-plan/index.md reads "delivered — awaiting nightly + release evidence" and the owner post-merge checklist has been printed. Never merged, never dispatched release.yml or nightly.yml from a branch, no required workflow file edited, no Chrome-only file added beyond the ten in plan.md and no Firefox lane trigger narrowed without the owner.
```
