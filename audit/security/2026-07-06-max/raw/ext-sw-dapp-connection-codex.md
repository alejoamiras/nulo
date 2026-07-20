CLUSTER: ext-sw-dapp-connection

## Findings

### [1] Unbounded dApp discovery intake can exhaust the service worker while locked or awaiting approval

**Impact factors**: Availability violation. Blast radius is a single user's extension service worker and wallet UI responsiveness; no secret data exposure. Attack vector: network via a malicious web page using the injected dApp bridge. Attack complexity: low. Privileges required: none. User interaction: required to visit or keep open the malicious page, but no wallet approval is required for the locked-wallet path.

**Evidence confidence**: high.

**OWASP / CWE mapping**: OWASP Top 10 2021 A04 Insecure Design; CWE-770 Allocation of Resources Without Limits or Throttling; CWE-400 Uncontrolled Resource Consumption.

**Trace**:
1. The service worker registers a raw `chrome.runtime.onMessage` listener for content-script-originated wallet-sdk traffic at `apps/extension/src/wallet/services/wallet-sdk/background.ts:149`.
2. The wrapper only rejects malformed content-script envelopes, then forwards valid discovery traffic into the upstream handler at `apps/extension/src/wallet/services/wallet-sdk/background.ts:187` and `apps/extension/src/wallet/services/wallet-sdk/background.ts:192`.
3. Every upstream pending discovery invokes `handleDiscovery(...)` from `onPendingDiscovery` at `apps/extension/src/wallet/services/wallet-sdk/background.ts:198`.
4. If the wallet is locked, `handleDiscovery` enqueues the request and returns without any cap, dedupe, or per-origin throttle at `apps/extension/src/wallet/services/wallet-sdk/background.ts:473` and `apps/extension/src/wallet/services/wallet-sdk/background.ts:475`.
5. The queue sink is an unbounded array append in `packages/wallet-bridge/src/discovery-queue.ts:8` and `packages/wallet-bridge/src/discovery-queue.ts:21`.
6. On unlock, drain copies and iterates the entire accumulated queue at `packages/wallet-bridge/src/discovery-queue.ts:35` and `packages/wallet-bridge/src/discovery-queue.ts:40`.
7. The unlocked duplicate-popup path has the same unbounded intake shape: duplicate discoveries for the same `(origin, chainId)` wait on the pending popup promise at `apps/extension/src/wallet/services/wallet-sdk/background.ts:504` and `apps/extension/src/wallet/services/wallet-sdk/background.ts:506`, creating one suspended handler per request.

**Missing control**: No maximum pending discovery count, no per-origin/session rate limit, no dedupe by `(origin, chainId)` while locked, no early rejection once a cap is reached, and no enqueue-time stale eviction.

**Exploit story / violation scenario**:
1. A user visits `https://evil.example` while the wallet is locked.
2. The page repeatedly emits valid wallet-sdk discovery requests with unique request IDs and valid-looking chain info, for example `chainInfo.chainId = "0x1"` and `chainInfo.version = "0x1"`.
3. Each request reaches `handleDiscovery`; because `profileService.getActiveProfile()` returns no active profile, the service worker pushes another request ID into `DiscoveryQueue`.
4. The attacker keeps sending requests until the service worker spends memory on queued request IDs and upstream pending discoveries, updates badge state repeatedly, and later performs a large drain loop when the user unlocks.
5. If the wallet is unlocked instead, the attacker opens or leaves a connect popup pending, then floods duplicate discoveries for the same origin and chain; each waits on the same popup promise, consuming service-worker memory until the popup resolves.

**Preconditions**: The extension is installed and active on the malicious page; the attacker can run JavaScript in that page. The strongest path requires the wallet to be locked. The alternate path requires an unresolved connect popup for the attacker's origin and chain.

**Why mitigations fail**: `validateContentScriptMessage` checks only the outer envelope type and does not rate-limit or bound request volume at `apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:46`. `DiscoveryQueue` rejects stale entries only during `drain`, not at enqueue time, so memory can grow until unlock at `packages/wallet-bridge/src/discovery-queue.ts:52`. `pendingDiscoveryPromises` dedupes the approval popup, not the number of suspended discovery handlers waiting for that popup at `apps/extension/src/wallet/services/wallet-sdk/background.ts:504`.

**Instances**:
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:473`
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:475`
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:504`
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:506`
- `packages/wallet-bridge/src/discovery-queue.ts:8`
- `packages/wallet-bridge/src/discovery-queue.ts:21`
- `packages/wallet-bridge/src/discovery-queue.ts:35`
- `packages/wallet-bridge/src/discovery-queue.ts:40`