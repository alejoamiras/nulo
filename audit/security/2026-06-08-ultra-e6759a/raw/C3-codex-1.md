# C3 — Extension-messaging IPC layer (Codex xhigh Pass 1)

## Findings

### Finding 1 — Background `Service` trusts port name alone, so any same-extension content-script context can invoke privileged wallet RPCs

**Title**: `packages/extension-messaging/src/background/service.ts` accepts a `chrome.runtime.Port` solely by `client.name === this.name`, with no `client.sender` validation. Any code executing in a Nulo content-script context can open raw ports to background services and call privileged methods outside the wallet-sdk dispatcher.

**Impact factors**:
- CIA+A: **Confidentiality**, **Integrity**, and **Availability**.
- Blast radius: every background service inheriting this base class.
- Exploitability: requires execution in a same-extension content-script context; once there, no popup or additional authorization is enforced by the transport.

**Evidence confidence**: **high** — direct source trace through the base transport plus concrete privileged service sinks.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-285** (Improper Authorization), **CWE-863** (Incorrect Authorization).

**Trace** (source → sink):
1. The extension injects a content script into every frame on every `*://*/*` page at document start: `packages/extension/manifest/manifest.config.ts:31-37`.
2. That content-script context has direct `chrome.runtime.*` access; the shipped relay already uses `chrome.runtime.sendMessage(...)`: `packages/extension/src/content-script/content.ts:11-18`.
3. Background `Service.onConnect` accepts any port whose `name` matches the service name and performs no `client.sender.id`, `client.sender.url`, `client.sender.tab`, or context-type checks: `packages/extension-messaging/src/background/service.ts:40-47`.
4. The accepted port is then allowed to drive request dispatch: `packages/extension-messaging/src/background/service.ts:62-76`.
5. Concrete privileged sinks exist behind that transport. For example, `ProfileService.getProfiles()` enumerates profiles at `packages/extension/src/wallet/services/profile/service.ts:99-101`, and `ProfileService.deleteProfile(id)` deletes a profile at `packages/extension/src/wallet/services/profile/service.ts:521-537`.

**Missing control**: the base transport never authenticates the caller as an allowed extension page. It should reject content-script ports (`sender.tab` present) and restrict accepted senders to an explicit extension-page allowlist.

**Exploit story**:
1. Attacker-controlled code executes in the Nulo content-script context on a visited page.
2. It opens `chrome.runtime.connect(undefined, { name: "profile" })`.
3. It sends a raw RPC envelope for `getProfiles`, learns one or more profile ids, then sends `deleteProfile(id)`.
4. The base transport accepts the port and dispatches both calls directly to `ProfileService`.
5. The victim loses the profile and the downstream cleanup cascade fires.

**Preconditions**:
- The attacker can execute inside a same-extension content-script context.
- The wallet is installed.
- The targeted background service is registered, which is the normal steady state for the service worker.

**Why mitigations fail**:
- The wallet-sdk content-script validator only protects the `chrome.runtime.onMessage` wallet-sdk path in `packages/extension/src/wallet/services/wallet-sdk/background.ts:119-132`; raw `Port` traffic to background `Service` instances bypasses that seam entirely.
- Service names are stable and easy to discover from source and bundles.
- The transport performs no second-layer authorization once the port is accepted.

**Instances**:
- `packages/extension-messaging/src/background/service.ts:40-47`
- `packages/extension-messaging/src/background/service.ts:62-76`
- `packages/extension/manifest/manifest.config.ts:31-37`
- `packages/extension/src/content-script/content.ts:11-18`
- `packages/extension/src/wallet/services/profile/service.ts:99-101`
- `packages/extension/src/wallet/services/profile/service.ts:521-537`

---

### Finding 2 — Offscreen `Service` trusts `to` and attacker-chosen `from`, exposing PXE RPC directly to same-extension contexts

**Title**: `packages/extension-messaging/src/offscreen/service.ts` accepts any `chrome.runtime.sendMessage` envelope whose `to` matches the service name, then routes the response to an unverified attacker-controlled `from` field. That exposes the offscreen `pxe` service directly to same-extension content-script callers.

