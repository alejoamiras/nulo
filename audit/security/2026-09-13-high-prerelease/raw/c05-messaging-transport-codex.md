Files read: all 58 assigned non-test files in full, plus context, maps, relevant tests and handoff evidence; HEAD `62f3456af552b40fed7aa8bfe5e0b838ffe3d720`.
Findings: 3.
Non-findings: 18.

### F-1: Flattened RPC errors bypass URL redaction and expose endpoint credentials in logs

1. **Title:** Flattened RPC errors bypass URL redaction and expose endpoint credentials in logs.

2. **Impact factors:** Confidentiality loss affecting credentials embedded in custom RPC URL paths or queries. Credentials enter the in-memory log, console output and log exports; with `developerMode` enabled, they also enter `chrome.storage.session`. Exploitation requires access to those diagnostics or a shared export. Logging itself needs no attacker: an ordinary endpoint failure triggers it. Complexity is low once a credential-bearing endpoint is configured. No signing-key or recovery-phrase disclosure was demonstrated.

3. **Evidence confidence:** **High.** A read-only reproduction using the production fetch helper and production redactor confirmed that an HTTP 401 error contains synthetic URL credentials, that passing the `Error` object removes them, and that the PXE-style conversion to a string retains them.

4. **OWASP / CWE mapping:** OWASP **A09:2025 — Security Logging and Alerting Failures**, which explicitly includes sensitive information written to logs. **CWE-200**, present in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html); the more specific mechanism is CWE-532. [OWASP A09](https://top10.owasp.org/2025/A09_2025-Security_Logging_and_Alerting_Failures/).

5. **Trace:**
   - Production node creation accepts an HTTPS RPC URL and supplies the custom fetch implementation: `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:32`, `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:50`.
   - Dispatch failures and non-success HTTP responses interpolate the **complete** `host` URL into the error: `packages/aztec-runtime/src/utils/fetch.ts:74`, `packages/aztec-runtime/src/utils/fetch.ts:89`.
   - PXE read/write failures reach `logOpFailure`, which extracts the error message into a string before logging: `packages/aztec-runtime/src/pxe/service.ts:913`, `packages/aztec-runtime/src/pxe/service.ts:926`, `packages/aztec-runtime/src/pxe/service.ts:960`. The best-effort contract lookup has the same conversion at `packages/aztec-runtime/src/pxe/service.ts:352`.
   - Across the logger RPC handoff, the client applies `trim`, then the service forwards into the store: `apps/extension/src/wallet/services/logger/client.ts:20`, `apps/extension/src/wallet/services/logger/service.ts:22`.
   - `trim` scrubs URLs in actual `Error` objects, but returns primitive strings unchanged: `apps/extension/src/wallet/logger/utils.ts:169`, `apps/extension/src/wallet/logger/utils.ts:193`, `apps/extension/src/wallet/logger/utils.ts:263`.
   - The resulting string is retained and broadcast at `apps/extension/src/wallet/logger/store.ts:68`; developer-mode persistence writes it under `nulo:logs` at `apps/extension/src/wallet/logger/store.ts:107`. Logs are retrievable at `apps/extension/src/wallet/services/log-viewer/service.ts:23` and exportable at `apps/extension/src/components/JsonViewer/LogsViewer.vue:141`.

6. **Missing control:** The error-to-string boundary lacks sanitization. Preserve `Error` objects until the existing projection runs, and remove URL credentials when constructing fetch errors. Logging entry points must also cover credential-bearing string arguments; checking object key names cannot protect interpolated strings.

7. **Violation scenario:** Configure an endpoint such as `https://rpc.example.invalid/v2/AUDIT_SENTINEL?api_key=AUDIT_QUERY`. A request receives a JSON HTTP 401 response. The fetch helper produces an error containing the complete URL. PXE converts that error to a string and logs it at Error level. A subsequent diagnostic export includes the credentials. The read-only reproduction returned:

   ```json
   {
     "productionFetchIncludesCredential": true,
     "errorObjectProjectionRemovesCredential": true,
     "pxeStyleFlattenedLogRetainsCredential": true
   }
   ```

8. **Preconditions:** A configured endpoint contains credentials in its path or query, and an affected RPC operation fails. Reading the leaked value requires diagnostic access or receipt of an export. Persistence across worker restarts additionally requires `developerMode`; exposure in the live ring buffer does not.

9. **Why mitigations fail:** HTTPS protects the network exchange, not the subsequently logged URL. `URL_KEYS`, secret-name matching and `projectError` work on shapes that the flattening operation removes. Applying `trim` twice does not help because both passes preserve strings. Disabling developer-mode retention reduces lifetime but leaves live logs and exports exposed.

10. **Instances:** The demonstrated RPC-error instances are `packages/aztec-runtime/src/utils/fetch.ts:76`, `packages/aztec-runtime/src/utils/fetch.ts:78`, `packages/aztec-runtime/src/utils/fetch.ts:89`, `packages/aztec-runtime/src/pxe/service.ts:352`, and `packages/aztec-runtime/src/pxe/service.ts:926`. The same flatten-before-redaction pattern also occurs at:
    - `packages/aztec-runtime/src/pxe/service.ts:207`.
    - `packages/extension-messaging/src/core/base-service.ts:115` and `packages/extension-messaging/src/core/base-service.ts:152`.
    - `packages/extension-messaging/src/background/client.ts:61`; `packages/extension-messaging/src/background/service.ts:91` and `packages/extension-messaging/src/background/service.ts:97`.
    - `apps/extension/src/core/adapters/clock-ticker-adapter.ts:39`.
    - `apps/extension/src/wallet/index.ts:77`, `apps/extension/src/wallet/index.ts:97`, `apps/extension/src/wallet/index.ts:109`.
    - `apps/extension/src/offscreen/index.ts:63`; `apps/extension/src/wallet/logger/console-forwarding.ts:19`.
    - `apps/extension/src/wallet/runtime.ts:168`, `:172`, `:189`, `:257`, `:573`, `:577`, `:580`, `:592`, `:611`.

    These additional sites share the bypass; a credential-bearing error source was established specifically for the RPC paths above, not independently for every platform-error site.

### F-2: Store-key provisioning exposes the PXE decryption key to unrelated extension pages

1. **Title:** Store-key provisioning exposes the PXE decryption key to unrelated extension pages.

2. **Impact factors:** Confidentiality loss of a profile’s 32-byte PXE storage key to an over-privileged same-extension page. The key is usable for that profile’s encrypted PXE stores and can be retained beyond the unlock that supplied it. This requires execution in a popup, onboarding tab or another page belonging to **this extension**, active during provisioning. Passive capture is low complexity; later replay requires an applicable store/runtime state. An ordinary website, another extension, or the normal content-script relay does not obtain the broadcast. The transferred key is not the profile master or an account signing key.

3. **Evidence confidence:** **High** for key exposure and the receiving authorization gap, based on production code and browser messaging semantics. Replay acceptance is established from the handler; a complete browser/OPFS replay was not executed.

4. **OWASP / CWE mapping:** OWASP **A01:2025 — Broken Access Control**; **CWE-200**, present in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). The over-broad audience is an exposure-through-sent-data mechanism. [OWASP A01](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/).

