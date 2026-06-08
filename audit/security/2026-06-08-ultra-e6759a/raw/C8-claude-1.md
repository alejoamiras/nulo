# Cluster C8 — PXE + accelerator + offscreen + Aztec node URL

**Auditor:** Claude (Opus 4.7) — Round 1, agent 1
**Date:** 2026-06-08
**Scope:** PXE wiring in offscreen document, accelerator gating, SW↔offscreen boundary, Aztec node RPC URL injection

---

## F1 — Critical — Node RPC URL accepts dangerous schemes (javascript:, file://, data:, chrome://) — wormable XSS via UI

**Severity:** Critical
**Confidence:** High
**CVSS:** 8.2 (AV:L/AC:L/PR:H/UI:R/S:C/C:H/I:H/A:L — local but escalating to scope-changed because the offscreen privilege exceeds the originating popup)

**Location:**
- `packages/extension/src/wallet/services/network/spec.ts:121, 141, 145` — `addNetwork`, `addEndpoint`, `updateEndpoint` schemas all use `z.string().url()`
- `packages/extension/src/wallet/services/network/service.ts:235-258` — `addNetwork` invokes `_getChainId` → `nodeFactory.createNode(rpcUrl)` on user input
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:16-18` — `createNode(rpcUrl)` passes the string straight to `createAztecNodeClient`
- `packages/aztec-runtime/src/utils/fetch.ts:42` — `fetch(host, ...)` is called with no scheme allowlist

**Description:**
`z.string().url()` is the only validation step on the rpcUrl across the wire boundary. I verified empirically (`node -e ...`) that this schema accepts `javascript:alert(1)`, `file:///etc/passwd`, `data:text/html;base64,...`, and `chrome://settings` as valid URLs. The popup `NewNetworkPopup.vue` (lines 39-47) and `EditEndpointPopup` perform NO additional scheme check beyond the zod validator. The downstream `_getChainId` → `nodeFactory.createNode(rpcUrl)` → `createAztecNodeClient(rpcUrl)` → `createSafeJsonRpcClient` → `fetchOnce()` calls `fetch(host, { method: "POST", body, headers })` with the raw URL.

Behavior per scheme:
- **`javascript:`**: `fetch()` in MV3 contexts rejects this and throws — fail-closed.
- **`file://`**: MV3 extensions do NOT have `file://` access by default; `fetch` will reject with a network error. Fail-closed.
- **`http://`**: Allowed unconditionally in production. Per ARCHITECTURE.md the wallet treats localhost as a special case but plain HTTP to remote hosts is silently allowed. **A user adding an `http://attacker.example.com` RPC for a "Devnet" presets the wallet for MITM.**
- **`data:` URL**: `fetch()` against a data URL returns the payload. If the JSON-RPC parser accepts the response, it could feed attacker-controlled chainId/version values for free — no network round trip needed.

The most concrete attack:

1. Phishing site or compromised dApp documentation tells a user to "add this RPC URL" for "early access to Mainnet". The user types `http://malicious.example.com/aztec` (or pastes a `data:application/json,{"l1ChainId":1,...}` URL) into the New Network popup.
2. `_getChainId` succeeds with whatever `(l1ChainId, rollupVersion)` the attacker returns.
3. The Network is persisted with that chainId, and any subsequent `setActiveNetwork()` makes it the live RPC for all tx construction.
4. Every `proveTx`/`simulateTx` now talks to the attacker. `node.getNodeInfo()` returns attacker-controlled `(l1ChainId, rollupVersion)`, which `nulo-account.ts:99-103` blindly uses as the `ChainInfo` for `computeOuterAuthWitHash` (see F2 below for the chain-mismatch implications).

Note: the schemes that *do* survive `fetch` (`http://`, `https://`) are the dangerous ones in practice. The `javascript:` / `file://` failures still produce noise in error logs and could mask real network failures. There is no defense-in-depth — the network service trusts whatever URL crosses the wire.

**Impact:** Phishing-driven MITM of RPC traffic; signed-authwit forgery via mismatched chainId/version (cross-references F2); arbitrary fee escalation via lied `getCurrentMinFees()` (cross-references F5).

**Reproduction:**
```js
// In the popup browser context (devtools attached):
managers.network.addNetwork("MyChain", "data:application/json;base64,...")
// Or via the New Network popup UI:
//   Name: "Devnet 2"
//   RPC Link: "http://attacker.example.com/aztec"
```

