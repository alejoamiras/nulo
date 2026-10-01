# Phase G — Offscreen/messaging sender-auth + Firefox instance token (F-09, F-10) — MID

Branch: `fix/hf-g-offscreen-auth` off `fix/harden-findings`.

> **Codex auth-revoked campaign-wide** (`HTTP 401 token_invalidated`). MID consult unavailable → design on own judgment, logged here (AFK rule). Both findings are **Low/DiD**, so the risk of proceeding without codex is bounded.

## F-09 — offscreen/messaging listeners lack sender authentication (Low/DiD)
`offscreen/service.ts:35 onMessageListener(message)` accepts any runtime message with `message.to === this.name` — it never receives or checks `sender`. `background/service.ts:36 onConnect(client)` accepts any Port whose `client.name === this.name` — it never checks `client.sender`. Today unreachable from a web page (no `externally_connectable`; `content.ts` can't set a top-level `to`), but a missing defense-in-depth guard.

**Fix — trusted-internal-sender check.** New shared helper `isTrustedInternalSender(sender)` in `extension-messaging/core/sender-auth.ts`, wired into the offscreen listener + background `onConnect`.

> **⚠️ REAL BUG the e2e caught — the plan's "reject tab-present" mechanism is wrong.** First cut used `sender.id === chrome.runtime.id && sender.tab === undefined`. That **cascaded the network e2e** (19 test files failing at ~34s timeouts): the e2e (and the options page, and a user-opened popup-in-a-tab) hosts the extension **popup in a TAB**, so its Port `sender.tab` is *defined* → the check rejected the popup's SW Port → every tx-approval flow hung. An extension page in a tab is NOT untrusted. **Corrected discriminator: `sender.url`**, which Chrome sets and the sender cannot spoof:
> ```ts
> if (sender?.id !== chrome.runtime.id) return false
> return sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL(""))
> ```
> `getURL("")` is the extension's own base (`chrome-extension://<id>/` / `moz-extension://<id>/` — browser-agnostic). Trusts SW (no url), popup/offscreen/options (extension-URL, tab or not); rejects a content script (its `sender.url` is the **web page**) and foreign extensions (`id`). This is the plan's *intent* (reject content-scripts/pages) with a correct mechanism. **Lesson: a build+unit gate would have shipped this; the plan's `e2e:agent` gate on G is what caught it.**
- `offscreen/service.ts`: `onMessageListener = (message, sender) => { if (!isTrustedInternalSender(sender)) return false; ... }` (the Chrome `onMessage` listener already passes `sender` as arg 2).
- `background/service.ts`: `onConnect = (client) => { if (client.name !== this.name) return; if (!isTrustedInternalSender(client.sender)) { logWarn; return } ... }`.
- **Firefox sender-shape parity**: Firefox `MessageSender` has the same `{id, tab, frameId}` shape; add unit tests asserting accept (SW/popup shape) / reject (tab-present, foreign-id) on BOTH Chrome and Firefox-shaped sender objects.

## F-10 — Firefox offscreen fallback can duplicate PXE listeners after SW restart (Low)
On Firefox, the offscreen document is emulated (a hidden window); after an SW restart a new offscreen can be created while a stale one lingers → two PXE listeners answer `{to:"pxe"}`. **Durable instance token**: stamp each SW instance / offscreen with a token; `{to:"pxe"}` requests carry the current token; a stale offscreen sees a mismatched token → ignores + self-closes.
**Codex consult (restored — gpt-5.5, high effort) verdict:** use a **Firefox-only lifecycle control token, NOT per-request tokening** (per-request would gold-plate + touch the shared `extension-messaging` envelope for a Low/Firefox-only path — avoid). Chosen minimal design:
- **SW (`offscreen.ts`), Firefox branch only** (`!hasOffscreenApi()`): a per-SW-lifetime `firefoxOffscreenInstanceId = crypto.randomUUID()` (module-level, lazy). Put it in the created window's URL (`?instance=<token>`). Right after `chrome.windows.create`, broadcast `OFFSCREEN_ADOPT_INSTANCE {token}` — sequenced **before** PXE traffic (ensureOffscreenRunning creates → broadcasts → awaits READY → only then does the SW route `{to:"pxe"}`), so a stale window is gone before it can answer.
- **Offscreen (`offscreen/index.ts`)**: read own token from `location.search` (undefined on Chrome — no param). Register an EARLY listener (beside the PING one, before `createPxeOffscreen`) for `OFFSCREEN_ADOPT_INSTANCE`: if my token is set (Firefox) AND `msg.token !== myToken` → **stale** → `window.close()` (removes the window + its PXE listener). Codex Q3: don't depend on close for correctness, but here the SW sequences ADOPT-before-PXE so the stale window closes before traffic; close is reliable for an extension-created window.
- **Chrome path stays byte-for-byte unchanged**: no URL param, no ADOPT broadcast (both gated on `!hasOffscreenApi()`); `chrome.offscreen` + `getContexts()` already prevents Chrome duplicates.

Codex's adversarial test to add: two stale windows + one fresh, single PXE request → only the fresh (matching-token) responder answers; stale ones self-close.
This is **stale-instance separation, NOT** the F-09 sender-auth — keep both.

## Invariants
- No context other than same-extension SW/popup/offscreen can drive the offscreen PXE listener or open a background Port (F-09).
- At most one live offscreen PXE listener answers `{to:"pxe"}` per SW instance; a stale (prior-instance) offscreen ignores/self-closes on token mismatch (F-10).
- No behavior change for the legitimate SW↔offscreen↔popup message paths.

## Negative tests
- extension-messaging unit: `isTrustedInternalSender` accepts SW/popup shape (`{id: runtime.id}`), rejects tab-present (`{id: runtime.id, tab:{...}}`) + foreign-id (`{id: "other"}`); Chrome + Firefox sender shapes.
- offscreen listener drops a message from a rejected sender (no `handleRequest`); background `onConnect` refuses a tab-present Port.
- F-10: a `{to:"pxe"}` with a mismatched token is ignored by a stale offscreen (unit-level around the token check).

## Gate (plan.md Unit G): `bun run --filter '@nulo/extension-messaging' test` + `bun run test` + `bun run build:firefox` + `bun run lint` + `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (offscreen/PXE path). Layers: build(firefox) · lint · unit · network-e2e.
