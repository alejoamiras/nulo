# Backup Import Repair — Plan v2 (post-audit)

Topic: the **full-backup import flow** silently strands the user on `/popup/import` even when the import has succeeded. Two parallel audits (Opus 4.7 and Codex xhigh) revised the original plan substantially — Codex caught a P0 race that would have shipped a worse bug. This v2 incorporates both audits.

---

## 1. Root cause (verified)

`packages/extension/src/wallet/services/profile/service.ts:753-861`

`ProfileService.restore()` writes the new profile + emits `onProfileAdded`, then explicitly **does not** call `sessionManager.open()`. Comment at line 811: *"Restore doesn't open a session here (user re-unlocks via the lock screen)."*

Every other profile-creation entry point **does** call `sessionManager.open()` (`createProfile`, `unlockProfile`, `unlockPasskeyProfile`, `importPasswordProfile`, `importPasskeyProfile`). `sessionManager.open()` is the only path that emits `onActiveProfileChanged`. `app.vue:174` is the only place `appStore.isLogined` flips to true (besides startup at 198). No emit → `isLogined` stays false → `completeImport` hangs on its `while` loop.

### What the user sees

`useFullBackupImport.ts:291-294`:

```js
restoreStatus.value = "finished"
if (!isRestoreHasErrors.value) {
  opts.completeImport(newProfile)   // never resolves
  return
}
```

Template (`import.vue:331-362`):

- `restoreStatus === "finished"` hides the "Import" CTA.
- `!isRestoreHasErrors` hides the "Continue" + "View Errors" CTAs.
- Only the always-on `Back` button remains.

Matches the user's report verbatim. Same hang exists from `/popup/register` (fresh install) and from `/popup/auth → SelectProfilePopup → /popup/import?from=/popup/auth` (locked-with-profiles). The profile IS in storage, so a popup reload + manual unlock recovers — but the post-import handoff is broken.

---

## 2. Audit findings I incorporated

**Codex (P0)** — *Just calling `sessionManager.open()` inside `restore()` creates a worse race.* If `restore()` opens the session at the start of the backup flow, it emits `onActiveProfileChanged` before `useFullBackupImport` has restored the backup's networks/accounts. `app.vue`'s handler immediately calls `initNetworks()` → `getOrInitNetworks()` which **seeds DEFAULT_SEEDS networks** for the empty profile (`network/service.ts:167-199`), and `initAccount()` → `ensureDefaultAccount()` which **creates a default account**. Meanwhile `useFullBackupImport` continues calling `networkService.restore(data.network)` + `accountService.restore(data.account)` — racing into the same storage with duplicate chain IDs and duplicate addresses.

**Codex (P1)** — *The duplicate-address rollback is dead code.* `accountService.restore()` throws `new Error("Duplicate address")` (`account/service.ts:219`); the RPC layer (`extension-messaging/src/background/client.ts:108-112`) reconstructs it as a real `Error` instance — so `if (err === "Duplicate address")` at `useFullBackupImport.ts:236` **never matches**. The catch falls through to the outer catch at line 297 which sets `restoreStatus = ""` (not `"failed"`), re-enabling the Import button. The "Profile already exists, import aborted" copy is never shown. Orphan profile + networks leak.

**Codex (P1)** — *`completeImport` is waiting on the wrong condition.* `while (!appStore.isLogined)` is a no-op when the user was already unlocked. The simplified completeImport must wait for a signal that means *"the IMPORTED profile is the active profile"*, not just *"some profile is logged in"*.

**Codex (P1)** — *`NetworkService.onProfileDeleted` (`network/service.ts:659-670`) already cascades* — when `deleteProfile` runs, networks are purged automatically. Manual cleanup is redundant.

**Opus (P0)** — *`onActiveProfileChanged` does not refresh `appStore.profiles`* (the list). The truthy branch at `app.vue:164-175` only writes `appStore.profile` (singular). The list is only refreshed in the falsy branch at line 178. If we drop the UI-side `appStore.profiles.push`, the new profile is invisible until something else refreshes the store. (Mitigation: `SelectProfilePopup.vue:21-23` keeps its own list via `onProfileAdded` subscription, but `appStore.profiles` still goes stale for other readers.)

