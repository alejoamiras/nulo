# C8 — PXE + accelerator + offscreen + Aztec node URL (Codex xhigh Pass 1)

## Findings

### Finding 1 — Network endpoint enrollment accepts arbitrary URLs, and backup restore bypasses endpoint re-probing entirely

**Title**: `NetworkService` persists attacker-chosen RPC URLs with only `z.string().url()` validation, and the backup-restore path bypasses even the one-time `getNodeInfo()` probe. Once selected, that URL is fed straight into `createAztecNodeClient(...)` / `fetch(...)` with no scheme, origin, or HTTPS-vs-loopback policy.

**Impact factors**:
- CIA+A: **Integrity** + **Confidentiality** + **Availability**. An attacker-controlled RPC can lie about chain state, receipts, fees, nullifier membership, and any other node-derived data the wallet consumes.
- Blast radius: any profile that adds/imports a custom network or endpoint and later activates it; all same-chain PXE/node operations on that profile then ride the malicious endpoint.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required. The attacker needs the user to add/import/select the endpoint; I did **not** find a direct wallet-sdk method that mutates networks.

**Evidence confidence**: **high** — direct code trace plus local verification of the installed Zod URL validator.

**OWASP / CWE mapping**: A04:2021 Insecure Design, A05:2021 Security Misconfiguration — **CWE-20** (Improper Input Validation), **CWE-184** (Incomplete List of Disallowed Inputs).

**Trace** (source → sink):
1. Boundary validation for user-entered endpoints is only `z.string().url()` in `packages/extension/src/wallet/services/network/spec.ts:120-145`.
2. The persisted/offscreen-facing shape is looser still: `NetworkInfoSchema.rpcUrl` is only `z.string()` at `packages/extension/src/wallet/services/network/spec.ts:97-100`.
3. `addNetwork(name, rpcUrl)` calls `_getChainId(rpcUrl)` and then persists the resulting network row at `packages/extension/src/wallet/services/network/service.ts:235-252`.
4. `addEndpoint(...)` / `updateEndpoint(...)` do the same one-time probe via `_getChainId(rpcUrl, ...)` at `packages/extension/src/wallet/services/network/service.ts:328-348`.
5. `restore(networks)` accepts any "new-shape" `Network` object and writes it straight to storage; it does **not** validate endpoint URLs or re-probe `chainId` at `packages/extension/src/wallet/services/network/service.ts:613-633,757-768`.
6. Later use-sites (`setActiveNetwork`, `getNode`, `getNodeForUrl`, `getNetworkInfo`) reuse stored endpoint URLs directly at `packages/extension/src/wallet/services/network/service.ts:305-318,488-526,542-547`.
7. The runtime sink is centralised in `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17`, which calls `createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())`.
8. The actual transport sink is raw `fetch(host, { method: "POST", ... })` in `packages/aztec-runtime/src/utils/fetch.ts:42-47`.

**Missing control**: a central URL policy. The wallet needs one allowlist at the node-factory boundary: permit `https:` always, permit `http:` only for loopback/local-dev hosts, reject non-HTTP(S) schemes before any probe or restore, and re-validate restored endpoints before persisting them.

**Exploit story**:
1. A malicious dApp, guide, or "network backup" tells the user to add/import a custom Aztec endpoint.
2. The user enters `http://attacker.example/rpc` in the popup, or imports a backup whose `primaryEndpoint.rpcUrl` points there.
3. `addNetwork` accepts it because `z.string().url()` passes, or `restore()` skips probing entirely.
4. The user activates the network.
5. Every later node/PXE call for that chain now talks to attacker infrastructure, which can lie, black-hole, or shape the wallet's view of the chain.

**Preconditions**: the user adds/imports/selects the malicious endpoint, or an internal extension component calls the same service with attacker-controlled endpoint data.

**Why mitigations fail**:
- `z.string().url()` is not an Aztec-RPC allowlist. I verified locally against the repo's installed Zod that it accepts `javascript:`, `data:`, `file:`, `chrome:`, `ftp:`, `ws:`, and `wss:` in addition to `http:` / `https:`.
- The one-time `_getChainId()` probe is not a transport policy; it still dials the attacker URL first.
- `restore()` bypasses even that probe and trusts the stored `(chainId, rpcUrl)` pair as-is.
- No sink re-checks the scheme/host before `createNode()` / `fetch()`.

