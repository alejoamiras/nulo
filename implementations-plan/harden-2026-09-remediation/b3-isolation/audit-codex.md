# harden-b3-isolation — codex audit transcript

## Round 1 — 2026-09-14, GPT-6 Astra `high`, session `01a0a171-009a-7832-8ed0-8153096eb3fe`

Prompt: the plan, recon, the competing outline, seed rows F-06/F-07/F-11/F-14, the findings, the touched code, asks A–H, the no-over-engineering rule verbatim.

### Response (paths made repo-relative)

Read-only audit; no tests were run and no files were modified. Confidence is **high** for the code-path findings below; browser behavior was checked against documentation, not exercised locally.

1. **Blocking — the proposed recovery instructions create a dead end.**  
   `plan.md:15–16`; `apps/extension/src/wallet/services/profile/service.ts:1794–1803`.

   An undecryptable `dekSealed` makes full-backup export fail with “change the profile password to repair.” The plan removes that repair and makes password change say “export a full backup.” Neither operation can succeed. Passkey full-backup export also checks DEK decryptability (`service.ts:1708–1715`).

   **Smallest change:** retain the password-change refusal, but distinguish MAC corruption with a decryptable DEK from actual DEK loss. Specify recovery through an existing intact backup or recovery phrase/passkey, and accurately describe which imported keys and local state cannot be recovered. Update both error messages. Add a test covering the advertised recovery route, not merely the refusal.

2. **Blocking — a warm PXE bypasses the missing-DEK provider check.**  
   `plan.md:14`; `packages/aztec-runtime/src/pxe/client.ts:147–175`; `packages/aztec-runtime/src/pxe/service.ts:953,966`.

   The provider runs only after `PXE_STORE_KEY_MISSING`. Provisioned keys and runtimes survive locking/profile switching: `onActiveProfileChanged` deliberately does nothing. Therefore: unlock normally → provision key → lock → corrupt the DEK/MAC → unlock degraded. The warm offscreen still holds the original key and can open another chain store without invoking the throwing provider.

   **Smallest change:** explicitly gate newly admitted profile-bound PXE requests in recovery mode, including requests using cached keys/runtimes. Preserve already-admitted background jobs. Add the warm-offscreen sequence above alongside the cold-provider test. The current Phase 1 tests would miss this.

3. **Blocking — genuine offscreen responses can still be induced with stolen correlation IDs.**  
   `plan.md:19`; `packages/extension-messaging/src/offscreen/service.ts:38–59`; `packages/extension-messaging/src/core/base-client.ts:194–215`.

   A compromised popup observes `{from: uid, requestId: n}`, then sends another accepted PXE request using those same identifiers. The service accepts same-extension popup requests and replies to the attacker-supplied `from`. Its response therefore has the **genuine offscreen sender URL** and can settle the victim’s pending request. A fast `getNoteSchemas` request racing a slow operation is sufficient to induce an incorrect result or failure. No spoofing of browser-assigned metadata is necessary.

   **Smallest change:** authenticate the PXE request direction as well: accept requests only from the intended wallet background context, accounting for Chrome’s worker and Firefox’s background page. Add a client-plus-service test reproducing the reflected response.

   Also replace `startsWith(offscreenUrl)` with an exact URL/path comparison and explicitly permitted query handling. Do not reject all `sender.tab` values: Firefox’s hidden-window document is tab-hosted. Browser documentation describes `sender.url` as the sending page/frame URL, not proof of a particular offscreen instance. Require real Chrome/Firefox positive controls. [Chrome MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender), [Firefox MessageSender](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender).

4. **Blocking — journal events bypass the proposed RPC ownership gate.**  
   `plan.md:18,36`; `apps/extension/src/wallet/services/operation-journal/service.ts:332,367,454`; `packages/extension-messaging/src/background/service.ts:98`.

   While p1 is active, p2’s background operation can update or complete. The journal broadcasts its entire record to every connected client. Overriding `invoke` does not intercept these events. A compromised popup learns IDs, metadata, errors and timing without calling either read method.

   **Smallest change:** gate the journal’s **wire event delivery** by active-profile ownership while preserving all in-process events. Test foreign-profile added/updated/deleted events and locked-state delivery through a connected Port. The current Phase 3 gate stays green with this disclosure intact.