5. **Trace:**
   - The SW derives the profile store key after obtaining the unlocked profile secret: `apps/extension/src/wallet/runtime.ts:536`, `apps/extension/src/wallet/runtime.ts:542`, `apps/extension/src/wallet/runtime.ts:544`.
   - The PXE client base64-encodes it as an ordinary RPC parameter: `packages/aztec-runtime/src/pxe/client.ts:198`.
   - The transport sends the envelope using untargeted `chrome.runtime.sendMessage`: `packages/extension-messaging/src/offscreen/client.ts:135`. The `to: "pxe"` property is application data, not a browser-enforced recipient.
   - Browser delivery exposes the message to other extension frames. It does **not** deliver this extension-to-extension broadcast to content scripts; those require `tabs.sendMessage`. [Chrome runtime messaging](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendMessage), [Mozilla runtime messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage).
   - On replay, the receiver accepts any sender satisfying the broad internal-extension predicate: `packages/extension-messaging/src/offscreen/service.ts:38`, `packages/extension-messaging/src/core/sender-auth.ts:17`.
   - `provisionChainStoreKey` installs a correctly sized key for an unseen or same-generation live profile without consulting the current wallet session: `packages/aztec-runtime/src/pxe/service.ts:775`, `packages/aztec-runtime/src/pxe/service.ts:794`, `packages/aztec-runtime/src/pxe/service.ts:804`. The supplied key is subsequently passed to the encrypted store opener at `packages/aztec-runtime/src/pxe/opfs-store.ts:114`.