**Opus (P0)** — *Zeroize ordering in `restore()`'s password branch.* `seal()` runs OUTSIDE the try at `service.ts:781`; if it throws, the finally never executes and `plainSecret` leaks unzeroed. Pre-existing minor issue.

**Opus (P2)** — *Three failure surfaces (inline banner + `restoreStatus="failed"` + a new toast) is overkill.* Keep the banner; only add the success toast.

**Codex/Opus (cut)** — pre-flight `getAllAccountAddresses` RPC is over-engineered; reactive detection + correct cleanup handles it.

**Codex/Opus (flag, out of scope)** — `SessionManager.open()` swallows errors at `session-manager.ts:218-220`. If `chrome.storage.session.set` fails, the caller can't tell. Pre-existing footgun.

---

## 3. The fix — corrected architecture

**Key insight from Codex's P0**: the session must be opened *AFTER* `useFullBackupImport` has finished restoring all backup data, not before. Otherwise the `onActiveProfileChanged` handler races the data restore. So instead of bolting `sessionManager.open()` into `restore()`, we add a **late-activation step** that the composable calls at the end.

### 3.1 Service-layer changes

**`packages/extension/src/wallet/services/profile/service.ts`**

`restore()` stays mostly as-is — it writes the profile only, no session open, same as today. Two cleanups while we're here:

- (Opus P0) Restructure password branch so `secretBox.seal()` runs INSIDE the try block, so the `finally` always zeros both buffers. Match `importPasswordProfile`'s pattern at service.ts:684-705.
- For the **passkey** path, stash the recovered secret in a new per-profile in-memory `pendingRestoreSecrets: Map<profileId, Uint8Array>` so the later finalize step can open the session without re-running the WebAuthn ceremony. Memory-only — never persisted; cleared on SW restart (acceptable; user re-imports if SW dies mid-flow).

**New method**: `profileService.finalizeRestore(profileId: string, password?: string): Promise<ProfileInfo>`

- For password profiles: re-derives the passhash via `EncryptionKey.getPasshash(password)`, unseals the profile's stored secret, calls `sessionManager.open(profile, secret, passhash)`, zeroes both buffers. Equivalent to `unlockProfile` but explicitly named for post-restore semantics.
- For passkey profiles: pulls the pending secret from `pendingRestoreSecrets`, calls `sessionManager.open(profile, secret)`, zeroes + removes from map. No second WebAuthn prompt.
- Returns the active `ProfileInfo`. Throws if no pending secret / wrong password / no profile.

Why a new method instead of reusing `unlockProfile`: for passkey we can't run the ceremony twice without a UX hit. For password the work is the same, but the named method documents intent + parallels the passkey path.

**Add `restore` AND `finalizeRestore` to**:
- `packages/extension/src/wallet/services/profile/spec.ts` — `Methods` type.
- `packages/extension/src/wallet/services/profile/client.ts` — typed methods.
- Drop the `as unknown as { … }` cast at `useFullBackupImport.ts:182`.

### 3.2 Composable + page changes

**`packages/extension/src/popup/components/modules/import/useFullBackupImport.ts`**

After the existing `backupServices` restore loop completes (line 289), and before flipping `restoreStatus = "finished"`, **call the finalize step**:

```ts
try {
  await profileService.finalizeRestore(newProfile.id, opts.password.value || undefined)
} catch (err) {
  // Profile + backup data ARE in storage. Worst case: user goes back, sees
  // the new profile in /popup/auth, unlocks normally.
  restoreStatus.value = "failed"
  opts.fillError("full_backup", "Couldn't open the imported profile", String((err as Error)?.message ?? err))
  return
}

restoreStatus.value = "finished"
if (!isRestoreHasErrors.value) {
  opts.completeImport(newProfile)
  return
}
importedProfile.value = newProfile
```

**Fix the dead Duplicate-address check** (line 236):

