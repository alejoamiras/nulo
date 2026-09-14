# harden-b4-approval — codex audit transcript

## Round 1 — 2026-09-14, GPT-6 Astra `high`, session `01a0a216-d8d1-7cd1-9551-d414b849ee72`

Prompt: the seed rows F-02/F-16/F-18, the findings, recon.md, the draft plan, the competing outline, the touched code, asks A–F, the adversarial lenses (i)–(vi), the no-over-engineering rule verbatim.

### Response (paths made repo-relative)

**The draft needs changes before implementation. Confidence: high.** Locked owner decisions remain unchanged. Read-only review; no tests or e2e configurations were run.

## Asks A–F

- **A — Delete the mint set.** The raw-argument fallback preserves disclosure without adding another maintained signature list.
- **B — Derive from `abiBuilder`.** Keep **multiple signatures per name**. Parameter names describe the expected ABI shape; they do not prove a contract’s semantics or that the account is the caller under NO_FROM.
- **C — Fail closed on newly discovered hashes.** Comparing sets is sufficient; a subset does not introduce additional authority. The comparison baseline must be an SW-held preview bound to the operation, not an arbitrary popup-supplied list. Cover NO_FROM too.
- **D — Keep burst 3, refill 20 seconds, verify caps 2/origin and 8/global, and waiter bound 8 provisionally.** Queue 4 requires explicit expiry: requests at positions 3–4 reach refill at 60/80 seconds, beyond the 55-second cutoff. Count fresh connections, all chains, and all tabs. Preserve B-13 by reserving capacity before approving discovery.
- **E — Use one index-aligned delta envelope.** Apply fields individually, but validate their contents and their compatibility with the stored request.
- **F — Yes: cover both `call` and `encoded_call` actions.** Their arguments remain hidden otherwise.

## Numbered findings

### 1. **Blocking — A foreign estimate can bypass name↔selector validation**

[plan.md:17](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:17) relies on the existing fingerprint as sufficient binding. However, [operation-fingerprint.ts:130](apps/extension/src/wallet/services/execution/operation-fingerprint.ts:130) omits an encoded call’s `name`.

A compromised popup can estimate `{name: actualName, selector: S}`, then approve a stored request `{name: differentName, selector: S}` with identical remaining fields. The fingerprint matches; the reuse branch returns the cached request at [dapp-send-executor.ts:670](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:670), bypassing the fresh-build check at [tx-request-builder.ts:577](apps/extension/src/wallet/services/execution/tx-request-builder.ts:577).

**Smallest fix:** include optional names in encoded-call fingerprints, including encoded authwit content. Test an estimate whose **only** difference from the stored operation is its name. Ordinary recipient/amount substitutions already miss the fingerprint.

### 2. **Blocking — `feeSettings` can override the stored self-pay requirement**

The draft permits any fee settings on either send kind ([plan.md:17](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:17)). Self-pay is currently locked to `fj` only in the popup at [OperationCard.vue:75](apps/extension/src/popup/windows/execute/OperationCard.vue:75). The planner records `requestedPayment`, but execution selects the strategy from the supplied settings at [service.ts:965](apps/extension/src/wallet/services/execution/service.ts:965).

Thus the delta can change payment behavior, including introducing FPC payment actions, rather than merely selecting a higher priority.

**Smallest fix:** enforce stored fee-path constraints SW-side: self-pay requires `fj`; embedded payment remains embedded; other sends accept only valid selectable methods. Test self-pay plus an `fpc` delta and embedded payment plus a conflicting delta.

### 3. **Blocking — `previewedInterface` is not authenticated by its address/chain check**

[service.ts:745](apps/extension/src/wallet/services/execution/service.ts:745) accepts the entire interface when two caller-controlled identity fields match. A popup can preserve those fields while replacing function mappings. Those mappings are persisted at [token/service.ts:385](apps/extension/src/wallet/services/token/service.ts:385).

Also, contrary to [plan.md:25](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:25), a mismatched contract currently triggers **re-parsing**, not rejection.

**Smallest fix:** re-derive the interface SW-side during approval; treat the popup value as a hint only. Test matching contract/chain with altered function mappings.

### 4. **Blocking — The rebuilt-authwit baseline remains popup-authored**

[plan.md:16](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:16) treats supplied hashes as “the hashes it displayed.” Nothing verifies that provenance or binds the list to the estimate ID and stored operation. The REUSED branch does not compare the supplied list at all.

The competing outline has the stronger **SW-owned baseline** approach, but its implementation is incomplete: [operation-estimate-reuse.ts:120](apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:120) consumes the entry before returning a miss; ineligible estimates never have an entry.

