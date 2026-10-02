# b05-dapp-ingress-approval — codex

Scope read: `dev` at `910a4def`. Source inspection only; no files modified or tests run. Brace groups below enumerate inspected files; some reads were targeted excerpts.

- Orientation: `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`; `audit/bugs/2026-09-30-ext-high/raw/repo-map/{_outer,extension-wallet,extension-popup,packages-high}.md`; `audit/bugs/2026-09-30-ext-high/raw/leads-from-quality-run.md`; both specified prior reports and the August 24 adjudication.
- Ingress: `apps/extension/src/wallet/services/wallet-sdk/{background,queued-journal,queued-wait-vouching,session-baton,session-established,discovery-approval,verify-admission,profile-switch-teardown,stale-session,tab-lifecycle,to-json-safe,error-envelope}.ts`.
- Services: `apps/extension/src/wallet/services/dapp-interaction/{service,client}.ts`, `apps/extension/src/wallet/services/dapp-session/{service,spec,integrity,mac-storage}.ts`, `apps/extension/src/wallet/services/window-manager/window-manager.ts`, `apps/extension/src/wallet/services/auth-registry/service.ts`.
- Dispatcher: `packages/wallet-bridge/README.md`, `packages/wallet-bridge/src/{dispatcher,account-resolution,method-descriptors}.ts`.
- UI: `apps/extension/src/popup/windows/{execute,capabilities,discover,verify,json}/index.vue`, `apps/extension/src/composables/{useDappApprovalWindow,useDappInteractionPayload}.ts`.
- Handoffs: `apps/extension/src/wallet/services/execution/claim-helper.ts`, `apps/extension/src/wallet/utils/auth-registry.ts`.
- Test excerpts: colocated window-manager, approval-window, dApp-interaction, dApp-session, queued-journal, auth-registry and error-envelope tests; dispatcher test searches for expiry and intentional-behavior exclusions.

## b05-dapp-ingress-approval-X-1: [Minor] Capability approval succeeds after its session expires

**Title:** Capability approval succeeds after its session expires.

**Severity:** Minor — requires approval to cross the seven-day session-expiry boundary; reconnecting recovers.

**Repro confidence:** high.

**Type:** wrong result; secondary: state invariant violation.

**Counter-example:** An unlocked profile has a valid dApp session expiring at time `E`. At `E − 5 seconds`, the dApp requests `{ type: "data", addressBook: true }`, which opens the capability window. The user approves at `E + 5 seconds`, with no intervening session read deleting the expired row. `applyCapabilityDecision()` persists the grant and returns success despite the past expiry. The dApp’s immediately following `getAddressBook()` encounters the expired session, deletes it and cannot use the reported grant.

**Violated invariant:** Granted capabilities must belong to a live session. `getDappSession()` rejects expired sessions, and execution approvals explicitly revalidate session liveness after the popup wait; capability approval does neither at commit.

**Failing path:**

- `packages/wallet-bridge/src/dispatcher.ts:1355` — `handleRequestCapabilities()` waits for the decision.
- `apps/extension/src/wallet/services/dapp-interaction/service.ts:435` — `requestCapabilities()` validates expiry before opening the window.
- `apps/extension/src/wallet/services/dapp-interaction/service.ts:228` — `resolveInteraction()` settles the later approval without checking expiry.
- `apps/extension/src/wallet/services/dapp-session/service.ts:343` — `applyCapabilityDecision()` checks only row existence, then persists at `:380`.
- `packages/wallet-bridge/src/dispatcher.ts:1371` — returns a successful capability response.
- The next session lookup reaches `apps/extension/src/wallet/services/dapp-session/service.ts:164` and `:399`, which reject/delete the expired session.

**Expected vs actual behavior:** Expected: refuse the expired approval and require reconnection. Actual: report permission granted, then immediately refuse its use.

**Recommended fix:** Check expiry inside `applyCapabilityDecision()`’s existing lock before mutation; reject and perform the normal expiry cleanup. Do not call the currently lock-acquiring `isExpired()` from inside that lock.

**Instances:** Missing validation at `apps/extension/src/wallet/services/dapp-session/service.ts:343`; production approval caller at `packages/wallet-bridge/src/dispatcher.ts:1362`.

## b05-dapp-ingress-approval-X-2: [Minor] Closing a loading approval reports a wallet failure instead of rejection

**Title:** Closing a loading approval reports a wallet failure instead of rejection.

**Severity:** Minor — incorrect cancellation classification; no transaction is executed.

**Repro confidence:** high.

**Type:** bad error path; secondary: wrong result.

**Counter-example:** A valid `sendTx` opens its approval window. While initialization is still awaiting account/network data, the user closes it using the browser’s close button. The popup’s `beforeunload` rejection listener has not yet been installed. The background receives `windows.onRemoved`, rejects with the string `"Window closed by user."`, and maps that string to `"The wallet could not process the request."`. A dApp following the documented `code === 4001` cancellation handling instead enters its wallet-failure branch.

**Violated invariant:** The documented dApp cancellation contract distinguishes user rejection from wallet failures. The explicit Reject button already supplies `UserRejectedError`, producing code `4001`.

**Failing path:**

