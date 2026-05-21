# @nulo/wallet-bridge

The dApp-facing dispatcher. Implements the `@aztec/wallet-sdk` capability map,
narrows protocol messages into typed service calls, and enforces session scope.
Does not depend on the Aztec runtime — the bridge is transport-shaped, not
chain-shaped.

## Position in the stack

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  aztec-runtime  →  wallet-bridge  →  extension
```

Depends on `wallet-core` and `extension-messaging`. **Does not** depend on
`aztec-runtime`: keeping the bridge runtime-free is what allows the dispatcher
to live in the service worker while the PXE lives in the offscreen document.

## File map

| Path | Purpose |
|---|---|
| `src/dispatcher.ts` | The dispatcher. Routes every wallet-sdk method to typed service calls; narrows protocol shapes; threads the right session/capabilities through. |
| `src/capability-map.ts` | Declarative map of every capability the wallet exposes: name, scope, approval model, popup vs silent path. |
| `src/capabilities.ts` | Capability-request types and resolution helpers. |
| `src/services-contract.ts` | Structural interfaces the dispatcher consumes (NetworkServices, AccountServices, DappSessionServices, …). Keeps the bridge import-free relative to concrete service impls in `@nulo/extension`. |
| `src/scope-enforcement.ts` | Per-message re-check: call-intent targets, fee-payer constraints, chainId, account allow-list against the session's granted scope. |
| `src/session-types.ts` | DappSession shape; per-`(origin, chainId, profileId)` keying. |
| `src/dapp-interaction-protocol.ts` | Wire schemas for popup-driven interactions (discover, capabilities, execute, verify, json). |
| `src/action.ts`, `operation.ts`, `operation-result.ts`, `transaction-origin.ts` | Operation models that flow through the dispatcher. |
| `src/fee.ts` | Fee-payment-method protocol types shared with the popup. |
| `src/caip.ts` | CAIP-2 / CAIP-10 helpers (`aztec:<chainId>` / `aztec:<chainId>:<address>`). The single source of truth for parsing/formatting CAIP identifiers. |
| `src/authwit-content.ts` | Auth-witness content shapes. |
| `src/discovery-queue.ts` | Discovery-request queue. |
| `src/types.ts` | Shared protocol types. |

## OperationResult

Every `executeOperations` call returns one `OperationResult` per requested
operation, in order. The union has four variants:

| Variant | Meaning |
|---|---|
| `{ status: "ok", result }` | Operation completed; `result` is its return value. |
| `{ status: "cancelled", jobId?, reason? }` | User cancelled mid-flight. Distinct from `failed`. |
| `{ status: "failed", error }` | Operation failed. `error` is a human-readable message. |
| `{ status: "skipped" }` | Batch sibling not attempted (a prior operation in the same batch returned non-`ok`). |

`cancelled` distinguishes "the user intentionally cancelled" from "the
operation failed". dApps should suppress error UI on cancellation — silent UX
is the expected behavior. Added in 0.2.0.

## dApp cancellation contract

When a user cancels an in-flight tx (or other cancellable operation) from the
wallet UI, the wallet-sdk delivers an error to the dApp's awaiting promise.

**The current upstream `@aztec/wallet-sdk` collapses our structured envelope
to a plain `Error` whose `.message` is the JSON-serialized payload.** The
following recipe handles both that shape and a forward-compatible structured
shape, so dApps stay correct if the SDK ever preserves structure:

```ts
try {
  const txHash = await wallet.aztec.sendTx(payload)
} catch (err) {
  let info: { code?: number; message?: string; data?: unknown } | undefined

  // Forward-compat: structured payload (if SDK ever stops collapsing).
  if (typeof err === "object" && err !== null && "code" in err) {
    info = err as typeof info
  }
  // Today: SDK wraps as `new Error(JSON.stringify(response.error))`.
  else if (err instanceof Error) {
    try {
      info = JSON.parse(err.message)
    } catch {
      /* not a Nulo cancel — fall through to generic error handling */
    }
  }

  if (info?.code === 4001) {
    // User cancelled or rejected — silent UX, no failure dialog.
    return
  }

  // Real failure — surface info?.message ?? err.message to the user.
  console.error("Transaction failed:", info?.message ?? (err instanceof Error ? err.message : err))
}
```

### Cancel payload shape

When the wallet emits a cancel signal, the structured envelope (before SDK
collapse) is:

```jsonc
{
  "code": 4001,                                  // EIP-1193 user-rejected
  "message": "Transaction cancelled by user",
  "data": {
    "walletErrorCode": "JOB_CANCELLED",          // discriminates from USER_REJECTED
    "jobId": "<journal-uuid>"                    // for dApp-side correlation
  }
}
```

- **Code `4001`** matches [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193#errors).
  dApps with existing EIP-1193 reject handling get cancel handling for free.
- **`data.walletErrorCode`** disambiguates "user cancelled mid-flight"
  (`JOB_CANCELLED`) from "user rejected at approval popup" (`USER_REJECTED`).
  Both share code 4001; the discriminator is for dApp-side telemetry.
- **`data.jobId`** correlates with the wallet's internal journal record.
  Optional for dApp consumers.

### What other error shapes look like

For other failures (network errors, simulation failures, etc.), the dApp
receives `err.message` as a plain non-JSON string. The recipe's
`try { info = JSON.parse(...) } catch { ... }` falls through gracefully.

## getAccounts before requestCapabilities

`wallet.getAccounts()` throws `CapabilityNotGrantedError` (code `4100`,
EIP-1193 "Unauthorized") when called on a session that has not yet been
granted the `accounts` capability. dApps should call `requestCapabilities()`
first; if they don't, the throw triggers their existing fallback path:

```ts
try {
  const accounts = await wallet.getAccounts()
} catch (err) {
  // Fallback works for ANY throw — bare-catch is fine (e.g. Nethermind faucet).
  // Code-aware discrimination (optional):
  const msg = err instanceof Error ? err.message : String(err)
  try {
    const parsed = JSON.parse(msg)
    if (parsed.code === 4100 && parsed.data?.walletErrorCode === "CAPABILITY_NOT_GRANTED") {
      // The wallet is telling us to request capabilities first.
    }
  } catch {
    /* not a structured error — bare-catch fallback handles it */
  }

  // Always send the full manifest: one popup grants accounts + simulation
  // + transaction + etc. The dApp can do everything afterwards.
  const granted = await wallet.requestCapabilities(myFullManifest)
}
```

The structured envelope (pre-SDK-collapse):

```jsonc
{
  "code": 4100,
  "message": "accounts capability not granted. Call requestCapabilities() first.",
  "data": {
    "walletErrorCode": "CAPABILITY_NOT_GRANTED",
    "capabilityType": "accounts"
  }
}
```

The `data.walletErrorCode` discriminator distinguishes this 4100 from any
other "unauthorized" surface the wallet might add later. The error message is
a public contract — it must stay byte-for-byte stable across versions because
some dApps will substring-match on it.

Note: today the wallet only ever throws this for the `accounts` capability
(from `dispatcher.handleGetAccounts`). Other capability-gated methods reject
with the existing scope-enforcement error format. Widening the
`CapabilityNotGrantedError` surface to other methods is a separate, deferred
follow-up — it would change the error-string contract for those methods, so
it needs its own audit cycle before any rollout.

## Scripts

| Command | Effect |
|---|---|
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run test` | Unit tests via vitest. |

