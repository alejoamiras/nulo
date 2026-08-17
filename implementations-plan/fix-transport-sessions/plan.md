# fix-transport-sessions — Arc 4 of the 2026-08-16 remediation

Five findings in the **transport + dApp-session** layer: unguarded async callbacks, per-tuple vs per-session state, multi-write lost updates, a timeout that doesn't cover connect, and an in-memory discovery queue that dies on SW restart. Source of truth: `audit/bugs/2026-08-16-extension-mid/findings/consolidated.md` (B-06, B-13..B-16). **Prove-first**: a RED repro (test/script) per finding verified against pre-fix source, then GREEN. Smallest-safe; no new abstraction unless ≥3 sites benefit AND codex agrees. [light] tier — single codex plan audit, then implement, then ONE codex pass over the arc diff.

## Findings + proposed fixes

### B-06 (Critical) — per-tuple verification hash shows the WRONG emojis
`wallet-sdk/background.ts:212/220/222/247` + `dapp-session/service.ts:203` + `verify/index.vue`. Two live `ActiveSession`s sharing one stored `DappSession` overwrite each other's `verificationHash`; a verify window reads the shared row and can display the OTHER session's emojis → "Always trust" trusts a channel it never verified.
- **Fix (recommended):** key verification state per active wallet-SDK session (`{activeSessionId, dappSessionId, verificationHash}`), not the tuple-level `DappSession.verificationHash`. The verify window resolves by `activeSessionId`.
- **Open Q for codex:** is there a stable `activeSessionId` on the callback + reachable by the verify window's query params? If not, what identifier keys the per-session map?

### B-13 (Major) — unguarded `onSessionEstablished` → leaked pending-verification OR unverified live session
`wallet-sdk/background.ts:212-256`. The `else` (missing-DappSession) branch `return`s before the `pendingVerification.delete` cleanup; and a `setVerificationHash` reject (or a throwing `chrome.windows.create`) leaves a live session that never shows verification, un-terminated.
- **Fix:** wrap the whole callback in try/catch/finally — clear `pendingVerification` in `finally`; await `chrome.windows.create`; terminate the specific active session if verification persistence or the popup fails.

### B-14 (Major) — capability grant lost across multi-write sequence
`wallet-bridge/dispatcher.ts:963-1042` pushes precomputed whole-row arrays across several separately-locked writes (`updateDappSession`/`setAccountAliases` → `setCapabilityGrants` → `setCapabilityRejections` → reload). A concurrent revoke throws "Invalid id" mid-sequence (approval discarded, cryptic error); two concurrent approvals both snapshot pre-write and the later clobbers the earlier.
- **Fix:** one `applyCapabilityDecision` service mutation that reacquires the latest row UNDER THE LOCK and merges the approved delta/accounts/aliases/rejections in a SINGLE write. Dispatcher calls it once.

### B-15 (Major) — RPC timeout doesn't cover connection establishment
`extension-messaging/src/core/base-client.ts:101-125` awaits `ensureTransportReady()` BEFORE installing the timeout correlator, and `connect()` retries "Extension context invalidated" forever → a wedged transport hangs the request regardless of `requestTimeoutMs`.
- **Fix:** compute a total request deadline BEFORE awaiting readiness; pass the remaining deadline / an AbortSignal into the readiness wait; reject with a typed timeout/disconnection error when readiness can't be achieved in time. Mirror in `background/client.ts` + `offscreen/client.ts`.

### B-16 (Major) — queued discovery lost on SW restart / approved after dApp gave up
`wallet-bridge/discovery-queue.ts` + `wallet-sdk/background.ts:324/383-410/486-498`. The in-memory-only queue vanishes on MV3 reclaim; and Nulo's 5-min stale threshold outlives the SDK's 60s discovery timeout, so it can approve a connection the dApp stopped waiting for.
- **Fix:** give queued discoveries an explicit SDK-compatible expiry (≤60s); persist the queue to `chrome.storage.session` and reconcile on SW boot (drop expired).
- **Open Q for codex:** exact SDK discovery timeout to match (60s?), and whether `chrome.storage.session` is the right store (ephemeral, survives SW restart within a browser session — yes).

