CLUSTER: messaging-boundary

Scope: `packages/extension-messaging/src/**` — cross-context RPC plumbing (Service/ServiceClient bases, wire schema, offscreen transport, Error reconstruction). One handoff hop taken into `apps/extension/src/content-script/content.ts`, the manifest, and the `@aztec/wallet-sdk` `ContentScriptConnectionHandler` to establish reachability.

## Findings

### [1] Service transport listeners perform NO sender/origin validation — the entire cross-context RPC surface trusts any first-party-visible sender

**Impact factors**
- Property violated: Authorization / integrity of the privileged RPC dispatch surface (every popup↔SW Port service and every SW↔offscreen service is built on these two base listeners).
- CIA+A: Authorization (missing origin/authenticity check at a trust-boundary listener). If reached, an attacker invokes registered RPC methods on privileged services without going through the wallet-bridge capability/approval layer.
- Blast radius if reached: all users, system-wide (the base classes are generic plumbing reused by every current and future service).
- Data sensitivity: high (offscreen hosts PXE + WebCrypto key derivation; Port services own session/profile/execution state).
- Exploitability of the *code fact*: attack vector = local/extension-message bus; complexity = low; privileges required = none in principle; user interaction = none. **BUT current reachability from a web attacker is BLOCKED — see "Why mitigations (currently) hold".** This is a latent/defense-in-depth gap, not a live exploit.

**Evidence confidence**: high for the code fact (there is provably no `sender` check); high that current external reachability is blocked (verified manifest + SDK relay).

**OWASP / CWE**: OWASP A01:2021 (Broken Access Control) / A08 (Software & Data Integrity). CWE-346 (Origin Validation Error); related CWE-940 (Improper Verification of Source of a Communication Channel), CWE-862 (Missing Authorization).

**Trace (source → sink)**
- Background Port server: `packages/extension-messaging/src/background/service.ts:36` `onConnect = (client) => { if (client.name !== this.name) return; ... }` — the ONLY gate is a caller-supplied port `name`. `client.sender` (`.id` / `.origin` / `.tab` / `.url`) is never inspected. → `service.ts:41` registers `onMessage` → `service.ts:58-64` `onMessage` validates only envelope shape (`type`/`content`) → `service.ts:63` `void this.handleRequest(message.content, client)` → `packages/extension-messaging/src/core/base-service.ts:81` `handleRequest` → allowlist check (`base-service.ts:90-97`) → `base-service.ts:111` `this.invoke(methodName, params)` → `base-service.ts:124-126` `(this as Record<string,fn>)[method](...params)` (dispatch into the concrete service).
- Offscreen server: `packages/extension-messaging/src/offscreen/service.ts:36` `onMessageListener = (message): boolean => { if (typeof message === "object" && message !== null && message.to === this.name) this.onMessage(message) }` — the Chrome `sender` argument is **not even bound**; the only gate is a caller-supplied `to` string. → `offscreen/service.ts:43-49` `onMessage` (checks `type`/`from`/`content` shape only) → `offscreen/service.ts:48` `this.handleRequest(message.content, message.from)` → same `base-service.ts` dispatch chain as above.

**Missing control**: neither listener checks `sender.id === chrome.runtime.id` (nor an origin allowlist, nor `sender.tab === undefined` to reject content-script/tab senders on the offscreen bus). The port `name` (background) and the `to` string (offscreen) are attacker-suppliable values, not authenticity proofs. Authenticity of the peer is assumed from "it reached my first-party listener", with no in-layer verification.

