# Recon — PXE timer throttling on Firefox

Base: `origin/dev` at `67d13b23`. Recon was run inline (one author, greps over the whole workspace) plus
four sonnet research agents for the outside world; the measurements are in [`spike/`](./spike/README.md).

## Reuse map

| Capability needed | Existing code found | Verdict |
|---|---|---|
| Create / supervise / close the PXE host per browser | `apps/extension/src/wallet/utils/offscreen.ts` — `createOffscreen` dispatches on `hasOffscreenApi()`; single-flight gate, ready gate, serialized close tail, pass fence | **adapt** — only the three Firefox branches change (`createOffscreenFirefox`, the Firefox half of `closeOffscreen`, the Firefox half of `isOffscreenAlreadyRunning`) |
| Background ↔ PXE-page transport | `packages/extension-messaging/src/offscreen/` on `chrome.runtime.sendMessage`; sender check `isSenderAtUrl` (`core/sender-auth.ts`) ignores the query string and does not use `sender.tab` | **reuse as-is** — the spike ran the whole network suite over it with the page framed; comments that name the hidden window get corrected |
| Keep the background alive | two mechanisms: `apps/extension/src/wallet/runtime.ts:113,258` — a 10 s `storage.session` heartbeat, armed at the END of boot; and `packages/extension-messaging/src/offscreen/service.ts:79` — while a PXE request is in flight the PXE page messages the background every 20 s | **reuse as-is** — together they keep the Firefox event page (and so a frame inside it) alive; the spike's idle runs exercise the heartbeat, its proving runs exercise both. Not a guarantee of indefinite life — see the plan's lifetime rule |
| Survive a background restart | strict security mode drops the session when the background dies: the wallet comes back LOCKED, a dApp's discovery is queued until unlock (`tests/e2e/network/cold-wake-discovery.test.ts`, `frozen-account-canary.test.ts` stage 5 — Chrome-only today because only Chrome could kill its background) | **reuse as-is** — the recovery path is host-independent; the spike reached Firefox's `extension.terminateBackground()` through the suite's `chromeScript`, which makes those specs portable |
| Stale-host defence | `OFFSCREEN_ADOPT_INSTANCE`, `isSupersededByAdopt`, `firefoxInstanceToken`, the `?instance=` listener in `src/offscreen/index.ts` | **adapt** — the broadcast and the self-close listener go (they exist because a window outlives its background; a frame cannot); the URL token stays as a per-frame generation that READY is matched against. Justification attacked in plan § Security |
| Firefox e2e launch prefs | `apps/extension/tests/e2e/fixtures/browser/firefox.ts:246-251` — three `dom.*timeout*` prefs that mask the throttling | **delete** |
| Guard that a masking pref cannot come back | none. Searched: `dom.min_background`, `timeout` in `apps/extension/scripts/e2e/*.test.ts` | **build new** — one assertion in the existing `apps/extension/scripts/e2e/firefox-driver.test.ts`; nothing else pins launch prefs |
| A timer abstraction | `ClockPort` (`packages/wallet-core/src/ports/clock-port.ts`), `SystemClock` adapter | **not applicable** — only our services use it; the slow timer is inside `@aztec/foundation` |
| Worker-backed timers / timer deps | none. Searched: `new Worker`, `?worker`, `SharedWorker`, `worker-timers`, `setimmediate`, `"timers"` across `apps/extension/src`, `packages/*/src`, every `package.json` | **not built** — the shim was measured and rejected, see plan § Trade-offs |
| Visibility handling | none. Searched: `visibilityState`, `document.hidden` | nothing to reuse |
| Unit tests for the Firefox host path | `apps/extension/src/wallet/utils/offscreen.test.ts:343-400` (window pass-fence test), `:26-48` (adopt token) | **adapt** — rewritten for the frame; adopt-token cases deleted with the code |
| Docs that describe the host | `ARCHITECTURE.md` §1 diagram, §6, §"Builds"; `apps/extension/tests/e2e/FIREFOX.md` rows 31/34/60; `apps/extension/manifest/manifest.firefox.config.ts` comment; `.claude/skills/chrome-extension-debug/SKILL.md:60-68`; `apps/extension/scripts/e2e/browser-seam.test.ts:353` comment; `packages/extension-messaging/src/core/sender-auth.ts:25-33` comments | **adapt** |

## Conventions to match

- A browser difference in the product lives behind `hasOffscreenApi()` in `offscreen.ts`; in the suite it lives on `BrowserDriver` (`FIREFOX.md`).
- Guard tests for e2e infrastructure live under `apps/extension/scripts/e2e/*.test.ts` — a test under `tests/e2e/**` is excluded from the unit config and never runs.
- Comments say why, never which plan; `AUDIT`/`B-17`/`F-10` markers pair with tests, so a deleted marker's tests go with it.

## Collision / dedup risks

- The B-17 close serialization and pass fence are shared by both browsers. The frame path must keep going through `trackedClose()`; it must not grow a second close path.
- `isSenderAtUrl` is pinned by tests in three places (`sender-auth.test.ts`, `offscreen/client.test.ts`, `services/pxe/client.test.ts`) with a `?instance=` + tab-hosted fixture. Those fixtures stay valid (the function is unchanged); only their wording is Firefox-history.

## Outside world (research agents, 2026-09-21)

- **MetaMask, Rabby**: Firefox ships as Manifest V2 with a persistent background page; `chrome.offscreen` is used on Chrome MV3 only, for short hardware-wallet calls. Neither has any timer-throttling code. Our build plugin refuses MV2 outright (`@crxjs/vite-plugin` 2.7.1, `dist/index.mjs:2348`).
- **Firefox platform**: no offscreen API, none planned (Mozilla: the event page already has a DOM). `windows.create({ focused: false })` is ignored by design since Firefox 86 (bug 1253129). Event page idle timeout 30 s, reset by extension API calls since Firefox 121 (bug 1844041) — secondary source, confirmed here only by the soak measurement.
- **Throttling mechanics**: a background window's timers get a 1000 ms floor plus a budget; the three prefs the suite sets are the ones `TimeoutManager::MinSchedulingDelay()` reads. Whether workers escape it was unsettled in the literature; measured here: they do.
- No comparable wallet was found hosting heavy WASM on Firefox MV3. This is not a copied pattern; it is the MV2 wallets' pattern (work inside the background page's DOM) carried to MV3.
