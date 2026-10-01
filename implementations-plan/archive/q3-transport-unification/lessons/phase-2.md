# Phase 2 — Shared client request-correlator core (the riskiest)

**Status:** ✓ complete. Standard gate + network leg both green. Network: PR #121 run 27825563285 on commit 931577a (base = origin/dev #120), 8 network jobs RAN + passed (not skipped).

## What shipped

`src/core/base-client.ts` — `BaseServiceClient`, the shared correlator both
transport clients now extend. It owns the mechanics that were duplicated and
drift-prone across the two forks:

- per-instance `nextRequestId`
- ONE pending map; the timeout (and the bg warn timer) live INSIDE the entry —
  the offscreen `requestTimers` sidecar is gone (D7: removed in the same change
  as the leak guards that prove the inside-entry path covers disconnect +
  send_failed).
- a single `settle()` terminal path: clear timers → delete entry → resolve/reject
  → `onTerminal` exactly once. **Idempotent** — a second terminal for the same id
  (late response, post-timeout response, disconnect/send race) is a silent no-op.
- success-path decode + response DISPATCH (`handleResponse`).

Per-transport HOOKS (D13 — error-VALUE construction stays per-transport so the
offscreen string→typed flip is a localized P4 change, not smuggled in here):
`ensureTransportReady`, `sendEnvelope`, `makeRemoteError`, `makeTimeoutError`,
`makeSendFailureError`, `makeDisconnectError`, `getRequestTimeoutMs`, `onTerminal`.

- **Background subclass**: Port lifecycle (connect/reconnect/disconnect), typed
  errors (`walletErrorFromPayload` / `RpcTimeoutError` / `RpcDisconnectedError` /
  `Error("Client disconnected")`), no telemetry.
- **Offscreen subclass**: uid + from/to routing, `onReady`, telemetry via
  `onTerminal`, and STRING error values (preserved verbatim — flipped in P4).

## The one real trap (caught by the contract tests, fixed)

The bg contract tests read the sent envelope **synchronously** right after calling
a method — because the old Port client connected AND sent synchronously
(`chrome.runtime.connect` is sync; `connect()` only `await`s on the retry path).
A naive `await ensureTransportReady()` in the core deferred the send by a
microtask and broke ~21 client tests + 2 extension consumer tests
(`task/client.test.ts`).

Fix: `ensureTransportReady` returns `void | Promise<void>`. The bg impl attempts
the synchronous connect and returns **void** when it lands `Connected`, so the
core only suspends when the transport genuinely must wait. The sync Port
`sendEnvelope` runs `postMessage` before returning, so its throw is still caught.
Net: bg keeps its synchronous-to-send timing; offscreen stays async (returns the
`onReady` promise). This is an internal timing detail invisible to production
callers (who await the request promise) — confirmed by the full contract suites
passing unchanged.

## Leak guards (D7) strengthened

The offscreen leak block now asserts, under fake timers, that after `send_failed`
and after `disconnect` **no orphaned timer fires a second terminal** (advance past
the 90s ceiling → telemetry record count unchanged). This is the concrete proof
codex demanded before allowing the sidecar removal.

## Gate

- `bun run --cwd packages/extension-messaging test` → **91 passed** (6 files).
- `bun run --cwd packages/extension-messaging typecheck` → clean.
- `bun run --cwd packages/extension typecheck` (vue-tsc) → clean.
- `bun run --cwd packages/extension test` → **2518 passed | 1 skipped** (all 21
  ServiceClient subclasses unaffected; the 2 task-consumer regressions fixed).
- `bun run lint` → exit 0.
- Network leg: re-runs on the P2 push (cumulative branch). Recorded on completion.

No codex consult needed mid-build — the plan + D13 specified the core/hook split
precisely, and the relocated contract suites were a tight safety net (they caught
the microtask-timing regression immediately). Codex gets the post-impl audit.