**Exploit story / violation scenario** (the conditions under which this becomes live):
1. A future change adds `externally_connectable` to the manifest (e.g. to let a companion site `nulo.sh` talk to the extension). External pages matching the pattern can now `chrome.runtime.connect(extId, {name})` / `sendMessage(extId, …)`. For `connect`, Chrome routes to `onConnectExternal`; for the Port server to be hit the change would also have to register there — but the *pattern* of "any sender with the right name" is now one wiring mistake from privileged dispatch.
2. OR a second content script (or an SDK relay change) forwards a page-controlled object that carries a top-level `to` equal to an offscreen service name, or opens an arbitrary-named Port. Because the content script is injected into **every** frame of **every** origin (`manifest.config.ts:31-38`, `matches: ["*://*/*"]`, `all_frames: true`), any malicious page would then drive offscreen/Port RPC dispatch.
3. In either case, the attacker sends `{ to: "<offscreen-service-name>", from: "x", type: 2, content: { requestId: 1, method: "<registered method>", params: {…} } }` (offscreen) or connects a Port named `<service>` and posts a `Request`. The allowlist (`rpcMethods`) still bounds *which* methods, but the attacker now reaches every declared RPC of a privileged service directly, bypassing the wallet-bridge capability/scope/approval layer that normally fronts dApp calls.

**Preconditions**: one of — `externally_connectable` added; a new/changed page→extension relay that lets a page influence a top-level `to`/port-name; or the SDK `ContentScriptConnectionHandler` envelope changing to pass a page-controlled routing field. None hold today.

**Why mitigations (currently) hold** — and why they are external to this package:
- `apps/extension/manifest/manifest.config.ts` sets **no `externally_connectable`** (grep-confirmed repo-wide: no `externally_connectable` / `onMessageExternal` / `onConnectExternal` anywhere). External web pages therefore cannot address the extension's `onMessage`/`onConnect` at all; their messages would land on `*External` listeners that are never registered.
- The sole page→extension relay is `apps/extension/src/content-script/content.ts`, which delegates to `@aztec/wallet-sdk` `ContentScriptConnectionHandler`. That handler (verified in the installed dist) only accepts `window.postMessage` with `event.source === window` and `data.type === DISCOVERY`, and forwards to `chrome.runtime.sendMessage` a **fixed envelope** `{ origin: "content-script", type: "secure-message"|"discovery-request"|…, sessionId, content: <pageData> }`. The page's data is nested under `.content`; the page cannot set a top-level `to` (so the offscreen `message.to === this.name` guard fails: `undefined !== serviceName`) and the content script never calls `chrome.runtime.connect` (so the Port server is unreachable from a page).
- `web_accessible_resources` exposes only `logo.png` — no injected in-page provider script a page could message.
- The net effect: the safety of the whole cross-context RPC boundary rests on invariants that live **outside** this package (the manifest, and a third-party SDK's relay-envelope shape). This layer — the generic base every service inherits — provides zero defense of its own. A `sender.id === chrome.runtime.id` guard on both listeners is a one-line, cost-free hardening that makes the boundary self-protecting instead of implicitly-protected.

**Instances**
- `packages/extension-messaging/src/background/service.ts:36-44` (`onConnect` — port-name-only gate, no `sender` check).
- `packages/extension-messaging/src/background/service.ts:58-64` (`onMessage` — shape-only, sender never consulted).
- `packages/extension-messaging/src/offscreen/service.ts:36-41` (`onMessageListener` — `sender` argument not bound; `to`-only gate).
- `packages/extension-messaging/src/offscreen/service.ts:43-49` (`onMessage` — shape-only, sender never consulted).

## Notes — surface checked and found clean (with reasoning)

**Dynamic dispatch is a true allowlist, not arbitrary-property reach.** `base-service.ts:90-97` requires `methodName ∈ rpcMethods ∪ frameworkRpcMethods` (both `ReadonlySet<string>`) BEFORE `invoke` at `base-service.ts:124-126`. `rpcMethods` is built by `defineRpcMethods<TMethods>()(...)` (`core/rpc-methods.ts:23-29`), a curried helper whose variadic type forces the name list to be exactly the keys of the service's `Methods` interface (fails-closed at compile time). Hostile names (`__proto__`, `constructor`, `prototype`, `hasOwnProperty`, `valueOf`, `toString`, framework `start`/`emit`, trailing-space `"echo "`) are all dropped — verified by `core/hardening.test.ts:125-140`. Reaching a prototype/inherited method would require a service author to explicitly declare it as a typed RPC (their bug, not this layer's).

