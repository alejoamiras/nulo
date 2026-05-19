# Phase 2 follow-up: aztec_sendTx feeSettings undefined crash

**Status:** plan v2 — codex-reviewed, ready to implement
**Branch target:** `feat/phase-2-durable-jobs` (continuation)
**Severity:** user-visible crash on dApp tx approval when user clicks Approve too fast to fill the fee widget

## The bug

User-facing symptom in the SW log:

```
[sw:execution] [15abdf83] executeOperations: aztec_sendTx failed:
Cannot read properties of undefined (reading 'priorityLevel')
```

Triggered by a dApp swap when the user approved without selecting a fee method. The chain of failure:

| # | Where | Issue |
|---|---|---|
| 1 | `packages/extension/src/popup/windows/execute/index.vue:178,193` | Type-lie via `undefined!` — popup writes `feeSettings: undefined` while TS thinks the type is non-optional |
| 2 | `packages/extension/src/popup/windows/execute/index.vue:228` | Approve validation only covers `send_transaction`, not `aztec_sendTx` — the bad op leaves the popup |
| 3 | `packages/extension/src/wallet/services/execution/service.ts:1867, 2146` | SW receives op with `feeSettings: undefined`, calls `buildAndEstimateTxRequest` which dereferences `feeSettings.priorityLevel` and throws |

This is pre-existing (predates Phase 2) but worth fixing now that we've caught it.

## Correct design (what already exists)

The wallet-bridge has an intentional request/executable split — codex caught this and I had missed it:

```ts
// packages/wallet-bridge/src/dapp-interaction-protocol.ts:36-38, 116-118
type SendParams = AccountParams | "feeSettings"
export type AztecSendTxRequest = Omit<AztecSendTxOperation, SendParams> & {
  account: CaipAccount
}
```

The inbound dApp `AztecSendTxRequest` **omits** `feeSettings`; the executable `AztecSendTxOperation` **requires** it. The intended contract is "dApp sends a request without feeSettings → wallet materializes feeSettings → executable Operation goes to the SW".

The bug is **not** the wallet-bridge type — it's that *two paths* materialize request→operation, and one lies:

| Path | File | Behavior |
|---|---|---|
| Silent auto-approve | `dapp-interaction/service.ts:219-256` | Correct: `feeSettings: { paymentMethod: { kind: "embedded" } }` |
| Popup (user approval) | `execute/index.vue:169-193` | Lies: stores draft rows as `Operation`, fakes feeSettings with `undefined!` |

The structural fix is to make the popup path stop lying — and ideally collapse the two materializers into one.

## Layered fix

Four layers, ordered cheap-to-expensive. Layers 1–3 close the user-visible bug. Bonus (4) is the structural cleanup codex recommended.

### Layer 1: Popup-local Draft types — no more `undefined!`

**Codex v2 update:** the change isn't popup-local without also threading the new types through the other popup files referencing `UIOperation`. Specifically:

| File | What changes |
|---|---|
| `popup/windows/execute/index.vue` | Replace inline `UIOperation` with `DraftUIOperation`; drop `!` lies on L178/L193/L220 |
| `popup/windows/execute/OperationCard.vue:26` | Its own `UIOperation = Operation & { network; account?; feeSettings?: FeeSettings }` — replace with the shared `DraftUIOperation` (or align its definition) so the optional `feeSettings` is consistent end-to-end |
| `composables/useFeeEstimationMap` callers (`index.vue:88-90`) | The estimate input was `{ op: UIOperation; feeSettings: FeeSettings }` — feeSettings is *strict* in this shape (estimate has no business running with undefined). Keep it strict; the caller narrows before scheduling. |
| `wallet/services/execution/client.ts:65` (`estimateOperationFee`) | Keeps `FeeSettings` (non-optional). Callers must validate first. |

Concrete shape:

```ts
// New shared file: popup/windows/execute/types.ts
import type {
  AztecSendTxOperation,
  Operation,
  SendTransactionOperation,
  FeeSettings,
} from "@nulo/wallet-bridge"
import type { Network } from "@/wallet/services/network/client"
import type { Account } from "@/wallet/services/account/client"

type DraftAztecSendTx = Omit<AztecSendTxOperation, "feeSettings"> & {
  feeSettings?: FeeSettings
}
type DraftSendTransaction = Omit<SendTransactionOperation, "feeSettings"> & {
  feeSettings?: FeeSettings
}
export type DraftOperation =
  | Exclude<Operation, AztecSendTxOperation | SendTransactionOperation>
  | DraftAztecSendTx
  | DraftSendTransaction

export type DraftUIOperation = DraftOperation & {
  network: Network
  account?: Account
}
```