**Instances**:
- `packages/extension/src/wallet/services/network/spec.ts:97-100`
- `packages/extension/src/wallet/services/network/spec.ts:120-145`
- `packages/extension/src/wallet/services/network/service.ts:235-252`
- `packages/extension/src/wallet/services/network/service.ts:305-318`
- `packages/extension/src/wallet/services/network/service.ts:488-526`
- `packages/extension/src/wallet/services/network/service.ts:542-547`
- `packages/extension/src/wallet/services/network/service.ts:613-633`
- `packages/extension/src/wallet/services/network/service.ts:726-733`
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17`
- `packages/aztec-runtime/src/utils/fetch.ts:42-47`

---

### Finding 2 — The selected network’s chain identity is not revalidated when constructing authwits / txs

**Title**: the wallet stores a composite `chainId` once at network-enrollment time, but later tx construction trusts fresh `node.getNodeInfo()` values without checking they still match the selected network. A malicious or drifted RPC can therefore choose the `(l1ChainId, rollupVersion)` pair used for signing/proving.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization**. The wallet can build authwits / tx requests against attacker-chosen chain metadata while the UI/session/network row still says chain X.
- Blast radius: any activated malicious or drifted endpoint; every tx/authwit path using that node inherits the mismatch.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required. The attacker first needs control of the selected endpoint (for example via Finding 1).

**Evidence confidence**: **high** — direct trace from persisted network row to live node-derived `chainInfo`.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-345** (Insufficient Verification of Data Authenticity).

**Trace** (source → sink):
1. The only chain-identity check at enrollment time is `_getChainId(rpcUrl)` returning `(info.l1ChainId ^ info.rollupVersion) >>> 0` at `packages/extension/src/wallet/services/network/service.ts:726-733`.
2. That stored `chainId` is later projected into `NetworkInfo` by `getNetworkInfo()` at `packages/extension/src/wallet/services/network/service.ts:542-547`.
3. `ChainRuntimeRegistry.getOrInit(network)` keys the runtime on `(profileId, chainId)` and only re-initializes when `rpcUrl` changes; it does **not** compare the live node's chain identity back to `network.chainId` at `packages/aztec-runtime/src/pxe/chain-runtime.ts:199-229`.
4. `ProductionPxeFactory.createChainRuntime(network)` creates the node from `network.rpcUrl` only at `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105`.
5. During tx construction, `NuloAccount.buildTxExecutionRequest()` calls `node.getNodeInfo()` and feeds the returned `l1ChainId` / `rollupVersion` directly into `chainInfo` at `packages/aztec-runtime/src/account/nulo-account.ts:99-103`.
6. The dApp-visible `getChainInfo` path also returns fresh node values without cross-checking the selected `Network` row at `packages/extension/src/wallet/services/execution/service.ts:1643-1647`.

**Missing control**: before any signing/proving or `getChainInfo` response, recompute `liveComposite = (l1ChainId ^ rollupVersion) >>> 0` and require `liveComposite === network.chainId`; fail closed otherwise. Stronger still: persist the original `(l1ChainId, rollupVersion)` pair and compare both fields individually.

**Exploit story**:
1. The user adds a custom network while the attacker RPC reports a benign composite chainId X.
2. The network row is stored as chain X.
3. Later, the same RPC flips `getNodeInfo()` to chain Y.
4. Session routing, labels, and CAIP resolution still treat the dApp session as chain X, but authwits / tx requests are now built with chain Y metadata.
5. The user approves an action believing it is for chain X; the cryptographic context is attacker-chosen.

**Preconditions**: a malicious or drifted RPC is selected as the primary endpoint.

**Why mitigations fail**:
- `getNodeStatus()` does have a re-probe path, but it is advisory only; nothing forces it before sign/prove at `packages/extension/src/wallet/services/network/service.ts:470-485`.
- `setActiveNetwork()` and `getNode()` create node clients from stored URLs without any live chain check at `packages/extension/src/wallet/services/network/service.ts:305-318,488-501`.
- `ChainRuntimeRegistry` trusts the caller-supplied `NetworkInfo.chainId`; the live node data is never bound back to it.

**Instances**:
- `packages/extension/src/wallet/services/network/service.ts:235-252`
- `packages/extension/src/wallet/services/network/service.ts:470-485`
- `packages/extension/src/wallet/services/network/service.ts:542-547`
- `packages/extension/src/wallet/services/network/service.ts:726-733`
- `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105`
- `packages/aztec-runtime/src/pxe/chain-runtime.ts:199-229`
- `packages/aztec-runtime/src/account/nulo-account.ts:99-103`
- `packages/extension/src/wallet/services/execution/service.ts:1643-1647`

---

### Finding 3 — Unbounded dApp payloads run under an exclusive per-chain PXE lock, with a 30-minute prove ceiling

**Title**: there is no upper bound on dApp-supplied `ExecutionPayload` size, yet `simulateTx`, `profileTx`, and `proveTx` all execute under `PxeService`’s exclusive per-chain write lock. In the prove path, the transport timeout is explicitly extended to 30 minutes. A granted dApp can therefore monopolize one chain lane with oversized or proof-heavy requests.

**Impact factors**:
- CIA+A: **Availability**. One granted dApp can block same-chain wallet activity (simulate/profile/prove/clear) for an extended period.
- Blast radius: chain-local within one `(profileId, chainId)` lane; other profiles and other chains remain live because the guards are per-chain.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Low. After one approval, silent private-data calls are already possible; self-paid `aztec_sendTx` can also avoid the popup when `exec.feePayer` is present and the session confirmation level permits it.

**Evidence confidence**: **high** — direct input-to-lock trace; no size cap found in the audited path.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-400** (Uncontrolled Resource Consumption), **CWE-770** (Allocation of Resources Without Limits or Throttling).

**Trace** (source → sink):
1. The wallet-sdk dispatcher forwards raw Aztec.js payloads into operations with no size/cost cap at `packages/wallet-bridge/src/dispatcher.ts:829-857`.
2. Silent dApp execution materializes and runs those operations after the initial approval flow; `isConfirmationNeeded()` explicitly allows self-paid `aztec_sendTx` to skip the popup when `exec.feePayer !== undefined` at `packages/extension/src/wallet/services/dapp-interaction/service.ts:253-338,431-458`.
3. `OperationPlanner.processAztecJsPayload()` iterates every element of `exec.calls`, `exec.capsules`, `authWitnesses`, and `extraHashedArgs` at `packages/extension/src/wallet/services/execution/operation-planner.ts:153-203`.
4. `NuloAccount.buildTxExecutionRequest()` then loops `while (current.calls.length > APP_MAX_CALLS)` and repeatedly wraps chunks of 4 calls at `packages/aztec-runtime/src/account/nulo-account.ts:119-124,153-167`.
5. The actual PXE work for `proveTx`, `simulateTx`, and `profileTx` runs inside `withPxeWrite()`’s per-chain write lock at `packages/aztec-runtime/src/pxe/service.ts:268-356,449-463`.
6. `proveTx` gets a special 30-minute timeout in `PxeServiceClientBase` at `packages/aztec-runtime/src/pxe/client.ts:44-69`.
7. The dApp send path reaches that sink via `executeAztecSendTx(...)->coordinator.proveTxTask(...)` at `packages/extension/src/wallet/services/execution/service.ts:1958-1968` and `packages/extension/src/wallet/services/execution/execution-coordinator.ts:69-86`.

**Missing control**: there is no admission control on payload size/cost before exclusive chain work begins. The wallet needs a hard cap (calls/actions/authwits/capsules/extraHashedArgs), plus per-origin queue/rate budgeting or a design that moves expensive proving out of the exclusive chain lane.

**Exploit story**:
1. The user grants a dApp the normal wallet-sdk session/capabilities once.
2. The dApp submits either:
   - a huge `simulateTx` / `profileTx` payload, or
   - a self-paid `aztec_sendTx` that enters the silent path and drives full proving.
3. The extension normalizes the entire payload, chunks it, and starts PXE work under the per-chain write lock.
4. While that request is running, the user’s own same-chain actions and other dApps queue behind it.
5. In the prove case, the lane can stay occupied for up to 30 minutes before the transport times out, and the prove itself is intentionally not cancelled mid-flight.

**Preconditions**: the dApp has a granted session on the target chain. For the 30-minute case, it also needs a send-capable flow such as self-paid `aztec_sendTx`.

**Why mitigations fail**:
- `APP_MAX_CALLS = 4` is not a safety limit; it only changes how large payloads are recursively wrapped.
- The chunking loop is linear, not exponential, but linear cryptographic work under an exclusive lock is still sufficient for a chain-local DoS when the input is unbounded.
- The guard model correctly isolates other chains/profiles, but there is no fairness or per-origin quota inside one chain lane.
- The extended 30-minute timeout is explicitly designed to keep long proves alive rather than failing fast.

**Instances**:
- `packages/wallet-bridge/src/dispatcher.ts:829-857`
- `packages/extension/src/wallet/services/dapp-interaction/service.ts:253-338`
- `packages/extension/src/wallet/services/dapp-interaction/service.ts:431-458`
- `packages/extension/src/wallet/services/execution/operation-planner.ts:153-203`
- `packages/aztec-runtime/src/account/nulo-account.ts:119-124`
- `packages/aztec-runtime/src/account/nulo-account.ts:153-167`
- `packages/aztec-runtime/src/pxe/service.ts:268-356`
- `packages/aztec-runtime/src/pxe/service.ts:449-463`
- `packages/aztec-runtime/src/pxe/client.ts:44-69`
- `packages/extension/src/wallet/services/execution/service.ts:1958-1968`
- `packages/extension/src/wallet/services/execution/execution-coordinator.ts:69-86`

---

### Finding 4 — Concurrent offscreen boot can bypass the READY gate because health checks short-circuit an in-flight bootstrap

**Title**: the offscreen health check treats “responds to PING” as “ready”, but the offscreen shell intentionally registers `OFFSCREEN_PING -> OFFSCREEN_PONG` before PXE bootstrap. Because `ensureOffscreenRunning()` checks health before awaiting any in-flight `offscreenPromise`, a concurrent caller can skip the READY wait and send PXE traffic into a half-booted document.

**Impact factors**:
- CIA+A: **Availability**. Requests can race offscreen bootstrap and either hit a partially initialized service or time out waiting for a response that the caller assumed was safe to send.
- Blast radius: the first burst of PXE-bound requests during offscreen creation/reload; especially visible after SW wake/restart or concurrent callers.
- Exploitability: AV:Network / AC:Low / PR:None / UI:None once a session exists, but timing-dependent.

**Evidence confidence**: **high** for the READY-bypass race; concrete user-visible failure is timing-dependent.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-362** (Race Condition).

**Trace** (source → sink):
1. The offscreen shell registers the `OFFSCREEN_PING` handler immediately at module top, before any service bootstrap, at `packages/extension/src/offscreen/index.ts:11-18`.
2. The shell does **not** send `OFFSCREEN_READY` until after `await createPxeOffscreen(...)` resolves at `packages/extension/src/offscreen/index.ts:67-81`.
3. `createPxeOffscreen()` itself documents that it awaits `services.start()` before returning at `packages/aztec-runtime/src/offscreen/entry.ts:38-46`.
4. `ensureOffscreenRunning()` first checks `isOffscreenAlreadyRunning()` and then `isOffscreenHealthy()`; a successful PONG returns immediately at `packages/extension/src/wallet/utils/offscreen.ts:205-210`.
5. The `offscreenPromise` READY wait only happens later, after that early-return branch, at `packages/extension/src/wallet/utils/offscreen.ts:215-232`.

**Missing control**: a PONG must imply READY. Either register the health-check listener only after PXE startup finishes, or make `ensureOffscreenRunning()` always await an in-flight `offscreenPromise` before honoring health.

**Exploit story**:
1. Request A wakes the service worker and starts creating the offscreen document, setting `offscreenPromise`.
2. The browser exposes the offscreen context quickly.
3. Request B arrives milliseconds later.
4. `isOffscreenAlreadyRunning()` is now true, and the early top-level ping handler returns `OFFSCREEN_PONG` even though READY has not been sent yet.
5. B returns from `ensureOffscreenRunning()` and sends a PXE request into a half-booted offscreen document, racing startup invariants or timing out.

**Preconditions**: concurrent PXE requests during offscreen creation/reload, or a caller racing the first request after SW wake.

**Why mitigations fail**:
- The health check is “responds to ping”, not “services started”.
- `ensureOffscreenRunning()` checks health before consulting `offscreenPromise`.
- The shell comment explicitly says the ping handler is registered early so slow init does not block PONGs.

**Instances**:
- `packages/extension/src/offscreen/index.ts:11-18`
- `packages/extension/src/offscreen/index.ts:67-81`
- `packages/aztec-runtime/src/offscreen/entry.ts:38-46`
- `packages/extension/src/wallet/utils/offscreen.ts:73-97`
- `packages/extension/src/wallet/utils/offscreen.ts:205-232`

## Non-findings

- **No direct wallet-sdk path to add/switch networks** — the audited wallet-sdk dispatcher only materializes existing-network operations such as `aztec_getChainInfo`, `aztec_registerContract`, `aztec_simulateTx`, `aztec_profileTx`, and `aztec_sendTx` at `packages/wallet-bridge/src/dispatcher.ts:780-865`. I did not find `addNetwork` / `addEndpoint` / `setActiveNetwork` on the dApp-exposed surface. The real risk is phishing/manual add/import (Finding 1), not a silent SDK mutation.
- **Accelerator required-mode is actually enforced when the build flag is present** — the flag is baked from `import.meta.env` at `packages/extension/src/accelerator/config.ts:26,41-43`, passed only by the offscreen shell at `packages/extension/src/offscreen/index.ts:67-76`, and required mode genuinely fails on preflight / `fallback` / `denied` at `packages/aztec-runtime/src/pxe/chain-runtime.ts:126-156`. If the env never reaches the build, CI loses enforcement, but that is a build-pipeline issue rather than a runtime bypass.
- **Artifact class-id confusion on `aztec_registerContract` is blocked on the audited path** — the execution layer recomputes `getContractClassFromArtifact(artifact)` and throws on mismatch at `packages/extension/src/wallet/services/execution/service.ts:1684-1699`; `ArtifactRegistry.resolve()` also drops mismatched PXE-local artifacts at `packages/aztec-runtime/src/pxe/artifact-registry.ts:172-177,200-211`. I also did not find a dApp-reachable `updateContract`/same-class replacement API in the wallet-sdk surface.
- **`APP_MAX_CALLS` chunking is not an authwit-confusion bug by itself** — the wallet computes chunking locally at `packages/aztec-runtime/src/account/nulo-account.ts:119-167`; the dApp does not supply a separate “chunk count” field that could be tampered with. The real issue is lack of overall work limits under exclusive locks (Finding 3).
- **Node lies about the init-nullifier witness do not obviously become successful double-init** — the decision point is untrusted at `packages/aztec-runtime/src/account/nulo-account.ts:129-146`, but I did not find a client-side path that converts a false “uninitialized” answer into a successful unauthorized state transition. The more likely effect is wasted proving / failed tx.
- **Firefox hidden-window fallback keeps the same extension-origin isolation boundary** — it hosts the same `offscreen.html` page and uses the same `chrome.runtime` channel at `packages/extension/src/wallet/utils/offscreen.ts:140-176`. The documented SW-restart leak at `:183-191` is a lifecycle/resource issue, not a cross-origin isolation break.
- **No stale-response cache keyed off OFFSCREEN_PING/PONG** — I did not find any secret-bearing cache coupled to the health check. The offscreen concern in this cluster is readiness/race (Finding 4), not cached-response reuse.