## Testing

Colocated `*.test.ts`. Dispatcher and scope-enforcement coverage live in
`dispatcher.test.ts` and `scope-enforcement.test.ts`. Both exercise the bridge
against a fake services-contract; no real chain or runtime needed.

## Key invariants

- **No `aztec-runtime` imports.** Enforced via biome `noRestrictedImports`.
  The bridge is transport-shaped; chain-shape concerns belong in the runtime
  or in the extension's service layer.
- **One CAIP source of truth.** Anything that parses `aztec:<chainId>` or
  `aztec:<chainId>:<address>` goes through `caip.ts`. Hand-rolled parsing is a
  bug; that's how the partial-validation drift this package was extracted to
  fix gets reintroduced.
- **Scope enforcement is per-message.** A granted session is not a free pass —
  `scope-enforcement.ts` re-checks each method's targets against the session's
  allow-list. Don't bypass it on the "trusted dispatcher" assumption.
- **Capabilities encode UX, not authority.** The `capability-map.ts` columns
  determine whether a popup opens; the underlying authority is the session
  itself. Adding a capability without updating the popup model leaves a silent
  path; removing one without a migration leaves stale sessions.
- **The dispatcher is the single chokepoint.** Every dApp-originated request
  flows through `dispatcher.ts`. New surface (e.g. a new wallet-sdk method)
  gets added here; bypass routes are not allowed.

## Versioning

Pre-1.0 — minor bumps allowed to widen public types non-breakingly (e.g. the
`cancelled` variant added in 0.2.0). Major/exhaustive consumers may need a
new case added to their switches.