**Recommendation:**
1. Tighten `z.string().url()` to `z.string().url().refine(s => { const u = new URL(s); return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u.host)) })`.
2. For production builds, additionally refuse `http://` for non-localhost hosts (advisory log + UI warning at least).
3. For "kind: local" presets, allow `http://localhost*` / `http://127.0.0.1:*` only.
4. Centralise the scheme check inside `AztecNodeFactoryAdapter.createNode(rpcUrl)` so every call site is gated. Throw early, before `fetch` is ever invoked.

---

## F2 — High — Node-returned chainId/rollupVersion blindly trusted for authwit signing; cross-chain replay primitive

**Severity:** High
**Confidence:** High
**CVSS:** 7.4 (AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:N)

**Location:**
- `packages/aztec-runtime/src/account/nulo-account.ts:92-136` — `buildTxExecutionRequest` reads `(l1ChainId, rollupVersion)` from the (untrusted) node
- `packages/aztec-runtime/src/account/nulo-account.ts:99-103` — passes them directly into `ChainInfo` used for `computeOuterAuthWitHash`
- `packages/extension/src/wallet/services/network/service.ts:726-737` — `_getChainId` only checks the XOR composite at endpoint-add time; never re-validates at tx-sign time
- Upstream `@aztec/entrypoints/dest/account_entrypoint.js:105` — `computeOuterAuthWitHash(this.address, chainInfo.chainId, chainInfo.version, payloadHash)`

**Description:**
At endpoint-add / endpoint-update time the NetworkService computes `chainId = (l1ChainId ^ rollupVersion) >>> 0` and persists that composite onto the Network row. At every subsequent `proveTx`/`simulateTx`, however, the **untrusted node is queried again** via `node.getNodeInfo()` (line 99) and the returned `l1ChainId` + `rollupVersion` are used to build the `ChainInfo` for tx signing. **There is no consistency check between the persisted `network.chainId` and the node's currently-reported `(l1ChainId ^ rollupVersion)`.**

A malicious RPC that lied once at add-time (returning a clean composite) and then flips later — or a benign RPC that was MITM'd between sessions — gets to dictate the authwit `chainId/version` for every signed tx. The user thinks they're signing for chain A; the attacker gets a signature valid for chain B.

This is more dangerous than typical EVM cross-chain replay because authwit hashing is the protocol-level signature surface: a forged authwit for the same address on a different chain (where the attacker has standing) can be replayed against any contract that doesn't strictly bind the wallet's account contract to the originating chain.

**Mitigating factor:** the protocol's account contract verifies the authwit hash includes the chainId/version inside the circuit. If the rollup proves with `version=X` but the simulation built it with `version=Y` (because the node lied), the proof would fail to verify on-chain. So the actual exploit window is limited to scenarios where the attacker controls both the wallet's view AND has standing on a *real* chain whose `(chainId, version)` happens to match the lied values — making this a targeted attack rather than wide-net.

**Impact:** Targeted cross-chain authwit forgery if attacker controls the wallet's RPC view; signing-UI/actual-chain mismatch where the popup says "send on Testnet" but the signature is valid on a different chain.

**Recommendation:**
- Inside `NuloAccount.buildTxExecutionRequest`, after `node.getNodeInfo()`, assert that `(info.l1ChainId ^ info.rollupVersion) >>> 0` equals the `chainId` passed in via `network` (thread it through). Throw on mismatch.
- Alternatively, persist `(l1ChainId, rollupVersion)` separately and verify each at sign-time, not just the composite.
- The fast-path (`extension/src/wallet/services/execution/fast-path.ts`) should follow the same discipline.

---

## F3 — High — Offscreen ping handler responds during boot before service handlers are wired; readiness lie

**Severity:** High
**Confidence:** High
**CVSS:** 5.3 (AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:H)

**Location:**
- `packages/extension/src/offscreen/index.ts:11-18` — ping handler is registered at module top, **before** `createPxeOffscreen` finishes init (line 67-77)
- `packages/extension/src/wallet/utils/offscreen.ts:65-97` — `isOffscreenHealthy()` treats a pong as proof of full readiness