## Prove-first strategy
- B-06: unit — two sessions sharing a tuple; assert the verify-window resolver returns EACH session's own hash (RED: shared row returns the other's).
- B-13: unit — drive the callback with (a) missing DappSession and (b) a rejecting setVerificationHash; assert pendingVerification cleared + session terminated (RED: leak / live-unverified).
- B-14: unit — concurrent approvals / delete-mid-sequence; assert the final row merges both / surfaces a typed error (RED: clobber / "Invalid id").
- B-15: unit — fake-timer; a never-ready transport; assert the RPC rejects within the deadline (RED: hangs).
- B-16: unit — expiry + restart-reconcile; assert an expired queued discovery is dropped and a live one survives a simulated boot (RED: 5-min live / in-memory vanish).

## Security & adversarial
B-06 is the security-relevant one: a wrong-emoji verify window can trick a user into trusting an unverified channel. The fix must guarantee the displayed emojis derive from that exact session's own hash. B-13/B-14 touch the authz/session-approval boundary — a lost or skipped decision must fail CLOSED (session terminated / error surfaced), never silently continue.

## Codex plan-audit amendments (adopted)

- **B-06 — SIMPLIFY to a window snapshot (no per-session store).** Stop reading/persisting the hash on the shared `DappSession`; pass the immutable, URL-encoded `session.verificationHash` when opening the verify URL (alongside `dappSession.id`). The window displays that snapshot (falls back to the row for legacy). `session.verificationHash` is SW-set (trusted), not user-forgeable.
- **B-13 — amend:** establish the tuple cleanup key BEFORE fallible awaits; the missing-row branch AND all setup failures call `handler.terminateSession(session.sessionId)`; AWAIT `chrome.windows.create` and treat a missing returned window/id as failure; cleanup (`pendingVerification.delete`) in `finally` incl. early returns; terminate in `catch` (fail-closed). Since B-06 removes hash persistence, the failure test is popup-creation rejection.
- **B-14 — amend:** one `applyCapabilityDecision` doing `get → merge → set → emit` ENTIRELY inside the existing service lock, never calling the lock-taking setters. Inputs are decision DELTAS, not premerged arrays. Merge selected accounts + alias patches + approved grants + decision-type rejections (approval clears the corresponding prior rejection; a denied widening preserves the older grant). **Concurrent same-type approvals:** implement capability-specific UNION (don't let generic replacement lose a scope). Use the mutation on the popup-REJECTION path too; return the committed row for enrichment; surface a structured "session revoked" error when the row is absent.
- **B-15 — amend:** the deadline begins BEFORE readiness and covers readiness+send+response, centralized in the base client; both background+offscreen hooks accept the signal/deadline. Aborting `waitForConnection` alone is insufficient — `connect()`'s retry must observe cancellation OR treat "Extension context invalidated" as terminal. Offscreen cancellation propagates through `onReady()`. A late shared transport may stay available but the expired request must NEVER send; do NOT disconnect a transport shared by other requests.
- **B-16 — amend AND ESCALATE (beyond [light]).** `chrome.storage.session` is right; `expiresAt = discovery.timestamp + 60_000`, expire at `now >= expiresAt`. **Blocking omission:** the SDK handler's `pendingDiscoveries` map ALSO dies on restart — persisting only the queue leaves `getPendingDiscovery(requestId)` undefined so nothing can be approved. Reconciliation must persist enough to reconstruct/replay the SDK pending discovery, validate tab/origin, drop expired, and process live entries when already unlocked — one SERIALIZED state machine (hydrate → enqueue → drain → persist; remove durable entries only after terminal processing). **Decision: B-16 ships as its own focused follow-up PR within this arc** (its own prove-first + codex pass), so the 4 well-scoped fixes land clean first. SDK exact-timeout match is impossible without an SDK change (shorter caller timeouts aren't on the wire) — 60s is the correct upper bound.