**Impact factors**:
- CIA+A: **Confidentiality** and **Integrity**, with follow-on **Availability** via destructive PXE operations.
- Blast radius: the entire offscreen PXE surface, including private-state reads and mutation methods.
- Exploitability: requires execution in a same-extension content-script context; no popup or session-layer authorization is enforced by the transport.

**Evidence confidence**: **high** — direct trace through the offscreen base class into concrete PXE methods.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-285**, **CWE-863**, **CWE-200** (Exposure of Sensitive Information).

**Trace** (source → sink):
1. A same-extension content script can send runtime messages and register an `onMessage` listener: `packages/extension/src/content-script/content.ts:11-18`.
2. Offscreen `Service.onMessageListener` checks only `message.to === this.name` and discards the real `sender` entirely: `packages/extension-messaging/src/offscreen/service.ts:45-49`.
3. `onMessage` accepts any truthy `message.from`, dispatches the method, and returns the response to `to: message.from`: `packages/extension-messaging/src/offscreen/service.ts:52-83`.
4. The offscreen PXE implementation exposes direct private-state and mutation methods, including `getRegisteredAccounts` at `packages/aztec-runtime/src/pxe/service.ts:232-233`, `getNotes` at `packages/aztec-runtime/src/pxe/service.ts:264-266`, `getPrivateEvents` at `packages/aztec-runtime/src/pxe/service.ts:359-366`, `simulateTx` at `packages/aztec-runtime/src/pxe/service.ts:283-337`, and `clearChainState` at `packages/aztec-runtime/src/pxe/service.ts:399-427`.

**Missing control**: the offscreen transport never binds the logical caller id (`from`) to the actual `chrome.runtime.MessageSender`. The listener should validate the sender and refuse content-script senders before the method dispatch occurs.

**Exploit story**:
1. Attacker-controlled code executes in the Nulo content-script context.
2. It installs a `chrome.runtime.onMessage` listener that filters for `to === "attacker"`.
3. It sends `chrome.runtime.sendMessage({ type: Request, to: "pxe", from: "attacker", content: { method: "getNotes", ... } })`.
4. Offscreen `Service` executes `PxeService.getNotes(...)` and emits the response to `to: "attacker"`.
5. The attacker receives private note data without going through the service worker’s dApp/session authorization path.

**Preconditions**:
- The attacker can execute inside a same-extension content-script context.
- The offscreen document is live, or becomes live through normal wallet use before the attack.
- The relevant PXE runtime for the targeted profile/chain has been initialized or can be initialized by the request.

**Why mitigations fail**:
- `from` is treated as an opaque return address, not an authenticated identity.
- The listener signature omits `sender`, so there is no current chance to reject content-script callers.
- The service worker’s wallet-sdk validation does not protect this offscreen path.

**Instances**:
- `packages/extension-messaging/src/offscreen/service.ts:45-49`
- `packages/extension-messaging/src/offscreen/service.ts:52-83`
- `packages/aztec-runtime/src/pxe/service.ts:232-233`
- `packages/aztec-runtime/src/pxe/service.ts:264-266`
- `packages/aztec-runtime/src/pxe/service.ts:283-337`
- `packages/aztec-runtime/src/pxe/service.ts:359-366`

---

### Finding 3 — Dispatch is not a whitelist: inherited `emit()` is remotely callable, enabling forged internal events and destructive subscriber cascades

**Title**: both background and offscreen services set `requests = this`, gate dispatch with `method in this.requests`, and call `this.requests[method](...)`. That makes inherited methods reachable at runtime. In the background path, the most serious reachable inherited method is the protected base-class `emit()`, which lets an attacker forge internal service events and trigger destructive cross-service subscribers.

**Impact factors**:
- CIA+A: **Integrity** and **Availability**.
- Blast radius: all background services with event subscribers; a forged event can drive downstream cleanup or UI state changes without the corresponding state mutation happening first.
- Exploitability: requires access to the background transport from Finding 1; no further auth checks are applied once the request is dispatched.

**Evidence confidence**: **high** — direct base-class trace plus concrete subscriber graph.

