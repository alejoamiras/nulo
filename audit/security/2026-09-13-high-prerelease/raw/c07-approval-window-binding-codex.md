Files read: requested cluster production files and tests in full, plus bounded messaging, dispatcher, execution, manifest, and lifecycle handoffs.  
Findings: 3 root causes; no severity bands assigned.  
Non-findings: 18; verification used source inspection and read-only, in-memory probes—no files modified.

### F-1: Approval omits transaction arguments and authwit authorization details

1. **Title:** Valid transactions and authwits can be approved without displaying their recipient, amount, or delegated caller.

2. **Impact factors:** Violates informed transaction authorization. A hostile dApp can obtain approval for a transfer or delegated authorization whose consequential parameters are absent from the primary approval surface. Potential impact includes loss of funds controlled by the selected account. The attacker needs a connected dApp with the requisite capability and an approving user; no extension compromise is required. Attack complexity is low for ordinary supported token transfers.

3. **Evidence confidence:** **High.** The missing rendering branches are explicit in the templates. A read-only probe against the installed Aztec Standards token artifact confirmed that all four standard transfer functions have `(from, to, amount, _nonce)` parameters and return `{ kind: "unverified" }` from the approval parser.

4. **OWASP / CWE mapping:** OWASP A01:2025 Broken Access Control; CWE-863, Incorrect Authorization, as the requested Top-25 classification for the consent failure. CWE-863 appears in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html); category reference: [OWASP A01](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/).

5. **Trace:**
   - A dApp’s `sendTx` becomes an approval request containing its execution payload at `packages/wallet-bridge/src/dispatcher.ts:946`.
   - `apps/extension/src/popup/windows/execute/OperationCard.vue:117` renders every call’s method and target.
   - Argument rendering exists only when `parseTransferIntent(call).kind !== "unverified"` at `apps/extension/src/popup/windows/execute/OperationCard.vue:135`. **There is no fallback branch** after that block.
   - The parser recognizes four older transfer names and requires exactly three arguments at `apps/extension/src/utils/transfer-intent.ts:23` and `apps/extension/src/utils/transfer-intent.ts:71`. Current supported transfer descriptors use four arguments and names such as `transfer_public_to_public` at `apps/extension/src/wallet/services/token/functions/descriptors.ts:322` and `apps/extension/src/wallet/services/token/functions/descriptors.ts:332`.
   - At execution, encoded arguments are retained and passed into the actual call at `apps/extension/src/wallet/services/execution/tx-request-builder.ts:188` and `apps/extension/src/wallet/services/execution/tx-request-builder.ts:584`.

   The authwit instance has the same missing-display root:
   - Uncovered call intents and inner-hash intents are routed to approval at `packages/wallet-bridge/src/dispatcher.ts:1002`.
   - `apps/extension/src/popup/windows/execute/OperationCard.vue:357` displays the intent category and target/function or consumer, but omits the call’s **caller and arguments**, or the **inner hash**.
   - Execution includes those omitted values in the authorization hash and signs it at `apps/extension/src/wallet/services/execution/service.ts:909`, `apps/extension/src/wallet/services/execution/service.ts:924`, and `apps/extension/src/wallet/services/execution/service.ts:935`.

6. **Missing control:** A complete primary approval representation of authorization-relevant values. Unsupported semantic decoding needs a visible warning and indexed raw argument values. Authwit approval also needs the delegated caller and the exact call arguments—or the opaque hash and an explicit opaque-authorization warning.

7. **Exploit story or violation scenario:** A connected malicious dApp requests a valid `transfer_public_to_public(user, attacker, amount, nonce)` against a registered token with a correct artifact and selector. The popup displays the submitting account, method, token address, and fee controls, but neither the transfer recipient nor amount. The user approves while relying on the dApp’s benign description. The wallet executes the supplied recipient and amount. Alternatively, an uncovered authwit request shows the legitimate token and function while concealing the attacker-controlled delegated caller and transfer arguments.

