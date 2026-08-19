# Arc A — fix-cold-wake-discovery-loss (a dApp message that wakes a dead SW is dropped)

[mid] bug arc of the post-remediation follow-on goal. PROVE-FIRST RED; dual plan audit (codex + fable); ONE end-diff codex pass. HARD BOUNDARY: `transport-ready-handshake` stays PARKED — its recon confirms full scope disjointness (Port-based `extension-messaging` RPC vs this arc's one-shot `chrome.runtime.sendMessage` content transport); this arc must not touch that package. Validation: repo gates + `audit:vue` + **SOLO `NULO_E2E_PROVERLESS=1 bun run e2e:agent`**.

## Recon verdict (two parallel agents, against `dev@a3a25caa`)

**The bug, corroborated in source:** the only `chrome.runtime.onMessage` registration for wallet-sdk traffic happens inside `initWalletSdkHandler`'s `addContentListener` (`wallet-sdk/background.ts:154-204`), attached via `handler.initialize()` (`:427`) at the TAIL of `runtime.start()` (`runtime.ts:311`) — after migrations, config/BB init, and `services.start()`. A content-script `chrome.runtime.sendMessage` that WAKES a dead SW dispatches the moment the top level has executed, before any of that — the message is lost. The repo already fixed this exact class for alarms (the module-scope price shim, `index.ts:74-89`, whose comment states the MV3 invariant verbatim); no equivalent exists for `onMessage` (the only sync `onMessage` listener, `index.ts:36-48`, handles one internal type and returns false).

**Design-deciding facts (all verified):**
1. **No `sendResponse` contract on this path.** The wrapper never captures `sendResponse` and always returns `undefined`; the content script fire-and-forgets its `sendMessage` (promise never observed — `content.ts:11-13` and every SDK relay call-site); real responses travel a SEPARATE channel (`tabs.sendMessage` → the content script's own background-listener). Buffering/delaying delivery violates nothing.
2. **Only `discovery-request` is worth buffering.** It is stateless at the handler (fresh map write) and validator-reachable. `key-exchange-request` / `secure-message` / `disconnect-request` are all gated on in-memory maps (`pendingDiscoveries` status, `activeSessions`) that do not survive an SW restart at all — their cold-wake loss is the pre-existing session-durability gap, not this bug. (`ping` is rejected by the Nulo validator at ALL times — a separate out-of-scope finding, recorded below.)
3. **Double-delivery is catastrophic in every state** (traced, not assumed): locked → the duplicate's coalesce→`rejectDiscovery` DELETES the very `pendingDiscoveries` entry the first delivery queued (drain later finds "gone" — reproduces the bug class being fixed); unlocked → two Allow/Deny popups (no dedupe before `windowManager.openAndAwait`); `secure-message` → two queued-journal records + two dispatches for one dApp `sendTx` (the untouchable anti-lost-tx surface). **Therefore the shim must be THE ONLY chrome listener for this traffic** — never a second listener alongside the SDK-attached one.
4. **`runtime.start()`'s idempotency gap** (verified): `started` is set synchronously before any await and NEVER reset on failure — a second caller's `.then()` resolves before real startup completes, and after a failed start it resolves forever-immediately with the SDK handler never attached. **The shim must not key its drain on `runtime.start()`'s promise.** Drain on listener-attach instead.
5. RED shape viable: page load injects the content script WITHOUT waking the SW (no message is sent until the click); one click = ONE DiscoveryRequest, no SDK re-broadcast — the loss is deterministic and assertable.

## The fix — a module-scope content-message relay (single listener, drain-on-attach)

New `apps/extension/src/wallet/services/wallet-sdk/content-message-relay.ts`:

- `registerContentMessageRelay(): void` — called ONCE, synchronously, at module scope in `wallet/index.ts` (beside the price shim, same MV3 invariant comment). Registers the SINGLE `chrome.runtime.onMessage` listener for content traffic: a cheap pre-filter (`message?.origin === "content-script"` — mirrors the validator's discriminator, keeps the toolbar-popup and RPC messages out of the buffer) then: if a listener is attached → forward `(message, sender)` synchronously; else → push to a BOUNDED FIFO buffer (cap ~32, reject-new with a log — mirrors the F-04 posture; boot takes ~1-3s and the 55s discovery staleness governs anything older downstream). Always returns `undefined` (today's semantics).
- `attachContentListener(listener): void` — called by `background.ts`'s transport `addContentListener` INSTEAD of registering its own chrome listener. Sets the attached listener, then FLUSHES the buffer FIFO through it. The existing wrapper body (subframe check + `validateContentScriptMessage` + forward, verbatim with its comments) becomes the listener passed in — validation stays where it lives today and applies identically to buffered and live messages.
- Net wiring delta in `background.ts`: `addContentListener: (listener) => attachContentListener((message, sender) => { …existing body… listener(message, sender) })` — the chrome-API call moves out; the filters do not.

Zero other changes. The relay is transport-only plumbing: no contact with `sessionQueues`, journal creation, or dispatch (the anti-lost-tx pins stay untouched); no Ready-handshake semantics (delivery-once, order-preserving, no acks).

## Prove-first

- **RED e2e** (`tests/e2e/network/cold-wake-discovery.test.ts`, written, run in flight): boot registered+unlocked → open playground (content script injected, SW still killable) → close popup → REAL SW kill → click connect (the sendMessage IS the wake) → pre-fix the discover wait TIMES OUT; post-fix popup → approve → verify → connected. If this does NOT go red, the bug premise is wrong and recon must re-examine (CANCEL is a valid outcome).
- **Unit pins** (new `content-message-relay.test.ts`): pre-attach messages buffer and flush FIFO on attach; post-attach messages forward synchronously; non-content messages never buffered; cap rejects-new with the log; attach-then-flush delivers each message EXACTLY once (the double-delivery guard); a second attach replaces (or throws — pick one, pin it).
- Existing pins untouched: `content-script-validator.test.ts` (the filters), `concurrent-sendtx*` e2e (the arrival invariant), `connect-locked-queue*` (queue semantics).

## Out-of-scope findings recorded

- `ping` from content scripts is rejected by `CONTENT_SCRIPT_MESSAGE_TYPES` at ALL times (validator enum omits it) — a dead dApp liveness probe, warm or cold. Separate finding for the owner report.
- `runtime.start()`'s never-reset `started` flag makes every `.then()`-consumer (including the price shim) resolve-before-ready after a failed start — pre-existing; the relay sidesteps it by design; recorded, not fixed here.

## Competing outline (for the audit)

Buffer inside the EXISTING `index.ts` sync listener (extend `:36-48`) instead of a new module — fewer files, but mixes internal toolbar messaging with dApp transport and leaves the chrome-API ownership split between index.ts and background.ts. Or: accept the loss (dApp UX shows "no wallet found", user re-clicks) and CANCEL — rejected upfront by the RED premise unless the RED fails to red.

## Audit ledger

**Fable: `conditional approve`** — three conditions, all adopted into the design:

- **C1 — the buffer must not launder freshness.** The SDK stamps `discovery.timestamp` at FLUSH time (`handleDiscoveryRequest`), so buffering across a slow cold boot would reset the B-16 clock and could approve a handshake the dApp abandoned at its 60s local timeout. Adopted: each buffered entry records `receivedAt`; flush drops (and logs) entries older than a TTL well inside the 55s window.
- **C2 — filter BEFORE buffering + per-origin sub-cap.** The manifest is `all_frames: true, matches: *://*/*`; any page can synthesize discovery requests, and a flood/iframe swarm during the 1-3s boot window would fill a naive 32-slot buffer and starve a DIFFERENT tab's legitimate cold-wake discovery — the very message this arc saves. Adopted: `isSubframeSender` + `validateContentScriptMessage` + `type === "discovery-request"` run at ENQUEUE (the same filters, applied once — flushed messages bypass re-validation at attach OR revalidate harmlessly; decide in impl, pin it), with the repo's own cap posture: 32 global + 4 per-origin, reject-new + log.
- **C3 — the RED must discriminate.** Adopted (spec updated): pre-kill liveness baseline; after the wake-click, a probe popup waits for STRICTLY-NEWER liveness (SW woke AND finished boot) BEFORE the discover-popup judgment; discover wait raised to 60s.

Fable also **corrected the plan's "fire-and-forget" wording** (the content script returns the promise and the SDK discards it un-awaited; "Receiving end does not exist" is not today's failure mode because `index.ts:36` already registers a listener — the relay changes nothing there), and raised the decisive **TLA ask**: a module-type SW only guarantees wake-event delivery to module-scope listeners if the ENTIRE static graph is top-level-await-free. **Verified: 113 chunks in the built SW graph parsed with the TS API — zero top-level await.** (A small guard test keeping the SW graph TLA-free is proposed for the diff; codex to weigh.) Non-blocking notes adopted: the relay registers immediately after `index.ts:48` (before `createWalletRuntime()`, so a construction throw cannot leave it unregistered; logger-free); a boot hang strands the buffer boundedly (log it); the `sendToTab`-to-a-closed-tab unhandled rejection is a pre-existing class, newly reachable — noted, not fixed.

**Codex: `conditional approve`** — three conditions, CONVERGENT with fable's, all adopted:

1. **Pre-attach admission** (= fable C2, sharpened): the plan's "buffer every content message" contradicted its own "only discovery is worth buffering" — before attach, admit ONLY a validated, policy-allowed (top-frame) `discovery-request`, with the F-04 caps (4/origin, 32 global, reject-new); live attached traffic keeps today's forwarding path unchanged.
2. **Arrival-age preservation** (= fable C1): the SDK stamps `discovery.timestamp` at flush, so the 55s cutoff does not govern relay residence — store `receivedAt`, drop+log entries older than 55s before forwarding.
3. **RED wake-isolation**: recurring alarms survive the kill (the journal reaper fires every minute into the module-scope alarm listener) and could warm the worker between kill and click, false-greening the pre-fix run — clear alarms before the kill and assert no SW target immediately before the click. (Spec updated.)

Codex also settled the open design points: idempotent replacement on re-attach (safer than throwing — pinned); snapshot/clear the queue BEFORE flush callbacks (a synchronous throw must not replay); reject-new confirmed over drop-oldest; the buffer dying with a boot that never attaches is acceptable and must NOT couple to the broken `start()` promise; no legitimate SDK message fails the origin prefilter (the discriminator is written verbatim by every SDK content path); double delivery has no credible production path once the relay owns the only listener; the separate module beats extending the toolbar listener; nothing here enters the parked Ready-handshake.

**Implementation landed per the converged design** (relay + index.ts registration before any construction + transport attach swap + 7 unit pins).

**RED→GREEN evidence:**
- Original spec on pre-fix dev: RED (discover-popup timeout after a real `worker().close()` kill with the connect click as the wake; retried ×2).
- **C3-hardened spec, source-swap RED**: with the two wired files reverted to `origin/dev` (relay present but never registered/attached), the spec red again — 60s discover timeout, with alarms cleared pre-kill, the SW asserted dead at click time, and the replacement worker's boot PROVEN complete (strictly-newer liveness) before the judgment. The loss is the listener gap, not slow boot.
- Post-fix GREEN: _recorded below on completion._
