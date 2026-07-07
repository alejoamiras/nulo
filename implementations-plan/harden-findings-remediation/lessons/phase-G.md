# Phase G — Offscreen/messaging sender-auth + Firefox instance token (F-09, F-10) — MID

Branch: `fix/hf-g-offscreen-auth` off `fix/harden-findings`.

> **Codex auth-revoked campaign-wide** (`HTTP 401 token_invalidated`). MID consult unavailable → design on own judgment, logged here (AFK rule). Both findings are **Low/DiD**, so the risk of proceeding without codex is bounded.

## F-09 — offscreen/messaging listeners lack sender authentication (Low/DiD)
`offscreen/service.ts:35 onMessageListener(message)` accepts any runtime message with `message.to === this.name` — it never receives or checks `sender`. `background/service.ts:36 onConnect(client)` accepts any Port whose `client.name === this.name` — it never checks `client.sender`. Today unreachable from a web page (no `externally_connectable`; `content.ts` can't set a top-level `to`), but a missing defense-in-depth guard.

**Fix — trusted-internal-sender check (mirror `content-script-validator.ts isSubframeSender`).**
- New shared helper in extension-messaging, e.g. `isTrustedInternalSender(sender): boolean` = `sender?.id === chrome.runtime.id && sender.tab === undefined`. This allowlists SW / popup / offscreen (same-extension, no tab) and rejects: (a) other extensions (`id` mismatch), (b) content-scripts / pages (`sender.tab` present).
- `offscreen/service.ts`: `onMessageListener = (message, sender) => { if (!isTrustedInternalSender(sender)) return false; ... }` (the Chrome `onMessage` listener already passes `sender` as arg 2).
- `background/service.ts`: `onConnect = (client) => { if (client.name !== this.name) return; if (!isTrustedInternalSender(client.sender)) { logWarn; return } ... }`.
- **Firefox sender-shape parity**: Firefox `MessageSender` has the same `{id, tab, frameId}` shape; add unit tests asserting accept (SW/popup shape) / reject (tab-present, foreign-id) on BOTH Chrome and Firefox-shaped sender objects.

## F-10 — Firefox offscreen fallback can duplicate PXE listeners after SW restart (Low)
On Firefox, the offscreen document is emulated (a hidden window); after an SW restart a new offscreen can be created while a stale one lingers → two PXE listeners answer `{to:"pxe"}`. **Durable instance token**: stamp each SW instance / offscreen with a token; `{to:"pxe"}` requests carry the current token; a stale offscreen sees a mismatched token → ignores + self-closes.
**Design deferred to implementation** — must read `apps/extension/src/offscreen/index.ts` + `src/wallet/utils/offscreen.ts` first to place: (a) token generation (SW-instance-scoped, `crypto.randomUUID()` at offscreen create), (b) token propagation on `{to:"pxe"}`, (c) the mismatch → ignore/self-close in the offscreen. This is **stale-instance separation, NOT** the F-09 sender-auth — keep both.

## Invariants
- No context other than same-extension SW/popup/offscreen can drive the offscreen PXE listener or open a background Port (F-09).
- At most one live offscreen PXE listener answers `{to:"pxe"}` per SW instance; a stale (prior-instance) offscreen ignores/self-closes on token mismatch (F-10).
- No behavior change for the legitimate SW↔offscreen↔popup message paths.

## Negative tests
- extension-messaging unit: `isTrustedInternalSender` accepts SW/popup shape (`{id: runtime.id}`), rejects tab-present (`{id: runtime.id, tab:{...}}`) + foreign-id (`{id: "other"}`); Chrome + Firefox sender shapes.
- offscreen listener drops a message from a rejected sender (no `handleRequest`); background `onConnect` refuses a tab-present Port.
- F-10: a `{to:"pxe"}` with a mismatched token is ignored by a stale offscreen (unit-level around the token check).

## Gate (plan.md Unit G): `bun run --filter '@nulo/extension-messaging' test` + `bun run test` + `bun run build:firefox` + `bun run lint` + `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (offscreen/PXE path). Layers: build(firefox) · lint · unit · network-e2e.