**OWASP / CWE mapping**: A01:2021 Broken Access Control + A04:2021 Insecure Design — **CWE-470** (Use of Externally-Controlled Input to Select Code), **CWE-863**.

**Trace** (source → sink):
1. `requests` is the service instance itself, not a standalone map: `packages/extension-messaging/src/background/service.ts:17-18` and `packages/extension-messaging/src/offscreen/service.ts:22-23`.
2. Dispatch admission is `method in this.requests`, which walks the prototype chain: `packages/extension-messaging/src/background/service.ts:68` and `packages/extension-messaging/src/offscreen/service.ts:58`.
3. The selected member is then invoked directly: `packages/extension-messaging/src/background/service.ts:76` and `packages/extension-messaging/src/offscreen/service.ts:73`.
4. Base-class `emit()` is therefore remotely callable: `packages/extension-messaging/src/background/service.ts:104-116` and `packages/extension-messaging/src/offscreen/service.ts:142-155`.
5. Forging `ProfileService.emit("onProfileDeleted", profileInfo)` is destructive because multiple services subscribe to that event:
- `AccountService`: subscription at `packages/extension/src/wallet/services/account/service.ts:31-35`
- `ContactService`: subscription at `packages/extension/src/wallet/services/contact/service.ts:42-45`, destructive handler at `packages/extension/src/wallet/services/contact/service.ts:256-266`
- `NetworkService`: subscription at `packages/extension/src/wallet/services/network/service.ts:158-163`, purge path at `packages/extension/src/wallet/services/network/service.ts:575-588`
- `DappSessionService`: subscription at `packages/extension/src/wallet/services/dapp-session/service.ts:38-40`, deletion path at `packages/extension/src/wallet/services/dapp-session/service.ts:313-318`
- `FpcService`: subscription at `packages/extension/src/wallet/services/fpc/service.ts:59-64`, destructive handler at `packages/extension/src/wallet/services/fpc/service.ts:448-456`
- `PxeService`: subscription at `packages/aztec-runtime/src/pxe/service.ts:161-163`, destructive handler at `packages/aztec-runtime/src/pxe/service.ts:470-490`

**Missing control**: method dispatch should use an explicit allowlist of RPC-callable methods, not the service instance and prototype chain. Internal helpers like `emit`, `ensureInitialized`, and logging methods must never be addressable by transport input.

**Exploit story**:
1. The attacker reaches the background transport from Finding 1.
2. It calls `getProfiles()` to obtain a valid `ProfileInfo` payload.
3. It sends a raw request with `method: "emit"` and params `["onProfileDeleted", profileInfo]` to the `"profile"` service.
4. Base `emit()` broadcasts the forged event and invokes the local `EventHandler`.
5. Subscribers in account/contact/network/dapp-session/FPC/PXE services delete related state and clear PXE databases even though the profile deletion path was never legitimately executed.

**Preconditions**:
- Access to a background service port.
- Knowledge of a valid event name and payload shape. For profile events, `getProfiles()` provides the payload shape directly.

**Why mitigations fail**:
- TypeScript `protected` is compile-time only; `emit()` is a normal runtime method.
- `method in this.requests` includes inherited methods from both `Service.prototype` and `Object.prototype`.
- JS semantics confirm the mapper’s suspicion: `toString` and `hasOwnProperty` are callable inherited methods; `__proto__` reaches the prototype object but throws instead of mutating it. The whitelist is still broken because inherited members are in scope at all.

**Instances**:
- `packages/extension-messaging/src/background/service.ts:17-18`
- `packages/extension-messaging/src/background/service.ts:68-76`
- `packages/extension-messaging/src/background/service.ts:104-116`
- `packages/extension/src/wallet/services/profile/service.ts:66`
- `packages/extension/src/wallet/services/profile/service.ts:533`
- `packages/extension/src/wallet/services/account/service.ts:31-35`
- `packages/extension/src/wallet/services/contact/service.ts:42-45`
- `packages/extension/src/wallet/services/network/service.ts:158-163`
- `packages/aztec-runtime/src/pxe/service.ts:161-163`
- `packages/aztec-runtime/src/pxe/service.ts:470-490`

