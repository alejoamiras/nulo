Files read: all 47 cluster production files, specified test sections, four audit context/map files, and relevant execution/profile handoffs.
Findings: 3.
Non-findings: 13, including explicitly unresolved upstream transport behavior.

Validation used production-source harnesses with mocked SDK/browser dependencies. They reproduced the selector-forwarding gap, acceptance of a colliding chain tuple, uncapped duplicate discovery waiters, and uncapped verification-window creation. These were source-level checks; repository suites and browser/chain integration tests were not run. Nothing under `node_modules` was read.

### F-1: simulateTx fast path does not bind the authorized function name to the executed selector

1. **Title:** Public-static simulation bypasses function-name scope through an independent selector.

2. **Impact factors:** Authorization and simulation-result integrity. A connected dApp with a narrowly scoped simulation grant can submit an allowed function name while forwarding another function’s selector to the node simulation helper. The demonstrated scope is public-static simulation; private-data disclosure and on-chain state changes were not established. Vector: dApp RPC. Complexity: low after obtaining a grant. Privileges: an authorized session/account and applicable simulation capability. User interaction: initial authorization; no additional approval for simulation.

3. **Evidence confidence:** **Moderate.** The repository demonstrably forwards the independently supplied selector without ABI binding. The upstream simulation implementation was outside the permitted reads.

4. **OWASP / CWE:** [OWASP A01:2025 — Broken Access Control](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/); CWE-863, Incorrect Authorization, in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** DApp-controlled `exec.calls` → authorization compares only `to` and `name` at `packages/wallet-bridge/src/method-scope-checkers.ts:169` → execution selects the optimized prefix at `apps/extension/src/wallet/services/execution/view-executor.ts:242` → prefix eligibility trusts supplied `type`/`isStatic`, then parses the supplied call at `apps/extension/src/wallet/services/execution/fast-path.ts:99` and `:109` → the unchanged calls, including their selectors, reach `simulateViaNode` at `apps/extension/src/wallet/services/execution/fast-path.ts:202`.

6. **Missing control:** Before optimizing, resolve the target’s registered ABI, require the selector’s actual function name to match the scope-checked name, and derive function type/static status from that ABI.

7. **Failure scenario:**  
   a. The session grants simulation of `allowed_view` on contract C.  
   b. The dApp supplies a call naming `allowed_view`, targeting C, but carrying another public-static function’s selector and compatible arguments.  
   c. The name-based scope checker accepts it.  
   d. With a usable block anchor and successful node simulation, the optimized path forwards the other selector and returns its result.  
   The source harness reproduced acceptance by the scope checker and preservation of the independent selector at the simulation-helper boundary.

8. **Preconditions:** A restricted simulation grant, an authorized account, a suitable target function, and a successful optimized path. No compromised RPC is required for the missing name–selector binding.

9. **Why mitigations fail:** Shape parsing does not consult the contract ABI in this path. Standard transaction construction binds encoded calls at `apps/extension/src/wallet/services/execution/tx-request-builder.ts:569`; utility execution binds them at `apps/extension/src/wallet/services/execution/view-executor.ts:363`. Those checks do not cover the optimized prefix. For mixed payloads, only the remainder enters the standard arm at `apps/extension/src/wallet/services/execution/fast-path.ts:215`. Fallback protects requests that fall back, not successful optimized requests.

10. **Instances:** The shared optimized-prefix path covers both entirely public-static `simulateTx` requests and public-static prefixes of mixed requests: `apps/extension/src/wallet/services/execution/view-executor.ts:242`, `:275`; `apps/extension/src/wallet/services/execution/fast-path.ts:99`, `:109`, `:202`. `profileTx`, standard transaction construction, and `executeUtility` do not share this missing ABI-binding path.

### F-2: Live signing still accepts a different chain identity with the same XOR

1. **Title:** Live chain validation accepts colliding identity tuples before authwit signing.

