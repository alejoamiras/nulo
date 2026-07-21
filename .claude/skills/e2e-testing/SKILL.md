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
- **Full-backup import has a bounded two-stage clock**: restore (slow on hosted runners) THEN possibly
  the app's own 30s recovery wait before it routes (`import.vue` completeImportWithRecovery). Any
  navigation wait below restore+30s+margin fails STRUCTURALLY whenever the recovery leg runs — it looks
  like flake because fast bootstraps skip the leg. Import-driver nav waits are sized 300s; affected
  spec budgets 900s.
- **The seeded-ACTIVE network is baked at build time and fresh-extension flows bootstrap on it** before
  any fixture can switch. CI egress to the public Alpha mainnet RPC blackholes, and each blocked call
  eats the node client's full 60s-abort × retry envelope — so e2e builds pin
  `VITE_NULO_E2E_DEFAULT_NET=testnet` (smoke workflow + agent.sh; never ships, prod default unaffected).
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
- **One-shot route checks race vue-router settling — use settle loops.** `ensureUnlocked` samples the
  hash ONCE and no-ops off-auth; a fresh popup transiently shows `/popup` (an index route that
  immediately pushes general) before the guard settles on auth, so a one-shot sample in that window
  means nobody ever types the password. Recovery waits should loop: general → done; auth → unlock →
  re-check; terminal-reset route → verify via raw storage before ending the wait.
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
