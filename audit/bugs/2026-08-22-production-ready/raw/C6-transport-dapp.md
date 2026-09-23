# Cluster C6 — transport / wallet-sdk handler / dispatcher / dApp sessions

> Scanner: general agent, 2026-08-22 (findings recovered via session resume after truncation).

## C6-1 — Live dApp channels silently re-bind to whichever profile is active after a profile switch

**Severity:** Medium | **Repro confidence:** High | **Type:** Authorization-binding gap / TOCTOU across identity switch

**Counter-example:**
1. Profiles Work (A) and Personal (B) each connected dApp X on chain C historically → two persisted rows: row-A {profileId:A, accounts:[A1], grants:[simulation,…]}, row-B {profileId:B, …} (rows per-profile: dapp-session/service.ts:120-121; per-(origin,chainId,profileId) documented spec.ts:36-39).
2. User unlocks A, loads X in tab → encrypted channel established; transport ActiveSession carries NO profile binding (background.ts wiring :229-247).
3. User switches to B (A closes, B unlocks). NOTHING terminates the channel: only onActiveProfileChanged listener in wallet-sdk wiring drains discovery queue (background.ts:392-423); teardown triggers exclusively DappSession-delete (:365-389), tab close, cross-origin nav, establishment failure, TTL (tab-lifecycle.ts:45-78). Grep-verified — no other terminateSession/terminateForTab caller.
4. X calls simulateTx over the A-era channel. handleWalletMessage builds ctx from CURRENT active profile (background.ts:681-688). Dispatch's lookup (origin, String(chainId)) filters x.profileId === profile.id where profile = ACTIVE B (dapp-session/service.ts:114-129) → finds row-B. enforceCapability passes on B's simulation grant (dispatcher.ts:1107-1162); resolveNetworkAndAccount(ctx.profileId=B) resolves B1 (dispatcher.ts:1321-1349). B's simulated private state returns over the A-era channel. No popup, no new consent, no teardown event.

**Violated invariant:** live channel's authority derives from the (profile, consent-row) pair that established it; identity switch must terminate or re-authorize outstanding channels. Revocation honored instantly for deletes (F-006); profile switch is the one authority transition with no equivalent.

**Failing path:** background.ts:683-688 (ctx.profileId from current active) · dapp-session/service.ts:120-122 (lookup keyed to active not establishing profile) · dispatcher.ts:1328 · service.ts:114 + background.ts:392 (no profile-mismatch refusal anywhere).

**Expected vs actual:** dispatch refused or channel terminated when active ≠ establishing. Actual: enforcement transparently re-binds to active profile's consent row — silent-capability reads (simulateTx/getPrivateEvents/getAddressBook, all < Transactions → no popup per dapp-interaction/service.ts:474-502) cross identities unprompted; sends prompt but under B's account with no indication channel predates switch. New profile w/o row → non-exempt fail closed CapabilityNotGrantedError (safe but inconsistent).

**Smallest safe fix:** terminate tuple-matching live sessions in existing onActiveProfileChanged listener (same pattern as onDappSessionDeleted handler :365-389), or stamp establishing profileId onto transport session in handleSessionEstablished and refuse dispatch on mismatch.

**Instances:** one root cause; affects every method class (silent readers worst).

## C6-2 — `toJsonSafe` cycle guard is an accumulating `seen` set: legitimate repeated references serialize as "[Circular]"

**Severity:** Low-Medium | **Repro confidence:** Moderate (mechanism line-certain; reachability needs producer emitting shared reference) | **Type:** Response corruption at transport seam

**Counter-example:** const z = Fr.ZERO; toJsonSafe({maxFee: z, fee: z}). First visit adds instance to seen, converts via toJSON() to fresh {value:"0x00"}; second reference hits seen.has(z) → {maxFee:{value:"0x00"}, fee:"[Circular]"}. Fr.ZERO is a module singleton used pervasively as default field values across @aztec/*; any result containing one shared instance twice (two zero fields), or any DAG-shared sub-object, corrupts. Internal RPC path immune (jsonSanitize JSON-round-trips destroys identity); only dApp response path affected.

**Failing path:** background.ts:766-767 (seen.has → "[Circular]", seen.add, no delete-on-exit, checked BEFORE toJSON branch :779-781); applied to every success response at :695.

**Smallest safe fix:** seen.delete(value) after recursing children, or track only ancestors on current path.

## C6-3 — `pendingVerification` marker leaks when approved discovery never reaches key exchange → spurious re-verification

**Severity:** Low | **Repro confidence:** High mechanism / Moderate frequency | **Type:** Lifecycle leak with behavioral side effect

User clicks Allow; marker `${origin}|${chainId}` added synchronously (discovery-approval.ts:56); approval lands. Tab closes mid-ECDH (~2 s window) or content-script port drops before onSessionEstablished fires. Sole deleter is that handler's finally (session-established.ts:100-102), so entry persists SW lifetime. Stored DappSession already exists → next connect auto-approves via existing-session lookup (background.ts:509-514); handleSessionEstablished computes isNewConnection = pendingVerification.has(verifKey) → true (session-established.ts:59) → needsVerification → emoji verify window opens even though trustedVerification true.

**Fix:** TTL the marker — Map<string, addedAtMs>, entries older ~90 s absent at read site (:59).

## Verified clean (from truncated first pass)

- Discovery freshness chain: drain re-reads clock per entry; approveOrRollback best-effort write rollback + reject (discovery-approval.ts:35-50); locked-queue coalesce false → reject → upstream pendingDiscoveries doesn't leak (background.ts:500-503).
- Capability grants merge-under-lock: applyCapabilityDecision re-reads LATEST row under same lock as revoke/delete/expiry-sweep (service.ts:273-307,309-320,336-349); denied widenings preserve narrower grants; pre-popup snapshot never written blind.
- Empty-calls short-circuit compensating control VERIFIED: enforceScopeWithSession validates exec.scopes/opts.scopes/additionalScopes/eventFilter.scopes unconditionally even when call checks exit on length===0 (scope-enforcement.ts:88-105); runs whenever grants.length > 0, guaranteed by enforceCapability throw otherwise.
- dispatcher.ts:666 opts lead resolves clean at this boundary: opts.from overwritten with resolved account every path (:666, buildAccountOperation overrides :1261/:1271/:1280); fee routing keys exec.feePayer/executionMode/fee.embeddedFeePayment not extra opts fields (materializer :81-101); residual authority in execution-layer Zod.
- Session establishment gate: promise registered sync pre-await + identity-rechecked post-await (background.ts:229-241, 271-274); verify-window carries THIS session hash (B-06); body fail-closed.
- Interaction approval commit point: check-cancelled → delete fully synchronous (service.ts:103-115); cancel flag written durably before broadcast (:199-200); detached handle still settles dispatcher promise so post-approval drift aborts propagate (:186-189). Crash-between-delete-execute collapses into MV3-death semantics (channel dies; journal reaper terminalizes stranded queued record).
- MAC storage: WebCrypto HMAC verify constant-time (integrity.ts:55-67); deterministic sorted-key canonicalization; locked/inactive rows hidden-not-deleted (mac-storage.ts:92-99) so legit rows re-verify after unlock; deletion purge uses MAC-free view.