2. **Impact factors:** Authorization and signed-message integrity. An enrolled RPC endpoint can cause the wallet to sign material using a different L1 chain identity and rollup version while retaining the account selected for the stored network. Vector: RPC response manipulation. Complexity: constructing a collision is trivial, but controlling an enrolled endpoint is required. Privileges: endpoint control or equivalent response control; an ordinary dApp alone cannot supply this response. User interaction: an authorized signing request, potentially silent under existing account and call grants. Acceptance or financial consequences on another deployment were not demonstrated.

3. **Evidence confidence:** **High.** The exact-tuple mismatch is accepted by the production helper, and its output fields feed the authwit hash immediately before signing.

4. **OWASP / CWE:** [OWASP A01:2025 — Broken Access Control](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/); CWE-863, Incorrect Authorization, in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:** An otherwise authorized `createAuthWit` reaches `packages/wallet-bridge/src/dispatcher.ts:990` → the execution service selects the stored-network account at `apps/extension/src/wallet/services/execution/service.ts:869`, then reads untrusted live node information at `:872` → `packages/aztec-runtime/src/utils/chain-identity.ts:55` compares only `(l1ChainId ^ rollupVersion) >>> 0` → the accepted live fields become hash-domain metadata at `apps/extension/src/wallet/services/execution/service.ts:876`, feed `computeAuthWitMessageHash` at `:922` or `:929`, and reach `account.createAuthWit` at `:935`.

6. **Missing control:** The signing-time comparison must include the exact stored L1 chain identity, with consistent validation of the rollup-version relationship. The current `SelectedNetworkChainInfo` interface exposes only the composite `chainId` at `packages/aztec-runtime/src/utils/chain-identity.ts:34`.

7. **Failure scenario:**  
   a. A network is enrolled with `(l1ChainId, rollupVersion) = (1, 5)`, producing composite `4`.  
   b. Later, the same endpoint reports `(2, 6)`, also producing `4`.  
   c. The wallet selects the account associated with the stored network.  
   d. The live guard accepts the changed tuple.  
   e. The wallet hashes and signs the authorization using chain identity `(2, 6)`.  
   The production-helper check accepted this exact example.

8. **Preconditions:** A non-local enrolled network and an endpoint that changes or misreports identity after enrollment. For the direct authwit route, the normal account/call authorization must also pass. This finding does not bypass those independent gates.

9. **Why mitigations fail:** Endpoint addition and update now compare exact `l1ChainId` at `apps/extension/src/wallet/services/network/service.ts:568` and `:614`; those checks do not validate every later node response. Account derivation uses the stored L1 identity at `apps/extension/src/wallet/services/account/service.ts:349`, but does not compare it with the subsequently returned signing metadata. Reusing one validated node response prevents inconsistent rereads; it does not make the XOR comparison injective. This is the explicitly requested re-examination of the previously held collision, which remains open at live signing.

10. **Instances:** Root: `packages/aztec-runtime/src/utils/chain-identity.ts:53`. Signing or transaction-context consumers include `apps/extension/src/wallet/services/execution/service.ts:875`, `apps/extension/src/wallet/services/execution/tx-request-builder.ts:221` and `:407`, and `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:854`—the latter signs at `:863`. The same comparison also supplies authwit discovery at `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:109` and `apps/extension/src/wallet/services/execution/discovery-probe.ts:74`, and non-signing identity/simulation consumers at `apps/extension/src/wallet/services/execution/service.ts:230`, `apps/extension/src/wallet/services/execution/view-executor.ts:211`, `apps/extension/src/wallet/services/execution/fast-path.ts:179`, and `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:204` and `:362`.

### F-3: Discovery limits omit duplicate waiters and reconnect verification windows

1. **Title:** Discovery admission limits do not bound all discovery-related resources.

2. **Impact factors:** Availability of the extension service worker and browser UI. A single origin can accumulate pending discovery work beyond the advertised limits; a remembered origin can repeatedly create verification windows. Vector: dApp discovery/handshake messages. Complexity: low. Privileges: none for duplicate waiting beyond an open connection prompt; a previously accepted origin for reconnect-window creation. User interaction: leaving a connection prompt pending, or having previously connected the dApp. Browser exhaustion was not measured.

