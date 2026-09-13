Verified against `62f3456a`. No files were modified. Independent conclusions were recorded before reading the full findings. Runtime checks used source transpiled in memory with mocked external dependencies; no real witnesses, browser windows, or network requests were used.

### F-09 — Production prover accepts an unauthenticated loopback HTTP accelerator

**Independent read (before reading the trace):**

- Production supplies no accelerator policy, and the factory constructs `AcceleratorProver` without `httpsOnly`: `apps/extension/src/offscreen/index.ts:107-115`, `packages/aztec-runtime/src/pxe/chain-runtime.ts:228-229`.
- The SDK initially permits HTTP and accepts a health response based on its JSON shape: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-transport.ts:363-379,201-205`.
- Private execution steps are serialized and posted; the request carries content/version headers but no peer-authentication mechanism: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-prover.ts:407-426`, `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-transport.ts:740-758`.

**Verdict:** **CONFIRMED.** The gap exists when HTTP is selected before this transport instance has established healthy HTTPS.

**Comparison with finding:** The core trace matches. Two statements need narrowing: HTTP is not freely available after HTTPS has worked, and an arbitrary returned error does not necessarily trigger WASM fallback. The exact witness contents listed in the finding were not independently established because the serializer implementation is outside the permitted dependency reads.

**Strengthened trace:**

1. Production passes `factory: undefined` at `apps/extension/src/offscreen/index.ts:107-115`. The default factory is selected at `packages/aztec-runtime/src/pxe/service.ts:166`; it constructs and installs the accelerator prover at `packages/aztec-runtime/src/pxe/chain-runtime.ts:228-248`.
2. Default host/ports are loopback `59833`/`59834`; absent an explicit option or environment flag, HTTPS-only remains false: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-prover.ts:68-70,109-148`. The extension’s defined `process.env` supplies no HTTPS-only override: `apps/extension/vite.config.ts:330-337`.
3. With HTTPS refused and HTTP returning `200 {"status":"ok","api_version":1}`, the transport chooses HTTP: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-transport.ts:201-205,603-605,669-677`.
4. That versionless health response is accepted and its protocol pinned: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-prover.ts:243-246,302-329`.
5. On proving, the SDK serializes the execution steps and posts them to the selected endpoint: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-prover.ts:392,407,426` → `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-transport.ts:745-758`.

**Concrete preconditions:** A local process controls the HTTP port, supplies the recognized health response, HTTPS does not win negotiation, and the unlocked wallet performs a proof.

**Existing controls:** Loopback validation restricts location, not process identity. Redirect rejection prevents forwarding to another endpoint. Previously healthy HTTPS prevents subsequent plaintext negotiation under the default policy: `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-transport.ts:455-479,519-538`. These controls do not authenticate the initially selected HTTP responder.

**Verification result:** The actual transport selected HTTP and posted an unchanged synthetic byte array with only `content-type` and `x-aztec-version`. Both explicit HTTPS-only mode and previously healthy HTTPS produced zero HTTP requests. Serialization of a real witness was not exercised.

The finding’s blanket error-fallback statement is too broad: network failures fall back, while HTTP errors receive separate classification and may propagate, at `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-prover.ts:516-530`.

**Severity check:** **Keep Medium.** Private execution material reaches an unauthenticated local peer, but exploitation requires local port control and a proof; master/signing-key disclosure is unproven.

**Fix check:** Explicitly setting `accelerator.httpsOnly: true` is the smallest direct correction for this HTTP path. The SDK already supports it at `apps/extension/node_modules/@alejoamiras/aztec-accelerator/src/lib/accelerator-prover.ts:109-114`, with unavailable-accelerator fallback at `:351-355`. HTTP-only or untrusted-certificate installations will fall back to WASM, affecting proving performance. Verify HTTPS browser permissions/CORS and CI-required proving behavior; the current manifest explicitly grants HTTP loopback access at `apps/extension/manifest/manifest.config.ts:20`. CA provisioning was not inspected.

**Confidence:** **High** for the HTTP disclosure mechanism: source trace and transport probes agree.

### F-18 — Discovery caps omit reconnect verification windows and duplicate waiters

