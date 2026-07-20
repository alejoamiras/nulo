## F-01 — VERDICT: CONFIRMED

Independent evidence (file:line I read):
- `packages/wallet-bridge/src/method-scope-checkers.ts:255` gates `createAuthWit` only on `accounts.canCreateAuthWit`.
- `packages/wallet-bridge/src/method-scope-checkers.ts:279` and `packages/wallet-bridge/src/method-scope-checkers.ts:291` scope-check only structured `CallIntent` / `IntentInnerHash`; `packages/wallet-bridge/src/method-scope-checkers.ts:306` leaves raw `Fr` with “no semantic info”.
- `packages/wallet-bridge/src/dispatcher.ts:370` generic-routes non-popup methods to `executionService.executeOperations`; `packages/wallet-bridge/src/dispatcher.ts:1156` builds `aztec_createAuthWit` directly from `args[1]`.
- `packages/wallet-bridge/src/dispatcher.ts:352` says only `sendTx` / `registerToken` use popup handling; `createAuthWit` is not listed.
- `apps/extension/src/wallet/services/execution/service.ts:680` parses raw `Fr`; `apps/extension/src/wallet/services/execution/service.ts:685` signs it.
- `apps/extension/src/popup/windows/capabilities/build-items.ts:32` skips `accounts` cards; `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:45` renders only account identity/alias, not `canCreateAuthWit`.
- `apps/faucet/src/lib/capabilities.ts:152` and `apps/faucet/src/lib/capabilities.ts:219` show real bridge/faucet manifests requesting `canCreateAuthWit:true`.
- `apps/faucet/src/composables/useWithdraw.ts:230` obtains an off-chain private burn authwit; `apps/faucet/src/composables/useWithdraw.ts:236` spends it in a later bridge exit.

Final band:
Critical. The signing sink is silent after a commonly requested account-selection grant, and the approval UI does not meaningfully surface `canCreateAuthWit:true` for accounts. A raw hash can represent a transfer/burn/approval authorization and is signed without semantic scope.

Exploit chain / preconditions:
Malicious connected dApp has an `accounts` grant with `canCreateAuthWit:true`; it submits raw `Fr` as `createAuthWit(from, rawHash)`. Dispatcher performs no popup or tx/sim scope check, execution signs, attacker consumes the witness in a later contract/third-party transaction. Typed SDK may not expose raw `Fr`, but the dispatcher accepts `unknown[]` from the dApp message path.

Fix note:
Reject raw hashes from dApp RPC, or force an explicit per-request confirmation for opaque hashes. Prefer recomputing from structured intent and binding the signed call to verified contract/function/selector scope.

## F-02 — VERDICT: CONFIRMED

Independent evidence (file:line I read):
- `packages/wallet-bridge/src/method-scope-checkers.ts:121`, `packages/wallet-bridge/src/method-scope-checkers.ts:160`, `packages/wallet-bridge/src/method-scope-checkers.ts:174`, and `packages/wallet-bridge/src/method-scope-checkers.ts:281` authorize by `call.name`.
- `packages/wallet-bridge/src/dispatcher.ts:544` forwards `sendTx` exec unchanged; `packages/wallet-bridge/src/dispatcher.ts:1134` and `packages/wallet-bridge/src/dispatcher.ts:1153` forward simulate/profile exec unchanged.
- `apps/extension/src/wallet/services/execution/operation-planner.ts:207` parses `FunctionCall`; `apps/extension/src/wallet/services/execution/operation-planner.ts:212` stores `selector`; `apps/extension/src/wallet/services/execution/operation-planner.ts:215` stores independent `name`.
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:304` resolves selector only to fill missing type/static fields; it does not compare resolved ABI name to `action.name`.
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:311` uses `action.name || action.selector` only as display metadata; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:317` executes `FunctionSelector.fromString(action.selector)`.
- `apps/extension/src/popup/windows/execute/index.vue:181` copies the dApp operation into popup state; `apps/extension/src/popup/windows/execute/OperationCard.vue:183` displays `call.name ?? call.selector`.
- `apps/extension/src/popup/windows/execute/OperationCard.vue:118`, `apps/extension/src/popup/windows/execute/OperationCard.vue:401`, and `apps/extension/src/popup/windows/execute/OperationCard.vue:433` similarly render attacker-supplied names for other surfaces.

Final band:
High. This bypasses granted function scope and can mislead the approval UI. It can also affect silent simulation/profile/authwit paths; fund-loss impact is credible when the mismatched selector authorizes spend-like behavior, but it generally needs prior scoped grants and, for `sendTx`, user confirmation.

Exploit chain / preconditions:
DApp has scope for `transfer@token`; it sends a `FunctionCall` with `name:"transfer"` and `selector:approveSelector`. Scope passes on name, popup can show “Transfer”, and execution uses `approveSelector`.

Fix note:
Authorize selectors, not names. Resolve selector against the contract artifact before authorization and reject if supplied `name` disagrees with the ABI-resolved function.

## F-03 — VERDICT: CONFIRMED

Independent evidence (file:line I read):
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:116` gets the node; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:119` fetches first `node.getNodeInfo()`.
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:124` validates that first response with `assertLiveChainIdentity`.
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:343` calls `account.buildTxExecutionRequest(node, ...)`.
- `packages/aztec-runtime/src/account/nulo-account.ts:103` fetches `node.getNodeInfo()` again.
- `packages/aztec-runtime/src/account/nulo-account.ts:104` builds `chainInfo` from the second response.
- `packages/aztec-runtime/src/account/nulo-account.ts:127`, `packages/aztec-runtime/src/account/nulo-account.ts:137`, and `packages/aztec-runtime/src/account/nulo-account.ts:140` use that second `chainInfo` for wrapping/signing.
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:153` and `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:351` reach `buildStandard()` on normal dApp send paths.

Final band:
High. Requires a malicious configured RPC endpoint or MITM that can equivocate between two `getNodeInfo()` calls, but the second unvalidated response is on the normal signing path and directly controls signing/wrapping chain identity.

Exploit chain / preconditions:
User sends a transaction through attacker-controlled/drifted RPC. First `getNodeInfo()` matches the selected network and passes; second `getNodeInfo()` returns different `l1ChainId` / `rollupVersion`; `NuloAccount` signs/wraps over the second identity.

Fix note:
Pass the validated chain info into `buildTxExecutionRequest()` and remove the internal refetch, or re-run `assertLiveChainIdentity` on the second response before constructing `chainInfo`.