5. **Blocking — scoped selection does not prevent cross-tuple deletion after an asynchronous sync.**  
   `plan.md:17,31`; `apps/extension/src/wallet/services/auth-registry/service.ts:365–372,489–516`.

   `syncAuthwit` captures a row, awaits the node, then deletes whichever row currently occupies its numeric ID. During that await, a purge can remove the original row and restore/recording can reuse its ID for another profile or chain. The resumed sync deletes the replacement. Adding tuple filtering to the initial read leaves this intact.

   **Smallest change:** under the existing lock, re-read and compare the current row’s tuple, hash and pending state before deleting. Capture the operation’s profile/chain once and thread it through asynchronous sync/status work; do not reselect the active profile after awaits. Add a deferred-node test that replaces the ID with a foreign-tuple row before resolving the response.

6. **Should-fix — transaction-hash reconciliation remains an explicit tuple-boundary exception.**  
   `plan.md:20,54`; `apps/extension/src/wallet/services/auth-registry/service.ts:120–128,177–185`.

   A restored pending row may name another profile’s transaction hash. That transaction’s update then confirms or deletes the restored row across the event’s ownership boundary. Hash collision resistance does not establish profile ownership; the current query never examines the tuple. This does **not**, by itself, demonstrate deletion of an unrelated genuine victim transaction’s authwits.

   **Smallest change:** pass `tx.profileId`, `tx.chainId` and `tx.account` into reconciliation and match them alongside the hash. Skip automatic reconciliation when transaction provenance is absent. Test equal hashes across profiles/chains for both outcomes.

7. **Should-fix — authwit live updates retain address-only scoping.**  
   `plan.md:17,30`; `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:55,67–71`; `apps/extension/src/wallet/services/auth-registry/spec.ts` (`Events`).

   The plan changes the initial fetch but does not explicitly change the list’s event acceptance predicate. Another chain’s same-address authwit can still enter the displayed list. Registry-enabled events carry only an address, so they cannot distinguish profiles or chains at all.

   **Smallest change:** retain the competing outline’s full-tuple list predicate and extend enabled/disabled event payloads with the tuple. Compare it in the handlers. Add one same-address, foreign-chain/profile event test.

8. **Should-fix — several planned tests do not establish the claimed property.**  
   `plan.md:16,26,31,36`.

   - **Phase 1 MAC test:** an authentic p1 row read while p2 is active should be **hidden without deletion**, because `keyFor(row.profileId)` requests p1’s locked key. To reproduce F-06, construct a **p2-targeted payload**, sign it using p1’s real key, insert it beneath the signing wrapper, and verify rejection under p2. Include the real `ProfileService` derivation path so a master-only facade regression cannot hide behind a corrected helper stub.
   - **Phase 1 banner:** `getActiveProfile()` uses `ProfileService.getProfileInfo` (`service.ts:497,2159`), not `SessionManager.toInfo`. Updating only the latter misses a newly opened popup. Test the actual RPC projection after degraded unlock. Since persisted `Profile` extends `ProfileInfo`, explicitly keep the transient field out of the stored shape.
   - **Phase 2 reconcile:** asserting only that p1 survives also passes if the purge subscriber is never registered. Assert that p2’s keyless account’s authwits **and status** disappear, while p2’s other-chain rows survive.
   - **Phase 3 surface:** test rejection of all five removed methods, not only `transitionOperation`; require the RPC read gate to fail closed when `ProfileService` is unavailable.

**A — Degraded UX:** Keep the profile accessible with a persistent banner and actionable errors, subject to findings 1–2. A storage writer can cheaply trigger recovery mode by corrupting `envelopeMac` as well as `dekSealed`; the plan should state both. This is the accepted availability tradeoff. Full-backup export does not need “only the master.”

**B — Sender checks versus Port:** Keep the bounded sender-check approach, but apply it to both request and response directions as in finding 3. URL narrowing blocks a direct response from an ordinary popup URL; it does not establish complete isolation from compromised same-extension code. ADOPT’s existing no-tab predicate also still admits a popup, so “denied at every listener” is false. A bare `runtime.connect` replacement does not automatically establish confidentiality; no broad transport rewrite is justified here.