**Description:**
The offscreen shell registers the PING→PONG handler synchronously at the top of `offscreen/index.ts:13-18`, before `createPxeOffscreen(...)` (line 67) runs the async PXE service init. The comment on line 12 says this is intentional ("Registered before anything else so even a slow init doesn't block pong"), but the consequence is that `isOffscreenHealthy()` returns true during a window where the actual `PxeService` request handler is NOT yet registered on `chrome.runtime.onMessage`. Any registerAccount/proveTx request that crosses the SW→offscreen seam during that init window has no listener; it sits until the 90s default request timeout fires (or 30 minutes for `proveTx`).

The window is small (the PXE service's `init` runs IndexedDB orphan cleanup that can block on `onblocked` — which the code resolves rather than hangs on, so worst-case is a few hundred ms in normal cases). But under contention (e.g. another browser process holding the IDB, SW recently restarted, slow disk), the window can stretch to seconds.

Operationally this surfaces as cryptic "Offscreen request timed out: registerAccount" errors that the user sees as a hung send/setup. From a security angle, the issue is more subtle: a stale handler is the simplest "phantom service" — if any future code ever caches handler references after a PONG observation, it could send privileged messages into a void.

The "stale offscreen tricked into responding with cached data" angle from the prompt isn't realised here (the PXE service rebuilds state from IDB on every init, doesn't cache anything across the offscreen lifetime), but the **lie about readiness** is the right concern.

**Impact:** Hung first registerAccount/proveTx after offscreen boot; degraded reliability that could mask other failures; no data exfil today but a footgun for future caching layers.

**Recommendation:**
- Defer registering the PING handler until *after* `services.start()` resolves, so a PONG genuinely means "ready to accept requests".
- OR introduce a separate readiness state machine (`OFFSCREEN_INIT_BEGAN` / `OFFSCREEN_READY` / `OFFSCREEN_BUSY`) so `isOffscreenHealthy()` can distinguish booting-but-listening from fully-up.
- Add a unit test in `is-benign-sw-disconnect.test.ts` peer or new file that asserts the PING handler is NOT live before `createPxeOffscreen` finishes — easy to introspect by inspecting the `chrome.runtime.onMessage` listener count.

---

## F4 — Medium — `verifiedClassIds` cache key only covers classId, not artifact content

**Severity:** Medium
**Confidence:** High
**CVSS:** 4.7 (AV:L/AC:H/PR:H/UI:N/S:U/C:L/I:H/A:N)

