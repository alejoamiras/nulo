# @nulo/extension-messaging

Typed RPC plumbing between the service worker, popup, and offscreen document. Defines `Service` / `ServiceClient` / `OffscreenService` base classes; reconstructs `Error` instances across the boundary; ships a telemetry sidecar.

## Position in the stack

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  aztec-runtime  →  wallet-bridge  →  extension
```

Depends on `wallet-core` for ports, error types, and the `ServiceSpec` contract.

## File map

| Path | Purpose |
|---|---|
| `src/core/base-service.ts` · `base-client.ts` | Transport-agnostic `Service` / `ServiceClient` base shared by the background + offscreen specializations: request **correlation**, dispatch, event broadcast, and port-disconnect handling. |
| `src/core/decode.ts` · `error-response.ts` | Success-path result decode + typed-error (`WalletError`) reconstruction shared by both transport clients. |
| `src/core/rpc-methods.ts` · `initialization.ts` | RPC method-name registry + shared service-initialization helpers. |
| `src/background/service.ts` | `Service<Methods, Events>` — server-side base. Owns the port listener, request dispatch, and event broadcast. |
| `src/background/client.ts` | `ServiceClient<Methods, Events>` — client-side base. Owns `chrome.runtime.connect`, request correlation, port-disconnect handling, and subscription bookkeeping. |
| `src/messages.ts` | Wire schema: `RequestMessage`, `ResponseMessage`, `EventMessage`, `SubscribeMessage`. |
| `src/errors.ts` | The named-error registry (`InvalidPasswordError`, `ProfileIdConflictError`, `UserRejectedError`, …). Used by both sides to round-trip typed errors. |
| `src/offscreen/service.ts` | `OffscreenService` — server-side base for the offscreen document. Same pattern as background, over `chrome.runtime.sendMessage`. |
| `src/offscreen/client.ts` | `OffscreenServiceClient` — the SW-side caller. Includes per-request telemetry. |
| `src/offscreen/telemetry.ts` | Sidecar telemetry surface. Each request emits a single terminal-state event (`ok` / `failed` / `send_failed`) so production builds get DevTools observability for offscreen RPCs. |
| `src/zod-helpers.ts` | Schema-validation helpers used by services that narrow protocol messages. |
| `src/utils.ts` | Port lifecycle utilities (waiters, drains). |
| `src/testing/setup.ts` | Per-package vitest setup. |
| `src/testing/port-registry.ts` | `PortRegistry` / `FakePort` / `connectStub` — the one `chrome.runtime.connect` fake, exported as `@nulo/extension-messaging/testing`. Any number of ports per name, a closed port throws on `postMessage`, only a far-end close fires `onDisconnect`; `manual` or `microtask` answering. The extension's `tests/vitest.setup.ts` and its logger tests use it too. |
| `src/testing/transport-harness.ts` | Import-to-install `chrome` stub for this package's contract suites: the port client direction over `PortRegistry`, plus the service side (`connectServiceClient`), the offscreen `sendMessage` broker and logger spies. Not exported — importing it registers vitest hooks. |

## Scripts

| Command | Effect |
|---|---|
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run test` | Unit tests via vitest. |

## Testing

Colocated `*.test.ts`. Most coverage lives across the SW boundary and is exercised inside `@nulo/extension`'s test suite (which can stand up a fake browser environment); the unit tests here focus on the message-schema contract and the error reconstruction path.

## Key invariants

- **Errors are reconstructed across the wire as real `Error` instances.** On the client, compare with `err instanceof Error && err.message === "…"` — never `err === "…"`. The base class restores `Error` (and named subclasses from `errors.ts`) at the deserialization step.
- **A port client fails in three distinct ways; only one of them reconnects.**
  - *The far end closes the port* (the service worker was recycled): the client re-opens its port at once; requests in flight reject with the plain `Error("Client disconnected")` — deliberately not a `WalletError`; match it with `isClientDisconnectRejection`. Retryable.
  - *A send hits a torn-down port*: that request rejects with `RpcDisconnectedError`. Retryable once the worker is back.
  - *The port cannot be opened* (`chrome.runtime.connect` throws synchronously — the page's extension context is gone after an update or reload): the request that needed the port rejects immediately with `RpcConnectError`. Nothing retries, no timer is left behind, and `connect()` itself never rejects. Treated as permanent for that document; a later request simply tries the open again.
- **Telemetry is best-effort.** The offscreen telemetry sidecar fires one terminal-state event per request (`LoggingTelemetrySink` is the default sink in production). It must not be on the request hot path; lost telemetry never fails an RPC.
- **No service logic in this package.** This is plumbing only. The shape `Service<Methods, Events>` is generic; concrete services (account, profile, network, …) live in `@nulo/extension`.
- **Zod helpers are validation, not transformation.** Schemas verify the wire shape; they do not coerce values. Coercion at the service boundary masks bugs in the dispatcher narrowing layer.