```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === "Duplicate address") {
    try { await profileService.deleteProfile(newProfile.id) } catch (e) { console.error(e) }
    // NetworkService.onProfileDeleted purges the networks automatically.
    opts.fillError("full_backup", "Can't import", "An account from this backup is already in your wallet")
    restoreStatus.value = "failed"
    return
  }
  throw err   // re-throw — fall through to outer catch
}
```

(Also: re-throw on the non-duplicate branch — current code silently swallows non-duplicate `accountService.restore` errors, leaving an inconsistent half-restored profile.)

**Reuse the profileService client.** The current `useFullBackupImport.ts:186` does `profileService.disconnect()` immediately after `restore()`. With finalizeRestore + deleteProfile now needed later, keep one client alive for the whole function and disconnect in `finally`. Same for `networkService`.

**`packages/extension/src/popup/pages/import.vue`**

Simplify `completeImport` and fix the wait condition (Codex P1):

```js
const completeImport = async (profile) => {
  await setLastActiveProfileId(profile.id)
  await setSentinel()

  // Wait for the SW-emit handshake: app.vue's onActiveProfileChanged
  // handler sets appStore.profile + flips isLogined ONLY after init runs.
  // Predicate must match the IMPORTED profile specifically, so this works
  // even if the user was already unlocked as a different profile.
  await waitForProfileActive(profile.id, 30_000)

  openToast({ label: "Profile imported", icon: "check-circle" })
  router.push("/popup/general")
}

async function waitForProfileActive(expectedId, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (appStore.isLogined && appStore.profile?.id === expectedId) return resolve()
    const stop = watch(
      [() => appStore.isLogined, () => appStore.profile?.id],
      ([logged, id]) => { if (logged && id === expectedId) { clearTimeout(t); stop(); resolve() } },
    )
    const t = setTimeout(() => {
      stop()
      reject(new Error("Profile activation timeout"))
    }, timeoutMs)
  })
}
```

If the timeout fires (worst case: SW crashed during finalizeRestore — the profile is in storage but session never opened), redirect to `/popup/auth` with a toast `"Profile imported — unlock to continue"`. The user recovers.

Drop the manual `appStore.profile = profile` and `appStore.profiles.push(profile)` writes — they're now redundant given the next fix.

**`packages/extension/src/popup/app.vue`** — refresh `appStore.profiles` in the truthy branch of `onActiveProfileChanged`:

```js
if (profile) {
  appStore.profile = profile
  appStore.profiles = await managers.profile.getProfiles()   // ← new
  await initNetworks()
  await initAccount()
  ...
}
```

Same idea in `loadProfile()` after the `if (activeProfile)` block — but it already does `appStore.profiles = await managers.profile.getProfiles()` earlier at line 186, so it's covered.

### 3.3 Button-state affordance

**`packages/extension/src/popup/pages/import.vue:340-361`** — add a third button branch so the user never sees a no-CTA state during the activation window:

```vue
<Button
  v-if="restoreStatus === 'finished' && !isRestoreHasErrors"
  :loading="true"
  :disabled="true"
  variant="cta"
>
  Finishing import…
</Button>
```

If the timeout fires, this button never gets clicked (we redirect first). If it succeeds, we navigate before the user notices.

---

## 4. UX copy (revised per Opus P2-4 — banner is enough; skip failure toasts)

| Where | Trigger | Copy | Icon / variant |
|---|---|---|---|
| Toast | Backup import success | **"Profile imported"** | `check-circle` |
| Toast | Slow handshake (>30s, redirected to /popup/auth) | **"Profile imported — unlock to continue"** | `info` |
| Inline banner | Decryption failed | **"Decryption Failed"** / *"The provided password is incorrect or the backup file is corrupted."* | (existing red banner — unchanged) |
| Inline banner | Duplicate address | **"Can't import"** / *"An account from this backup is already in your wallet"* | (red banner; replaces "Profile already exists, import aborted") |
| Inline banner | Bad schema | **"Incompatible backup"** | (existing — unchanged) |
| Inline banner | Bad checksum | **"Backup Integrity Check Failed"** | (existing — unchanged) |
| Inline banner | Finalize-restore failed | **"Couldn't open the imported profile"** / *"<err.message>"* | (new — same red banner style) |
| Button | Mid-handshake state | **"Finishing import…"** | (loading variant) |