8. **Preconditions:** The dApp holds the relevant account/transaction capability, or the account authwit sub-permission for the signing variant. The target and arguments must form a valid executable operation. The user approves without opening and interpreting the separate JSON viewer.

9. **Why mitigations fail:** Name/selector and artifact validation establish that the function exists; they do not display its parameters. The parser’s conservative refusal to guess is appropriate, but its documented fallback is absent. A `data-intent-kind="unverified"` attribute is not a visible warning. “View JSON” still works, but relegating recipient and amount to that separate surface recreates the behavior described as fixed in `apps/extension/src/utils/transfer-intent.ts:4`.

10. **Instances:**
    - `apps/extension/src/popup/windows/execute/OperationCard.vue:117`: every unrecognized `aztec_sendTx` call, including the currently installed standard token transfer functions.
    - `apps/extension/src/popup/windows/execute/OperationActionRow.vue:11`: both `call` and `encoded_call` display only method and target, without arguments.
    - `apps/extension/src/popup/windows/execute/OperationCard.vue:357`: popup-routed `aztec_createAuthWit` omits caller/arguments or inner hash.
    - `apps/extension/src/popup/windows/execute/OperationActionRow.vue:36`: encoded public-authwit display also omits arguments; the adjacent source explicitly states that today’s dApp grant producer does not emit this variant. This is a related implementation instance, **not a separately demonstrated hostile-dApp route**.

### F-2: Approval authority is attached to a request ID, not its stored operations or owning window

1. **Title:** A privileged popup can substitute operations, origin, or interaction type when claiming an approval request.

2. **Impact factors:** Violates authorization and operation integrity under the expressly requested **buggy or compromised popup** model. A replacement operation can use a different existing account or network within the unlocked profile, change transfers or authorizations, or introduce additional operations. Another internal document that knows a request ID can read or decide that request. No additional click is enforced by the service itself. This is **not a demonstrated web-page-to-extension privilege escalation**; privileged extension code is a prerequisite.

3. **Evidence confidence:** **High.** An in-memory harness executing the production `approveInteraction` and `executeAndResolve` method bodies confirmed that replacement operations and a forged origin reach the execution-service boundary unchanged. The same probe succeeded when the stored request was a discovery payload.

4. **OWASP / CWE mapping:** OWASP A01:2025 Broken Access Control; CWE-863, Incorrect Authorization, with CWE-639, Authorization Bypass Through User-Controlled Key, applicable to the missing per-window request ownership. Both are in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). See [OWASP A01](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/).

5. **Trace:**
   - Internal RPC authenticates the extension origin at `packages/extension-messaging/src/background/service.ts:45`; it does not identify the interaction’s owning document.
   - RPC invocation passes parameters without the sender context at `packages/extension-messaging/src/core/base-service.ts:125`.
   - `getInteractionPayload(id)` performs only a map lookup at `apps/extension/src/wallet/services/dapp-interaction/service.ts:150`.
   - `approveInteraction` accepts the caller’s complete operations array and origin, claims the ID, then forwards those values at `apps/extension/src/wallet/services/dapp-interaction/service.ts:158` and `apps/extension/src/wallet/services/dapp-interaction/service.ts:186`.
   - `executeAndResolve` checks the stored session’s profile and continued existence, but executes the supplied array at `apps/extension/src/wallet/services/dapp-interaction/service.ts:245` and `apps/extension/src/wallet/services/dapp-interaction/service.ts:272`.

   The distinction between downstream validation and binding to the original request is:

   | Dimension | Downstream checks | Compared with original stored request? |
   |---|---|---|
   | Target, selector, arguments | ABI lookup, name/selector consistency, argument parsing | **No.** A different valid call passes these checks. |
   | `from` account | Standard send requires `opts.from === accountAddress`; account resolution uses the active profile | **No.** Both fields can be changed together. |
   | Chain | Network/account resolution and live-node chain-identity checks | **No.** They validate the returned network, not its equality with the approved request’s chain. |
   | Fee payer/settings | Fee-route classification, required fee-settings presence, gas admission checks | **No.** Returned payment settings and wire gas options are consumed. |
   | Authwits, capsules, extra arguments | Schema parsing and conversion into execution payloads | **No.** Returned contents are accepted. |
   | Operation/call count | Execution iterates the returned operations; the builder processes returned calls | **No.** No original count, order, or content commitment is checked. |

   Relevant downstream controls are at `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:532`, `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:556`, `apps/extension/src/wallet/services/execution/operation-planner.ts:175`, `apps/extension/src/wallet/services/execution/tx-request-builder.ts:213`, and `apps/extension/src/wallet/services/execution/tx-request-builder.ts:569`.

