# Fable audit — round 1 (plan review)

Auditor: fable Plan agent, fresh context, both outlines + recon + source reads. Verdict: **conditional approve** (5 conditions). Verbatim findings below; adopted/rejected disposition in plan.md's decision ledger.

## 1. Adversarial / Security

- **HIGH — passkey dead-end in the new error boundary.** Plan's slice-loop catch sets `backupStatus=""` + toast + return, calling it "recoverable: the unlock form re-renders." True only for password profiles. For passkey profiles with `isAgreed=true` and `backupStatus=""`, the template renders NOTHING: body needs `!isPasskeyProfile && !backupStatus` (full.vue:300) or truthy `backupStatus` (:313); bottom CTAs need `!isPasskeyProfile` (:437) or truthy `backupStatus` (:447). Result: blank stranded page — the exact N-01 failure class, minus the spinner. **Fix:** in the catch, `if (isPasskeyProfile.value) isAgreed.value = false` (the documented reset at full.vue:116-121).
- **MEDIUM — secret scrub omitted from the ported precedent.** account.vue's `onBeforeUnmount` scrubs `payload`/`password` ("plain payload is spendable material," account.vue:209-216); the plan ports only the `generation++` half while full.vue's `backup` holds plaintext master-key/entropy/DEK (full.vue:169-191) and `password` is never cleared (:264-266). **Fix:** add `backup = null; password.value = null; repeatedPassword.value = null` to `onBeforeUnmount`.
- Checksum semantics correctly non-authenticating (matches useFullBackupImport.ts:119-124); nothing in the plan upgrades trust. Cap error copy is static — no injection. Residual accepted DoS: a legitimate-looking 64 MiB JSON still gets fully parsed in-popup. Non-cap decompress failures still silently fall back to raw bytes (files.ts:111-114) → lands as "unknown" type downstream; pre-existing, acceptable.

## 2. Assumption-Attack

- **Facts:** all spot-checked cites accurate (checksum strip/compact useFullBackupImport.ts:117,125-126; keydown default-arm full.vue:255-257; unguarded CTA :437-444; bare slice loop :193-198; unbounded drain + swallow files.ts:249-273,111-114; contacts precedent useContactImportExport.ts:90-94; 64 KiB service check account/service.ts:660; P7 teardown useFullBackupImport.ts:828-842; account.vue latch :50-59,117-146,201-216).
- **Inference 1 → promote to Fact:** auto-reconnect verified — `ensureTransportReady` reconnects when Disconnected (packages/extension-messaging/src/background/client.ts:101-111,113-121); `disconnect()` rejects pendings (:74).
- **Inference 2 — wrong basis, hedged conclusion:** the unit env is **jsdom**, not node (apps/extension/vitest.config.ts:27). `CompressionStream` likely leaks through from Node's globalThis; keep the mock fallback.
- **Inferences 3/4:** cap values defensible; dropping in-loop disconnects only lengthens port lifetimes (~loop duration), unobservable to the polls (backup-roundtrip.test.ts:53-71).
- **Silent Asks:** none material.

## 3. Implementation Critique

- **A over B: agree**, but the plan under-prices A's test cost — B's composable would make cases (a)–(f) trivially unit-testable; A forces a 12-module mock wall.
- **MEDIUM — test 1(e) unimplementable as written:** `backup` is a non-reactive `<script setup>` `let` (full.vue:58) — unreachable via `wrapper.vm`. **Fix:** pin the checksum through a mocked `downloadFile` capture (parse pretty payload → strip `checksum` → recompute).
- **MEDIUM — FileTooLargeError surfacing underspecified (backup path):** change map doesn't touch useFullBackupImport.ts, yet the only catch around `opts.pickFile()` is the generic one (useFullBackupImport.ts:444-447) → wrong copy. **Fix:** wrapper-catch in useProfileImportFlow (fillError + return `undefined`, exiting via `if (!file) return` at :405) — or a one-line `instanceof` in that catch.
- **MEDIUM — account path likewise:** `handlePickFile`'s bare `catch {}` swallows everything (accounts/import.vue:60-62). Make the `instanceof FileTooLargeError → error.value` branch explicit.
- **MEDIUM — e2e poke race:** if creation finishes before the second Enter, keydown case `"finished"` fires `handleEncrypt()`, racing the spec's own poll (backup-roundtrip.test.ts:53-63). **Fix:** wait for `backup-status-card` visible before poking; assert the card persists; count downloads via the capture stub.
- Gen-fence-between-slices, end-publish draft, whole-loop finally, cap placement: all sound; dropping recon's third cap point (post-decompress size) is fine — the chunk cap subsumes it. `handleEncrypt`'s sync status-flip + new keydown cases genuinely closes its window.
- **Low:** don't port account.vue's `!password.value` guard verbatim into `handleBackup` — it breaks the passkey auto-fire (full.vue:97); keep a default no-op arm in the keydown switch.

## 4. Verdict

**conditional approve** (with conditions:)
1. Passkey failure path resets `isAgreed` in the slice-loop catch (HIGH-1).
2. Specify the FileTooLargeError surfacing mechanism for both import call sites (wrapper-catch or `instanceof` branches).
3. Rewrite test 1(e) as a downloadFile-capture pin; synchronize the e2e poke on `backup-status-card`.
4. Add the account.vue-precedent secret scrub to `onBeforeUnmount`.
5. Correct Inference 2's basis to jsdom (apps/extension/vitest.config.ts:27), keeping the mock fallback.