**Smallest fix:** retain SW-owned preview hashes with their operation fingerprint independently of whether the built transaction remains reusable. Resolve that snapshot for both reuse and rebuild; missing preview means empty authority. Test forged hashes, stale/mismatched preview IDs, and no-estimate execution.

### 5. **Blocking — NO_FROM still signs undisclosed authwits**

The placeholder “Authorizations resolved at send” in [plan.md:16](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:16) does not close disclosure or binding.

NO_FROM bypasses the proposed standard rebuild comparison and explicitly creates witnesses at [dapp-send-executor.ts:874](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:874).

**Smallest fix:** apply the same preview and unseen-hash guard to the existing NO_FROM discovery path, before creating witnesses. Keep that rejection outside its broad “not an authorization request” catch.

Suppressing `send_transaction` discoveries is correct because its confirm path adds none. Standard embedded-fee confirmation also skips discovery; neither justifies exempting NO_FROM.

### 6. **Blocking — Returning `true` for queued verification weakens B-13**

[plan.md:18](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:18) establishes queued sessions before their window opens. [background.ts:396](apps/extension/src/wallet/services/wallet-sdk/background.ts:396) then allows message dispatch. A queued session can perform work before a later window failure terminates it—or without ever displaying verification if the existing windows remain open.

The outline’s two-tab justification is incorrect: [session-tabClose.test.ts:34](apps/extension/tests/e2e/network/session-tabClose.test.ts:34) approves and closes verification **before** closing the first tab.

**Smallest fix:** reserve verify capacity before `approveDiscovery`; queue excess discoveries before key exchange, preserving the existing establishment gate. Apply the reservation to returning, fresh, and duplicate-waiter approval sites. Do not delay the SDK’s key-exchange response itself.

### 7. **Blocking — The throttle has no production drain trigger**

The draft specifies lazy clock reads, but promises that queued requests run every 20 seconds ([plan.md:18](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:18)). After a finite burst ends, no further call necessarily arrives to drain the queue.

Additionally, upstream [background_connection_handler.ts:294](apps/extension/node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:294) makes `rejectDiscovery` delete the SW entry; it **does not notify the page**. “Rejected explicitly” therefore does not imply an immediate disconnected UI.

**Smallest fix:** schedule a cancellable drain while entries exist, expire entries by their discovery deadline, and recheck current profile/session eligibility before approval. Test a finite burst with **no subsequent discoveries**, using the production scheduling path. Account for the page’s discovery timeout in e2e assertions.

### 8. **Should-fix — The verify queue can grow indefinitely**

The proposed open-window caps do not bound queued established sessions ([plan.md:18](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:18)). A remembered origin gains another queued entry every refill while two windows remain open. Dead entries are checked only when dequeued.

**Smallest fix:** make queued reservations part of the bounded pre-handshake admission queue from finding 6; remove reservations on termination. Test sustained admission with no window closes, plus multiple chains and fresh-connection waiters. The assertion that discovery already serializes all fresh connections is false: [background.ts:661](apps/extension/src/wallet/services/wallet-sdk/background.ts:661) explicitly permits concurrent chains.

### 9. **Blocking — The vocabulary representation loses variants and the inferred sender can lie**

The `Map<name, signature>` in [plan.md:14](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:14) cannot represent both two- and four-argument variants. Both `transferPrivate` and `transferPublicToPrivate` have them ([descriptors.ts:356](apps/extension/src/wallet/services/token/functions/descriptors.ts:356), [descriptors.ts:381](apps/extension/src/wallet/services/token/functions/descriptors.ts:381)).

“From: this account” is false for NO_FROM: [tx-request-builder.ts:403](apps/extension/src/wallet/services/execution/tx-request-builder.ts:403) explicitly executes with no message sender.

**Smallest fix:** use name→signatures, or `(name, arity)` keys. Render inferred caller only for account execution; show no caller for NO_FROM. Avoid calling name/arity matching “descriptor-verified” semantics.

The outline’s multi-signature representation wins; its claim that `transfer_in_private` accepts only four arguments contradicts its own descriptor cross-product.

### 10. **Should-fix — Raw-argument disclosure remains incomplete**

[OperationActionRow.vue:11](apps/extension/src/popup/windows/execute/OperationActionRow.vue:11) hides arguments for both call forms. The planned `safeWire(value, 64)` also truncates even a normal 66-character address; [humanize.ts:42](apps/extension/src/popup/windows/execute/humanize.ts:42) confirms truncation is destructive.

**Smallest fix:** add indexed arguments to both action forms and retain an inspectable full sanitized value for truncated arguments/hashes. Include ordinary strings and structured raw arguments, not only canonical numeric projections.

### 11. **Should-fix — Several tests would remain green with the relevant fix deleted**

