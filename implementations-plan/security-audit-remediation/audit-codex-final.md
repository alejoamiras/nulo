# Codex final audit — security-audit-remediation plan (FRESH CONTEXT)

## Verdict
`reject (with blocking findings: Phase 0.5 does not actually eliminate all 6 dispatcher session lookups; Phase 3 still leaves an approved-discovery / re-key-exchange race after revocation; Phase 5's IPv6 loopback fact is wrong and would reject legitimate [::1] RPC URLs.)`

## Blocking findings (NEW — not already in audit-codex.md or audit-opus.md)
Not re-blocking prior Round-1 items like frame-targeted transport infeasibility or the general need for broader F-012 sink coverage. The blockers below are new gaps in the iterated plan itself.

### B1 — Phase 0.5 is incomplete as written
The plan says Phase 0.5 replaces all 6 `tryGetDappSessionByOriginAndChain` call sites in [`dispatcher.ts`](../../../packages/wallet-bridge/src/dispatcher.ts), and the source does confirm those 6 reads at `:289`, `:391`, `:457`, `:505`, `:735`, and `:904`. But the Phase 0.5 file scope in [`plan.md:46-48`](./plan.md#L46) only threads the captured session through `enforceCapability`, `enforceScope`, `handleGetAccounts`, `handleSendTx`, `handleRegisterToken`, `requestCapabilities`, and `enrichGrantedCapabilities`. It omits `resolveNetworkAndAccount()`, which still performs the 6th lookup at [`dispatcher.ts:904-909`](../../../packages/wallet-bridge/src/dispatcher.ts:904).

That omission matters: account-context methods still keep one of the old async session reads, so the phase does not actually achieve the “single lookup” property it claims at [`plan.md:42-50`](./plan.md#L42). This also leaves the plan internally inconsistent: [`plan.md:37`](./plan.md#L37) says Phase 0.5 + 1 are “one consolidated PR,” while [`plan.md:53`](./plan.md#L53) and [`plan.md:79`](./plan.md#L79) say Phase 0.5 lands before Phase 1.

### B2 — Phase 3 closes active sessions, but not approved pending discoveries
The revised F-006 plan only talks about iterating `handler.getActiveSessions()` and terminating matches. That is insufficient against the actual wallet-sdk state machine.

Source:
- `approveDiscovery()` marks a pending discovery as `approved` and sends `DISCOVERY_APPROVED` at [`background_connection_handler.ts:243-260`](../../../node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:243).
- `handleKeyExchangeRequest()` establishes a live session whenever the pending discovery exists with `status === 'approved'` at [`:277-279`](../../../node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:277).
- `terminateSession()` deletes the active session and then recreates a pending discovery in `approved` state at [`:356-379`](../../../node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:356).

So the Phase 3 design still leaves two races open:
- A discovery that was already approved before the durable `DappSession` row is deleted can still complete key exchange after revocation.
- A just-terminated session can be re-key-exchanged against the restored approved discovery before the async `SESSION_DISCONNECTED` message closes the content-script port at [`content_script_connection_handler.ts:218-225`](../../../node_modules/@aztec/wallet-sdk/src/extension/handlers/content_script_connection_handler.ts:218).

The plan needs an explicit local answer for approved `pendingDiscoveries`, not just `ActiveSession`s: either purge/block them on revocation, or reject `KEY_EXCHANGE_REQUEST` whenever the backing `DappSession` is gone.

### B3 — The Phase 5 IPv6 loopback fact is wrong in the actual runtime
The iterated plan says the loopback host match should be ``::1`` and specifically “NOT `[::1]`” because WHATWG URL serialization strips brackets at the hostname layer ([`plan.md:159-162`](./plan.md#L159)). That is not what the current repo runtime does. In this environment:

```ts
new URL("http://[::1]:8080").hostname // "[::1]"
```

I verified that in both `bun 1.3.13` and `node v24.16.0`. So the proposed allowlist would reject a legitimate IPv6 loopback RPC URL. The test vector in [`plan.md:178`](./plan.md#L178) is also wrong: `http://::1:8080` is not the valid URL spelling; the valid form is `http://[::1]:8080`.

This is not a cosmetic nit. The plan currently treats a wrong copied fact as settled, and the resulting implementation would break real loopback usage.

## Significant findings (NEW)
### S1 — The revised F-012 sink inventory still is not source-verified
The plan’s new helper-based F-012 direction is better than the old single-hook idea, but the concrete sink list is still off. It names [`chain-runtime.ts:104-105,199-229`](../../../packages/aztec-runtime/src/pxe/chain-runtime.ts:104) even though those paths do not call `node.getNodeInfo()`, while it omits real live-node identity reads like [`execution/service.ts:1646`](../../../packages/extension/src/wallet/services/execution/service.ts:1646) (`aztec_getChainInfo`) and [`execution/service.ts:2123`](../../../packages/extension/src/wallet/services/execution/service.ts:2123) (`executeNoFromSendTx` authwit discovery). Since the chosen remediation is “call the helper at every sink,” the sink inventory has to be exact.

### S2 — Force decision on Phase 0.5 vs Phase 1: keep them separate
My call: keep Phase 0.5 as its own PR, but only after fixing B1 and explicitly documenting the mid-dispatch revocation semantics. It is not a harmless cleanup. Capturing session state at dispatch entry changes behavior for recursive/batched paths, so folding it into the Phase 1 auth bundle would make review harder, not safer.

### S3 — Pending-request correlation is feasible locally; the plan can simplify
The content script is currently a pure transport wrapper at [`content.ts:11-20`](../../../packages/extension/src/content-script/content.ts:11), and the page-side extension provider already matches discovery responses by exact `requestId` at [`extension_provider.ts:177-225`](../../../node_modules/@aztec/wallet-sdk/src/extension/provider/extension_provider.ts:177). That means the local F-002 mitigation can be implemented by tracking pending discovery `requestId`s in the content-script transport wrapper and dropping unsolicited approvals. It does not need speculative upstream envelope changes to be feasible locally.

### S4 — The “test pin discipline” claim is aspirational, not present-tense
The repo does have a PR template at [`.github/PULL_REQUEST_TEMPLATE.md`](../../../.github/PULL_REQUEST_TEMPLATE.md:1), but it does not require “this PR closes F-XXX; the test at <file:line> pins the regression,” and I found no CI enforcement for that rule. The plan should phrase this as a process change to make, not as an existing safeguard.

## What the iterated plan got right
- Round-1’s biggest F-001/F-002 correction was handled correctly: the plan no longer pretends Nulo can already do frame-targeted replies on the current wallet-sdk transport.
- Pulling F-005 into the same scope-enforcement phase as F-003/F-004 was the right reversal.
- Replacing the old single `walletSdkSessionId` storage idea with tuple matching over live sessions is directionally right for multi-tab same-origin sessions.
- Moving F-012 away from “just hook `nulo-account.ts`” and toward a shared helper was the correct response to the prior audit, even though the sink inventory still needs another pass.
- The “do not guess” language added around F-008 is the right security posture for approval summaries.

## Where the iteration may have OVER-corrected
- Phase 0.5 now gets treated like a mechanical prep refactor, but its own tests (“all-or-none, not half-applied”) show it is really a dispatch-semantics change.
- F-012 swung from one impossible central hook to a many-sinks helper strategy without a maintained chokepoint or inventory guardrail.
- The Phase 5 IPv6 update over-corrected from the research note into a hard “NOT `[::1]`” claim that the actual runtime does not support.

## Final recommendation
This needs one more iteration before implementation starts. Keep Phase 0.5 separate, amend Phase 3 to handle approved `pendingDiscoveries` as well as `ActiveSession`s, and re-verify Phase 5 against the real runtime/source instead of the copied research claims. After those changes, this would be close to conditional approval rather than another reject.