---

### Finding 4 — `unwrapParams` is an unauthenticated O(maxIndex) allocation sink

**Title**: `unwrapParams()` expands the sparse numeric-key object into a dense array from `0..maxKey`. A single crafted request like `{0: "x", 100000000: "y"}` forces a 100,000,001-iteration loop and huge allocation before any real method logic runs.

**Impact factors**:
- CIA+A: **Availability**.
- Blast radius: both background and offscreen transports; every RPC method is affected because param unwrapping happens before dispatch.
- Exploitability: one raw crafted request is sufficient; repeated requests sustain denial of service.

**Evidence confidence**: **high** — direct code path; no speculative control flow.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-400** (Uncontrolled Resource Consumption).

**Trace** (source → sink):
1. Background and offscreen request validation only check `typeof wrappedParams === "object"`: `packages/extension-messaging/src/background/service.ts:67-69`, `packages/extension-messaging/src/offscreen/service.ts:57-59`.
2. Both transports call `unwrapParams(wrappedParams)` before entering the service-method `try/catch`: `packages/extension-messaging/src/background/service.ts:72`, `packages/extension-messaging/src/offscreen/service.ts:62`.
3. `unwrapParams` converts object keys to numbers, computes `array_max(keys)`, then loops `for (let i = 0; i <= max; i++)`: `packages/extension-messaging/src/utils.ts:10-20`.
4. `array_max` returns the largest positive numeric key with no bound enforcement: `packages/wallet-core/src/utils/arrays.ts:13-20`.

**Missing control**: the transport never validates that params are a small dense tuple. It should reject nulls, non-plain objects, negative indices, non-integer indices, and any max index above a tiny fixed cap.

**Exploit story**:
1. The attacker reaches either transport from Finding 1 or Finding 2.
2. It sends a valid-looking RPC envelope with a real method name and `params: { "0": "x", "100000000": "y" }`.
3. `unwrapParams` allocates and fills a huge dense array before dispatch.
4. The service worker or offscreen document stalls, throws, or gets restarted by the browser.
5. Repeating the request sustains denial of service.

**Preconditions**:
- Ability to send a raw request to either transport.
- No unlock or wallet state is required.

**Why mitigations fail**:
- The transport uses a numeric-object encoding but never enforces tuple density.
- `typeof wrappedParams !== "object"` still admits pathological sparse objects and even `null`.
- The allocation happens before service-specific validation can reject the request.

**Instances**:
- `packages/extension-messaging/src/background/service.ts:67-72`
- `packages/extension-messaging/src/offscreen/service.ts:57-62`
- `packages/extension-messaging/src/utils.ts:10-20`
- `packages/wallet-core/src/utils/arrays.ts:13-20`

---

### Finding 5 — No connection caps, in-flight caps, or backpressure: a same-extension caller can exhaust the IPC layer with many ports or many expensive requests

**Title**: the IPC layer imposes no limits on connected background ports, no per-client in-flight request cap, and no queue/backpressure for expensive offscreen calls. A hostile same-extension caller can open large numbers of ports and issue many concurrent long-running requests.

**Impact factors**:
- CIA+A: **Availability**.
- Blast radius: background service worker responsiveness, offscreen PXE responsiveness, and any UI depending on them.
- Exploitability: straightforward once the attacker can access the transport; does not require malformed payloads.

**Evidence confidence**: **high** — direct source trace.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-400** (Uncontrolled Resource Consumption).

**Trace** (source → sink):
1. Background `Service` stores clients in an unbounded array: `packages/extension-messaging/src/background/service.ts:13`, pushes each accepted port at `packages/extension-messaging/src/background/service.ts:44-47`, and fan-outs events to all clients at `packages/extension-messaging/src/background/service.ts:112-114`.
2. Background requests are handled by an async listener with no pending-request cap or serialization: `packages/extension-messaging/src/background/service.ts:62-76`.
3. Offscreen requests are accepted fire-and-forget: `packages/extension-messaging/src/offscreen/service.ts:45-48`.
4. Every offscreen request starts its own keepalive interval until completion: `packages/extension-messaging/src/offscreen/service.ts:65-69`.
5. The offscreen sink includes expensive methods such as `proveTx`, `simulateTx`, `executeUtility`, and `getPrivateEvents`: `packages/aztec-runtime/src/pxe/service.ts:268-366`.