Then `index.vue` + `OperationCard.vue` both import `DraftUIOperation`. The `!` lies at L178/L193 become plain `undefined` (now type-correct). The `as UIOperation & { feeSettings?: FeeSettings }` cast at L220 collapses.

After this layer, the compiler enforces that consumers handle the optional case. The `estimate` callsite at L88-90 needs an assertion (Layer 2) before scheduling — TS will require it.

### Layer 2: Type-asserting approve validation

**Codex v2 update:** a boolean predicate + manual `as Operation` cast still leaves a lie at the cast site. TypeScript assertion functions solve both Layer 2 and the silent-path's narrowing in Layer 4. Extract to a plain `.ts` helper for testability (no Vue SFC mounting).

**New file:** `packages/extension/src/popup/windows/execute/operation-validation.ts`

```ts
/**
 * Operation validation helpers for the dApp approval Execute window.
 *
 * Bridges popup draft state (where send-like feeSettings may be undefined
 * because the user hasn't picked one yet) to the executable Operation
 * shape the SW expects.
 *
 * Kept in a plain .ts file (not the SFC) so it's unit-testable without
 * Vue test harness setup.
 */
import type { DraftUIOperation } from "./types"
import type { Operation } from "@nulo/wallet-bridge"

/**
 * Returns true iff the operation still needs the user to pick a fee
 * payment method (feeSettings undefined AND no dApp-supplied embedded
 * fee).
 *
 * "Legit no-fee" cases:
 *  - send_transaction with op.fee.embeddedFeePayment set
 *  - aztec_sendTx with executionMode === "default_entrypoint"
 *  - aztec_sendTx with exec.feePayer set
 */
export function requiresFeeSelection(op: DraftUIOperation): boolean {
  if (op.kind === "send_transaction") {
    return op.feeSettings === undefined && op.fee?.embeddedFeePayment === undefined
  }
  if (op.kind === "aztec_sendTx") {
    const isNoFrom = op.executionMode === "default_entrypoint"
    const hasEmbeddedFeePayer = op.exec?.feePayer !== undefined
    return op.feeSettings === undefined && !isNoFrom && !hasEmbeddedFeePayer
  }
  return false
}

/**
 * TS assertion: narrows a Draft operation to the executable Operation
 * shape. Throws if the operation isn't ready (caller should have run
 * `requiresFeeSelection` first to surface a user-facing error).
 *
 * Used by the approve handler AFTER the requiresFeeSelection gate, AND
 * by the Layer 4 silent-path post-materialize cast.
 */
export function assertExecutableOperation(op: DraftUIOperation): asserts op is Operation & {
  network?: unknown
  account?: unknown
} {
  if ((op.kind === "send_transaction" || op.kind === "aztec_sendTx") && op.feeSettings === undefined) {
    throw new Error(`assertExecutableOperation: ${op.kind} is missing feeSettings`)
  }
}
```

Then in `index.vue` `approve()` (L226):

```ts
if (operations.value.some(requiresFeeSelection)) {
  setError("Validation error", "Select a fee payment method for each transaction", "warning")
  return
}
// Narrow: every op is now executable.
const executable: Operation[] = operations.value.map(({ network: _n, account: _a, ...op }) => {
  assertExecutableOperation(op as DraftUIOperation)
  return op as Operation
})
```

The assertion call narrows the type. No `as Operation` lie at the cast site.

### Layer 3: SW boundary contract — runtime invariant at trust boundary

**File:** `packages/extension/src/wallet/services/execution/service.ts`

Even with honest types, `approveInteraction()` at `dapp-interaction/service.ts:82-94` is a JS-context boundary that trusts whatever the popup sends. Runtime malformed input can land regardless of compile-time types. Add an explicit pre-check before the work that needs `feeSettings`.

For `executeAztecSendTx` (after the `default_entrypoint` redirect at L1817, which already tolerates missing feeSettings by design):