**C — Journal surface:** Remove `createOperation` and `countOperations` alongside the three writes. Keep internal methods usable across profiles and gate the wire events. Removing counts eliminates the direct count oracle; foreign-ID reads should match absent-ID results. Global storage scans still have size-dependent timing, and arbitrary popup JavaScript retains extension storage privileges. Document those limits rather than adding constant-time machinery for this Low.

**D — Password change:** Refuse undecryptable-DEK password changes. A new DEK cannot decrypt the old store or imported keys, and silently minting one conceals that loss. Bit rot is indistinguishable from deliberate corruption here. Refusal is safe only with truthful recovery instructions; a re-key/wipe workflow is unnecessary scope.

**E — Profile deletion:** Use `purgeForProfile(profileId)`. It matches the coordinator’s actual intent and catches orphan rows absent from its address snapshot. Include tuple-keyed statuses and malformed rows whose profile ownership is still identifiable; preserve other profiles’ rows.

**F — Shared helper:** Reuse a small package-private dual-secret HKDF helper, preserving envelope-MAC vectors exactly. Export only the concrete derivations unless an external caller actually needs the primitive. Specify the distinct outputs: 256-bit PXE bytes versus non-extractable HMAC keys. With an unknown victim DEK, I found no remaining offline derivation from the shared master alone. A holder of the victim’s full-backup material also holds its DEK and remains outside that guarantee.

**G — Legacy rows:** Keep them hidden and reinstall locally; no sweep or migration is needed. However, remove the blanket claim that overwriting any codec-hidden row is harmless: codec-hidden rows can also be damaged current-format records. Reuse the existing physical-key occupancy check for ordinary authwit ID allocation rather than treating every hidden key as disposable.

**H — Reconciliation:** Scope it as in finding 6. Transaction hashes identify transactions, not the ownership of local bookkeeping rows. Threading the already-available tuple is a small change and avoids maintaining an unexplained exception to the batch’s central invariant.

The network cells exercise real DEK handoff, OPFS opening, same-ID reimport, passkey execution, dApp disconnect/reconnect, and mined authwit grant/revoke/toggle behavior. Local gates can deterministically exercise hostile rows, missing DEKs, replacement races and forged messages that those existing network cells do not generate. Neither substitutes for the other; the selected network cells also do not prove Firefox sender semantics. These changes need no B4 approval-card work or later reversal.

**reject — blocking items 1–5: recovery dead end, warm-PXE bypass, reflected offscreen responses, journal event disclosure, and stale-sync cross-tuple deletion.**

## Round 2 — 2026-09-14 (same session; the final pass on the ledger)

Prompt: the ledger and the revised plan; re-verify.

### Response (paths made repo-relative)

1. **Blocking — passkey export still prevents reaching the tolerant restore. Confidence: high.**  
   `plan.md:16`; `apps/extension/src/wallet/services/profile/service.ts:1708–1715`; `apps/extension/src/popup/pages/settings/security/export/full.vue:177`.

   The adopted fix changes password export and passkey **restore**, but passkey **export** still calls `exportPlain` → `exportPasskeyCredential`, which rejects an undecryptable DEK. A user without an existing backup cannot create the file the repair instructions require. The new restore-only test stays green.

   **Smallest change:** explicitly include this export gate in the tolerant recovery path, preserving credential/fingerprint checks and displaying the loss warning. Test corrupt passkey profile → actual backup export → restore → healthy session.

2. **Blocking — the PXE gate breaks full-backup assembly for either profile type. Confidence: high.**  
   `plan.md:15–17`; `apps/extension/src/popup/pages/settings/security/export/full.vue:111,281`; `apps/extension/src/wallet/services/account-state/service.ts:175–176`; `apps/extension/src/utils/full-backup-helpers.ts:139`.

   Full export always includes `AccountStateService.backup()`. For an active network, that calls PXE for senders/contracts. Recovery mode rejects those calls; `viaPxe` converts the error to `"PXE request failed"`, and the assembler propagates it, aborting the entire backup. Successfully returning a fresh DEK from `exportBackupMaterial` does not prove that a downloadable backup exists.

   **Smallest change:** deliberately omit the unavailable account-state slice during recovery export and visibly report that omission. Do not blanket-swallow unrelated backup failures. Add a full-assembly test with an active network and recovery-mode PXE rejection; include the export component/account-state tests in Phase 1’s gate.