**Independent read (before reading the trace):**

- Existing sessions are auto-approved before the cap check: `apps/extension/src/wallet/services/wallet-sdk/background.ts:647-650,670`.
- Same-tuple duplicates await one popup without counting their individual requests; caps count only popup-map keys: `apps/extension/src/wallet/services/wallet-sdk/background.ts:663-668,718,748-751`.
- Every live established session backed by an untrusted stored row opens a verification window, without window accounting: `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:94-145`.

**Verdict:** **CONFIRMED** for both the verification-window gap and uncapped duplicate waiters.

**Comparison with finding:** Both local traces match. “Zero interaction” applies after the initial connection approval, while the wallet is unlocked and the session remains valid. Actual browser exhaustion and unlimited upstream handshake admission were not demonstrated.

**Strengthened trace:**

1. Discovery callbacks enter `handleDiscovery` at `apps/extension/src/wallet/services/wallet-sdk/background.ts:334-338`.
2. An unlocked profile and a remembered session permit the existing-session branch: `apps/extension/src/wallet/services/wallet-sdk/background.ts:627-650`. The session lookup enforces profile, origin, chain and expiration at `apps/extension/src/wallet/services/dapp-session/service.ts:128-137`.
3. Fresh discoveries are approved at `apps/extension/src/wallet/services/wallet-sdk/background.ts:701-703`, bypassing `checkDiscoveryPopupCaps` at `:670`.
4. After successful SDK key exchange, the registered callback invokes establishment validation: `apps/extension/src/wallet/services/wallet-sdk/background.ts:340-355`.
5. With a valid row and live transport, `trustedVerification` unset makes `needsVerification` true; a new window is created at `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:94-154`. Normal confirmation leaves trust unset unless the checkbox is selected: `apps/extension/src/popup/windows/verify/index.vue:72-76`.

**Concrete preconditions:** A previously approved origin, an unlocked profile, a non-expired session without trusted verification, and repeated fresh discoveries completing key exchange.

**Duplicate-waiter trace:** With no stored session and one pending popup for the tuple, each fresh request reaches `awaitPendingPopupDedupe` before cap enforcement: `apps/extension/src/wallet/services/wallet-sdk/background.ts:647-670`. Each waits at `:718`; the shared promise resolves when the original popup flow finishes at `:833-835`. The cap observes one map entry regardless of waiter count.

**Existing controls:** Freshness, profile binding, revocation checks and transport liveness remain enforced at `apps/extension/src/wallet/services/wallet-sdk/background.ts:687-703` and `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:89-137`. They do not count fresh reconnects or verification windows.

**Verification result:** Actual local handlers, with mocked SDK/browser boundaries, processed **33 discoveries and established-session callbacks**, yielding **33 approvals and 33 window-creation calls**, while the connect-popup map remained empty. A trusted reconnect created no additional window. Separately, **65 duplicate requests remained pending behind one popup promise** and settled when that promise resolved.

**Severity check:** **Keep Medium, low end.** The window path supports repeated browser/UI resource allocation after prior approval; the waiter-only component remains lower impact and lifetime-dependent.

**Fix check:** The recommendation needs refinement:

- Moving the existing cap check earlier is insufficient: remembered-session requests never increase the map it counts.
- Reserve capacity for pending/open verification windows before asynchronous creation, and reject or terminate excess unverified sessions. Release reservations on creation failure and window closure.
- Bound same-tuple waiters before awaiting the shared promise.
- Do not merely focus an earlier verification window for a different transport session. Its hash is intentionally session-specific: `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:49-51,148`.

Mirror reject-new admission at `packages/wallet-bridge/src/discovery-queue.ts:68-81` and window reservation/cleanup at `apps/extension/src/wallet/services/window-manager/window-manager.ts:79-138`. Preserve profile separation and each session’s verification hash; legitimate concurrent connections are the main regression risk.

**Confidence:** **High** for the local allocation gaps: independently reproduced. Browser-level exhaustion and SDK admission limits remain unmeasured.

### F-08 — Simulation fast path authorizes by name without binding the selector

**Independent read (before reading the trace):**