6. **Missing control:** Bind the approval decision to the stored interaction type, original operation contents, and authenticated owning document. Materialization should remain authoritative in the background, accepting only explicitly permitted wallet-generated changes such as fee selection. Origin attribution should come from the stored request.

7. **Exploit story or violation scenario:** Window A displays a harmless request. Its compromised approval handler—or a buggy handler using another window’s operation state—calls `approveInteraction(idA, replacementOperations, forgedOrigin)`. The replacement names a valid account, network, selector, and arguments. The original session remains live, so the service forwards the replacement. A discovery request ID also works: it has no `session` property, so the session-revalidation branch is skipped entirely. The read-only harness confirmed both handoffs; it did not broadcast a transaction.

8. **Preconditions:** Privileged same-extension code execution or a popup implementation defect, a live request ID, and valid replacement operations. Another internal context must learn the ID; the finding does not depend on guessing its 128-bit value. Actual signing still requires an unlocked profile and usable account.

9. **Why mitigations fail:** Sender authentication separates web/content-script callers from extension pages but grants all accepted pages the same RPC authority. First-claim-wins prevents duplicate decisions; it does not establish that the winning document displayed this request. Profile/session checks establish continuing identity, not operation equality. Estimate-reuse validation checks the operation supplied at confirmation and may fall back to rebuilding; it does not bind that operation to `interaction.payload`. Also, `ExecutionService.executeOperations` is independently privileged: this finding does not claim containment of a fully compromised extension page.

10. **Instances:**
    - `apps/extension/src/wallet/services/dapp-interaction/service.ts:150`: request payload read without document/window ownership.
    - `apps/extension/src/wallet/services/dapp-interaction/service.ts:158`: arbitrary replacement operations and origin.
    - `apps/extension/src/wallet/services/dapp-interaction/service.ts:189`: arbitrary result settlement without interaction-type or document binding.
    - `apps/extension/src/wallet/services/dapp-interaction/service.ts:247`: discovery-shaped records skip session validation when used through the execution approval method.
    - `apps/extension/src/popup/windows/execute/index.vue:412`: the caller strips UI decorations but returns the remaining operation object.
    - `apps/extension/src/wallet/services/dapp-interaction/spec.ts:105`: RPC contract carries IDs and results, with no owning-window proof.

### F-3: Token registration persists metadata fetched after the user approved a different snapshot

1. **Title:** Token metadata is not bound between approval preview and watchlist persistence.

2. **Impact factors:** Violates integrity of the user-approved token registration. A malicious token with mutable metadata can cause the wallet to save a different name, symbol, or decimals value from the preview. The immediate impact is limited to the registered token’s local metadata; subsequent financial harm would depend on how that token is later used. Exploitation requires control over metadata responses or the token’s mutable metadata state and user approval. No popup compromise is required.

3. **Evidence confidence:** **High** for the preview-versus-persistence discrepancy. The trace is complete; no live-chain metadata-switch exploit was run.