- `apps/extension/src/composables/useDappApprovalWindow.ts:123` — initialization finishes before registering `beforeunload` at `:124`.
- `apps/extension/src/wallet/services/window-manager/window-manager.ts:156` — the background close listener invokes `_settleUserClose()`.
- `apps/extension/src/wallet/services/window-manager/window-manager.ts:259` — rejects with an untyped string.
- `apps/extension/src/wallet/services/dapp-interaction/service.ts:493` — propagates the rejection through the waiting request.
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:1216` — calls `toWalletResponseError()`.
- `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:197` — returns the generic failure constant rather than the `UserRejectedError` envelope at `:48`.

**Expected vs actual behavior:** Expected: closing the approval produces `4001 / USER_REJECTED`, consistently with Reject. Actual: the dApp receives an unclassified wallet failure.

**Recommended fix:** Supply a typed user-close rejection for dApp windows, either directly or through a caller-supplied close error in `WindowManager`. Preserve distinct handling for timeout and window-creation failures.

**Instances:** Shared root at `apps/extension/src/wallet/services/window-manager/window-manager.ts:259`; affected execution and capability interactions at `apps/extension/src/wallet/services/dapp-interaction/service.ts:432` and `:441`.

## Leads adjudicated

- **q11 — `queued-journal.ts:143`, missing chain-prefix filter: rejected.** The discrepancy exists, but no normal production writer was found that creates the required mixed-chain session. Discovery starts with empty accounts; capability additions are restricted to wallet-offered accounts from the session’s chain.
- **q11 — `dispatcher.ts:1084`, `grantPublicAuthwit` allowed inside raw batches: rejected.** The omission exists, but standard SDK batches exclude this custom method. The raw path still awaits permission and completion; no qualifying normal-operation failure was established.
- **q13 — `dapp-session/integrity.ts:58`, permissive base64 decoding: rejected.** Malformed input still reaches the empty-byte check or cryptographic verification failure. The ineffective decoding catch does not produce an incorrect acceptance.

## Routed to security

None established.

## Non-findings considered

- Mixed-chain journal lead: no reachable production producer; not promoted from a hypothetical stored row.
- Raw custom batch lead: unsupported input alone does not demonstrate incorrect execution or settlement.
- MAC-decoding lead: remains fail-closed.
- Worker death during discovery: timeout/retry behavior is explicitly accepted in `ARCHITECTURE.md`; established sessions have stale-session disconnect handling.
- Double approval and approve-versus-cancel: synchronous first-claim removal/marking prevents duplicate execution.
- Account selection changing after queued-journal creation: the execution claim helper detects and refiles scope mismatches while retaining cancellation identity.
- Prior B-06/B-13: verification hashes are passed per window, and message dispatch waits for establishment validation.
- Prior B-14: capability decisions merge under one service lock.
- Prior N-04/N-07/N-19: profile-bound channels, queued-wait liveness and ancestor-only serialization address the reviewed prior failure mechanisms.
- Disabling the auth registry does not erase grants through `syncAuthwit()`: its helper reads the approval map independently of the registry’s disable flag.
- Execution JSON-view URL: its query placement matches the destination’s `window.location.search` reader.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **b05-dapp-ingress-approval-C-1 — partially agree; Minor.** The user-close defect is real and overlaps my X-2. Closing during initialization makes it deterministic: `apps/extension/src/composables/useDappApprovalWindow.ts:123` installs `beforeunload` only after initialization, while `apps/extension/src/wallet/services/window-manager/window-manager.ts:259` rejects with a string. However, the ten-minute timeout counter-example overlooks the standard dApp’s documented 300-second ceiling (`ARCHITECTURE.md:176`): that caller has already timed out. Also, the resulting `response.error` is a plain string, not `{ message: ... }` (`apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:197`). **Confidence: high.**
- **b05-dapp-ingress-approval-C-2 — disagree with reporting eligibility; agree with the technical trace.** The exclusion is broader than Claude acknowledges: `apps/extension/src/wallet/services/execution/rpc-cancel.ts:82` explicitly documents deliberate code-channel exclusion, and `apps/extension/src/wallet/services/execution/rpc-cancel.test.ts:110` specifically asserts that classifying `TooManyPendingError` produces no code. Thus this exact loss is intentionally pinned, not merely the separate reconstruction defect. Under the audit’s exclusion rule, retain it as a known limitation unless additional, previously unacknowledged impact is demonstrated. **Confidence: high.**

**2. Leads Claude rejected that I think are real, or vice versa**

- No disagreement on the three quality leads’ final verdicts.
- One correction to the queued-journal rationale: filtering wallet accounts by chain does **not** prevent matching an address also present on another chain; `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:143` removes the CAIP chain, and `packages/wallet-bridge/src/account-resolution.ts:54` compares addresses only. Rejection rests on the absence of a normal mixed-chain session writer, with additions constrained to offered accounts at `packages/wallet-bridge/src/dispatcher.ts:608`.

**3. What Claude missed that I found**

- **b05-dapp-ingress-approval-X-1 — still supported; Minor, high confidence.** Claude’s session-expiry non-finding covers execution approvals only. A capability popup opened before expiry and approved afterward reaches `apps/extension/src/wallet/services/dapp-session/service.ts:343`, which checks existence but not expiry; `packages/wallet-bridge/src/dispatcher.ts:1371` then reports success. The immediately following request expires/deletes the session at `apps/extension/src/wallet/services/dapp-session/service.ts:399`, making the newly reported grant unusable.

**4. What BOTH missed**

None established with a sufficiently concrete, source-backed counter-example.