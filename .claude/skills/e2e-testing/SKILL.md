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

## Known-marginal: backup-restore-sw-restart (mid-restore recovery leg)

The "SW restart mid-restore" case is built on TWO inherent races; small timing shifts anywhere in
the SW boot/unlock path change which branch CI takes (observed: 5 consecutive CI reds on a branch
whose diff only added ~seconds of unlock-path work, then green; sibling branches green all along):

1. **Rollback vs page-close.** Killing the SW rejects the import page's pending restore RPC; its
   catch RECONNECTS and calls `deleteProfile` on the pre-finalize profile (rollback). The test
   closes that page right after the kill — close usually wins locally (no rollback), but on a slow
   runner the rollback can escape and race the recovery unlock, closing the just-opened session
   (page bounces auth→general→auth; the 240s general-wait then times out).
2. **Partial network rows suppress seeding.** Restore writes profile → networks (Local LAST) →
   accounts; recovery seeds default networks ONLY when zero network rows exist. A kill landing
   mid-network-writes leaves the profile permanently without "Local" — the switchToLocalNetwork
   row wait then fails on ABSENCE, not slowness. (Product gap, tracked outside the test.)

The test self-instruments on failure (hash-change history + page text + storage keys + SW
liveness dumped to stdout) — read the CI log's `[sw-restart-restore]` lines before re-running.

## PR-workflow silence — check mergeability first

If a push to a PR branch triggers NO workflows at all (not even Quality; only Cloudflare checks
appear), check `gh pr view <n> --json mergeStateStatus` — a `DIRTY` (conflicted) PR gets no
`pull_request` merge-ref, so ALL pull_request-triggered workflows silently skip. Fix = merge the
base branch in and push; the run fires immediately. Don't debug the workflows.
