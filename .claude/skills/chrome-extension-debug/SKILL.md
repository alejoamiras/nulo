---
name: chrome-extension-debug
description: Debug and test the Nulo Chrome extension using Chrome DevTools MCP. Use when Chrome MCP tools are available and need to test popup UI, debug user flows, monitor network/console, automate repetitive browser tasks, or run the Firefox build headless.
---

# Chrome Extension Debugging

## Extension Pages

Open in full-page mode for easier testing:
```
chrome-extension://<ID>/src/popup/index.html
```

Get extension ID from `chrome://extensions`.

## Logger

**URL:** `chrome-extension://<ID>/src/popup/index.html#/windows/logger`

The logger captures service worker logs that are otherwise not directly visible. It shows the full RPC communication flow between popup UI and background services.

**Why it's useful:**
- Service worker has no DevTools console access - this is the only way to see its logs
- Shows complete request/response cycle: client connect → request received → processed → response sent
- Tracks all 20+ services communication (account, network, transaction, config, etc.)
- Reveals timing issues via millisecond timestamps
- Displays serialized request/response payloads for debugging data flow

**Debug Mode** (Settings > Advanced):
- OFF: 1000 logs buffer, INFO level only (lifecycle events, errors)
- ON: 10000 logs buffer, DEBUG level (every RPC call with full payloads)

**Log trimming:** Large Aztec objects (ContractArtifact, bytecode, witnesses) are automatically truncated to prevent memory issues.

## Key Routes

| Page | Route |
|------|-------|
| Main | `#/popup/general` |
| Logger | `#/windows/logger` |
| Advanced Settings | `#/popup/settings/advanced` |

## Firefox

Playwright cannot load extensions into Firefox. The e2e suite drives it as a hybrid: geckodriver
(WebDriver classic) owns the session — launch, add-on install, `moz-extension://` navigation,
WebAuthn, window handles — and Puppeteer attaches to the same session over BiDi for the rest.
`NULO_E2E_BROWSER=firefox bun run test:e2e` (smoke) and `NULO_E2E_BROWSER=firefox bun run e2e:agent`
(network) run on it. It needs geckodriver (`GECKODRIVER`, or on `PATH`) and the Firefox the locked
Puppeteer pins (`bun x puppeteer browsers install firefox`, or `FIREFOX_PATH`). The full account —
every behaviour that differs and the debugging order — is `apps/extension/tests/e2e/FIREFOX.md`.

What differs from Chrome when probing by hand:

- Every window and tab the extension opens IS reachable, through that hybrid. Puppeteer's BiDi
  alone is not enough: a BiDi `navigate` or `reload` of a `moz-extension://` page strands the page
  ("no such frame"), so extension pages are navigated over the classic channel
  (`gotoExtensionPage` / `reloadExtensionPage`), and geckodriver needs `--allow-system-access`.
- A new tab lands in the most recently focused window, which can be one the wallet opened: the
  page may be hidden, get no animation frames and cannot run WebAuthn. Open a window instead
  (`newPage`), and bring a page to the front before a click that starts a ceremony.
- `page.evaluateOnNewDocument` monkeypatching is a no-op (Xray wrappers), and page consoles stay
  empty because the extension routes `console.*` into the logger. The oracle is the logger ring
  buffer: turn on Developer Mode (Settings → Advanced) so it persists, then read
  `chrome.storage.session.get("nulo:logs")` from any extension page.
- No `chrome.offscreen`: the PXE host is a frame of the background page, at
  `src/offscreen/index.html?instance=<generation>`, and dies with it. A hidden document's timers are
  clamped to 1 Hz, so when sends slow down check the host's `visible` state before the node or the
  prover. From the suite, `pxeHostState(page)` reads the frames; in the background page's console,
  `document.querySelectorAll("iframe")`.
- No `chrome.sidePanel`: guard every use. An unguarded call at popup boot aborted the popup's
  settings apply loop, so the handlers after it (`disableAnimations`, `defaultExplorer`) silently
  kept their defaults on Firefox.
- The Firefox manifest needs a well-formed `browser_specific_settings.gecko.id`; a placeholder
  makes the whole add-on "invalid" at install time, before any code runs.
