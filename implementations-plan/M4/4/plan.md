# M4.4 — Offscreen recoverability (3-5d)

> **Audit tier**: dual (codex xhigh + Plan agent).

## Context & entry state

The SW↔offscreen transport for PXE operations is the riskiest message channel in the wallet. The `getGasBalances 60s timeout regression` (incident at `293c9c9`, partial-fixed via single-flight + popup-side coalesce) was a symptom: the relay **silently lost messages** when the offscreen document transitioned between SW's `sendMessage` call and the handler wiring.

**Codex audit pass-through (BLOCKING context correction)**: 293c9c9 is **incident context, not a code dependency** — that commit didn't touch the offscreen transport. The remaining gap is the offscreen client's transport robustness itself, not "build on top of 293c9c9."

The current offscreen client (`packages/extension-messaging/src/offscreen/client.ts`):

| Line | Concern |
|---|---|
| `:18` | `requests: Map<number, [resolve, reject]>` — in-memory, lost on SW restart |
| `:19` | `requestTimers: Map<number, Timer>` — same |
| `:32-35` | `connect()` registers `chrome.runtime.onMessage` listener; no per-port lifecycle, no port disconnect handling |
| `:122-157` | `request()` sets timer, sends via `chrome.runtime.sendMessage`, awaits response routed by `requestId` |
| `:143-150` | 90-second timeout cleanup |
| `:108-120` | `onReady()` hook for transport bootstrap (subclasses ensure offscreen is alive); not wired to a heartbeat |

Tests today (`packages/extension/src/wallet/base/offscreen/client.test.ts`) cover only the `onReady()` hook (line 61). The transport itself — request correlation, late/duplicate terminal states, disconnect cleanup, timeout cleanup, retry after recreate — is **not unit-tested**.

The popup↔SW client (`packages/extension-messaging/src/background/client.ts:20`) has a much richer test suite (`packages/extension/src/wallet/base/background/client.test.ts:71` — multi-test contract suite). M4.4 mirrors that pattern for the offscreen client.

**Codex audit BLOCKING**: 6+ tests floor — out-of-order response correlation, late/duplicate terminal states, disconnect cleanup, timeout cleanup, retry after recreate. Not 3.