Notes:
- Toast appears only on success. All failure paths use the existing inline banner (Opus P2-4: don't triple-surface errors).
- "An account from this backup is already in your wallet" — names what actually collides (one account, not the whole profile). The previous "Profile already exists" was a lie since we just rolled the profile back.
- "Can't import" is the inline banner title — terser than "Import failed", matches the actual situation.

---

## 5. Tests

### 5.1 Unit / component (Vitest)

**New: `packages/extension/src/popup/components/modules/import/useFullBackupImport.test.ts`**

Cases (mock service clients):
- `isAllowedToImportBackup` truth table.
- Clean restore success → `restoreStatus="finished"`, no errors, `completeImport` called once.
- `finalizeRestore` throws → `restoreStatus="failed"`, error filled with `"Couldn't open the imported profile"`.
- Schema-version mismatch → fail path, no profile written.
- Checksum mismatch → fail path.
- Duplicate-address case → with the FIXED check (`msg === "Duplicate address"`): profile deletion called, status="failed", correct copy in fillError. **This test would have failed against the current dead code** — locks in the fix.
- Non-duplicate `accountService.restore` error → re-thrown, outer catch fills generic "Import failed".
- Partial-errors path → `restoreStatus="finished"`, `isRestoreHasErrors=true`, importedProfile set, `completeImport` NOT auto-called.

**Update: `packages/extension/src/popup/components/modules/import/ImportFullBackupForm.test.ts`**

- "Finishing import…" button visible + loading when `restoreStatus="finished" && !isRestoreHasErrors`.

**New: `packages/extension/src/wallet/services/profile/service.test.ts`** (or extend existing)

- `restore()` for password: profile in storage, NO session opened (assert no emit), `onProfileAdded` fired.
- `restore()` for passkey: profile in storage, pending secret stashed, NO session opened.
- `finalizeRestore()` for password with right pw: session opens, `onActiveProfileChanged` emitted.
- `finalizeRestore()` for password with wrong pw: throws `InvalidPasswordError`, no session, no emit.
- `finalizeRestore()` for passkey: session opens via pending secret, no WebAuthn ceremony invoked, pending map cleared.
- `finalizeRestore()` for passkey when no pending secret exists: throws.
- Zeroize: password-branch `seal()` throws → both `plainSecret` and (undefined-safe) `passhash` cleanup runs.

### 5.2 Non-network E2E (smoke; `bun run test:e2e`)

Update `packages/extension/tests/e2e/import-paths.test.ts`:

1. Remove the "deferred — broken" comment at line 17-19.
2. Add helper hook: a hidden `<input type="file" data-testid="import-file-input">` rendered when `selectedImportOption === "full_backup"`, programmatically clicked by `pickFile` so Puppeteer can use `ElementHandle.uploadFile()`.
3. New tests:
   - **Round-trip A** — register profile → export plain backup → save to disk → fresh extension → /popup/import → upload backup → enter new password → assert lands on `#/popup/general`, profile name matches, `appStore.profiles.length === 1`.
   - **Round-trip B** — same but encrypted backup. Adds "Decrypt Backup" intermediate step.
   - **Duplicate-address rejection** — register profile A → export A's backup → stay locked (auth.vue) → SelectProfilePopup → Import → upload A's backup with a new password → assert: inline banner *"Can't import — An account from this backup is already in your wallet"* visible, stays on `/popup/import`, `getProfiles()` returns one profile (rollback worked), `getNetworks()` returns A's networks only (cascade worked).
   - **Storage assertions** — after a successful import: `chrome.storage.local.get("nulo:ui:lastActiveProfile")` === new profile id, `chrome.storage.local.get("nulo:ui:sentinel")` matches `__SENTINEL__`, `chrome.storage.local.get("nulo:ui:activeAccount")` is set.

### 5.3 Network E2E — **skip in this PR**

The round-trip exercises the wallet state machine, not anything Aztec-node-touching. Network suite is for live PXE/anvil effects. A follow-up could test imported-token-balance fetch, but it's out of scope.

### 5.4 Validation matrix (per project memory rule: validate after every phase)

| Phase | Run | Pass |
|---|---|---|
| Commit 1 (service: restore + finalizeRestore + spec) | `typecheck:all` + `test` (unit incl. new service tests) | green |
| Commit 2 (composable + page wiring) | + `test:components` (new useFullBackupImport tests) | green |
| Commit 3 (app.vue profiles refresh + completeImport rewrite) | + manual: load extension, walk fresh-install round-trip | green + UX feels right |
| Commit 4 (Duplicate-address fix + cleanup) | + new useFullBackupImport duplicate test | green |
| End | `audit:vue` + `test:e2e` (smoke incl. new e2e tests) | green |
| Manual smoke | (1) fresh install backup import (2) backup import while locked-with-existing-profile (3) duplicate-address rejection (4) decryption failure (5) imported transactions show up | works |

---

## 6. Branching / PR shape

- Branch: `fix/backup-import-handoff`
- Base: `master`
- Single PR, **3 commits** (per Codex's recommendation to consolidate):
  1. `feat(profile): add finalizeRestore + harden restore() zeroize; expose in spec/client`
  2. `fix(import): late-activate session + correct completion wait + duplicate-address handler`
  3. `test(import): e2e round-trip + duplicate-rejection + composable unit coverage`

---

## 7. Out-of-scope (flagged for follow-ups)

- **SessionManager.open() swallows errors silently** at `session-manager.ts:218-220`. Pre-existing. Future hardening should propagate `chrome.storage.session.set` failures.
- **SessionManager doesn't close-prior-on-open** — irrelevant for the user's reported paths (both entry points have `isLogined=false`), but worth fixing eventually so an extension future surface that supports "import while unlocked" is safe.
- **PXE IndexedDB wipe on backup import** — unlikely to collide given deterministic address derivation, but worth a wipe-on-import for defensive cleanliness.
- **Cross-version backup validation** — only `schema-version === 2` is enforced; `wallet-version` / `aztec-version` are recorded but unused.
- **Accessibility (aria-live)** on the error banner.

---

## 8. Decisions I need from you before coding

**1. Architecture: late-activate via `finalizeRestore` (recommended).**
Codex caught that opening the session inside `restore()` triggers a race against auto-seed of default networks/accounts. The fix is a separate `finalizeRestore(profileId, password?)` RPC called after all backup data is restored. For passkey profiles, the SW retains the recovery secret in memory between `restore()` and `finalizeRestore()` to avoid a second WebAuthn prompt.

Alternative considered (single atomic RPC that does everything server-side) — much bigger refactor, moves backup orchestration off the popup. Not worth it.

→ Confirm late-activation is OK.

**2. Wait condition for `completeImport`.**
The audit showed `while (!isLogined)` is a no-op if the user was already unlocked. The plan uses `waitForProfileActive(expectedId)` that watches both `isLogined` AND `profile?.id === expectedId` so it really waits for the imported profile to become active.

→ OK to add a 30s timeout-and-redirect-to-auth fallback? Or strict-no-timeout?

**3. Duplicate-address copy.**
"An account from this backup is already in your wallet" — name the actual collision. Old copy "Profile already exists, import aborted" was misleading (the profile we just rolled back didn't really exist yet, and the conflict is account-level).

→ Like the copy? Want different?

**4. PR shape — 3 commits, one PR.**
Per Codex.

→ Or split into 2 PRs (service first, then UI)?

**5. Tests — scope.**
Plan covers unit + non-network e2e. Skipping network e2e.

→ Confirm.

---

## 9. Audit attachments (for the record)

- Opus 4.7 findings: in conversation transcript (run before this revision).
- Codex xhigh findings: response.md at `/var/folders/p9/.../codex-BQNArjPz/response.md`, session id `019e144c-2344-7423-a3cb-3421430c6dd3`.

Both audits agreed on: drop the pre-flight RPC, drop the explicit network cleanup, drop failure toasts. Codex's P0 (race) was the biggest single revision.