## Implementation progress + concrete designs

**Committed:** B-06 + B-13 (`93808e46`) — extracted `wallet-sdk/session-established.ts` (`handleSessionEstablished` + `chainInfoToChainId`); verify window prefers the URL `verificationHash` snapshot; callback is fail-closed (terminate on any failure, `pendingVerification` cleared in `finally`). 3 prove-first pins (`session-established.test.ts`) RED→GREEN.

### B-14 — concrete design (next)
`dispatcher.ts:handleRequestCapabilities` (876-1049) computes merges from a SNAPSHOT (`dappSession`, `existingGrants`, `existingRejections` captured at :877-878) then does FOUR separately-locked writes (`updateDappSession` :983, `setAccountAliases` :990, `setCapabilityGrants` :1030, `setCapabilityRejections` :1039) + reload :1042. Each `DappSessionService` setter is its own `lock.withLock(get→mutate→set→emit)` (service.ts:161-262), so a concurrent revoke/approval interleaves between them.

**Fix:** add `DappSessionService.applyCapabilityDecision(sessionId, decision)` — ONE `lock.withLock` doing `get(latest) → merge → set → emit` once, never calling the lock-taking setters. Decision (deltas, not premerged arrays):
```
{ addAccounts: string[]; aliasPatch: Record<string,string>; approvedGrants: GrantedCapabilityRecord[]; rejectedTypes: string[]; approvedTypes: string[] }
```
Merge against the LATEST row (not the dispatcher snapshot):
- accounts = latest.accounts ∪ addAccounts
- accountAliases = { ...latest.accountAliases, ...aliasPatch }
- grants: for each approvedGrant, UNION into latest.capabilityGrants per capability type (capability-specific union — `contracts` unions contract sets; `accounts`/`transaction` replace-if-changed; never let a generic replace drop a concurrently-approved scope); drop grants whose type is in rejectedTypes.
- rejections = latest.capabilityRejections filtered to types NOT in approvedTypes/rejectedTypes-of-this-decision, + new rejectedTypes (approval CLEARS the corresponding prior rejection; a denied widening PRESERVES the older grant).
- if `!latest` → throw a structured `SessionRevokedError` (not bare "Invalid id").
Return the committed row. Dispatcher computes the deltas from `result`/`delta`/`existingGrants` (the `replacementFor`/`deltaApprovedTypes` derivation stays dispatcher-side to shape approvedGrants) and calls `applyCapabilityDecision` ONCE — on BOTH the grant path AND the popup-reject path (reject = empty approves + all-delta rejectedTypes). Prove-first: concurrent approvals both land (union); a delete mid-decision surfaces `SessionRevokedError`, not a clobber.

### B-15 — concrete design
`extension-messaging/src/core/base-client.ts:101-125` awaits `ensureTransportReady()` BEFORE creating the pending correlator → the `requestTimeoutMs` timer only starts after readiness. Fix: compute `deadline = now + requestTimeoutMs` at request entry; race `ensureTransportReady()` against an AbortSignal/deadline; on deadline reject a typed `TransportTimeoutError` and do NOT send. `connect()`'s retry loop (`background/client.ts` + `offscreen/client.ts`) must observe the abort OR treat "Extension context invalidated" as terminal (stop retrying). Don't disconnect a transport shared by other requests. Prove-first: fake-timer; a never-ready transport rejects within the deadline.

### B-16 — ESCALATED, own follow-up PR
Persist BOTH the discovery queue AND enough to replay the SDK `pendingDiscoveries` to `chrome.storage.session`; `expiresAt = timestamp + 60_000`; one serialized reconcile-on-boot state machine (hydrate → validate tab/origin → drop expired → process live when unlocked; remove durable entries only after terminal processing). Ships AFTER B-14/B-15 land.