6. **Missing control:** Key provisioning needs a channel restricted to the intended background/offscreen peers, rather than an extension-wide broadcast. The receiving endpoint also needs to bind provisioning authority to that channel and its current incarnation. Merely adding `isTrustedInternalSender` to more listeners would still authorize unrelated pages belonging to this extension.

7. **Exploit story:** A compromised same-extension popup registers an `onMessage` listener. When an unlocked profile first provisions its PXE, the popup copies the `provisionChainStoreKey` parameters. That capture alone discloses the storage key. If the profile later locks and the offscreen document is recreated while its encrypted stores remain, the page can resend the captured provision envelope. The fresh handler has no lifecycle entry and accepts it. A subsequent applicable PXE operation can use the reinstalled key without passing through the SW’s locked-profile key provider.

8. **Preconditions:** Same-extension page execution is an explicit prerequisite; no initial XSS or page-to-popup execution exploit was found in this cluster. Capture requires a provision while the page is alive. The cold-replay scenario additionally requires surviving encrypted data and an offscreen state that accepts the captured generation. It does not require a forged browser `sender.id`.

9. **Why mitigations fail:** Sender authentication checks who **sent** a request; it cannot retract a key already delivered to other extension listeners. Base64 adds no confidentiality. Zeroing the original byte array at `packages/aztec-runtime/src/pxe/client.ts:207` cannot erase recipients’ copies. `pxeGeneration` fences deletion/reimport races but is not an unlock epoch or recipient authorization. The legitimate client’s fresh-generation checks are bypassed by a raw same-extension RPC. The offscreen lifecycle map is memory-only.

10. **Instances:** Secret production at `apps/extension/src/wallet/runtime.ts:536`; encoding/provisioning at `packages/aztec-runtime/src/pxe/client.ts:198`; extension-wide request delivery at `packages/extension-messaging/src/offscreen/client.ts:135`; broad recipient-side authorization at `packages/extension-messaging/src/offscreen/service.ts:38`; replay installation at `packages/aztec-runtime/src/pxe/service.ts:775`. This report identifies one store-key provisioning path shared by the extension PXE clients.

### F-3: Offscreen replies and lifecycle signals accept messages from the wrong context

1. **Title:** Offscreen replies and lifecycle signals accept messages from the wrong context.

2. **Impact factors:** Integrity loss through substituted PXE results or error classifications, and availability loss through false readiness/health signals. A compromised same-extension popup can observe request routes and race responses. A compromised content script can spoof readiness without knowing any request route; response substitution additionally requires learning or guessing the client UID and pending request ID. The normal page relay cannot produce these outer envelopes. No signature, approval or cryptographic-verification bypass was demonstrated.

3. **Evidence confidence:** **High.** Read-only executions of the actual client and readiness functions accepted forged messages carrying content-script-shaped sender metadata. Tests used browser mocks and synthetic values, not a running browser extension.