4. **OWASP / CWE mapping:** [OWASP A08:2025 Software or Data Integrity Failures](https://top10.owasp.org/2025/A08_2025-Software_or_Data_Integrity_Failures/). CWE-20 is the broad [2025 Top-25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) classification for accepting the new values without validating them against the approved snapshot; the more specific mechanism is [CWE-367, TOCTOU](https://cwe.mitre.org/data/definitions/367.html), which is not itself on that Top-25 list.

5. **Trace:**
   - `previewTokenMetadata` resolves the interface and fetches metadata at `apps/extension/src/wallet/services/token/service.ts:672`.
   - The popup separately stores the displayed metadata and interface at `apps/extension/src/popup/windows/execute/index.vue:361`.
   - Approval returns only `previewedInterface`, not the approved metadata snapshot, at `apps/extension/src/popup/windows/execute/index.vue:421`.
   - The execution consumer checks the previewed interface’s address and chain at `apps/extension/src/wallet/services/execution/service.ts:745`, then invokes `addTokenAuthorized` at `apps/extension/src/wallet/services/execution/service.ts:778`.
   - The persistence path installs a **new live metadata fetch** at `apps/extension/src/wallet/services/token/service.ts:294`.
   - `persistToken` performs that fetch and stores its new values at `apps/extension/src/wallet/services/token/service.ts:368`, `apps/extension/src/wallet/services/token/service.ts:382`, and `apps/extension/src/wallet/services/token/service.ts:403`.

6. **Missing control:** Persist the approved metadata snapshot, or compare any refreshed values with that snapshot and require renewed approval on a change. Address/interface binding alone does not bind the displayed metadata.

7. **Exploit story or violation scenario:** A token initially returns a plausible name, symbol, and decimals value. The dApp requests registration; the user sees that snapshot. While the popup is open, the attacker changes the token’s metadata state. After approval, the same token functions return different values. The wallet persists those values without another preview or comparison. The contract address and interface can remain unchanged throughout.

8. **Preconditions:** The token is not already registered for that profile/chain/address; its metadata can change between reads, or the metadata response source is adversarial. The token exposes the required metadata and balance functions, and the user approves registration.

9. **Why mitigations fail:** Sanitization protects rendering from control characters but does not bind two different responses. The previewed-interface check binds contract and chain, not name/symbol/decimals. Deletion fences and network-liveness checks protect storage ownership, not approved values. The separate seed path explicitly persists an exact metadata snapshot to avoid this same refetch problem at `apps/extension/src/wallet/services/token/service.ts:445`, but dApp registration uses the live path.

10. **Instances:**
    - `apps/extension/src/popup/windows/execute/index.vue:362` and `apps/extension/src/popup/windows/execute/index.vue:421`: displayed metadata discarded at approval handoff.
    - `apps/extension/src/wallet/services/token/service.ts:269`: authorized registration selects live metadata.
    - `apps/extension/src/wallet/services/token/service.ts:368`: unchecked second response becomes persisted identity data.
    - `apps/extension/src/wallet/services/execution/service.ts:745`: cached-interface and fresh-interface branches both converge on that live persistence path.

## Non-findings

- **N-1 — Direct hostile-page approval RPC, high confidence:** Same-extension ID plus extension-origin sender validation rejects ordinary content-script and foreign-extension callers; F-2 requires privileged extension code, not merely a malicious dApp (`packages/extension-messaging/src/core/sender-auth.ts:17`, `packages/extension-messaging/src/background/service.ts:45`).
- **N-2 — Duplicate approval or cancellation replay, high confidence:** Approval checks the durable cancellation flag and synchronously deletes the request before asynchronous execution; a second claim fails, while a previously processed cancellation blocks approval (`apps/extension/src/wallet/services/dapp-interaction/service.ts:173`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:176`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:288`).
- **N-3 — Approval after the pending-window timeout, high confidence:** The timeout is ten minutes; settlement removes the window handle and the interaction promise’s cleanup removes the request. Approval detaches the timer once execution takes ownership, so ten minutes is not an execution deadline (`apps/extension/src/wallet/services/dapp-interaction/service.ts:52`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:395`, `apps/extension/src/wallet/services/window-manager/window-manager.ts:81`, `apps/extension/src/wallet/services/window-manager/window-manager.ts:175`).
- **N-4 — Demonstrated window-manager duplicate-execution race, high confidence:** Handle-identity checks prevent adopting a late-created window after cancellation or handle reuse, stale windows are closed, and settlement is single-use; focus targets an existing handle and the interaction service restricts it to the active profile (`apps/extension/src/wallet/services/window-manager/window-manager.ts:92`, `apps/extension/src/wallet/services/window-manager/window-manager.ts:107`, `apps/extension/src/wallet/services/window-manager/window-manager.ts:205`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:304`). No additional security-impacting creation/focus race was demonstrated.
- **N-5 — Approval after persistent-session revocation or an already-completed profile change, high confidence:** Execution approval requires the captured profile to match the stored session and requires a live, unexpired session row; the popup also rejects on lock/profile change. Transport termination alone is different: its callback clears transport bookkeeping, and this approval check does not require the original transport session to remain live (`apps/extension/src/wallet/services/dapp-interaction/service.ts:249`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:264`, `apps/extension/src/wallet/services/dapp-session/service.ts:95`, `apps/extension/src/composables/useDappApprovalWindow.ts:102`, `apps/extension/src/wallet/services/wallet-sdk/background.ts:360`).
- **N-6 — Benign name paired with a different executable selector, high confidence:** Standard encoded calls, NO_FROM calls, and call-intent authwits resolve artifacts and reject name/selector disagreement; an unknown-artifact call is not an executable “raw selector with warning” fallback—it fails closed downstream. The popup itself does not provide the claimed unknown-artifact warning (`apps/extension/src/wallet/services/execution/tx-request-builder.ts:188`, `apps/extension/src/wallet/services/execution/tx-request-builder.ts:312`, `apps/extension/src/wallet/services/execution/tx-request-builder.ts:569`, `apps/extension/src/wallet/services/execution/service.ts:889`).
- **N-7 — Fee-payer labeling used to skip send approval, high confidence:** `Transactions` is the highest valid confirmation level, and sends are classified at that level, so `accessLevel >= confirmationLevel` always prompts for them. Claim classification additionally checks target, selector, flags, arity, and credited payer rather than trusting the function name (`packages/wallet-bridge/src/session-types.ts:21`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:56`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:587`, `packages/wallet-bridge/src/fee-payer.ts:46`).
- **N-8 — Silent execution as unrestricted signing authority, high confidence:** The SDK’s generic silent operation routes cover chain information, contract/class metadata, private events, sender/contract registration, address-book reads, simulation, utility execution, and profiling after dispatch capability/scope checks; account reads and token-registration probes also have their respective checks. Covered call-intent authwits sign silently, while uncovered/inner-hash intents prompt; token registration, sends, and public-authwit grants use approval (`packages/wallet-bridge/src/method-descriptors.ts:49`, `packages/wallet-bridge/src/dispatcher.ts:650`, `packages/wallet-bridge/src/dispatcher.ts:663`, `packages/wallet-bridge/src/dispatcher.ts:738`, `packages/wallet-bridge/src/dispatcher.ts:990`).
- **N-9 — Arbitrary numeric fee entry through the ordinary fee UI, high confidence:** The UI emits payment-method selection and priority, with self-pay unavailable for unknown/zero balances. Explicit wire gas prices are nevertheless honored without a wallet economic ceiling; custom gas limits have admission checks. A privileged popup can modify those wire options under F-2, but an independent hostile-page fee-approval bypass was not established (`apps/extension/src/popup/components/modules/send/fee-helpers.ts:77`, `apps/extension/src/wallet/services/execution/operation-planner.ts:88`, `apps/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts:71`, `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:267`, `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:320`).
- **N-10 — HTML/script injection through reviewed approval strings, high confidence:** No `v-html` sink was found in the reviewed windows or capability components; the templates interpolate text. Method labels use control stripping and a 64-codepoint clamp; displayed public-authwit argument strings use a 48-codepoint clamp. Missing argument values are F-1, not an escaping bypass (`apps/extension/src/popup/windows/execute/humanize.ts:43`, `apps/extension/src/popup/windows/execute/OperationCard.vue:126`, `apps/extension/src/popup/windows/execute/OperationActionRow.vue:31`, `apps/extension/src/wallet/services/dapp-session/capability-meta.ts:170`).
- **N-11 — Token symbol treated as authenticated identity, moderate confidence:** Name/symbol are explicitly untrusted, sanitized at display, and accompanied by a contract-address row; decimals render numerically and the recognized decimals ABI is unsigned eight-bit. Homoglyphs remain possible. AddressDisplay normally abbreviates addresses and can substitute a local label, so this is not a guarantee of full-address disambiguation; no independent trusted-token impersonation bypass was demonstrated (`apps/extension/src/popup/windows/execute/OperationCard.vue:233`, `apps/extension/src/popup/windows/execute/OperationCard.vue:268`, `apps/extension/src/components/AddressDisplay.vue:67`, `apps/extension/src/wallet/services/token/functions/descriptors.ts:213`).
- **N-12 — Executable dApp URL or Unicode-name injection, high confidence:** Discovery stores the browser-attributed origin as the URL and sanitizes the name; hostname display uses URL parsing and flags punycode/non-ASCII hostnames. The URL is rendered as text, not an executable link. The hostname has CSS ellipsis and the parse-error fallback is unsanitized text, so full-origin visibility is not guaranteed; no executable URL sink was found (`apps/extension/src/wallet/services/wallet-sdk/background.ts:770`, `apps/extension/src/composables/useDappHostname.ts:8`, `apps/extension/src/components/composite/DappIdentityBlock.vue:33`, `apps/extension/src/components/composite/DappIdentityBlock.vue:46`, `apps/extension/src/components/composite/DappIdentityBlock.vue:93`).
- **N-13 — dApp-supplied checkbox state, high confidence:** Selection state is constructed by the wallet. Recognized new capabilities—including the authwit rider—default selected; ordinary unknown new types default unselected. Existing grants remain selected, and a sole available account is preselected. These defaults are visible and still require approval; arbitrary wire `selected` fields do not control them (`apps/extension/src/popup/windows/capabilities/build-items.ts:46`, `apps/extension/src/popup/windows/capabilities/build-items.ts:67`, `apps/extension/src/popup/windows/capabilities/build-items.ts:87`, `apps/extension/src/popup/windows/capabilities/index.vue:183`).
- **N-14 — Unknown capability becoming a recognized/default-on grant through a prototype key, high confidence:** `isKnownCapability` uses `Object.hasOwn`, so `constructor` and `__proto__` remain unknown/unselected. However, `getCapabilityInfo` uses inherited lookup: both produce undefined risk and the renderer’s `riskWord` throws. This was reproduced at the metadata-function level; it disproves universal “unknown ⇒ high risk” behavior, but no impact beyond failure of the attacker’s own approval request or privilege escalation was demonstrated (`apps/extension/src/wallet/services/dapp-session/capability-meta.ts:98`, `apps/extension/src/wallet/services/dapp-session/capability-meta.ts:115`, `apps/extension/src/popup/windows/capabilities/build-items.ts:68`, `apps/extension/src/popup/windows/capabilities/CapabilityCard.vue:63`).
- **N-15 — Capability descriptions concealing wildcard scope, high confidence:** Main descriptions are wallet-controlled; whole-scope `*` displays “Any contract, any function,” wildcard contracts display “Any contract,” and wildcard functions remain visibly `fn: *`. Raw function identifiers accompany friendly labels; scope addresses/class IDs use dedicated sanitized renderers (`apps/extension/src/wallet/services/dapp-session/capability-meta.ts:194`, `apps/extension/src/components/composite/capabilities/ScopePatternList.vue:31`, `apps/extension/src/components/composite/capabilities/ScopePatternList.vue:42`, `apps/extension/src/components/ScopeAddress.vue:67`, `apps/extension/src/components/ScopeClassId.vue:38`).
- **N-16 — Hostile web page supplying the verify-window hash, high confidence:** The URL hash deliberately overrides the shared session-row hash and is supplied by the background’s per-transport-session snapshot. The popup HTML is absent from configured web-accessible resources, so a normal web-origin navigation/link cannot open it; this matches [Chrome’s documented navigability rule](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources). Confirmation optionally remembers trust; it is not a second transaction approval (`apps/extension/src/wallet/services/wallet-sdk/session-established.ts:145`, `apps/extension/src/popup/windows/verify/index.vue:140`, `apps/extension/src/popup/windows/verify/index.vue:155`, `apps/extension/src/popup/windows/verify/index.vue:72`, `apps/extension/manifest/manifest.config.ts:55`).
- **N-17 — Chunking silently drops or invents dApp calls, high confidence within the inspected path:** The popup iterates all input calls, and the planner converts all of them. Account chunking wraps a head slice and preserves the tail and auxiliary payload arrays; extra wrapper calls/authwits are account machinery, not evidence of substituted dApp calls. Original-versus-returned call-count binding remains absent as described in F-2 (`apps/extension/src/popup/windows/execute/OperationCard.vue:117`, `apps/extension/src/wallet/services/execution/operation-planner.ts:206`, `packages/aztec-runtime/src/account/nulo-account.ts:161`, `packages/aztec-runtime/src/account/nulo-account.ts:201`).
- **N-18 — Broken JSON-viewer request-ID placement, high confidence:** The opener deliberately places the ID in the outer URL query and the viewer reads `window.location.search`; these agree. It displays original stored operations, including auxiliary payload data, rather than the popup’s returned operation objects or later fee choices, so it does not repair F-2’s substitution gap (`apps/extension/src/popup/windows/execute/index.vue:491`, `apps/extension/src/popup/windows/json/index.vue:9`, `apps/extension/src/popup/windows/json/index.vue:31`, `apps/extension/src/popup/windows/json/index.vue:56`).

## Handoff edges followed

- dApp dispatch → interaction request: `packages/wallet-bridge/src/dispatcher.ts:946`, `packages/wallet-bridge/src/dispatcher.ts:1002`, `packages/wallet-bridge/src/dispatcher.ts:1168`.
- Popup RPC → background approval service: `apps/extension/src/popup/windows/execute/index.vue:441` → `apps/extension/src/wallet/services/dapp-interaction/service.ts:158`.
- Internal port authentication → registered RPC invocation: `packages/extension-messaging/src/background/service.ts:38` → `packages/extension-messaging/src/core/base-service.ts:125`.
- Approval service → execution dispatcher → immediate send/authwit/token handlers: `apps/extension/src/wallet/services/dapp-interaction/service.ts:272` → `apps/extension/src/wallet/services/execution/service.ts:554`.
- Token preview → popup display/approval → authorized persistence: `apps/extension/src/wallet/services/token/service.ts:672` → `apps/extension/src/popup/windows/execute/index.vue:361` → `apps/extension/src/wallet/services/execution/service.ts:778`.
- Window creation/removal/timeout → interaction settlement: `apps/extension/src/wallet/services/window-manager/window-manager.ts:65` → `apps/extension/src/wallet/services/dapp-interaction/service.ts:395`.
- Session establishment → verify URL → displayed emoji hash: `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:145` → `apps/extension/src/popup/windows/verify/index.vue:155`.
- Profile/session lifecycle → approval rejection and transport teardown: `apps/extension/src/composables/useDappApprovalWindow.ts:102`, `apps/extension/src/wallet/services/wallet-sdk/background.ts:523`.

Verification limits: the existing test suites were read, not executed. Read-only probes exercised the installed token artifact with the production intent parser, capability metadata edge cases, and extracted production approval-method bodies with mocked downstream services. No browser exploit, proof, or transaction broadcast was performed.

## Cross-rebuttal

**Its findings**

- **Claude F-1 — CONFIRM, high confidence.** `apps/extension/src/utils/transfer-intent.ts:23` restricts names and `:72` requires three arguments, whereas `apps/extension/src/wallet/services/token/functions/descriptors.ts:322` constructs supported two-/four-argument transfers. `apps/extension/src/popup/windows/execute/OperationCard.vue:135` suppresses their values without implementing the promised fallback. This confirms my F-1; updating the allowlist alone would leave arbitrary-call disclosure incomplete.
- **Claude F-2 — DOWNGRADE to a disclosure observation.** Primary-card omission is real, but “never shown anywhere” is false: `apps/extension/src/popup/windows/json/index.vue:12` selects stored operations and `:56` renders them, including auxiliary fields. Its trace also incorrectly connects `parseNoFromExtras` at `apps/extension/src/wallet/services/execution/tx-request-builder.ts:347` to standard-path construction at `:275`; the former feeds `:401` and `:414`. Incorporation remains confirmed through separate paths, but additional unauthorized execution or witness replay remains unproven.

**What it missed**

- **My F-1 additionally covers live authwit approvals:** `apps/extension/src/popup/windows/execute/OperationCard.vue:357` omits delegated caller and arguments, or the opaque inner hash. Those values enter authorization construction at `apps/extension/src/wallet/services/execution/service.ts:910` and `:927`, followed by signing at `:935`.
- **My F-2 addresses the explicitly requested buggy/compromised-popup model.** `apps/extension/src/wallet/services/dapp-interaction/service.ts:158` accepts replacement operations/origin; `:272` executes them without comparison against the original payload. First-claim semantics and session checks do not supply that comparison. Dismissing this solely because no popup XSS was found excludes an assigned threat model.
- **My F-3 binds registration to what was previewed:** `apps/extension/src/popup/windows/execute/index.vue:362` retains displayed metadata, but `:425` returns only the previewed interface. `apps/extension/src/wallet/services/token/service.ts:368` refetches metadata and `:382` persists the new values without comparison.

**What I missed**

**ADOPT, high confidence:** its narrower reachability assessment for generic `send_transaction` `call`/`encoded_call` display omissions. The current dApp producer at `packages/wallet-bridge/src/dispatcher.ts:1081` constructs `add_public_authwit`; ordinary generic actions should be classified as dormant instances, not independently reachable dApp exploits. My report needed that explicit qualification.

I do **not** adopt Claude F-2 as an independent vulnerability: the auxiliary-data path was already covered by my review, and neither report demonstrates its proposed authorization consequence.

**Overconfidence**

- Claude’s “single most common” and “most current token contracts” claims lack prevalence evidence. Supported counterexamples establish the bug without those claims.
- Its self-pay fee reassurance is false: `apps/extension/src/wallet/services/execution/operation-planner.ts:92` accepts wire `maxFeesPerGas` without restricting this to embedded payment; `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:267` honors explicit values. This establishes input control, not a demonstrated fee-drain exploit.
- Its silent-send qualification overlooks `apps/extension/src/wallet/services/dapp-interaction/service.ts:587`: transaction-level requests meet every valid confirmation threshold (`packages/wallet-bridge/src/session-types.ts:21`).
- “Always” displaying raw disambiguating addresses overstates `apps/extension/src/components/AddressDisplay.vue:69`, which can substitute local names; `:87` abbreviates addresses.
- “Session torn down” conflates durable revocation with transport termination: `apps/extension/src/wallet-sdk/background.ts:360` clears transport bookkeeping, whereas approval checks the durable session at `apps/extension/src/wallet/services/dapp-interaction/service.ts:264`.
- Its claimed platform impossibility of caller binding is unsupported: browser sender context reaches `packages/extension-messaging/src/background/service.ts:72`; method invocation discards context at `packages/extension-messaging/src/core/base-service.ts:125`.
- My F-2 establishes missing binding, not new authority beyond existing privileged execution RPCs. My F-3 establishes metadata substitution, not theft. High evidence confidence must not be read as high demonstrated impact.

**Net position**

- **F-1 — Incomplete transaction/authwit approval disclosure:** high confidence; retain, with generic-action reachability narrowed.
- **F-2 — Approval operations and caller window lack original-request binding:** high structural confidence; retain conditionally for the specified privileged-popup model.
- **F-3 — Registered token metadata can differ from the approved preview:** high confidence; demonstrated impact is local metadata integrity.
- **Claude F-2 — Auxiliary-data disclosure observation:** high confidence in primary-card omission; security impact unknown; exclude from confirmed vulnerabilities.