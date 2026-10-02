**Answers**

1. **SIGNER FIX:** `handleSendTx` already has the specific-account resolver path. It reads `args[1].from`, normalizes `NO_FROM`/missing to `undefined`, otherwise passes `String(rawOpts.from)` into `resolveNetworkAndAccount(ctx, dappSession, requestedFrom)` at [dispatcher.ts:509](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:509)-[516](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:516). The resolver then checks the requested address is both wallet-owned and in the session account set, or throws, at [dispatcher.ts:1207](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:1207)-[1221](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:1221).

So `handleCreateAuthWit` should use that same resolver:

```ts
const requestedFrom = String(args[0])
const [network, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
```

Then build the internal silent operation with `accountAddress: account.address`, not the generic session-default account. That is equivalent to `args[0]` after validation, but canonicalizes through the wallet account record.

2. **ROUTING:** yes, the dispatcher should decide covered-vs-popup. `isConfirmationNeeded` should remain an access/UX gate, not a scope-policy engine. Current `sendTx` passes this `ExecutionParams` shape at [dispatcher.ts:549](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:549)-[562](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:562):

```ts
{
  sessionId: dappSession.id,
  operations: [sendOp],
}
```

with hooks only for `sendTx`.

For popup `createAuthWit`, mirror the params shape but use the protocol request shape:

```ts
const authwitReq: AztecCreateAuthWitRequest = {
  kind: "aztec_createAuthWit",
  account: formatCaipAccount(ctx.chainId, account.address),
  messageHashOrIntent,
}

const results = await this.dappInteractionService.execute({
  sessionId: dappSession.id,
  operations: [authwitReq],
})
```

Do not pass the sendTx hooks bag.

Covered `CallIntent` silent routing is safe under the Unit A policy if all four conditions hold: `canCreateAuthWit` is granted for the signer, signer is resolved from `args[0]`, the `CallIntent` is covered by tx/sim scope, and execution rejects name-selector mismatch before `computeAuthWitMessageHash` at [execution/service.ts:656](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/service.ts:656)-[697](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/service.ts:697). Making all dApp `createAuthWit` popup is stricter UX policy, but not required to close F-01/F-02 as designed.

3. **accessLevel:** yes, change `aztec_createAuthWit` from `AccessLevel.PrivateData` to `AccessLevel.Transactions`. It currently maps to `PrivateData` at [dapp-interaction/service.ts:511](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:511)-[512](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:512). `validateSession` already accepts `aztec_createAuthWit` at [dapp-interaction/service.ts:370](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:370)-[380](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:380).

4. **EXPORTS:** exporting `callWithinTxOrSimulationScope`, `isCallIntent`, and `isIntentInnerHash` is layering-safe because `method-scope-checkers.ts` is a leaf module. Cleaner seam: export one helper, e.g. `isCreateAuthWitCoveredByTxOrSimulationScope(intent, grants)`, and keep the low-level guards private unless tests need them. If minimizing diff to match the plan, exporting the three named helpers is acceptable and should not create an import cycle.

5. **Descriptor:** changing `createAuthWit` from `account-operation` to `handler` removes it from derived `METHOD_TO_KIND` and `ACCOUNT_KINDS` at [method-descriptors.ts:232](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:232)-[253](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:253). Runtime is fine if `dispatch()` gets an explicit `createAuthWit` branch before the generic `METHOD_TO_KIND` lookup at [dispatcher.ts:365](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:365). Expected test fixture changes: remove `createAuthWit` from `FROZEN_METHOD_TO_KIND` and `FROZEN_ACCOUNT` at [method-descriptors.test.ts:57](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.test.ts:57)-[81](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.test.ts:81). No `sendTx`/`grantPublicAuthwit` descriptor regression; both are already `handler`.

6. **FIFO hooks:** `createAuthWit` through `execute()` must not pass `sendTx` hooks. The background only pre-allocates a queued journal for `message.type === "sendTx"` at [background.ts:283](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/background.ts:283)-[292](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/background.ts:292), and the safety-net `.finally(releaseFifo)` releases the dispatch baton for non-send paths at [background.ts:309](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/background.ts:309)-[314](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/background.ts:314). Passing no hooks means `createAuthWit` preserves existing non-send FIFO semantics.

Adversarially: covered-`CallIntent` silent routing does not leave residual F-01/F-02 exposure once raw hashes are rejected, inner hashes always popup, uncovered calls popup, signer resolution uses `args[0]`, and the execution-layer ABI name-selector bind is enforced before hashing. The residual risk is only the intentionally granted authority: a dApp with `canCreateAuthWit` plus broad tx/sim scope can silently get authwits within that broad scope.

**RECOMMENDED IMPLEMENTATION**

1. In [method-scope-checkers.ts:217](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:217), export the coverage helpers or add a single exported `isCreateAuthWitCoveredByTxOrSimulationScope`. Also relax `checkCreateAuthWit` at [method-scope-checkers.ts:279](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:279)-[304](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:304): keep the account `canCreateAuthWit` check and raw-Fr rejection, but do not throw for structured uncovered `CallIntent`/`IntentInnerHash`; dispatcher routing handles that.

2. In [method-descriptors.ts:107](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:107)-[110](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:110), change `createAuthWit.routing` to `{ via: "handler" }`. Remove `"aztec_createAuthWit"` from `AccountOperationKind` at [method-descriptors.ts:59](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:59).

3. In [dispatcher.ts:68](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:68)-[74](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:74), import `AztecCreateAuthWitRequest`. Also import the createAuthWit coverage helper from `method-scope-checkers.ts`.

4. In [dispatcher.ts:361](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:361)-[363](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:363), add `if (methodName === "createAuthWit") return this.handleCreateAuthWit(args, ctx, dappSession, grants)` before the generic `METHOD_TO_KIND` lookup.

5. Add `handleCreateAuthWit` near `handleGrantPublicAuthwit` in [dispatcher.ts:634](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:634). Resolve `String(args[0])` via `resolveNetworkAndAccount(ctx, dappSession, requestedFrom)`. For covered `CallIntent`, call `executionService.executeOperations([{ kind: "aztec_createAuthWit", networkId: network.id, accountAddress: account.address, messageHashOrIntent }], { type: OriginType.DAPP, name: ctx.origin })`. For `IntentInnerHash` or uncovered `CallIntent`, call `dappInteractionService.execute({ sessionId: dappSession.id, operations: [{ kind: "aztec_createAuthWit", account: formatCaipAccount(ctx.chainId, account.address), messageHashOrIntent }] })` with no hooks.

6. In [dapp-interaction/service.ts:511](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:511)-[512](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:512), change `aztec_createAuthWit` access level to `AccessLevel.Transactions`.

7. Update frozen descriptor tests at [method-descriptors.test.ts:57](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.test.ts:57)-[81](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.test.ts:81), plus scope tests that currently expect structured uncovered authwits to throw. Add dispatcher tests for signer mismatch rejection, covered `CallIntent` direct execution, uncovered `CallIntent` popup, `IntentInnerHash` popup, raw Fr rejection, and no hook forwarding for popup `createAuthWit`.