**Event dispatch is likewise an allowlist-in-practice.** `base-client.ts:204-211` `handleEvent` looks up `this[event]` but only invokes when `handler instanceof EventHandler` AND `event ∉ reservedEventNames`. Forged `constructor`/`__proto__`/`toString` names resolve to non-`EventHandler` values → dropped; reserved lifecycle handlers (`onConnected`/`onDisconnected`, reserved at `background/client.ts:37`) are excluded so a forged event cannot drive reconnect/subscription logic. Verified `core/hardening.test.ts:67-81, 155-168`.

**Message-shape validation is present and DoS-hardened.** `handleRequest` (`base-service.ts:90-104`) requires `requestId` to be a positive safe integer (NaN/Infinity/float/string/object dropped, not echoed) and `params` to be a non-null object. `unwrapParams` (`utils.ts:22-29`) reads only the contiguous `0..n` prefix, capped at `MAX_RPC_ARITY = 256`, closing the prior `{999999999:"x"}` ~10^9-iteration loop (verified `hardening.test.ts:185-201`). Envelope guards on both clients (`background/client.ts:86-90`, `offscreen/client.ts:60-77`) drop malformed/typeless messages.

**Error reconstruction is prototype-pollution-safe.** `walletErrorFromPayload` (`errors.ts:220-246`) switches on `payload.code` and constructs typed errors via constructors that pass `message` to `super()` and store `details` as a plain property — no `Object.assign` from an attacker object, no dynamic key writes, no `__proto__` assignment. `CapabilityNotGrantedError` reads only `details.capabilityType`. `buildErrorResponseContent` (`core/error-response.ts:21-25`) only projects `code`/`message`/`details`. Reconstruction is invoked by `makeRemoteError` (`background/client.ts:134-141`, `offscreen/client.ts:113-117`) whose input arrives only from a trusted first-party peer (see Finding 1 reachability). No pollution vector.

**JSON round-trip does not prototype-pollute.** `decode.ts:14-16` `decodeResult` uses bare `JSON.parse` (no reviver); `jsonSanitize`/`jsonStringify` (`packages/wallet-core/src/utils/serialization.ts:26-57`) use a replacer only, no reviver. A `__proto__` key round-trips as an own data property, never invoking the prototype setter. `resultIsJson` is decoded only for `typeof result === "string"` and fails closed on malformed JSON (`base-client.ts:178-188`, verified `hardening.test.ts:170-183`).

**Offscreen SW-side client uses a 64-bit random `uid` as correlation capability** (`offscreen/client.ts:38,62,104`) and requires `message.from === this.service` for events — an unguessable target that a page-relayed message cannot address; response injection needs the trusted offscreen peer.

**Late/duplicate/replayed responses are idempotently dropped** (`base-client.ts:230-246` `settle`, verified `hardening.test.ts:83-97`); no double-settle.

**No `eval` / `new Function` / dynamic `import()` of message data anywhere in the cluster** (grep-confirmed).

**Surface note (not a finding):** `frameworkRpcMethods = new Set(["backup","restore"])` (`background/service.ts:23`) exposes `backup`/`restore(...args)` on EVERY Port service, with `restore` taking arbitrary args (`background/service.ts:96-98`). What `restore` does is per-service (out of this cluster). Reachable only by a first-party Port connector today; flagged here so the bridge/services clusters (4/10) confirm no lower-trust caller can reach a state-mutating `restore` override.

**Telemetry is safe.** `offscreen/telemetry.ts:87-99` `sanitizeTelemetry` whitelists `detail` to a static category set and coerces field types before any sink; untrusted `error.message`/stacks/payloads are never forwarded (`onTerminal` at `offscreen/client.ts:138-152`). Sink throws are swallowed and cannot affect the request lifecycle.