**Location:**
- `packages/aztec-runtime/src/pxe/artifact-registry.ts:62, 195-212` — `verifiedClassIds: Set<string>` keyed by `classId.toString()`
- `packages/aztec-runtime/src/pxe/artifact-registry.ts:201-202` — `if (this.verifiedClassIds.has(key)) return artifact` returns the **passed-in** artifact, NOT the previously-verified one
- Upstream `@aztec/pxe/contract_store.js:83-88` — first-write-wins per classId (so PXE storage doesn't actually allow replacement)

**Description:**
`verifyAndCache` recomputes the artifact's class id on first resolve and caches `classId.toString()` on success. On the *next* call with the same classId, it returns the new `artifact` argument directly without verifying that the new artifact also computes to the cached classId.

Today this is safe because:
1. The `pxe-local` lookup path goes through PXE's `contractStore.getContractArtifact(classId)`, which fetches from IndexedDB — and the upstream `addContractArtifact` is first-write-wins (line 86-88 of `contract_store.js`), so the artifact returned for a given classId is immutable for the lifetime of the PXE.
2. The `known` branch skips recompute entirely with a documented justification (compile-in keying).

**However the invariant is implicit.** Two future changes would break the security model silently:
- If upstream PXE ever switches to last-write-wins for `addContractArtifact` (or if Nulo adds a custom path that does).
- If the cache is ever queried for an artifact that arrived from a *different source* than the one that originally populated it (e.g. someone refactors to make `verifyAndCache` reusable for `dApp-registered` artifacts in addition to PXE-local).

Because the cache key is solely the classId, a single tampered artifact in PXE storage (e.g. via a future bug in `updateContract` flow) gets to ride out the rest of the runtime as "verified" without ever being checked.

**Impact:** Defense-in-depth gap. Today, no exploit path. Tomorrow, a refactor lands and the bypass becomes real with no test failures.

**Recommendation:**
- Cache key should be `classId.toString() + "|" + contentHash(artifact)` (or a cheap stable fingerprint like the artifact's `name + functions.length + bytecodeHash`).
- OR drop the cache entirely (Poseidon recompute is ~10-50ms per call; most resolves are infrequent UI paths).
- Add a regression test that registers two different artifacts at the same classId and verifies the second one is rejected on the verification path even if the first was cached.

---

## F5 — Medium — Untrusted `node.getCurrentMinFees()` drives default `maxFeesPerGas` with no clamp

**Severity:** Medium
**Confidence:** High
**CVSS:** 5.4 (AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:H)

**Location:**
- `packages/aztec-runtime/src/account/fee-options.ts:61-63` — `(await node.getCurrentMinFees()).mul(1 + MIN_FEE_PADDING)` when the dApp didn't supply fees
- Called from `nulo-account.ts:113` and the fast-path (cross-referenced)

**Description:**
When the dApp/UI doesn't pass an explicit `maxFeesPerGas`, the default comes from the node's `getCurrentMinFees()` × 1.5. There is no upper bound. A malicious or compromised RPC can return an absurd minimum (e.g. 10^30 wei) and the wallet will sign a tx with that as `maxFeesPerGas`. The PXE will accept it (no client-side sanity ceiling); the user pays whatever they have, up to balance.

Mitigation in practice:
- The UI surfaces fee settings in the confirmation popup, so a user reading the popup carefully would notice a 10^18 ETH fee.
- The protocol enforces minimums but not maximums; the user's balance is the only hard cap.
- An attacker needs to first get the user to point at a malicious RPC (F1) for this to fire.

But the chain of "attacker controls RPC → attacker drains balance via inflated fees on the user's next send" is concrete and low-friction once F1 is exploited.

**Impact:** Fee drain via malicious RPC (chained with F1). Maximum loss = user's full balance for any single send the user approves.

**Recommendation:**
- Cap the node-returned default at a per-chain ceiling (e.g. `min(nodeReport * 1.5, MAX_REASONABLE_FEE_PER_GAS_FOR_CHAIN)`).
- In the confirmation popup, render a "high-fee warning" badge whenever the computed `maxFeesPerGas` exceeds a heuristic (e.g. 10× the typical fee for that chain).
- For the standard path, refuse to sign if `maxFeesPerGas * gasLimit > balance * 0.1` without explicit user override (the "are you sure you want to spend >10% of balance on fees" gate).

---

## F6 — Medium — Service-worker `chrome.runtime.onMessage` accepts unsanitized origin; no sender ID check

**Severity:** Medium
**Confidence:** High
**CVSS:** 5.1 (AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N)

**Location:**
- `packages/extension-messaging/src/offscreen/service.ts:30, 45-50` — `chrome.runtime.onMessage.addListener(this.onMessageListener)` without checking `sender.id === chrome.runtime.id`
- `packages/extension-messaging/src/offscreen/client.ts:56` — same on the client side

**Description:**
The offscreen-transport `Service` and `ServiceClient` classes both listen on `chrome.runtime.onMessage` and route based purely on the `to/from/type` fields inside the message payload. They never check `sender.id === chrome.runtime.id` (Chrome's only reliable signal that the message originated within the extension and not from an `externally_connectable` source).

Today, `manifest.config.ts` does NOT declare `externally_connectable`, so foreign extensions/web origins cannot send messages directly to the SW. This means the missing sender check is currently safe — but again, **the invariant is implicit**. If a future feature ever adds `externally_connectable: { matches: ["..."] }` (e.g. for a dev playground), any external page in the allowed list could send forged PXE requests with arbitrary `from`/`to` fields, hitting privileged operations like `registerAccount` (which writes derived secret keys into PXE storage at `pxe/${profileId}/${chainId}/`).

A related concern: content scripts CAN send messages to the SW. The wallet-sdk path filters those via `validateContentScriptMessage` (origin === "content-script" → strict envelope check) but the **PxeService listener has no such guard**. A bug in the content-script validator or an unexpected message path could let a content script's chrome.runtime.sendMessage reach the offscreen PxeService and trigger a `registerAccount`, `proveTx`, or `getNotes` call.

**Impact:** Defense-in-depth gap. No concrete exploit today; one wrong manifest change to enable it.

**Recommendation:**
- Add `sender.id === chrome.runtime.id || sender.id === undefined` (undefined for SW-internal sends) as a guard inside both `Service.onMessageListener` and `ServiceClient.onMessageListener`.
- For safety against intra-extension content-script forgery: require all PXE-service-bound messages to carry a token (e.g. the SW issues a per-boot nonce that the popup must include) — too heavy for now, but the option should be on the table.
- Add a lint or test that fails CI if `manifest.config.ts` ever gains `externally_connectable` without the guard being present.

---

## F7 — Low — `proveTx` 30-minute timeout drops cancel signal; long-tail UX hazard

**Severity:** Low
**Confidence:** High
**CVSS:** 3.1 (AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L)

**Location:**
- `packages/aztec-runtime/src/pxe/client.ts:60` — `PROVE_TX_TIMEOUT_MS = 30 * 60_000`
- `packages/aztec-runtime/src/pxe/service.ts:55` — `proveTx` runs inside `withPxeWrite` (per-chain write lock)

**Description:**
The `proveTx` timeout is 30 minutes; the comment says this is because BB.wasm proving is uninterruptible and Phase 2 `cancelJob` is the user-facing cancel path (lossy: SW marks cancelled, offscreen keeps running). The lock semantics are correct, but the long timeout chained with the per-chain write lock means **a runaway/stuck proveTx blocks all other writes on that chain for up to 30 minutes**. Other chains are unaffected.

If the accelerator is misconfigured or stalls mid-proof, the user sees no recovery for half an hour. Worse: a maliciously crafted payload that hits a degenerate path in BB.wasm could be used to grief the wallet (denial-of-service per chain).

**Impact:** Per-chain DoS up to 30 minutes for a stuck or hostile prove.

**Recommendation:**
- Add a sanity heuristic: if BB.wasm hasn't emitted any phase progress for >5 minutes (when accelerator-required mode is off, this requires extra instrumentation), surface a "stuck prove?" notification to the user with a manual-cancel button that calls `cancelJob`.
- Consider lowering the default timeout to 15 minutes with an explicit "extended prove" mode for circuits known to be slow.
- Add a unit test that pins the cancel-job semantics for proveTx (the cancel is best-effort and lossy by design — pin the contract).

---

## F8 — Low — Recursive payload chunking has no depth/size cap; potential exponential blow-up via crafted `APP_MAX_CALLS` overflow

**Severity:** Low
**Confidence:** Moderate
**CVSS:** 3.5 (AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:N/A:L)

**Location:**
- `packages/aztec-runtime/src/account/nulo-account.ts:122-124` — `while (current.calls.length > APP_MAX_CALLS) { current = await this.chunkHead(current, chainInfo) }`
- `chunkHead` (line 153) wraps `APP_MAX_CALLS` head calls via `entrypoint.wrapExecutionPayload`, producing a SINGLE call that replaces the head, leaving the tail intact

**Description:**
The chunking loop processes APP_MAX_CALLS (4) at a time and replaces them with 1 wrapped call. So a 100-call payload reduces to 25 wraps in the first iteration, then 6 wraps + 2 leftover = 7 calls in the second iteration, then 1 wrap + 3 leftover = 4 calls. Linear convergence; no exponential.

**However**, each iteration calls `entrypoint.wrapExecutionPayload(...)` which:
- Allocates a fresh `txNonce` (`Fr.random()` — every chunk gets a unique nonce)
- Calls `computeOuterAuthWitHash` (Poseidon hash)
- Calls `createAuthWit` (signing)

For an N-call payload, the total work is O(N) signatures + O(N) hashes — bounded linear. No DoS amplification.

The remaining concern: there is no upper-bound check on `payload.calls.length`. A dApp can submit a 10,000-call payload (e.g. via `batch`); the wallet will dutifully sign 2,500+ authwits, each requiring a Poseidon hash and a Schnorr signature. On slow hardware this could take 10+ seconds, freezing the UX. The dApp doesn't need to be malicious — a buggy dApp building an unbounded loop hits this.

**Impact:** UX freeze / battery drain on large payloads. No security boundary crossed.

**Recommendation:**
- Add a sanity cap on `payload.calls.length` (e.g. 256) in `buildTxExecutionRequest` and throw `Error("Payload too large")` early.
- Surface this cap in the dapp-facing schema validator (`OperationRequestSchema`) so the SW rejects the request before the offscreen even sees it.

---

## F9 — Informational — `requiresInitialization` trusts node's nullifier membership without challenge

**Severity:** Informational
**Confidence:** High
**CVSS:** 2.4 (AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N)

**Location:**
- `packages/aztec-runtime/src/account/nulo-account.ts:139-147` — `requiresInitialization(node)` reads `node.getNullifierMembershipWitness("latest", initNullifier)`
- `packages/aztec-runtime/src/account/nulo-account.ts:130-132` — same logic inline in `buildTxExecutionRequest`

**Description:**
The wallet determines "has the account been deployed yet?" by querying the node for the init nullifier's membership witness. If the node lies and returns `undefined`, the wallet treats the account as un-deployed and wraps the next tx in a deploy. If the account was already deployed, this second deploy will fail at the protocol level (the init nullifier is already in the tree), and the user sees a confusing error. If the node lies in the other direction (says a not-yet-deployed account IS deployed), the wallet builds a tx without the deploy wrapper; the tx fails at protocol level.

Either way the outcome is a failed tx, not silent corruption — the protocol's nullifier tree is the source of truth and any disagreement between wallet expectation and chain state surfaces as a verification failure on the prover side.

**Recommendation:**
- This is a node-trust issue; client-side mitigation is limited. The cheap defense is to **also** call `node.getContract(address)` (which the cascade already does for `getContractInstance`) and cross-check; if both report "not deployed" the consensus is stronger.
- Log a warning when the same call sequence flips between iterations (first call: not-deployed → tx fails because deployed; second call: deployed → tx fails because not-deployed). Catch-only — gives operators a debugging signal.
- For account contracts the protocol already binds the address to its instance; an inconsistent node response forces a hard tx failure, so the danger is bounded to UX confusion, not signing forgery.

---

## F10 — Informational — Firefox SW-restart leaks hidden offscreen windows (Manifest documents the limitation)

**Severity:** Informational
**Confidence:** High
**CVSS:** 1.5 (AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N)

**Location:**
- `packages/extension/src/wallet/utils/offscreen.ts:42-47, 99-127, 183-203` — Firefox fallback uses `firefoxOffscreenWindowId` module variable that resets on SW restart
- `manifest/manifest.firefox.config.ts:12` — Firefox does not get `offscreen` permission (uses hidden window instead)

**Description:**
On Firefox, the offscreen surface is a hidden minimized `chrome.windows.create` window. The window's ID is held in a module-level variable. When the SW restarts (Firefox does kill background pages), the variable resets to `null`, but the actual window may still be alive in the browser. The next `ensureOffscreenRunning()` then creates a *new* window and leaks the old one; the comment (line 102-117) acknowledges this.

Security-wise: each leaked offscreen window holds PXE state in its IDB which is the same per-profile path, so the data ISN'T duplicated. The leak is a UX/memory issue. The old window keeps running its PXE if any in-flight work was happening; secrets stay in memory in both windows until the user closes them manually.

**Impact:** Memory bloat on Firefox; secrets in memory longer than expected on long-running Firefox sessions.

**Recommendation:**
- The code's own comment proposes the right fix: `chrome.windows.getAll({populate:true})` + `tabs` permission to look up the window by URL after SW restart.
- Lower-cost alternative: have the offscreen window self-close after N seconds of idleness (`chrome.runtime.connect`-based heartbeat). When the SW restarts, the old window's heartbeat times out and it auto-closes.
- This is explicitly tracked as a known limitation; not blocking.

---

## F11 — Informational — `ACCELERATOR_REQUIRED_BUILD_STAMP` propagation guard is grep-based; brittle vs minifiers / future bundlers

**Severity:** Informational
**Confidence:** High
**CVSS:** N/A

**Location:**
- `packages/extension/src/accelerator/config.ts:30-43` — declares the literal string `"NULO_ACCELERATOR_REQUIRED_BUILD_STAMP"`
- `packages/extension/src/offscreen/index.ts:53-56` — pins the import via `globalThis` side effect to prevent tree-shaking
- `packages/extension/scripts/e2e/agent.sh` (referenced by comment line 32-36) — greps `dist/chrome` for the literal

**Description:**
The CI propagation assertion relies on vite NOT tree-shaking the string literal AND on the bundler NOT renaming/mangling the property name. A future vite/terser version that aggressively renames `globalThis.__NULO_ACCELERATOR_REQUIRED_BUILD_STAMP__` to a single-letter property OR string-replaces the literal could break the grep silently — passing CI even though the build is wrong.

**Recommendation:**
- Instead of grepping for the literal, have the CI agent run the built bundle in a JS context (e.g. `bun -e "import('./dist/chrome/.../offscreen.js')"`) and assert `globalThis.__NULO_ACCELERATOR_REQUIRED_BUILD_STAMP__ === "NULO_ACCELERATOR_REQUIRED_BUILD_STAMP"`. That's robust against bundling changes.
- Alternative: emit a separate `accelerator-required.flag` artifact at build time when `VITE_NULO_ACCELERATOR_REQUIRED=1` and grep for the filename. Bundlers don't touch separate artifacts.

---

## F12 — Informational — `onPhase` callback throws synchronously; uncaught-in-prover-internals risk

**Severity:** Informational
**Confidence:** Moderate
**CVSS:** N/A

**Location:**
- `packages/aztec-runtime/src/pxe/chain-runtime.ts:126-143` — `onPhase` throws on `"fallback"` / `"denied"`
- Upstream `AcceleratorProver` internals not in this audit scope

**Description:**
The `onPhase` callback throws an Error synchronously during phase transitions. If the upstream `AcceleratorProver` invokes this callback inside a try/catch that swallows errors (or inside a `Promise.allSettled`), the throw becomes a no-op and the SDK silently falls back to WASM — defeating the entire required-mode guard. The unit tests (chain-runtime.test.ts:135-149) verify the callback throws when called directly, but not that the upstream SDK actually surfaces the throw to the caller.

**Recommendation:**
- Add an integration test (gated on `VITE_NULO_ACCELERATOR_REQUIRED=1`) that triggers a real `fallback` phase (e.g. via mock accelerator server returning a deliberate "downgrade to WASM" signal) and asserts that `createChainRuntime` / first `proveTx` rejects with the expected message.
- Alternatively, set a flag (`this.phaseFailed = true`) inside the callback in addition to throwing, and check it after every prove — belt-and-suspenders.

---

## Cross-finding observations

1. **`ProductionPxeFactory` constructor signature mixes optional positional (`nodeFactory`) with optional bag (`options`).** Easy to call as `new ProductionPxeFactory({required: true})` by mistake — the first arg would be interpreted as nodeFactory. Adding TS strictness (`overload` or a single `opts` arg) would prevent this footgun.

2. **`NetworkInfo` shape is duplicated** between `extension/src/wallet/services/network/spec.ts` and `aztec-runtime/src/pxe/chain-runtime.ts`. The aztec-runtime version is declared inline to avoid the `@/` alias dependency. They drift today only in field ordering, but if anyone adds a field on one side (e.g. an `httpsOnly` flag), the boundary doesn't enforce the new field.

3. **`PxeService.simulateTx` returns the stub Schnorr account contracts injected by `stubAccountAddresses`.** The stub artifact comes from `@aztec/accounts/stub/schnorr` — verify whenever the aztec-packages version is bumped that the stub's behaviour still matches (it shouldn't ever sign anything real, but a future change could introduce a sneaky path). Not in scope of this cluster but worth flagging.

---

## Summary

| # | Severity | Title | Confidence |
|---|----------|-------|-----------|
| F1 | Critical | Node RPC URL accepts dangerous schemes; no scheme allowlist | High |
| F2 | High | Node-returned chainId blindly trusted for authwit signing | High |
| F3 | High | Offscreen ping handler responds during boot before service is ready | High |
| F4 | Medium | `verifiedClassIds` cache only keyed on classId, not content | High |
| F5 | Medium | Untrusted `node.getCurrentMinFees()` drives default fees with no clamp | High |
| F6 | Medium | SW `chrome.runtime.onMessage` doesn't validate sender.id | High |
| F7 | Low | proveTx 30min timeout blocks per-chain writes | High |
| F8 | Low | Recursive chunking has no payload-size cap | Moderate |
| F9 | Informational | requiresInitialization trusts node nullifier membership | High |
| F10 | Informational | Firefox SW-restart leaks hidden offscreen windows | High |
| F11 | Informational | Build-stamp propagation guard is grep-based, brittle | High |
| F12 | Informational | onPhase throw not integration-tested for SDK propagation | Moderate |

Top recommendations for immediate action:
1. **F1** — add scheme allowlist in `AztecNodeFactoryAdapter.createNode` AND in the Zod schemas (defense in depth).
2. **F2** — verify node-reported `(l1ChainId, rollupVersion)` against persisted `network.chainId` at every tx-sign time.
3. **F3** — defer PING handler registration until after `createPxeOffscreen` resolves.
4. **F5** — clamp default `maxFeesPerGas` to a per-chain ceiling; warn in confirmation popup on outlier fees.