The coverage in [plan.md:25](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:25), [plan.md:30](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:30), and [plan.md:35](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:35) needs these distinctions:

- Existing sequential reconnect and named compatibility cells stay green without F-18.
- A short flood capped at two windows stays green without the **throttle**, if the reservation remains.
- Discovery-record/card tests stay green without the **confirmation binding**.
- A fingerprint test changing recipient/amount misses the name-only bypass.
- Deriving expected and actual vocabulary from the same descriptors does not make descriptor edits fail automatically.

**Smallest fix:** add the negative cases above; assert timed admission separately from window counts. Arm `waitForPopup` **before** closing a window, since its snapshot excludes targets already present. Use an actual decoded authorization fixture for the retained preimage fields.

### 12. **Should-fix — The fix-loop exit contradicts the locked delivery gate**

[plan.md:52](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:52) permits delivery after three rounds with material residue. The seed requires convergence before submission.

**Smallest fix:** replace “continue to delivery” with “stop, reassess, and record unresolved findings.”

**Verdict: `reject`.**

## Round 2 — 2026-09-14 (resumed session)

Prompt: the ledger, the revised plan, the four change areas, questions (a)–(f).

### Response (paths made repo-relative)

**The revision closes the main substitution paths, but reservation cleanup and NO_FROM previewing still block approval. Confidence: high.** No tests were run.

## Answers (a)–(f)

**(a)** Reserving before approval is sound. The fresh branch must retain its dedupe promise until admission finishes, recheck its approving profile after waiting, and release the reservation immediately if `approveOrRollbackDiscoverySession` returns `false` or throws. These transitions are not yet specified.

**(b)** The revised design includes dedupe waiters, so they cannot bypass admission **if implemented literally**. The existing direct approval at [background.ts:731](apps/extension/src/wallet/services/wallet-sdk/background.ts:731) must go through that gate. “The dedupe pin survives” does not test this replacement.

**(c)** Estimate-by-reference supports fee changes: rematerialize the immutable request and apply the new validated settings each time. Preserve the attempt’s `estimateToken`, existing per-window `flowKey`, and `withEstimateAdmission`. The map currently does **not** pass its index to the estimator callback ([useFeeEstimationMap.ts:69](apps/extension/src/composables/useFeeEstimationMap.ts:69)); the smallest change is to include `index` in scheduled params. No change to the single-slot composable is necessary.

**(d)** Through the revised approval/estimate endpoints, no other arbitrary transaction input remains apparent. Globally, a compromised popup can still call RPC-exposed `executeOperations` and `executeTransfer` ([service.ts:83](apps/extension/src/wallet/services/execution/service.ts:83)). Describe F-16 as binding these interaction endpoints, not confining every compromised extension context.

**(e)** Interaction A’s snapshot must fail for B even with an identical fingerprint; the revised identity check and listed test correctly require this. TTL-only retention after rejection is not an authorization bypass when the interaction is unapprovable, but cancellation should evict snapshots through the existing cancellation hook. Do not evict handed-off snapshots merely because approval deletes the interaction record.

**(f)** Several negative controls remain missing; see findings 3–5. Existing compatibility tests are useful regression coverage, not evidence that the new security controls work.

**Ledger row 15:** I withdraw the request to extend plain action rows in this batch. The traced dApp producer constructs `add_public_authwit`, not a plain `call` action ([dispatcher.ts:1082](packages/wallet-bridge/src/dispatcher.ts:1082)).

## Findings

### 1. Blocking — Session termination can release capacity while its window remains open

[plan.md:18](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:18) releases the reservation on `onSessionTerminated`, including after window creation. Closing a dApp tab terminates its transport ([tab-lifecycle.ts:52](apps/extension/src/wallet/services/wallet-sdk/tab-lifecycle.ts:52)); that does not close its separate verify window.

An origin can connect, leave verification open, close its tab, and reconnect. Each termination frees the counter while retaining the OS window. The bucket slows accumulation but does not enforce the window cap.

**Smallest fix:** termination releases an **unopened** reservation only. An opened window retains its slot until `onRemoved`, or is explicitly closed before releasing capacity. If termination happens during `create`, remove the returned stale window instead of adopting it.

**Test:** leave verification open, terminate its transport, then reconnect. Assert actual open-window count remains within the cap.

### 2. Blocking — Fresh admission lacks an explicit completion and rollback contract

The enum-returning callback gate in [plan.md:18](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:18) does not specify how asynchronous fresh-session creation stays attached to admission.

Today:

