**Verdict**

The artifact is directionally right for F-01/F-02/F-08, but it is not complete as written. It closes the three named sinks only if you add execution-time ABI binding, but there is a fourth name↔selector/authwit sink in `AuthwitDiscoverer.computeEncodedCallMessageHash`. There is also an adjacent `createAuthWit` account-selection issue: dispatcher currently checks `args[0]` but signs with the first session account.

**Q1**

Reject raw `Fr` in the dispatcher/scope layer, not only in execution.

Change [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:255):
- `checkCreateAuthWit()` currently falls through for raw `Fr` at lines `306-308`.
- Replace that fallthrough with a throw for dApp-originated dispatcher calls.
- Keep this synchronous.

Popup gating is not declared by a generic “popup list”. It is effectively:
- registry route `routing: { via: "handler" }` in [method-descriptors.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:112) and [method-descriptors.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:179)
- hard-coded dispatcher branches at [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:352)

So for inner-hash `createAuthWit`:
- change `createAuthWit` in [method-descriptors.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-descriptors.ts:107) from `account-operation` to `handler`
- add `handleCreateAuthWit()` in [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:502)
- route `IntentInnerHash` through `DappInteractionService.execute({ operations: [{ kind: "aztec_createAuthWit", account, messageHashOrIntent }] })`
- add an unconditional popup rule for `aztec_createAuthWit` in [dapp-interaction/service.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/dapp-interaction/service.ts:455)

Also improve the popup display: [OperationCard.vue](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/popup/windows/execute/OperationCard.vue:450) currently shows “Inner hash” but not `consumer`; add consumer display or the confirmation is too opaque.

**Q2**

`accounts.canCreateAuthWit` should be usable standalone only as permission to ask the user, not as permission to silently sign arbitrary authwits.

Silent `CallIntent` authwit should require:
- accounts scope passes: [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:258)
- and call is covered by transaction/simulation scope: [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:279)

Fix the current `hasTxCaps` gap at [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:282). Current behavior says no tx/sim grants means “skip call-scope”. That is the bug.

Recommended policy:
- covered structured `CallIntent` -> silent allowed
- uncovered `CallIntent`, including no tx/sim caps -> popup-confirm or reject
- raw `Fr` -> reject
- `IntentInnerHash` -> popup-confirm always

For compatibility, I recommend popup-confirm for uncovered `CallIntent`, not blanket reject. But the silent path must require tx/sim scope.

**Q3**

Confirmed. The evasion is real.

In [tx-request-builder.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/tx-request-builder.ts:294), `encoded_call` resolves the artifact only when `action.type === undefined || action.isStatic === undefined` at lines `295-310`. If attacker supplies both, lookup is skipped and `action.name` flows into `FunctionCall` at lines `311-321`.

Change `TxRequestBuilder.buildStandard()`:
- always resolve instance/artifact for `action.to`
- always `findFunctionBySelector(artifact, action.selector)`
- if `action.name` exists and `action.name !== fn.name`, throw
- build `FunctionCall` from ABI truth: `fn.name`, `fn.functionType`, `fn.isStatic`, `fn.returnTypes`
- do not trust dApp-supplied `type`, `isStatic`, or `returnTypes` for execution metadata

Do the same in `buildNoFrom()` at [tx-request-builder.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/tx-request-builder.ts:407):
- after parsing `FunctionCall.schema`, look up selector in the already-resolved artifact map from lines `390-393`
- reject `call.name` mismatch
- reject if ABI function type is not `FunctionType.PRIVATE`; do not trust `call.type`

**Q4**

Feasible and correct.

In [service.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/service.ts:641), `executeAztecCreateAuthWit()` has `network`, `account`, `node`, and access to `this.pxeService`/`this.resolver`.

Add `findFunctionBySelector` import from `./contract-resolver`, then before line `661`:
- get `pxe = this.pxeService.getPXE(networkInfoFrom(network))`
- resolve instance for `call.to`
- resolve artifact
- `fn = await findFunctionBySelector(artifact, selector.toString())`
- reject if missing
- reject if supplied `call.name !== fn.name`
- construct `FunctionCall` using ABI truth

Fail closed if artifact is not resolvable. Do not skip-with-confirm for a structured `CallIntent`; without the artifact, the wallet cannot prove name↔selector binding. The dApp can register the contract/artifact first.

**Q5**

Parse at dispatcher pre-scope.

Best placement is [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:293), immediately after method support is confirmed and before `enforceCapability()`/`enforceScopeWithSession()` at lines `299-320`.

Use parsed args everywhere after that point:
- capability/scope
- handler routing
- `buildOperation()`
- batch leg dispatch

Use `WalletSchema[methodName].def.input.parseAsync(args)` through a small shared helper, not ad hoc per-checker casts. That preserves the existing Zod source of truth. For Nulo custom methods, ensure the runtime patch is loaded before dispatcher validation, or move the three custom schema constants into wallet-bridge and have the patch import them.

**Q6**

Main regression risks:
- `createAuthWit` currently checks `args[0]` but signs with the first authorized session account. See scope check at [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:256) versus signer selection at [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:1059). Fix by resolving `String(args[0])` as `requestedFrom` for `aztec_createAuthWit`.
- Do not make scope checkers async. Artifact resolution belongs in execution sinks, especially [service.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/service.ts:641) and [tx-request-builder.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/tx-request-builder.ts:103).
- Popup-gated `createAuthWit` should not use sendTx FIFO hooks. The send FIFO/mutex contract is sendTx-specific; background has a safety-net release for non-send paths at [background.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/background.ts:309).
- Signature binding is not affected if you only validate before computing `messageHash`. Do not change `computeAuthWitMessageHash()` inputs except replacing attacker metadata with ABI-resolved metadata.

**RECOMMENDED DESIGN**

1. Add dispatcher arg validation in `WalletSdkDispatcher.dispatch()` before capability/scope. Use parsed args from then on.

2. Refactor `createAuthWit` into a dispatcher handler:
   - change descriptor at `method-descriptors.ts:107`
   - add `handleCreateAuthWit()` near `handleSendTx()`
   - resolve signer from `args[0]`, not first session account
   - raw `Fr`: reject
   - scoped ABI-bound `CallIntent`: execute silently
   - uncovered `CallIntent`: popup-confirm
   - `IntentInnerHash`: popup-confirm

3. Add unconditional popup rule for `aztec_createAuthWit` in `DappInteractionService.isConfirmationNeeded()` and add consumer display for inner-hash popup UI.

4. Fix F-02 in `TxRequestBuilder.buildStandard()` `encoded_call`: unconditional ABI lookup and name mismatch rejection.

5. Fix F-02 in `TxRequestBuilder.buildNoFrom()`: unconditional ABI lookup, name mismatch rejection, and ABI-derived private-function check.

6. Fix F-02 in `ExecutionService.executeAztecCreateAuthWit()`: resolve artifact for `call.to`, bind selector to ABI name, and build the `FunctionCall` from ABI truth.

7. Fix the fourth sink: `AuthwitDiscoverer.computeEncodedCallMessageHash()` at `authwit-discoverer.ts:180` has the same conditional lookup bug. Make selector lookup unconditional and reject `content.name` mismatch before computing the authwit hash.

**DISAGREEMENTS/CORRECTIONS**

The artifact’s “all 3 sinks” list is incomplete. Add `AuthwitDiscoverer.computeEncodedCallMessageHash()` as a fourth F-02 sink.

Also, do not treat `canCreateAuthWit` alone as silent authority. It can be standalone only for explicit per-request confirmation. Silent authwit creation needs tx/sim scope coverage.