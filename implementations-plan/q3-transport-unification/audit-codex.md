# Audit — codex xhigh — Round 1

**Verdict:** `reject (blocking: contradictory phase boundaries around errorPayload/WalletError serialization; Phase 2 can't prove timer/telemetry correctness after deleting requestTimers; the callable-any-method RPC bug is deferred until after extracting it into the shared core)`

## Blocking
- **Phase-boundary contradiction:** P1 extracts `buildErrorResponseContent → {error, errorPayload?}`; P3 says the shared service core owns `WalletError` serialization; P4 says the offscreen `errorPayload` flip lands LAST. Can't have all three — either offscreen flips earlier, or the "shared" core carries a transport-specific suppression branch that defeats the simplification.
- **P2 D7 premature + gate can't prove its criteria:** the offscreen `requestTimers` sidecar (`offscreen/client.ts:227-238`) is the ONLY explicit cleanup path for async `sendMessage` failure. Deleting it (D7) before P2 has a richer hook + explicit leak tests for `disconnect()` and `send_failed` risks: reject once, leave timeout armed, later fire a false timeout / second terminal. The `onTerminal(requestId, status)` hook is too thin — offscreen telemetry needs `endedAtMs` + sanitized `detail` (`offscreen/client.ts:258-279`, `telemetry.ts:50-99`).
- **Callable-any-method RPC bug deferred:** both services do `method in this.requests` then invoke `this.requests[method](...)` on the whole service object (`background/service.ts:68-76`, `offscreen/service.ts:58-73`) — trusts inherited/prototype methods, not the intended RPC surface. "Unknown-method rejection" must happen BEFORE canonizing into the shared core (≈P3), not the P5 harden.

## Other
- "Both high" riskiest = cop-out; **P2 is worse** (silently corrupts correlation/reconnect/timeout/telemetry across both transports; P4 is loud + bounded).
- `is-benign`/`"Client disconnected"` justification = wrong transport (background-port noise, not PXE). [concurs with fable B2]
- "PXE re-parses via Zod" is NOT safety for REJECTED promises — Zod only runs on successful `request()` resolution (`pxe/client.ts:81-149`).
- Stale: CI-wiring ask already answered (`_unit-tests.yml:24-25 → test:all`). [concurs with fable]
- **A6 is user-visible (Ask):** changing offscreen serialization-failure from "eventual timeout" → "immediate service error" is user-visible behavior, not a no-op bugfix — ratify as a decision.
- Phase 3 keepalive gate ("long-running prove flows keep SW alive") is aspirational — no cited gate proves >30s keepalive; add a test or soften.