```ts
private async executeAztecSendTx(op: AztecSendTxOperation, origin: LocalTxOrigin, parentTask?: WrappedTask) {
  if (op.executionMode === "default_entrypoint") {
    return this.executeNoFromSendTx(op, origin, parentTask)
  }
  if (!op.feeSettings) {
    throw new Error("aztec_sendTx: feeSettings is required for the standard execution path")
  }
  // ... rest unchanged
}
```

For `executeSendTransaction` (no default_entrypoint here — feeSettings is unconditionally required):

```ts
public async executeSendTransaction(op: SendTransactionOperation, origin: LocalTxOrigin, parentTask?: WrappedTask): Promise<string> {
  await this.ensureInitialized()
  if (!op.feeSettings) {
    throw new Error("send_transaction: feeSettings is required")
  }
  // ... rest unchanged
}
```

Not redundant. Two reasons:
1. JS-context trust boundary. Layer 1 prevents the popup from sending bad data; Layer 3 catches a future regression or any non-popup caller violating the contract.
2. Failure messaging. Without the check, a downstream callsite throws `TypeError: Cannot read properties of undefined (reading 'priorityLevel')`. With it, the error names what's wrong.

### Bonus / Layer 4: Shared request→operation materializer

**Why:** codex's deeper observation is that **the duplicate materialization logic** (silent path in `dapp-interaction/service.ts:219-256` and popup path in `execute/index.vue:132-200`) is the real design smell. They diverge today; that's how the popup ended up lying. The fix is to have one source of truth for "request → operation" and let each consumer (silent / popup) layer its policy on top.

**New file:** `packages/extension/src/wallet/services/dapp-interaction/materialize.ts`

```ts
/**
 * Materializes a single dApp OperationRequest into an Operation (or, for
 * send-like kinds where the wallet supplies feeSettings, a draft that
 * still needs feeSettings before execution).
 *
 * Shared by `silentInteraction` (auto-approve) and the popup Execute window.
 * Both paths must produce the same op for the same input — divergence
 * between the two is what caused the W5-followup feeSettings crash.
 */
export type MaterializeDeps = {
  resolveNetwork(chain: CaipChain): Promise<Network>
  resolveNetworkAndAccount(account: CaipAccount): Promise<[Network, Account]>
}

/** Send-like ops the wallet (not the dApp) populates feeSettings for. */
type DraftSendLike =
  | (Omit<AztecSendTxOperation, "feeSettings"> & { feeSettings?: FeeSettings })
  | (Omit<SendTransactionOperation, "feeSettings"> & { feeSettings?: FeeSettings })

export type MaterializedOperation = Exclude<Operation, AztecSendTxOperation | SendTransactionOperation> | DraftSendLike

export async function materializeRequest(
  request: OperationRequest,
  deps: MaterializeDeps,
): Promise<MaterializedOperation> {
  // Single switch on request.kind. Handles ALL kinds; for send-likes,
  // sets feeSettings to `{ paymentMethod: { kind: "embedded" } }` IFF the
  // dApp explicitly opted in (default_entrypoint or pre-set feePayer);
  // otherwise leaves it undefined for the consumer to fill.
}
```

**Update:** `dapp-interaction/service.ts:201-269` (`silentInteraction`) — replace the inline switch with:

```ts
const operations: Operation[] = []
for (const req of payload.params.operations) {
  const op = await materializeRequest(req, deps)
  // Silent path: send-likes that reach here are by definition auto-approve-
  // eligible (isConfirmationNeeded() routed them here only for embedded-fee
  // cases). Materializer already set feeSettings for those; assert + cast.
  if ((op.kind === "aztec_sendTx" || op.kind === "send_transaction") && !op.feeSettings) {
    throw new Error(`silentInteraction: ${op.kind} reached the silent path without feeSettings — isConfirmationNeeded gate broken`)
  }
  operations.push(op as Operation)
}
```

**Update:** `popup/windows/execute/index.vue:131-200` (the for-of loop) — replace inline switch with:

```ts
for (const req of payload.value.params.operations) {
  const op = await materializeRequest(req, materializeDeps)
  _operations.push({ ...op, network: ..., account: ... } as UIOperation)
  // ... accumulate _accounts
}
```

The popup's "embedded if feePayer set, else undefined" rule lives inside `materializeRequest` — the popup doesn't repeat the rule.