**Missing control**: neither transport enforces per-sender connection limits, per-client in-flight request limits, or a bounded queue for expensive work.

**Exploit story**:
1. The attacker reaches the background or offscreen transport.
2. It opens hundreds of ports to one or more background services, or sends many concurrent PXE requests.
3. Background services retain the ports and process requests concurrently; offscreen requests each hold keepalive state and expensive runtime work.
4. Legitimate popup and service-worker traffic competes with the attacker flood and becomes slow, timing out or failing.
5. The browser may eventually restart the service worker, but the attacker can re-establish the flood immediately.

**Preconditions**:
- Ability to call the IPC transport.
- No malformed payloads are required; normal small requests suffice.

**Why mitigations fail**:
- The base classes assume all callers are trusted extension pages.
- There is no admission control at connection time.
- There is no backpressure once the connection exists.

**Instances**:
- `packages/extension-messaging/src/background/service.ts:13`
- `packages/extension-messaging/src/background/service.ts:44-47`
- `packages/extension-messaging/src/background/service.ts:62-76`
- `packages/extension-messaging/src/background/service.ts:112-114`
- `packages/extension-messaging/src/offscreen/service.ts:45-48`
- `packages/extension-messaging/src/offscreen/service.ts:65-69`
- `packages/aztec-runtime/src/pxe/service.ts:268-366`

## Non-findings

- `dispatch("__proto__", ...)` does reach the prototype chain, but it does **not** create a prototype-pollution sink here. The value resolved at `__proto__` is a prototype object, not a callable function, so the result is a `TypeError`, not mutation.
- `dispatch("toString", ...)` and `dispatch("hasOwnProperty", ...)` do resolve inherited `Object.prototype` methods. That confirms the whitelist failure behind Finding 3, but the concrete impact I found comes from reachable inherited service methods like `emit()`, not from `__proto__` itself.
- I did **not** find any `Object.assign({}, methods)`-style request-table construction in this package. The specific `JSON.parse(... "__proto__" ...)` → `Object.assign` prototype-pollution variant is therefore absent from the audited code.
- `wrapParams` / `unwrapParams` are **not** a prototype-pollution surface in the current implementation. They do not copy `__proto__` into fresh objects or mutate prototypes. Their real problem is sparse-index expansion and null-handling, i.e. availability, not integrity.
- The `jsonStringify` fallback in `packages/extension-messaging/src/background/service.ts:139-185` and `packages/extension-messaging/src/offscreen/service.ts:99-138` serializes from `response.content.result`, not from thrown-error envelopes. Ordinary service-side exceptions still go out as flat `error` strings plus optional `WalletError` payloads.
- `walletErrorFromPayload()` preserves `details` for known and unknown error codes (`packages/extension-messaging/src/errors.ts:220-245`), but it does not instantiate attacker-chosen classes, execute code, or mutate prototypes. Its risk is data exposure only if a service already chooses to put sensitive material in `details`.
- `lazy-listener` has a bounded buffer (`DEFAULT_MAX_BUFFERED = 100`) and drops oldest entries on overflow, so I did not find an unbounded-memory bug in the helper itself. The remaining risk is message loss / startup-time availability pressure if a consumer attaches it to an untrusted source.
- `subscribeWithSnapshot` is not used with offscreen clients in the current repo snapshot. I did not find a concrete exploitable security bug in present usage; the helper looks sound for the port-backed/background-client pattern it currently supports.
- Current offscreen `PxeService` defines no event surface, so the offscreen client’s unauthenticated broadcast-event acceptance is a latent hardening gap rather than a present concrete exploit in this codebase snapshot.

Primary fixes: add sender authentication to both base transports, replace `method in this.requests` with an explicit RPC allowlist, and bound `unwrapParams` to a small dense tuple shape. Secondary hardening is connection/request backpressure.
