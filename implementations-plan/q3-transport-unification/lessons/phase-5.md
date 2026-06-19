# Phase 5 — security hardening sweep on the unified seam

**Status:** code + standard gate ✓. Network leg in CI; finalize ✓ on green/latest-dev.

## Note on `/harden`

`/harden` is not an installed skill in this environment (it's referenced in
CLAUDE.md/blueprint as a protocol concept). Its security-sweep INTENT for this
seam is fulfilled by (a) the concrete hardening items below + the dedicated
`hardening.test.ts` (33 adversarial cases), and (b) the codex xhigh adversarial
post-impl audit run in the wrap-up. The plan's Phase 5 enumerated the exact
items; they're implemented directly.

## Hardening applied to the now-unified core

- **Unknown-EVENT guard (real hole closed).** `BaseServiceClient.handleEvent`
  used to do `(this)[event].invoke(payload)` — a hostile message naming an
  arbitrary `event` (`toString`, `constructor`, `connect`, …) would reach an
  unrelated property and crash the listener (or worse). Now it only invokes when
  `this[event] instanceof EventHandler`; anything else is logged + dropped. The
  server-side `emit` is unguarded by design (it emits its own known events).
- **Strict envelope (service).** `requestId` must be a positive number — hostile
  string/object/array/boolean ids are dropped, not echoed.
- **Replayed-response safety (client).** Already idempotent via the P2 `settle`
  (a second terminal for a settled id is a no-op); now pinned by a test.
- **Null/malformed inbound** on both clients (P1) + the offscreen service's
  `onMessageListener` non-object guard (P3) — reconfirmed by the hostile-message
  matrix.
- **RPC-surface guard** (D10, P3) already rejects inherited/prototype/non-RPC
  method names — reinforced here with `__proto__`/`constructor`/`prototype`/
  `hasOwnProperty`/`valueOf` negative cases.

## `hardening.test.ts` (33 cases)

- Client: valid event invokes; 6 hostile event names dropped (no throw, no
  invoke); replayed response dropped; 7 malformed inbound shapes dropped.
- Service: 9 hostile `requestId` values → no response; 8 hostile/non-registered
  method names → no response, not invoked; a well-formed request still replies.

## Gate

- extension-messaging test **137** (incl. 33 hardening); typecheck clean.
- extension test **2566**; aztec-runtime **32**; vue-tsc + tsc clean.
- `bun run lint` → exit 0.
- Network leg: runs on the P5 push.