**Plan agent audit pass-through**: SW idle is bounded (~5 min); pending-relay entries older than that should be reaped + emit `request_orphaned` telemetry on next SW startup. Synchronous reap before any RPC handler runs (mirrors M4.5's lock-fence pattern).

## Architecture invariants (preserved)

1. **`ServiceClient` (offscreen base) public API** — UNCHANGED. `request(method, ...params)`, `connect()`, `disconnect()`, `onReady()` all keep their existing signatures.
2. **90s default timeout for offscreen requests** — UNCHANGED. M4.4 doesn't shorten it; it adds telemetry when the timeout fires + ensures the timer is cleaned on every terminal path.
3. **Offscreen lifecycle** (`ensureOffscreenRunning` health-ping at `wallet/utils/offscreen.ts`) — UNCHANGED. M4.4 adds robustness on the client side; doesn't replace the lifecycle manager.
4. **Existing `293c9c9` single-flight + popup-side coalesce** — UNCHANGED. M4.4 layers transport robustness underneath.
5. **`chrome.runtime.sendMessage` API contract** — accepted as the underlying transport. M4.4 is in the orchestration layer, not the transport substrate.

## Sub-step breakdown

Single PR, three commits.

### Step 1 — Telemetry surface (terminal status enumeration)

**New file**: `packages/extension-messaging/src/offscreen/telemetry.ts`

```ts
export type RequestTerminalStatus =
  | "success"           // resolve() called
  | "rejected"          // reject() called via remote error
  | "timeout"           // 90s timeout fired
  | "disconnected"      // client.disconnect() rejected pending
  | "orphaned"          // SW restart found pending entry > 5min old; reaped at boot

export interface RequestTelemetry {
  requestId: number
  method: string
  startedAtMs: number
  endedAtMs: number
  status: RequestTerminalStatus
  detail?: string  // free-form; "client port closed" / etc.
}

/** Subscriber registry. Used by ProductionTelemetrySink in the SW
 *  to log + (later) push to a metrics endpoint. */
export interface TelemetrySink {
  recordTerminal(t: RequestTelemetry): void
}

export class NoopTelemetrySink implements TelemetrySink {
  public recordTerminal(_t: RequestTelemetry): void { /* no-op */ }
}

export class LoggingTelemetrySink implements TelemetrySink {
  constructor(private readonly logger: { log: (src: string, level: number, ...args: unknown[]) => void }) {}
  public recordTerminal(t: RequestTelemetry): void {
    this.logger.log("offscreen-telemetry", 2 /* Info */, t)
  }
}
```

**Wire**: `ServiceClient` constructor accepts an optional `telemetry: TelemetrySink` (defaults to `NoopTelemetrySink`). Resolve / reject / timeout / disconnect / orphan paths all call `telemetry.recordTerminal(...)` exactly once.

### Step 2 — Pending-relay map: durable + reapable

**Modified**: `packages/extension-messaging/src/offscreen/client.ts`

Today's `requests: Map<number, [resolve, reject]>` is in-memory only. M4.4 adds a sidecar:

```ts
type PendingMeta = { method: string; startedAtMs: number; }
private readonly pendingMeta: Map<number, PendingMeta> = new Map()
```

The sidecar IS in-memory; durability comes from the **reap-on-restart** logic, not persistence. SW restart reconstructs nothing — the goal is to *recognize* that a pending entry crossed an SW lifecycle and emit `orphaned` telemetry, not to *recover* it (the popup will retry naturally).

**SW restart reap pseudocode** (called from `connect()` or constructor):

```ts
private reapStalePending(): void {
  const now = Date.now()
  for (const [reqId, meta] of this.pendingMeta) {
    if (now - meta.startedAtMs > REAP_THRESHOLD_MS) {
      this.requests.get(reqId)?.[1]?.("Request orphaned (SW restart)")
      this.requests.delete(reqId)
      const timer = this.requestTimers.get(reqId)
      if (timer) clearTimeout(timer)
      this.requestTimers.delete(reqId)
      this.pendingMeta.delete(reqId)
      this.telemetry.recordTerminal({
        requestId: reqId, method: meta.method, startedAtMs: meta.startedAtMs,
        endedAtMs: now, status: "orphaned",
      })
    }
  }
}
```

`REAP_THRESHOLD_MS = 5 * 60 * 1000` (5 minutes — Chrome SW max idle before forced restart).

In practice: when the SW restarts, the in-memory maps are gone. The reap function is effectively a no-op on restart but is useful as a "pending entries that never got a response within 5 minutes" floor. It runs on every `connect()` AND on a periodic `chrome.alarms` tick (using `AlarmsPort` from M4.5's wiring).

### Step 3 — Test contract suite (mirror background/client.test.ts:71)

**New test file**: `packages/extension/src/wallet/base/offscreen/client.contract.test.ts`

Modeled directly on `background/client.test.ts:71`. Each test uses the existing `FakeBrowserApi` runtime port for chrome.runtime mocking.

Required tests (codex BLOCKING floor):

1. **Out-of-order response correlation**: send req1, req2, req3. Reply to req2 first, then req1, then req3. Each promise resolves with its correct payload. Pending map empty after.
2. **Late terminal state**: send req1, fire timeout at 90s, simulate the response arriving at 91s. The late response is silently dropped (no double-resolve, no log spam beyond debug).
3. **Duplicate terminal state**: send req1, simulate two responses for the same `requestId` arriving back-to-back. First resolves; second silently dropped.
4. **Disconnect cleanup**: send req1, req2, call `disconnect()`. Both promises reject with "Client disconnected"; pending + timers maps empty; telemetry records two `disconnected` terminals.
5. **Timeout cleanup**: send req1, advance clock to 90s. Promise rejects; map empty; telemetry records `timeout`.
6. **Retry after recreate**: send req1, disconnect, reconnect, send req1 again with same params. Server-side handler returns same response. Promise resolves. (Verifies no leaked listener / state from the prior session.)
7. **Orphan reap**: pre-populate `pendingMeta` with an entry > 5min old; call `connect()` (which triggers `reapStalePending`). Assert pending entry rejected with "orphaned"; telemetry records `orphaned`.
8. **Telemetry called once per terminal**: drive each terminal path and assert `recordTerminal` called exactly once with correct status.

8 tests. Each tests a distinct invariant. Models `background/client.test.ts:71`'s structure.

**NOT TESTED:**
- Real `chrome.runtime.sendMessage` timing (FakeBrowserApi covers this).
- Offscreen document lifecycle (covered by `offscreen.ts` separately).
- Real network conditions (e2e layer).

**Existing tests to consider**:
- `packages/extension/src/wallet/base/offscreen/client.test.ts:61` — keep its `onReady()` hook test; the new file is additive.

## Verification commands

```bash
bun run --filter '@nulo/extension' test    # contract suite passes
bun run --filter '@nulo/extension-messaging' test
bun run typecheck:all
bun run test:all                           # M2.6 unaffected
bun run check:imports
bun run build
```

Manual QA (30 min):
1. Cold-install with offscreen PXE; trigger getGasBalances on send popup.
2. Force SW restart (e.g. via `chrome://serviceworker-internals` → Stop). Reload popup. Verify: stale request reaps cleanly; new request succeeds.
3. Trigger 90s timeout (artificial: edit timeout to 5s in dev; trigger). Verify: telemetry log shows `timeout` terminal; popup gets the structured error.

**Adversarial test** during execution: introduce a 6-minute artificial delay in the offscreen handler; the orphan reap should fire on the next SW connect.

## Risks tracked

1. **Telemetry sink implementation** is currently logging-only. Real metrics push (e.g. to a Sentry-style endpoint) is out of scope for M4.4 — add a sub-PR if/when telemetry collection is approved.
2. **Reap threshold (5 min)** is a Chrome implementation detail; if Chrome changes the SW idle limit, the threshold must follow. Document in `telemetry.ts`.
3. **`pendingMeta` parallel map** doubles memory per pending request. Negligible (small N), but noted.
4. **Periodic reap via `chrome.alarms`** introduces a new alarm name (`nulo:offscreen:reap` per M4.5's naming convention). Ensure it doesn't collide with M4.5's `nulo:core:session:ttl`.
5. **Test fixture: simulating SW restart in unit test** requires constructing a fresh client + injecting pre-existing `pendingMeta`. FakeBrowserApi supports the runtime listener reset; verify the construction path during execution.

## Rollback

`git revert <m4.4-commit-sha>` rolls back. Telemetry sink + reap logic + new tests all in one commit-sequence. Existing offscreen client behavior (in-memory map, 90s timeout, no telemetry) restored.

## Open questions / decision flags

1. **Telemetry sink delivery**. M4.4 ships logging-only. If the user wants real metrics, that's a follow-up PR.
2. **Periodic reap interval**. Default to `chrome.alarms` 30s minimum; reasonable for the 5-minute reap window. Adjust based on real-world behavior.
3. **Reap on every `connect()`** vs alarm-only. Default both: connect is rare and cheap; alarm catches the long-idle case.