- Simulation scope checks use only caller-supplied `to` and `name`: `packages/wallet-bridge/src/method-scope-checkers.ts:143-170,391-393`.
- The dispatcher forwards `exec` unchanged, and the fast path selects calls using wire `type`/`isStatic` followed by schema parsing: `packages/wallet-bridge/src/dispatcher.ts:1467-1474`, `apps/extension/src/wallet/services/execution/fast-path.ts:96-110`.
- No local ABI lookup or name–selector comparison occurs before forwarding the selected calls to `simulateViaNode`: `apps/extension/src/wallet/services/execution/view-executor.ts:275-289`, `apps/extension/src/wallet/services/execution/fast-path.ts:200-211`.

**Verdict:** **PARTIALLY CONFIRMED.** The Nulo-side authorization/binding gap is confirmed. Acceptance by the actual SDK schema and execution of the alternate selector were not independently verified.

**Comparison with finding:** The local trace matches. The finding’s final statement that the alternate selector executes exceeds this verification’s evidence: neither `FunctionCall.schema` nor the implementation of `simulateViaNode` is named as an eligible dependency file. No local step refuted the finding; those two dependency steps remain unverified.

**Strengthened trace:**

1. A session-authorized `simulateTx` request passes capability and scope enforcement at `packages/wallet-bridge/src/dispatcher.ts:650-651,711-719`. Its registered checker is `checkSimulateTx`: `packages/wallet-bridge/src/method-descriptors.ts:262-265`.
2. For a grant allowing function A on contract C, a call carrying `to:C, name:A` passes regardless of its selector: `packages/wallet-bridge/src/method-scope-checkers.ts:166-170`.
3. The operation retains that execution payload at `packages/wallet-bridge/src/dispatcher.ts:1467-1474` and routes to the view executor at `apps/extension/src/wallet/services/execution/service.ts:635-637`.
4. Wire `type:"public"` and `isStatic:true` qualify it for prefix parsing at `apps/extension/src/wallet/services/execution/fast-path.ts:96-110`. **Actual SDK parser acceptance remains unverified.**
5. Assuming successful parsing and valid node/header/fee prerequisites, the selected calls reach `simulateViaNode` without a Nulo-side binding check: `apps/extension/src/wallet/services/execution/view-executor.ts:275-289` → `apps/extension/src/wallet/services/execution/fast-path.ts:175-211`. **Actual alternate-function execution remains unverified.**

**Concrete input/preconditions:** A valid simulation grant and authorized account; one well-shaped call naming permitted function A but carrying the selector and valid arguments of another public static function B on the same contract. A pure-public-static payload avoids the mixed-payload account-initialization fallback at `apps/extension/src/wallet/services/execution/view-executor.ts:252-269`.

**Existing controls:** Account/from checks, active-profile requirements and live-chain validation still apply at `apps/extension/src/wallet/services/execution/view-executor.ts:224-225,248-250` and `apps/extension/src/wallet/services/execution/fast-path.ts:175-179`. None binds the claimed name to ABI identity.

**Verification result:** The actual scope checker accepted the same allowed name with two distinct selectors and rejected a different name. Actual fast-path orchestration forwarded supplied calls unchanged to a mocked `simulateViaNode`, without invoking the standard arm. The SDK parser and real contract execution were deliberately not exercised.

**Severity check:** **Keep Low provisionally.** The established issue is a scope-control gap; this trace establishes no private-data disclosure, signature creation or persistent state change.

**Fix check:** Resolving the ABI before `runFastPath` is appropriate. Mirror the closer simulation pattern at `apps/extension/src/wallet/services/execution/view-executor.ts:361-381`: resolve instance/artifact, find the selector’s function, reject a name mismatch, and construct execution metadata from the ABI. Also derive public/static eligibility from that ABI; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:569-596` already follows this pattern.

Artifact resolution can add latency and reject calls previously simulated without a locally available artifact. Preserve valid mixed-prefix behavior and keep binding failures outside infrastructure-fallback handling.

**Confidence:** **Moderate overall; high for the local missing binding.** Full confirmation requires inspecting or exercising the two excluded SDK components.