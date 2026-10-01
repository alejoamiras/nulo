# Phase 4 — Offscreen client typed-error flip + dApp envelope (HIGH, dApp-reaching)

**Status:** ✓ complete. Standard gate ✓; network validated by the P5 cumulative run (27828443110 on 04081a5, 8 jobs ran+passed) which contains the offscreen flip + dApp envelope. The dApp-error-contract is unit-pinned (error-envelope.test.ts).

## What shipped

- **Flipped the four offscreen error-shaping hooks** (`makeRemoteError` /
  `makeTimeoutError` / `makeSendFailureError` / `makeDisconnectError`) from raw
  strings to typed errors — parity with the Port transport. Remote errors
  reconstruct the WalletError subclass from `errorPayload` (emitted by the
  offscreen service since P3/D9); timeout → `RpcTimeoutError`; send-failure →
  `RpcDisconnectedError`; disconnect → `Error("Client disconnected")`. The flip
  is localized to those four hook bodies — the shared core + background hooks are
  untouched (the D13 payoff).
- Migrated the 6 offscreen string-reject pins → `toBeInstanceOf` typed-error
  assertions; added an `errorPayload`-reconstruction test.

## B1 (dApp oracle) — the load-bearing part

The offscreen client's rejections DO reach connected dApps: PXE prove/simulate
failures propagate `background.ts dispatcher.dispatch → execution-coordinator
(re-throws) → toWalletResponseError`. `error-envelope.ts` had no `Rpc*` case.

- Subtlety found: because I kept the offscreen messages identical, the flip is
  actually message-transparent TODAY (typed error → `error.message` fall-through
  → same string). But that's fragile + accidental. D11 wants it pinned.
- **Added explicit `RpcTimeoutError` + `RpcDisconnectedError` cases** to
  `toWalletResponseError`:
  - `RpcTimeoutError` → `{code: -32603, message: "The wallet timed out while
    processing the request.", data: {walletErrorCode: "RPC_TIMEOUT"}}`.
  - `RpcDisconnectedError` → `{code: 4900 (EIP-1193 Disconnected), message: "The
    wallet was disconnected while processing the request.", data:
    {walletErrorCode: "RPC_DISCONNECTED"}}`.
  - **No oracle**: generic messages — the internal `"Offscreen request timed out:
    <method>"` detail (which leaked `proveTx`/`offscreen`) is NOT crossed to the
    dApp. dApp-contract tests assert the envelope + `not.toContain("proveTx")`.
  - This is a (bounded, intentional) dApp-wire improvement for these rare
    internal-error cases: structured + discriminable + leak-free, vs the prior
    accidental bare string. Ratified here.

## B4 — telemetry sanitizer post-flip

Offscreen rejections are now real Errors with `.stack`, but the telemetry
`detail` is still the static category (`sendMessage_threw` etc.), and the
sanitizer allow-list is unchanged. The existing "sanitizer drops untrusted
detail" test (asserts `detail === "sendMessage_threw"` + `not.toContain("rm
-rf")`) still passes — confirms no user-influenceable string reaches telemetry.

## Gate

- extension-messaging test **104**; typecheck clean.
- extension test **2533**; vue-tsc clean.
- `error-envelope.test.ts` **8** (incl. the 2 new D11 dApp-contract cases).
- `bun run lint` → exit 0.
- Network leg: runs on the P4 push — this is the cumulative run covering P1–P4
  (incl. the behavior flip). The dApp-error-contract is unit-pinned above;
  network proves the real prove/simulate flows still settle correctly.
