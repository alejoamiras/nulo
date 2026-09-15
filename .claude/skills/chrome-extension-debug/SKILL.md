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

Playwright cannot load extensions into Firefox; Puppeteer over WebDriver BiDi can
(`puppeteer.launch({ browser: "firefox", protocol: "webDriverBiDi" })` then
`browser.installExtension("dist/firefox")`). `bun run --cwd apps/extension smoke:firefox` walks
install → create profile → home → offscreen window → lock → unlock. It needs `bun run build:firefox`
and a Firefox Puppeteer can find (`bunx puppeteer browsers install firefox`, or `FIREFOX_PATH`).

What differs from Chrome when probing by hand:

- Only the first-run onboarding tab is reachable over BiDi. Tabs the extension opens later
  (`tabs.create`, `window.open`, the hidden offscreen window) answer "no such frame", and a web tab
  may not navigate to `moz-extension://`. Navigate the onboarding tab with `location.assign(...)`
  and reuse it as the popup.
- `page.evaluateOnNewDocument` monkeypatching is a no-op (Xray wrappers), and page consoles stay
  empty because the extension routes `console.*` into the logger. The oracle is the logger ring
  buffer: turn on Developer Mode (Settings → Advanced) so it persists, then read
  `chrome.storage.session.get("nulo:logs")` from any extension page.
- No `chrome.offscreen`: the PXE host is a minimized window at
  `src/offscreen/index.html?instance=<token>` (`chrome.windows.getAll({ populate: true })` lists it).
- No `chrome.sidePanel`: guard every use. An unguarded call at popup boot aborted the popup's
  settings apply loop, so the handlers after it (`disableAnimations`, `defaultExplorer`) silently
  kept their defaults on Firefox.
- The Firefox manifest needs a well-formed `browser_specific_settings.gecko.id`; a placeholder
  makes the whole add-on "invalid" at install time, before any code runs.