3. **Blocking — recovery toggling lacks an admission-order guarantee, and its test misses the warm-runtime bypass. Confidence: high.**  
   `plan.md:15,27`; `packages/extension-messaging/src/core/base-service.ts:129–131`; `packages/wallet-core/src/utils/event-handler.ts` (`invoke`); `packages/aztec-runtime/src/pxe/service.ts:890–892`.

   “The runtime calls it on each unlock” does not establish that recovery is enforced before new requests are admitted. Existing profile events publish to clients before invoking local subscribers, and subscribers are not awaited. An asynchronous toggle can therefore arrive after a new request has entered the warm runtime.

   Also, the specified **second-chain** test can pass with the admission check deleted: dropping the cached key forces a missing-key retry, whose provider already rejects. An existing matching runtime bypasses that provider.

   **Smallest change:** specify how authoritative recovery state blocks new requests before unlock publication/admission, including delayed or failed toggle delivery. Test an immediate request against the **already-open chain**, with toggle delivery delayed, plus a successful healthy re-unlock. Preserve already-admitted work.

4. **Should-fix — contradictory leftovers still prescribe rejected behavior. Confidence: high.**  
   `plan.md:42,54`.

   Phase 4 still says READY/PONG from a “tab-bound” sender must be rejected, contradicting the legitimate Firefox hidden-window case. Assumptions still endorse prefix matching and describe overwriting hidden keys as harmless, although both decisions were reversed.

   **Smallest change:** make READY/PONG tests reject wrong URLs while explicitly accepting the legitimate Firefox sender with `sender.tab`; replace the stale assumptions with exact-path matching and physical-key occupancy preservation.

**reject — blocking: passkey export remains gated; recovery-mode PXE rejection aborts backup assembly; recovery admission ordering and warm-runtime coverage remain incomplete.**

## Round 3 — 2026-09-14 (same session)

Prompt: round 2's items adopted (tolerant passkey export, recovery-mode assembly, SW-side admission guard, text fixes).

### Response (paths made repo-relative)

1. **Blocking — the recovery error is erased before the new backup catch. Confidence: high.**  
   `apps/extension/src/wallet/services/account-state/service.ts:140–145,175`.

   `backup()` calls `getSenders()`/`getContracts()` through `viaPxe`, which replaces every exception with `Error("PXE request failed")`. The proposed `catch (RecoveryModeError)` therefore never matches, and export still aborts.

   **Smallest change:** explicitly preserve `RecoveryModeError` through `viaPxe`. Inject the test failure at the PXE client, exercising the real wrapper; mocking `getSenders()` to throw the typed error would miss this.

2. **Should-fix — specify how the fresh passkey export blob reaches the file without changing the profile. Confidence: high.**  
   `apps/extension/src/popup/pages/settings/security/export/full.vue:177–180`.

   Currently `exportPlain()` returns only the credential ID, and the popup separately fetches the original stored `dekSealed`. State that the authenticated export returns the replacement blob and the popup consumes it directly. Never persist the fresh DEK into the source profile. The round-trip test should also assert that the source row remains unchanged.

3. **Should-fix — exempt cleanup from “every profile-bound method.” Confidence: high.**  
   `packages/aztec-runtime/src/pxe/client.ts:360–367`; `plan.md:15`.

   `clearChainState` and `clearProfileState` also pass through `request`. Gating them would prevent chain cleanup while the affected profile is active in recovery mode.

   **Smallest change:** scope the guard to operational PXE access and explicitly preserve cleanup calls. Add a recovery-mode cleanup positive control.

**reject — blocking: `viaPxe` erases the error required by the recovery-export catch.**

## Round 4 — 2026-09-14 (same session)

Prompt: round 3's three items adopted (viaPxe rethrows the recovery error by type; the export result carries the replacement blob, source row untouched; cleanup calls exempt from the admission guard).

### Response

approve
