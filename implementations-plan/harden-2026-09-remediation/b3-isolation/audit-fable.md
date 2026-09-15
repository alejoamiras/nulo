# harden-b3-isolation — fable audit transcript

## Round 1 — 2026-09-14, Fable 5.1 (same-family audit leg), in parallel with codex round 1

Prompt: the plan, recon, the competing outline, the seed rows, the findings, the touched code, asks A–H, the no-over-engineering rule verbatim; adversarial dimensions 1–5.

### Response (paths made repo-relative)

**Audit — B3 isolation plan (fable leg)**

## Findings

**1. [blocking] No repair path for the failure class the plan makes total — `service.ts:1802-1803`, `:2420`, `:1885-1887`.** The plan's Security line says a corrupted `dekSealed` "denies the whole profile … export and restore remain the repair path". Verified false in both profile types once the mint at `:1030-1033` is removed:
- Password: `exportBackupMaterial` throws `"Imported-keys key unrecoverable — change the profile password to repair"` when the slot won't unseal (`:1802-1803`); the plan makes password change refuse with "export a full backup". Circular. Only `exportMnemonic` survives (master-only).
- Passkey: `getProfileDekSealed` (`:1822-1831`) hands the corrupt blob into the backup verbatim; `restorePasskeyProfile` calls `unsealDekUnderWrapKey` (`:2420`), which throws on a bad envelope/tag (`imported-keys-dek-box.ts:54-67`) → `restoreError` → restore fails. Passkey profiles have no recovery phrase (`:1885-1887`) and no password change. A single corrupted byte of `dekSealed` (raw storage writer, bit-rot) makes derived funds permanently unreachable — today they stay reachable (`spec.ts:87-89`, A4).
Smallest change: (a) `exportBackupMaterial`: when `unsealDekWithPasshash` returns null, export a fresh `generateImportedKeysDek()` in the blob (imported-key rows then fail into the existing restore-side orphan taxonomy the comment at `:1795-1801` already relies on); (b) `restorePasskeyProfile`: catch the `:2420` unseal failure, proceed with the fresh destination DEK and skip `pendingDekRewraps.set` (`:2533`). Two tests: "export with undecryptable slot succeeds", "passkey restore with unopenable `dekSealed` finalizes non-degraded". Then ask D's mint removal is safe.

**2. [should-fix] `recoveryMode` is projected in the wrong place — `service.ts:492-498`, `:2159-2161`, `session-manager.ts:689-691`.** The plan sets it "in the session manager's projection" (`toInfo`, only reaches `onActiveProfileChanged`). A popup opened after unlock — the stated reason for the field — calls `getActiveProfile()`, which builds from `getProfileInfo(session.profile)` (`:497`) and never sees the session. Also `ProfileInfo` is returned by `getProfiles`, `unlockProfile`, every `onProfile*` event and cast into the backup's `profile` slice (`useFullBackupImport.ts:421,460`), where a required boolean is meaningless. Smallest: `recoveryMode?: boolean`, set in `getActiveProfile` from `session.dek === undefined` (and in `toInfo`); the Phase 1 test must assert through `getActiveProfile`, not the event.

**3. [should-fix] Journal surface shrink breaks the type surface as written — `rpc-methods.ts:23-28`, `operation-journal/spec.ts:363-371`, `client.ts:29-65`.** `defineRpcMethods` is exhaustive over `Methods` ("every RPC method must be registered"), so listing two names while `Methods` keeps seven is a type error. Phase 3 must prune `Methods` (keep `OperationJournalMethodSchemas` — the service bodies use them) and delete the five wrappers in `client.ts`. Also the `invoke` override receives `backup`/`restore` (`background/service.ts:24,100-106`, dispatched through `base-service.ts:112`) — delegate to `super.invoke` for anything but the two reads. Add `spec.ts` and `client.ts` to Phase 3's file list.

**4. [should-fix] F-14 over-claims what the URL check buys — `sender-auth.ts:17-23`, `offscreen/client.ts:60-66`.** "Which is what actually denies a forged response from a compromised popup" is false: a compromised same-extension page can `window.open(offscreenUrl)` or embed an `<iframe src=offscreenUrl>` (same origin, scriptable) and send from that context; `sender.url` is then the offscreen URL, `sender.tab`/`frameId` don't discriminate (Chrome sets `frameId` only with `tab`; Firefox's real offscreen IS a tab, `utils/offscreen.ts:279`). Keep the check (it closes accidental sources for one line) but rewrite the Architecture and Security sentences: forged responses need a same-extension context at the offscreen URL, which the stated attacker can create — F-14 stays Low by its documented boundary, not by this check. No code change.