**Tests:** `packages/extension/src/wallet/services/dapp-interaction/materialize.test.ts` — at minimum:
- 1 case per request kind, asserting the materialized shape
- send_transaction with `op.fee.embeddedFeePayment` set → feeSettings = embedded
- send_transaction without → feeSettings = undefined (draft)
- aztec_sendTx with `default_entrypoint` → feeSettings = embedded
- aztec_sendTx with `exec.feePayer` set → feeSettings = embedded
- aztec_sendTx neither → feeSettings = undefined (draft)
- pin the resolved networkId/accountAddress threading
- pin error path: unknown kind → throws

## Tests

**Layer 1** — no new tests. Type-only change; `bun run typecheck` enforces the shapes.

**Layer 2** — new `operation-validation.test.ts` (colocated with `operation-validation.ts`):
- `requiresFeeSelection`:
  - `send_transaction` no feeSettings, no `op.fee.embeddedFeePayment` → `true`
  - `send_transaction` no feeSettings, `op.fee.embeddedFeePayment` set → `false`
  - `aztec_sendTx` no feeSettings, default_entrypoint → `false`
  - `aztec_sendTx` no feeSettings, exec.feePayer set → `false`
  - `aztec_sendTx` no feeSettings, neither → `true`
  - non-send op kinds → `false`
- `assertExecutableOperation`:
  - non-send kind → no throw
  - `aztec_sendTx` with feeSettings → no throw
  - `aztec_sendTx` without feeSettings → throws with `"missing feeSettings"`
  - `send_transaction` without feeSettings → throws
  - type-narrowing check (TS-only — assertion narrows the type in the call site)

**Layer 3** — service-level tests at `packages/extension/src/wallet/services/execution/`. Existing `service.ts` doesn't currently have a `.test.ts` colocated; the contract surface is exercised through the e2e suite. Two new focused tests using mocked deps:
- `execute-aztec-send-tx-feesettings.test.ts`:
  - `executeAztecSendTx` with `executionMode === "default_entrypoint"` and undefined feeSettings → routes to `executeNoFromSendTx` (no throw)
  - `executeAztecSendTx` standard path with undefined feeSettings → throws with `"feeSettings is required"`
- `execute-send-transaction-feesettings.test.ts`:
  - `executeSendTransaction` with undefined feeSettings → throws with `"feeSettings is required"`

Both tests use a minimal `new ExecutionService(logger)` and stub the methods that would otherwise need PXE / chain state. The check is at function entry, so we don't need a working Aztec stack.

**Layer 4** — `materialize.test.ts` (see Bonus section above).

## Rollout order

1. Layer 3 first (SW boundary). Smallest diff, zero coupling with the others, immediately makes the crash observable as a clear error instead of a TypeError. Lands tests for it.
2. Layer 1 + 2 together (popup type fix + validation). One commit. Compile-time enforcement + UX validation.
3. Layer 4 (shared materializer) as a separate commit on top — large diff, isolated review.

Each commit independently passes `bun run audit:vue` (typecheck + tests + lint + build).

## What this does NOT change

- The wallet-bridge `Operation` / `AztecSendTxOperation` types — kept strict. The contract that says "executable operations have feeSettings" is preserved.
- The `silentInteraction` enrichment path's semantics. It still ends with `feeSettings: { paymentMethod: { kind: "embedded" } }`; the materializer just centralizes where the rule lives.
- `executeNoFromSendTx` (the `default_entrypoint` branch) — already correctly tolerates `feeSettings?.paymentMethod?.kind` being absent at L1929.

## Documented asymmetry: `default_entrypoint`

Codex flagged this and we explicitly preserve it:

- `dapp-interaction/service.ts:isConfirmationNeeded()` at L379-387 routes ANY `aztec_sendTx` whose `exec.feePayer` is undefined to the popup, including `default_entrypoint` cases. The user is asked to confirm.
- The popup, however, treats `default_entrypoint` as "no fee selection needed" — pre-fills `feeSettings: { paymentMethod: { kind: "embedded" } }` and suppresses the FeeSettingsCard.

This is intentional: `default_entrypoint` requires user *confirmation* (it's a tx with on-chain effect) but NOT fee selection (the dApp handles fee payment via its own entrypoint). The asymmetry is consistent, just spread across two files. The Layer 2 `requiresFeeSelection` predicate respects it.

If a future change wants `default_entrypoint` ops to bypass user confirmation as well, that goes in `isConfirmationNeeded` — not in this fix.
