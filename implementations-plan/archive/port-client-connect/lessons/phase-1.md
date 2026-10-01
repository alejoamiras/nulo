# Phase 1 — terminal connect

## What landed

- `ServiceClient`: `openPort()` (synchronous, throws `RpcConnectError`, logs once at the open),
  `connect()` never rejects for a failed open, `ensureTransportReady()` is `void`; the retry loop,
  `waitForConnection`, the `sleep` import and `ClientState.Connecting` are gone.
- `RpcConnectError` (`RPC_CONNECT_FAILED`) in `errors.ts`; Chrome's reason folded into the message.
- `documentLogger` observes the returned line (`line.catch(() => {})`) and its TSDoc states the new
  contract.
- Tests: three in `connect failure is terminal`, one added to `port onDisconnect → reconnect`, and
  `console-forwarding.containment.test.ts`.

## Deviation from the plan's snippet (reverted post-implementation — see `post-impl.md` R1)

`connect()` swallows only `RpcConnectError` and rethrows anything else. `openPort()` also invokes
`onConnected` listeners; the old loop caught a throwing listener and *retried the open every second*,
leaking one port per attempt. A listener bug now surfaces as a rejected `connect()` instead of being
swallowed along with the failed-open case.

## Red checks

- The four new client tests were run against the old `client.ts` (file swapped, then restored): all
  four red — three time out at 5 s (the request can never settle without a timer advance), the
  reconnect case fails its assertion.
- The containment test, with the `catch` line disabled: **the first attempt hung the vitest worker**
  — the rejection → handler → log → rejection chain never yields to the timer queue, so neither the
  test's `setTimeout` drain nor vitest's own test timeout could fire. That is direct evidence the loop
  is a busy loop, not a slow one. The bridge in the test now stops forwarding after three turns, so a
  regression fails in ~10 ms (`expected "vi.fn()" to not be called at all, but actually been called 4
  times`) instead of hanging the run.

## Gate

`bun run lint` exit 0 · `bun run typecheck` exit 0 · `bun --cwd packages/extension-messaging test`
12 files / 226 tests passed · extension `src/wallet/logger` + `src/wallet/services/logger` 6 files /
93 tests passed.