**5. [should-fix] Provider semantics conflated: locked vs degraded — `runtime.ts:536-554`, `service.ts:1874-1880`, `session-manager.ts:226-232`.** The plan says the provider "THROWS … never `undefined`". `getProfileDek` throws `"Profile locked"` when locked and returns `undefined` when degraded. A locked profile must keep yielding `undefined` (→ the original marker error, `pxe/client.ts:175`, today's contract for background pollers); only an open session with `dek === undefined` throws `RecoveryModeError`. State it; the unit test should cover both.

**6. [should-fix] Gate blind spot: the journal's ownership gate is fail-open when `profileService` is null — `operation-journal/service.ts:92,132-136`.** Recon suggested "optional-when-absent". At the RPC boundary that is the wrong default: absent service → `[]`/`undefined`. Production always wires it, so this costs nothing except making the Port-path tests register a fake ProfileService.

**7. [nit] Journal events still fan out unfiltered — `background/service.ts:84-93`, `client.ts:87-100`.** `subscribeJob`/`onOperationAdded` deliver every profile's records to any connected popup. Not worth a per-client filter for a Low; record it in the Security section's "still trusted" line instead of "the popup sees only the active profile's rows".

**8. [nit] `assertWithinCap` needs no new threading — `tx-request-builder.ts:467-475`.** `ctx.network` already carries `profileId` + `chainId` (network rows are profile-owned, `network/service.ts:519,904`). Use them; don't widen `BuildContext`.

**9. [nit] Phase 2 test harness detail — `cross-profile-isolation.test.ts:335-336`.** NetworkService/AccountService are stubs there; the "chain-purge subscriber" and "reconcile" cases must capture the registered callbacks via `registerChainPurgeSubscriber`/`registerAccountPurgeSubscriber` spies or the registration can be forgotten and stay green.

**10. [nit] Phase 4 override has no app-side test.** The `isAcceptedSender` override lives in `apps/extension/src/wallet/services/pxe/client.ts` but the listed gate is `packages/extension-messaging test`; a deleted override stays green. Add one case in the app.

**11. [nit] Gates.** Phase 1 cites `src/popup/app.test.ts`, which does not exist. Phase 4's "`--shard=1/2` then `--shard=2/2`" is sequential, so it boots two sandboxes for no wall-clock gain — run the six files in one `e2e:agent` invocation (skill `:57-59`: never overlap; file is the unit). Add `opfs-storage.test.ts` (the only cell that exercises the store key directly) and `imported-account-execution.test.ts`.

**12. [nit] Error mapping wording — `dapp-session/service.ts:155-160`.** "Maps that error the way the fence's 'Wallet is locked' is mapped" reads as folding `RecoveryModeError` into "Wallet is locked". Let it propagate unchanged; its message is the surface.

Verified sound (no change): the throwing provider is awaited outside the retry `try` (`pxe/client.ts:174`, wrapper `pxe/client.ts:33` passes throws); the byte guard only fires on a real DEK swap once the mint is gone; `verifyOrDrop` hides on a `keyFor` throw (`mac-storage.ts:92-99`); `recordPendingAuthwits` has `sent.fence.profileId`/`sent.network.chainId` in scope (`dapp-send-executor.ts:399-419`); `deleteNetwork` runs only chain-purge subscribers (`network/service.ts:531,848-872`), so the chain-purge registration is required; `normalizeAllIds` rewrites any `profileId` key (`full-backup-helpers.ts:386-394`); `countOperations`' only caller holds the service type (`queued-journal.ts:24,58`); B4 touches none of this (no `getOperation` in the approval windows).

## Asks A–H

**A.** Throwing provider + toast + persistent banner, export reachable — yes, conditional on #1 and #2. Blocking the profile is worse: it removes the only repair.
**B.** Sender checks only — yes. A Port adds no confidentiality against a same-extension page (`onConnect` is reachable by any context) and the refactor's blast radius is the offscreen lifecycle. Correct the claim per #4.
**C.** Remove `createOperation` and `countOperations` too — yes; no client caller exists, and `createOperation` from a popup would let it forge journal history. Prune `Methods`/`client.ts` (#3).
**D.** Remove the mint — yes, it would silently rotate the PXE key under an open store. But only together with #1's export-side tolerance, or the refusal strands password profiles and the passkey side has no path at all.
**E.** `purgeForProfile(profileId)` at `coordinator.ts:120` — yes; the snapshot has no per-address chain, it matches the six sibling calls, and it is a superset of "pass profileId" (the seed's intent is scoping, which this satisfies).
**F.** Shared helper — yes, but only the shared block (`entropy-mac.ts:64-71,79-82`: assert, concat, `importKey`, zeroize), returning the HKDF base key; keep each site's `deriveKey`/`deriveBits` call inline. A `{salt, info, usage}` helper is one more abstraction than three callers need.
**G.** Hidden-by-codec, no sweep — yes. A `purgeMalformedRows` sweep would also delete every future-shape row; pre-production reinstall is the documented rule.
**H.** Leave `reconcileAuthwits(txHash)` unscoped — yes. The row is already inside the importing profile's provenance-filtered tuple; the worst case is over-claiming, which `service.ts:116-119` already accepts as the safe direction.

## Verdict

**reject** — blocking: #1 (repair path for a corrupt `dekSealed` after the DEK becomes load-bearing: `exportBackupMaterial :1802` and `restorePasskeyProfile :2420`). Everything else is should-fix/nit and does not change the design.

### Critical Files for Implementation
- apps/extension/src/wallet/services/profile/service.ts
- apps/extension/src/wallet/runtime.ts
- apps/extension/src/wallet/services/auth-registry/service.ts
- apps/extension/src/wallet/services/operation-journal/spec.ts
- packages/extension-messaging/src/offscreen/client.ts