4. **OWASP / CWE mapping:** OWASP **A07:2025 — Authentication Failures**; **CWE-306 — Missing Authentication for Critical Function**, present in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). [OWASP 2025 categories](https://top10.owasp.org/2025/).

5. **Trace:**
   - **Response substitution:** `packages/extension-messaging/src/offscreen/client.ts:60` never receives or checks `sender`; it routes by attacker-supplied `to`, then checks attacker-supplied `from` at `:68` → `packages/extension-messaging/src/core/base-client.ts:194` looks up the pending request → `:215` settles it with the supplied result. An empty array survives the concrete `getNotes` result schema at `packages/aztec-runtime/src/pxe/client.ts:274`.
   - **Forged errors:** The same response entry reaches `packages/extension-messaging/src/core/base-client.ts:200` → `packages/extension-messaging/src/errors.ts:397` → `packages/extension-messaging/src/errors.ts:360`, which reconstructs a supplied `JOB_CANCELLED` payload as `JobCancelledError`.
   - **False readiness:** `apps/extension/src/wallet/utils/offscreen.ts:97` accepts the literal `OFFSCREEN_READY` without sender verification → clears the timeout and resolves the gate at `:100` → `:390` and `:404` allow the ensure operation to finish, including while creation is unresolved.
   - **False health:** `apps/extension/src/wallet/utils/offscreen.ts:170` accepts the literal `OFFSCREEN_PONG` without sender verification → `:174` returns healthy → `:359` skips replacement of the existing document.
   - **Firefox lifetime control:** `apps/extension/src/wallet/utils/offscreen.ts:79` treats same-extension, no-tab senders as the background owner → `apps/extension/src/offscreen/index.ts:35` closes the window for a different token. That predicate also admits another same-extension context without `sender.tab`.

6. **Missing control:** Responses and lifecycle messages must authenticate the intended peer using browser-supplied context identity and bind messages to the current document/request incarnation. Request IDs and `from`/`to` fields provide correlation, not authentication. Firefox adoption additionally needs to distinguish the background owner from other same-extension contexts.

7. **Exploit story:** A compromised same-extension popup observes a pending `getNotes` request and sends this response before the real PXE response:

   ```js
   {
     type: 3,
     from: "pxe",
     to: observedRequest.from,
     content: {
       requestId: observedRequest.content.requestId,
       result: []
     }
   }
   ```

   The pending request resolves with an empty notes array; the later legitimate response is discarded because the request is already settled. Replacing `result` with `errorPayload: { code: "JOB_CANCELLED", message: "cancelled" }` produces the corresponding typed rejection.

   Separately, a compromised content script can send `OFFSCREEN_READY` during creation, or `OFFSCREEN_PONG` during a health probe. These messages require no UID. They can cause the SW to dispatch into an unavailable or unready PXE and wait for ordinary RPC deadlines instead of completing the intended recovery.

   On Firefox, a compromised same-extension action popup with no `sender.tab` can send `{type: "OFFSCREEN_ADOPT_INSTANCE", token: "different"}` and cause the hidden PXE window to close. Knowing the current token is unnecessary: the closing condition is inequality, not proof of possession.

8. **Preconditions:** Response spoofing requires a pending operation, matching routing values and winning the response race. A popup can observe the broadcast request; no content-script route-discovery path was established. Readiness spoofing requires raw content-script or extension-page execution and timing against a pending ensure operation. Firefox closure requires a token-bearing fallback window and a same-extension sender without a tab. Ordinary website JavaScript is insufficient.

9. **Why mitigations fail:** The service-side sender check protects requests entering the PXE, not messages returning to its client. The client UID is eight random hex characters, generated at `packages/extension-messaging/src/offscreen/client.ts:38`; it is exposed in every request and is not a secret capability. Result schemas reject malformed shapes but accept plausible false values such as `[]`. The genuine offscreen’s `servicesReady` check does not constrain a different sender. Firefox’s UUID distinguishes background lifetimes but neither authenticates replies nor makes token mismatch an authenticated shutdown instruction.

10. **Instances:** `packages/extension-messaging/src/offscreen/client.ts:60`; `apps/extension/src/wallet/utils/offscreen.ts:97`; `apps/extension/src/wallet/utils/offscreen.ts:170`; and the insufficiently specific Firefox owner predicate at `apps/extension/src/wallet/utils/offscreen.ts:79`, consumed at `apps/extension/src/offscreen/index.ts:35`. The ungated PING responder at `apps/extension/src/offscreen/index.ts:18` is a related control listener, but answering PING alone was not established as an independent security violation.

## Non-findings

- **N-1 — Internal request sender predicate:** **High confidence.** The exact predicate is `sender?.id === chrome.runtime.id && (sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL("")))`; same-extension content scripts still fail because their URL is the web page, while extension pages in tabs intentionally pass (`packages/extension-messaging/src/core/sender-auth.ts:17`).

- **N-2 — Normal page relay cannot select internal RPC destinations:** **High confidence.** The content adapter forwards SDK-created envelopes, not arbitrary outer page objects (`apps/extension/src/content-script/content.ts:11`); the installed SDK rebuilds discovery messages and wraps port messages as `key-exchange-request`, `disconnect-request`, `ping` or `secure-message`, leaving page-controlled fields inside `content` (`apps/extension/node_modules/@aztec/wallet-sdk/src/extension/handlers/content_script_connection_handler.ts:156`, `:172`).

- **N-3 — No direct website/foreign-extension internal entry:** **High confidence.** Broad content-script injection at `apps/extension/manifest/manifest.config.ts:31` does not expose `onMessage` directly to websites; the reviewed manifests declare no `externally_connectable` entry and the reviewed transport installs no external-message listener.

- **N-4 — Prototype method dispatch:** **High confidence.** `handleRequest` checks the explicit method sets before `invoke`; `__proto__`, `constructor`, inherited helpers and undeclared methods fail membership checks (`packages/extension-messaging/src/core/base-service.ts:82`); background services additionally expose the intentional framework methods `backup` and `restore` (`packages/extension-messaging/src/background/service.ts:25`).

- **N-5 — Event-name dispatch:** **High confidence.** Wire events must resolve to an actual `EventHandler` and cannot name reserved connection lifecycle handlers (`packages/extension-messaging/src/core/base-client.ts:230`, `packages/extension-messaging/src/background/client.ts:37`); no arbitrary method invocation or prototype-pollution path was found.

- **N-6 — Request IDs and background-port isolation:** **High confidence.** Requests require positive safe-integer IDs, response lookup uses a `Map` without string coercion, and replies use the originating port (`packages/extension-messaging/src/core/base-service.ts:91`, `packages/extension-messaging/src/core/base-client.ts:194`, `packages/extension-messaging/src/background/service.ts:81`); two mocked ports using ID `1` received only their respective replies.

- **N-7 — Event broadcasting is intentional, not per-port isolation:** **High confidence.** Background service events are sent to every authenticated port for that service (`packages/extension-messaging/src/background/service.ts:85`); popup A can therefore receive the same events as popup B, but ordinary request responses remain separate. No additional unauthorized event audience beyond the documented internal-context trust group was established.

- **N-8 — Arity and pending limits:** **High confidence.** Parameter unpacking is bounded to 256 own positional properties and preserves explicit holes (`packages/extension-messaging/src/utils.ts:34`); it does not enforce each method’s declared arity. Generic pending maps and accepted-port arrays have no count cap (`packages/extension-messaging/src/core/base-client.ts:84`, `packages/extension-messaging/src/background/service.ts:51`); execution backpressure is separate (`apps/extension/src/wallet/services/execution/execution-mutex.ts:99`, `apps/extension/src/wallet/services/execution/execution-lane.ts:293`). No uncapped ordinary-page-to-internal-RPC exhaustion trace was established.

- **N-9 — Serialization gadgets:** **High confidence.** BigInt becomes a decimal string, Buffer becomes base64, Map/Set become JSON-compatible collections, and errors become plain data; decoding uses JSON without a class-instantiating reviver (`packages/wallet-core/src/utils/serialization.ts:26`, `packages/extension-messaging/src/core/decode.ts:1`). No code-execution or global prototype-pollution gadget was found.

- **N-10 — Error reconstruction does not establish successful authorization:** **High confidence.** The constructor switch is closed and unknown codes produce a base `WalletError` (`packages/extension-messaging/src/errors.ts:348`); forged cancellation is covered by F-3, but no reconstructed “already verified” success signal or approval bypass was found. `TOO_MANY_PENDING` reconstructing as a base error is explicitly accommodated by cancellation classification (`apps/extension/src/wallet/services/execution/rpc-cancel.ts:78`).

- **N-11 — Failed unlock envelopes are not dumped:** **High confidence.** The transport logs method/request metadata rather than params, and rejected envelopes use summaries (`packages/extension-messaging/src/core/base-service.ts:96`, `:107`, `:115`; `packages/extension-messaging/src/core/envelope-summary.ts:1`); synthetic passhash/PRF sentinels did not appear in summary output. F-1 concerns error strings, not wholesale request-envelope logging.

- **N-12 — Terminal telemetry excludes request secrets:** **High confidence.** The offscreen client supplies request metadata rather than params/results, and telemetry restricts detail fields (`packages/extension-messaging/src/offscreen/client.ts:150`, `packages/extension-messaging/src/offscreen/telemetry.ts:1`); the synthetic-secret check passed.

- **N-13 — Log viewer stored XSS:** **High confidence.** Log text enters a CodeMirror document as text, and decorations select fixed CSS classes; it is not inserted as HTML (`apps/extension/src/components/JsonViewer/LogsViewer.vue:69`, `apps/extension/src/components/JsonViewer/logs-decoration.ts:7`). An attacker-controlled log string can survive redaction, but no executable HTML sink was found.

- **N-14 — Migration/initialization authorization bypass:** **Moderate confidence.** Module-scope shell listeners and logging exist before the migration gate, but wallet services register only after gate/engine handling and config loading; the dApp handler attaches after `services.start()` (`apps/extension/src/wallet/index.ts:37`, `:58`; `apps/extension/src/wallet/runtime.ts:194`, `:230`, `:239`, `:249`). Popup calls can arrive during service initialization, and there is no universal ready acknowledgment, but inspected sensitive profile operations await initialization (`apps/extension/src/wallet/services/profile/service.ts:2032`); no half-initialized authorization bypass was established.

- **N-15 — Silent session restore checks:** **High confidence for the inspected path.** Restore checks expiry/profile existence, refuses passkey silent restore, rejects legacy passhash/strict-mode/missing-bearer cases, unwraps the profile-bound bearer, rechecks strict mode, verifies the identity-bound envelope MAC, and handles out-of-range master values before activation (`apps/extension/src/wallet/services/profile/session-manager.ts:514`, `:553`, `:564`, `:574`, `:588`, `:612`, `:632`); this is not a claim that every outer session metadata field is MAC-covered.

- **N-16 — Legitimate provision/delete race fences:** **High confidence.** The SW rereads generation after derivation, the client checks it again immediately before provisioning, and the receiver rejects deleting, deleted-same-generation and live-different-generation states (`apps/extension/src/wallet/runtime.ts:551`, `packages/aztec-runtime/src/pxe/client.ts:183`, `:192`, `packages/aztec-runtime/src/pxe/service.ts:794`). Keeping existing PXEs warm across profile changes is deliberate for durable jobs (`packages/aztec-runtime/src/pxe/service.ts:965`); F-2 concerns captured key material and raw replay outside the legitimate provider.

- **N-17 — Disconnect-driven lock theft:** **High confidence.** Port disconnect removes transport listeners and rejects that client’s pending requests; it does not release service locks (`packages/extension-messaging/src/background/service.ts:55`, `packages/extension-messaging/src/background/client.ts:67`). `Lock` ownership tickets prevent stale release of a successor, and read-guard expiry tracks individual tokens (`packages/wallet-core/src/utils/lock.ts:103`, `:152`, `packages/wallet-core/src/utils/rw-guard.ts:148`); no RPC accepts another holder’s ticket or directly force-releases its lock.

- **N-18 — Browser adapter sender stripping:** **High confidence.** The generic Chrome adapter preserves sender metadata for `onMessage` but its adapted port interface omits sender metadata (`apps/extension/src/core/adapters/chrome-browser-api.ts:97`, `:121`); no production consumer of that adapter’s incoming `onConnect` surface was found. The active RPC implementation authenticates the original Chrome port instead.

## Handoff edges followed

The listener inventory below distinguishes endpoint authentication from ordinary message-shape filtering.

| Listener / edge | Gate and consequence |
|---|---|
| Background RPC `onConnect` — `packages/extension-messaging/src/background/service.ts:35` | Service-name match plus `isTrustedInternalSender` at `:45`. All logger/log-viewer/background RPC facades inherit this gate. |
| Background service port `onMessage` — `packages/extension-messaging/src/background/service.ts:50` | Installed only on an admitted port; message type/content checks at `:67`. |
| Background client port `onMessage` — `packages/extension-messaging/src/background/client.ts:53` | Uses the client’s own runtime-created port; no separate per-message sender predicate. |
| Offscreen RPC service `onMessage` — `packages/extension-messaging/src/offscreen/service.ts:35` | Shared internal sender predicate at `:41`; then destination/type checks. Rejects content-script requests, accepts same-extension popup requests. |
| Offscreen RPC client `onMessage` — `packages/extension-messaging/src/offscreen/client.ts:47` | No sender check at `:60`; routing/type checks only. F-3. |
| Toolbar-opening listener — `apps/extension/src/wallet/index.ts:37` | No sender check. A compromised content script can submit `{type:"nulo:open-toolbar-popup"}` and reach `chrome.action.openPopup`; the normal SDK wrapper cannot produce that outer message. No transaction approval follows automatically. |
| Offscreen PING listener — `apps/extension/src/offscreen/index.ts:18` | No sender check; genuine replies require `servicesReady`. |
| READY receiver — `apps/extension/src/wallet/utils/offscreen.ts:97` | Literal match only; F-3. |
| PONG receiver — `apps/extension/src/wallet/utils/offscreen.ts:170` | Literal match only; F-3. |
| Firefox ADOPT listener — `apps/extension/src/offscreen/index.ts:34` | Own extension ID, no tab, differing token; does not identify the exact background owner. F-3. |
| SW content-message relay — `apps/extension/src/wallet/services/wallet-sdk/content-message-relay.ts:79` | SDK origin discriminator; before attachment, validated top-frame discovery only, with 32-global/4-origin bounds and five-second expiry. Live dispatch proceeds through the wallet-SDK handler at `apps/extension/src/wallet/services/wallet-sdk/background.ts:282`. |
| Content-script incoming listener — `apps/extension/src/content-script/content.ts:15` | Delegates to SDK background-message classification. The SDK requires its background discriminator and recognized types; a raw PXE key envelope is not a relay message. |
| Generic browser-adapter listeners — `apps/extension/src/core/adapters/chrome-browser-api.ts:97`, `:121` | Adapter seams, not the production RPC authorization layer; see N-18. |

Firefox’s token is lazily minted with `crypto.randomUUID()` once per background lifetime at `apps/extension/src/wallet/utils/offscreen.ts:57`, placed in the minimized window URL at `:279`, and broadcast for adoption at `:301`. After background restart, both the tracked window ID and token reset, so a fresh window is created and old token-bearing windows self-close on mismatch. The token is an incarnation marker, not a secret or an RPC credential. Ordinary page/content-script and foreign-extension adoption messages fail the sender predicate; another same-extension no-tab context is not excluded. Adoption is fire-and-forget, and READY is not bound to that token.

Additional handoffs inspected were node creation → production fetch errors → PXE logging → logger RPC → store/export; SW key provider → offscreen provision → encrypted OPFS open; profile initialization → session restore; and execution admission → capacity rejection. The installed wallet-SDK handler was inspected only to establish what the production content adapter actually relays.

Read-only checks reproduced the log-redaction bypass, known-route response substitution, typed cancellation substitution, unauthenticated READY/PONG acceptance, same-ID port isolation, event broadcasting, bounded arity, and metadata-only summaries/telemetry. The readiness reproduction returned:

```json
{
  "untrustedPongAdopted": true,
  "untrustedReadyResolvedHangingCreate": true,
  "listenersCleaned": true
}
```

No files were modified. No live browser, full PXE integration test, credential-bearing network request or signing operation was executed.

## Cross-rebuttal

**1. Its findings, one line each**

- **DOWNGRADE Claude F-1 as written to a non-finding:** its proposed website→forged-event trace fails because the SDK constructs fixed outer envelopes (`apps/extension/node_modules/@aztec/wallet-sdk/src/extension/handlers/content_script_connection_handler.ts:156`), and the PXE client has no event handlers (`packages/aztec-runtime/src/pxe/client.ts:82`); the missing sender check is real, but that particular exploit is not. My F-3 retains separately demonstrated response/control-message paths.

**2. What it missed**

- **My F-1 — actual credential leakage:** production HTTP errors include the full endpoint (`packages/aztec-runtime/src/utils/fetch.ts:89`); PXE converts the error to a string (`packages/aztec-runtime/src/pxe/service.ts:927`); the redactor returns strings unchanged (`apps/extension/src/wallet/logger/utils.ts:263`). Its “no sensitive call site found” conclusion misses this concrete path. Existing policy acknowledging interpolation risks does not eliminate the violation.
- **My F-2 — recipient exposure:** provisioning places the base64 key in ordinary RPC parameters (`packages/aztec-runtime/src/pxe/client.ts:198`), then broadcasts them (`packages/extension-messaging/src/offscreen/client.ts:136`). Authenticating the eventual handler does not prevent unrelated same-extension pages from receiving the key.
- **My F-3 — readiness and response substitution:** READY/PONG receivers ignore sender metadata (`apps/extension/src/wallet/utils/offscreen.ts:97`, `apps/extension/src/wallet/utils/offscreen.ts:170`). Compromised content scripts can falsify those signals without knowing a UID. A compromised extension page can observe request routing and race a valid-shaped response accepted at `packages/extension-messaging/src/offscreen/client.ts:60`; `[]` passes `getNotes` validation (`packages/aztec-runtime/src/pxe/client.ts:279`).

**3. What I missed**

No additional finding to adopt. Its useful qualifications—fixed page-relay envelopes, absent PXE events, and the broad predicate’s acceptance of compromised extension pages—were already covered in my report. I **ADOPT its distinction between a missing guard and a demonstrated exploit, high confidence**: adding `isTrustedInternalSender` alone would not resolve my compromised-popup scenarios.

**4. Overconfidence in both reports**

Its broadcast trace incorrectly includes content-script listeners. Extension-originated `runtime.sendMessage` reaches extension frames, excluding the sender, but does not deliver to content scripts; those require `tabs.sendMessage`. Consequently, its SDK incoming filter is not what prevents passive content-script interception. [Chrome runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendMessage).

Its “unguessable UID” argument does not protect against extension-page observers: the UID is transmitted at `packages/extension-messaging/src/offscreen/client.ts:136`. Conversely, I established no content-script route-discovery path and cannot generalize response spoofing to ordinary websites.

Its replay non-finding overstates the receiver’s protection: `profileLifecycles` rejects remembered deleted generations but accepts unseen profiles (`packages/aztec-runtime/src/pxe/service.ts:794`). However, **my F-2 must remain limited to captured keys and surviving stores**: handler acceptance does not prove recovery of successfully erased data. Full locked-store replay was not browser-tested.

Its claim that dangerous names cannot be registered “by construction” is too strong: `defineRpcMethods` checks membership against the declared type and returns a set; it has no reserved-name blacklist (`packages/extension-messaging/src/core/rpc-methods.ts:23`). Current allowlists remain effective.

My F-3’s mock reproductions establish handler behavior, not a complete browser exploit or signing bypass. Firefox shutdown is a related, conditional availability observation; neither report establishes its full downstream job consequences.

**5. Net position**

- **Codex F-1 — RPC error strings expose endpoint credentials in logs: high confidence.**
- **Codex F-2 — Broadcast provisioning exposes PXE storage keys to unrelated extension pages: high confidence for exposure; moderate for end-to-end locked-store replay.**
- **Codex F-3 — Offscreen response/control messages lack endpoint authentication: high confidence in demonstrated handling defects; exploitation retains the stated compromised-context prerequisites.**

No independent Claude-only finding is added.