- Durable session writes precede final approval ([background.ts:805](apps/extension/src/wallet/services/wallet-sdk/background.ts:805)).
- The enclosing `finally` releases dedupe waiters ([background.ts:836](apps/extension/src/wallet/services/wallet-sdk/background.ts:836)).
- `approveOrRollbackDiscoverySession` returns `false` both for expiry and an SDK approval that did not land ([discovery-approval.ts:38](apps/extension/src/wallet/services/wallet-sdk/discovery-approval.ts:38), [discovery-approval.ts:62](apps/extension/src/wallet/services/wallet-sdk/discovery-approval.ts:62)). Neither produces a transport termination callback.

Returning from `runDiscoveryPopup` merely because admission returned `"queued"` releases its dedupe guard prematurely. Reserving and then ignoring the helper’s `false` result strands capacity until the deadline.

**Smallest fix:** specify this ordering:

1. After popup approval, await admission **before durable session creation**.
2. Revalidate the approving profile after the wait.
3. Keep the existing dedupe promise pending through creation and final approval.
4. Immediately release the reservation on false/throw; transfer ownership only after successful `approveDiscovery`.

Test expiry during writes, SDK approval returning false, and a queued fresh request with duplicate waiters.

### 3. Blocking — NO_FROM still has no working route to produce its preview

[plan.md:16](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:16) simultaneously says NO_FROM displays “Authorizations resolved at send” and requires a preview snapshot before creating discovered witnesses.

The source resolves the deferred question:

- Embedded operations suppress the fee card ([OperationCard.vue:165](apps/extension/src/popup/windows/execute/OperationCard.vue:165)).
- The only estimate scheduling call is in the fee-update handler ([index.vue:386](apps/extension/src/popup/windows/execute/index.vue:386)).
- NO_FROM discovers and signs during confirmation ([dapp-send-executor.ts:785](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:785)).

Consequently, the proposed guard rejects every popup-approved NO_FROM operation that needs a discovered witness. Retrying unchanged cannot help.

**Smallest fix:** explicitly schedule a NO_FROM preview after popup initialization, using its actual discovery path, and render that result. Remove the contradictory placeholder for this path. State how already-authorized silent NO_FROM execution is distinguished from popup approval; do not accidentally require an interaction snapshot on a path with no interaction.

**Test:** a positive NO_FROM preview→approval case. The listed unseen-hash rejection test stays green with all NO_FROM preview wiring deleted.

### 4. Should-fix — Snapshot cancellation is disconnected from the existing lifecycle

The new map in [plan.md:16](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:16) has TTL retention but no cancellation integration. Existing `evictStash` removes only the two transaction caches ([service.ts:239](apps/extension/src/wallet/services/execution/service.ts:239)). The registry deliberately invokes it even when cancellation races a successful stash ([estimate-cancel-registry.ts:171](apps/extension/src/wallet/services/execution/estimate-cancel-registry.ts:171)).

**Smallest fix:** add snapshot eviction to that callback; return the snapshot’s ID through the existing settlement flow even when transaction reuse is ineligible. Explicitly compare snapshot fingerprint as well as interaction/index. Preserve completed-estimate handoff.

**Tests:** cancelled-after-stash and cancelled-during-estimation cases must remove the snapshot; successful approval handoff must retain it until validation finishes. Existing cancellation tests could pass while the new snapshot leaks.

### 5. Should-fix — Admission tests contradict the two-window limit and do not prove throttling

[plan.md:35](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:35) expects **three immediate approvals** for remembered untrusted sessions, despite only **two open-or-reserved slots**. With no closes, the expected outcome is two admitted, four queued, six rejected—not 3/4/5. Refilling tokens cannot admit requests while window capacity remains exhausted.

The flood e2e asserts completion within approximately 30 seconds. Removing the token bucket would make completion faster and still satisfy that assertion.

**Smallest fix:** separate expectations:

- Trusted reconnects exercise token-only admission.
- Untrusted reconnects exercise the combined gate.
- After freeing both windows promptly, assert the fourth reconnect remains pending before the refill and completes after it.
- Add a dedupe-waiter case with occupied capacity; deleting its gate must fail the test.

### 6. Should-fix — `AddressDisplay` does not show full addresses by default

[plan.md:15](implementations-plan/harden-2026-09-remediation/b4-approval/plan.md:15) assumes using `AddressDisplay` preserves the visible full value. Its `full` prop defaults to false, and it otherwise calls `trimAddress` ([AddressDisplay.vue:17](apps/extension/src/components/AddressDisplay.vue:17), [AddressDisplay.vue:81](apps/extension/src/components/AddressDisplay.vue:81)).

**Smallest fix:** explicitly pass `full` for raw-address arguments and test the real component, not an address-echoing stub. For NO_FROM, use “Caller: none” rather than suggesting the transaction entrypoint is a sender.

**Verdict: `reject`.**