3. **Evidence confidence:** **High.** Production-source harnesses retained 256 same-key discovery waiters with one counted map entry and produced 40 verification-window calls for one remembered origin.

4. **OWASP / CWE:** [OWASP A06:2025 — Insecure Design](https://owasp.org/Top10/2025/A06_2025-Insecure_Design/); CWE-770, Allocation of Resources Without Limits or Throttling, in the [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html).

5. **Trace:**  
   **Duplicate waiting:** Fresh discovery request IDs reach `apps/extension/src/wallet/services/wallet-sdk/background.ts:619` → same `(origin, chainId)` requests enter the existing-promise branch at `:665`, before the cap at `:670` → each retains a separate wait at `:718`; accounting at `:750` counts only distinct popup-map keys.  
   **Reconnect windows:** Remembered sessions take the pre-cap auto-approval branch at `apps/extension/src/wallet/services/wallet-sdk/background.ts:647` → each established transport session reaches `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:143` → when verification is not trusted, each directly invokes `chrome.windows.create` at `:145`.

6. **Missing control:** Account for pending request IDs and verification windows, not only distinct connection-popup keys. Duplicate discovery requests need bounded admission or rejection; verification-window creation needs its own enforced capacity/coalescing lifecycle.

7. **Failure scenario:**  
   a. While one connection popup remains pending, submit many fresh request IDs for the same origin and chain. All wait on the same promise without increasing the capped map size. The harness retained 256 such requests with zero rejections and one map entry.  
   b. Alternatively, use a remembered session with `trustedVerification === false` and repeatedly complete new handshakes. Existing-session auto-approval avoids the connection-popup cap, and each handshake creates another verification window. The harness generated 40 window-creation calls for the same origin and chain.

8. **Preconditions:** The wallet is unlocked. Duplicate waiting requires a pending connection popup. Verification-window accumulation requires a remembered session whose verification preference remains untrusted and successful fresh transport handshakes.

9. **Why mitigations fail:** The 32-global/4-per-origin cap runs after both bypass branches. Tuple coalescing collapses connection popups, not the number of awaiting requests. Freshness is checked after the shared popup resolves at `apps/extension/src/wallet/services/wallet-sdk/background.ts:727`, so it does not impose an admission bound during the wait. Verification windows are not represented in `pendingDiscoveryPromises`. The locked-queue rejection mechanism is a separate path.

10. **Instances:** Duplicate admission and retention: `apps/extension/src/wallet/services/wallet-sdk/background.ts:665`, `:718`, `:750`. Remembered-session admission and uncapped verification windows: `apps/extension/src/wallet/services/wallet-sdk/background.ts:647` and `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:143`. These omissions allow one origin to exceed the intended limits without using subdomains.

## Non-findings

- **N-1 — Q1, ordinary and sandboxed subframes:** **High confidence:** with normal browser-supplied `tab` and nonzero `frameId`, the default subframe guard rejects before upstream handling; sandboxing does not provide a local exception (`apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:93`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:305`).

- **N-2 — Q1, missing tab/frame, opaque top frames, and navigation:** **Unknown end-to-end; no concrete cross-origin misuse established.** The local guard does not reject missing `sender.tab`/`frameId`, and origin attribution is delegated upstream. Navigation cleanup depends on receiving a URL update, which the lifecycle implementation explicitly says is unavailable in many cases. Therefore A-under-B handling is neither demonstrated nor ruled out for `about:blank`, `data:`, or same-tab navigation; it requires upstream transport evidence (`apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:93`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:327`; `apps/extension/src/wallet/services/wallet-sdk/tab-lifecycle.ts:26`, `:61`).

- **N-3 — Q2, pending approval and concurrent handshakes:** **High confidence in local controls:** the request-ID marker is installed before approval, expires after 90 seconds, and requires profile equality; establishment rechecks liveness around persistence. Verification URLs carry each transport session’s hash snapshot, preventing concurrent updates to the remembered row’s hash from changing another window’s displayed hash. No local prior-approval reuse or hash crossover was demonstrated; uniqueness and transport binding of session/request IDs remain upstream assumptions (`apps/extension/src/wallet/services/wallet-sdk/discovery-approval.ts:61`; `apps/extension/src/wallet/services/wallet-sdk/pending-verification.ts:24`; `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:89`, `:105`, `:126`, `:148`).

- **N-4 — Q2, restart and verification semantics:** **Moderate confidence:** local session ownership/validation maps start empty, and message processing rejects missing validation rather than inferring approval from a persisted row. `trustedVerification` is a remembered profile/origin/chain preference; establishment succeeds after opening the verification window, without waiting for human emoji confirmation. That is the implemented reconnect model, not a demonstrated bypass of a human-confirmation barrier. Upstream session restoration was not inspected (`apps/extension/src/wallet/services/wallet-sdk/background.ts:259`, `:393`; `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:94`, `:143`, `:155`).

- **N-5 — Q3, account widening:** **High confidence:** additions are intersected with wallet-offered accounts, aliases are limited to accepted additions, and membership-only widening preserves existing flags. The locked application rereads the row and checks `requiresGrant` before merging. Response enrichment uses stored flags and selected membership; the shortcut does not return declined account addresses. Whether a popup was needed can be observable, but no enumeration of unselected addresses or flag escalation was demonstrated (`packages/wallet-bridge/src/dispatcher.ts:402`, `:438`, `:1145`, `:1286`; `apps/extension/src/wallet/services/dapp-session/service.ts:301`, `:310`).

- **N-6 — Q4, registry scopes and ordinary execution:** **High confidence, except F-1:** contract operations enforce address lists and relevant flags; class metadata enforces class IDs; transaction/simulation checks inspect every call’s target/name; utilities use utility scope; events check their contract filter; address-book methods require the explicit subgrant. Empty names fail even under wildcard scope. Account-bearing execution resolves wallet/session membership, and explicit execution, option, additional, and event scopes are checked. Batch legs re-enter dispatch. Standard encoded calls and utility calls bind selectors to ABI names; public authwit actions resolve structured calls (`packages/wallet-bridge/src/method-scope-checkers.ts:42`, `:67`, `:95`, `:107`, `:177`, `:198`, `:374`; `packages/wallet-bridge/src/scope-enforcement.ts:89`; `packages/wallet-bridge/src/dispatcher.ts:905`, `:1557`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:166`, `:569`; `apps/extension/src/wallet/services/execution/view-executor.ts:361`).

- **N-7 — Q4, capsules and supplied witnesses:** **Moderate confidence; no concrete unauthorized outcome established:** these contents are not comprehensively inspected by the bridge’s target/account scope checkers. The followed planner/builder path treats capsules as execution inputs and supplied witnesses as existing witnesses; it does not turn a supplied witness hash into a fresh signature. This is a limited non-finding, not evidence that every nested field is independently authorized (`apps/extension/src/wallet/services/execution/planner.ts:175`, `:186`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:134`, `:146`, `:156`, `:502`).

- **N-8 — Q5, authwit shape and silent authorization:** **High confidence, excluding F-2:** direct raw hashes are rejected at the bridge. Structured inner hashes remain supported, require consumer-wide coverage when transaction/simulation scope exists, and always take explicit confirmation. Silent signing requires a structured call covered by transaction or transaction-simulation scope. Signer membership and the execution sink’s ABI binding still apply. Caller is hash-bound but is not a separately restricted dimension of the current capability model; no bypass of a caller restriction that the model actually defines was found (`packages/wallet-bridge/src/method-scope-checkers.ts:270`, `:276`, `:312`, `:331`; `packages/wallet-bridge/src/dispatcher.ts:985`, `:990`, `:1002`, `:1077`; `apps/extension/src/wallet/services/execution/service.ts:900`, `:922`).

- **N-9 — Q6, session-row MAC:** **High confidence:** the KDF does **not** include the profile ID; it uses the profile master secret with fixed salt/info. Thus identical masters yield identical MAC keys. Nevertheless, `profileId` and all other persisted authority-bearing fields are included in the authenticated row, and secret access requires the active profile. Changing the row’s profile ID alone invalidates its MAC. Invalid/missing MACs yield no usable row; unavailable keys hide rows until unlock. No profile-swap bypass was demonstrated. The MAC provides integrity, not rollback protection (`apps/extension/src/wallet/services/profile/service.ts:913`; `apps/extension/src/wallet/services/profile/session-manager.ts:214`; `apps/extension/src/wallet/services/dapp-session/integrity.ts:30`; `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:85`).

- **N-10 — Q7, empty results and catch-and-continue:** **High confidence in the reviewed authorization ladder:** missing sessions and required capability types throw before routing; empty grant lists are legitimate for exempt methods or empty negotiations. Checker-local “no matching capability” returns rely on that preceding gate. Empty account membership returns no accounts. Rejection-persistence failures grant nothing; invalid MAC deletion failures still return no row. Journal failures omit bookkeeping, not dispatch authorization. Some negotiation coverage shortcuts can echo requested capability details, but the execution gates continue to use stored grants; no resulting authority escalation was demonstrated (`packages/wallet-bridge/src/dispatcher.ts:692`, `:711`, `:833`, `:1128`, `:1249`, `:1312`, `:1327`; `apps/extension/src/wallet/services/dapp-session/mac-storage.ts:100`; `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:221`).

- **N-11 — Q8, schema patches and unknown methods:** **High confidence:** all four patched methods have explicit registry entries. Unknown methods are rejected using an own-property check before routing, including prototype-property names. `registerContractClass` is deliberately denied even if the SDK schema recognizes it, and batch does not provide an alternate route (`packages/wallet-sdk-schema-patch/src/apply.ts:34`; `packages/wallet-bridge/src/method-descriptors.ts:386`; `packages/wallet-bridge/src/method-scope-checkers.ts:407`; `packages/wallet-bridge/src/dispatcher.ts:692`, `:905`).

- **N-12 — Q9, locked queues and subdomains:** **High confidence in the local caps, with F-3 exceptions:** locked discoveries reject coalesced or excess request IDs upstream instead of retaining them. The preboot relay has global/per-origin bounds and expiry. Subdomains receive separate per-origin buckets, but cannot bypass the global bound in these capped paths. The queued-journal limits bound journal rows; they are not an RPC/FIFO admission limit and should not be treated as one (`apps/extension/src/wallet/services/wallet-sdk/background.ts:628`; `apps/extension/src/wallet/services/wallet-sdk/content-relay.ts:94`, `:99`, `:123`; `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:170`, `:185`, `:190`).

- **N-13 — Q10, response epoch and profile switching:** **High confidence in local suppression:** the handler captures the epoch before the awaited active-profile read, checks the live session’s owner, and suppresses both success and error responses after an epoch change. Switching profiles terminates mismatched or unstamped channels; establishment’s guarded stamp compensates for termination races. No local profile-switch response crossover was found. The final asynchronous upstream delivery implementation remains outside this review (`apps/extension/src/wallet/services/wallet-sdk/background.ts:873`, `:887`, `:947`; `apps/extension/src/wallet/services/wallet-sdk/profile-switch-teardown.ts:45`, `:85`, `:112`, `:122`).

## Handoff edges followed

- Content script → extension runtime relay → local frame/envelope checks → upstream wallet-sdk listener. Inspected the extension call sites; upstream origin derivation, cryptographic session binding, and navigation/restart behavior remain unresolved.
- Discovery approval → session-established callback → profile stamp and verification-window URL. Followed the verification UI’s URL-hash consumption and remembered-trust update.
- Decrypted wallet request → validation/FIFO handling → dispatcher → method registry, scope checks, and account resolution.
- Capability popup result → widening merge → locked session update → MAC-protected storage.
- Dispatcher execution → immediate simulation, utility, transaction-builder, and authwit handlers. Followed selector binding and live-chain metadata to their immediate execution/signing consumers.
- Profile change/session deletion → transport teardown → response-epoch suppression.
- Session MAC storage → profile key derivation → active-profile secret access.

## Cross-rebuttal

1. **Its findings, one line each**

- **DOWNGRADE Claude F-1:** Confirm the authorization-control gap, but retain **moderate confidence** and remove the asserted confidentiality impact: authorization uses `call.name` at `packages/wallet-bridge/src/method-scope-checkers.ts:169`, while `apps/extension/src/wallet/services/execution/fast-path.ts:109` and `:202` forward the independently supplied selector without local ABI binding; its trace does not establish that another public function’s result contains confidential information.

2. **What it missed**

- **My F-2 — Colliding live chain identity remains accepted before signing.** `packages/aztec-runtime/src/utils/chain-identity.ts:55` compares only XOR: `(1,5)` and `(2,6)` both produce `4`. `apps/extension/src/wallet/services/execution/service.ts:875` accepts that comparison, incorporates the live tuple at `:876`, hashes it at `:922`/`:929`, and signs at `:935`. Account derivation from the stored L1 identity does not validate this later response. The other report does not resolve the explicitly requested chain-binding question.
- **My F-3 — Unlocked discovery resources escape the caps.** Same-key discoveries wait at `apps/extension/src/wallet/services/wallet-sdk/background.ts:666` and `:718`, before the cap at `:670`; accounting at `:750` counts popup keys, not waiters. Remembered sessions also bypass that cap at `:647`, then can each open a verification window at `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:145`. Its locked-queue analysis is correct but does not cover these branches.
- **Requested KDF detail omitted:** `apps/extension/src/wallet/services/profile/service.ts:913` uses the selected master with fixed salt/info at `:922`/`:923`; the profile ID is not a KDF input. This remains a non-finding because authenticated row identity and secret-access checks prevent the simple profile-ID substitution.

3. **What I missed**

No additional finding to adopt. Its sole finding matches my F-1. Its claimed dependency inspection supplies a type declaration, not a demonstrated runtime confidentiality trace, and violates the explicit prohibition on reading `node_modules`; I did not repeat that inspection.

4. **Overconfidence in both reports**

- **Claude’s F-1:** “Any other public view” and confidentiality loss exceed the evidence. A suitable alternate function must execute successfully, and neither report demonstrates disclosure of protected data. Passing `fromAddr` to a simulation helper does not itself establish authenticated access to account-only information.
- **Claude’s origin non-finding:** Calling top-frame attribution an “upstream concern” leaves Q1 unresolved; it does not establish safety. `apps/extension/src/wallet/services/wallet-sdk/tab-lifecycle.ts:26` explicitly documents largely unavailable navigation cleanup. Neither report inspected enough upstream transport behavior to settle cross-origin reuse.
- **Claude’s establishment non-finding:** “Fail-closed at every step” is too broad. `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:155` returns success after opening the window, without awaiting human verification. That may be intentional, but it cannot prove human verification gates dispatch.
- **My report:** The mocked harnesses establish local control omissions, not browser exhaustion, actual alternate-function execution, or cross-chain acceptance of signed material. F-2 requires a controlled/drifted enrolled RPC; F-3 demonstrates missing admission bounds, not measured service failure. My F-1 therefore remains moderate. My labels “non-finding” for upstream-dependent questions mean unresolved, not certified safe.

5. **Net position**

- **F-1 — simulateTx optimized prefix lacks function-name/selector binding — Moderate confidence.** Authorization gap; confidentiality impact unproven.
- **F-2 — Live signing accepts colliding chain-identity tuples — High confidence.** Unexpected signing domain demonstrated in the local trace; downstream acceptance unproven.
- **F-3 — Discovery caps omit duplicate waiters and reconnect verification windows — High confidence.** Admission-control gaps confirmed; practical exhaustion impact unmeasured.