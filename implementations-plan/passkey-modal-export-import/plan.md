# Passkey Modal Migration — Export + Import Backup Flows (v3, post-audit + user steer)

## v3 deltas (over v2)

1. **No Path B fallback in `exportPlain` / `restore` passkey branches.** User explicitly rejected the back-compat shim ("I'd rather have a good clean implementation that WORKS"). Both methods now REQUIRE `credentialData` when `profile.type === "passkey"` — throw if absent. `confirmProfileOperation` stays intact because `ConfirmPopup.vue:52` is a separate (latent) caller.
2. **In-session round-trip e2e IS testable post-migration.** v2 deferred this based on a misread of `fixtures/passkey.ts`. The actual blocker — per-FrameTreeNode authenticator scope — is what Path A FIXES (modal runs in the same FTN as register, so credentials persist across export+import within the same popup session). Cross-EXTENSION round-trip is still blocked (PRF portability), but that's not what we're testing. v3 adds the in-session round-trip test.



## 1. The gap

A previous "Path A" refactor moved every popup-originated passkey ceremony off `chrome.windows.create` and into an in-page `PasskeyCeremonyDialog` modal. Three flows landed on Path A: create-profile, unlock-profile, import-passkey-discovery.

Two flows still take Path B (SW-driven window):

| Flow | File | Current Path B chain |
|---|---|---|
| **Export full backup (passkey)** | `packages/extension/src/popup/pages/settings/security/export/full.vue` | `handleBackup` → `exportPlain` → `confirmProfileOperation` → `passkeyCoordinator.confirm` (window) |
| **Import full backup (passkey)** | `packages/extension/src/popup/components/modules/import/useFullBackupImport.ts` | `restoreBackup` → `ProfileService.restore` passkey branch → `passkeyCoordinator.recoverByCredentialId` (window) |

Both are inconsistent with the rest of the wallet. Migrate them to the same shape.

## 2. Audits (both rejected v1; v2 incorporates their fixes)

**Codex xhigh** and **Opus 4.7** (run in parallel) agreed on every P0/P1:

- **P0 — Credential-binding break.** v1 swapped `confirmProfileOperation` → `recoverFromCredentialData` without asserting `recovery.credentialId === expected`. For `exportPlain` that's the profile's stored `credentialId`; for `restore` it's `masterKey` (the credentialId in the backup). Without this assertion a buggy/hostile popup could supply credential data for a DIFFERENT key.
- **P0 — Cancel-path UX wrong in both flows.** `UserRejectedError` is the canonical cancel signal — but `useFullBackupImport`'s outer catch would turn it into `"Import failed"` toast, and `export/full.vue`'s passkey branch auto-starts on agree and has no retry CTA, so silent-return leaves a dead state.
- **P1 — Wrong e2e target.** v1 proposed updating `security-backup.test.ts:63-87` to expect a modal. That test runs against a password profile (`registeredExtension`), so updating it would (a) drop the password smoke, (b) not exercise the migrated path. Need a NEW passkey-specific test with `setupPasskeyVirtualAuth`.
- **P2 — `mode: "getById"` doesn't exist.** `PasskeyRequest` only has `"create"` and `"get"`. Real shape: `{ mode: "get", credentialId }`.
- **P2 — `confirmProfileOperation` not dead.** `ConfirmPopup.vue:52` is still a (latent) production caller.

**Both agreed plan got right:**
- `acquireRecovery` / `recoverFromCredentialData` are the right primitives.
- `master-key` dual-use (secret for password, credentialId for passkey) is correct + already documented in `spec.ts:241`.
- Threading `runCeremony` into `useFullBackupImport` matches `CLAUDE.md` C1 hook conventions ("parent provides the do-the-thing fn").
- Lock concern is not a blocker — `recoverByCredentialId` already runs BEFORE the service lock at `service.ts:857`.

Audit artifacts kept in `/var/folders/p9/.../codex-4WD3iNvc/response.md` (codex) + conversation transcript (opus).

## 3. Architecture (v2)

### 3.1 Service layer

`packages/extension/src/wallet/services/profile/service.ts`

**`exportPlain(id, password?, credentialData?)`** — for passkey profiles, `credentialData` is REQUIRED (no Path B fallback per user pushback). Replaces the entire `confirmProfileOperation(id, password)` call at line 630:

```ts
if (profile.type === "passkey") {
  if (!credentialData) {
    throw new Error("credentialData is required for passkey profile")
  }
  // Caller already ran the ceremony in the popup's modal. Prove ownership
  // without re-running it. Materialize the credential SW-side; reject if
  // it belongs to a different key than the one bound to this profile.
  const recovery = await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
  try {
    if (recovery.credentialId !== profile.credentialId) {
      throw new Error("Invalid profile id")
    }
  } finally {
    zeroize(recovery.secret)   // export doesn't need the master; security minimization
  }
  // Refetch + credentialId-rotation check — verbatim from current code.
  const current = await this.repo.get(id)
  if (!current) throw new Error("Invalid profile id")
  if (current.type !== "passkey" || current.credentialId !== profile.credentialId) {
    throw new Error("Invalid profile id")
  }
  return current.credentialId
}
```

Codex suggested a dedicated `confirmFromCredentialData(profile, credentialData): void` helper on `PasskeyRecoveryCoordinator` (security minimization — don't derive the secret at all). v3 keeps the inline `recover + zeroize + compare` pattern; user picked this option. Revisit if a second caller of the same pattern emerges.

**`restore(profile, masterKey, password?, credentialData?)`** — for passkey profiles, `credentialData` is REQUIRED. Replaces `recoverByCredentialId(masterKey)` at line 860:

```ts
case "passkey": {
  let recoverySecret: Uint8Array<ArrayBuffer> | undefined
  let storedPending = false
  try {
    if (!credentialData) {
      throw new Error("credentialData is required for passkey profile")
    }
    const recovery = await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
    if (recovery.credentialId !== masterKey) {
      // Bind the modal-supplied credential to the credentialId recorded in
      // the backup file. Without this a popup bug could stash a secret
      // derived from the WRONG key, then finalizeRestore would open a
      // session bound to a master that doesn't match the imported address.
      throw new Error("credentialId mismatch")
    }
    recoverySecret = recovery.secret
    // ... rest unchanged: write profile, stash secret, return ProfileInfo
  } catch (err) {
    return { ...profile, restoreError: err instanceof Error ? err.message : err }
  }
  // ...
}
```

The `masterKey` parameter is preserved (it's still the credentialId from the backup file — needed for the cross-check). Existing PATH B callers (none today) would now hit the new throw; that's intentional per the v3 clean-cut decision.

`spec.ts` + `client.ts`: extend signatures with the new optional `credentialData?: PasskeyCredentialData` param. No new RPC methods, additive only.

### 3.2 Export-backup page

`packages/extension/src/popup/pages/settings/security/export/full.vue`

- Add `usePasskeyCeremony()` at the top.
- Mount `<PasskeyCeremonyDialog v-if="ceremonyRequest" :request="ceremonyRequest" @resolve="onCeremonyResolve" @reject="onCeremonyReject" />` at the end of the template.
- Rewrite `handleBackup` (line 79) for passkey profiles:

```ts
async function handleBackup() {
  let key = ""
  let credentialData: PasskeyCredentialData | undefined
  if (isPasskeyProfile.value) {
    try {
      const credentialId = await managers.profile.getPasskeyCredentialId(appStore.profile.id)
      credentialData = await runCeremony({ mode: "get", credentialId })
    } catch (err) {
      // Codex P0 / Opus P0-3: cancel must NOT toast + bounce. The current
      // dead-state risk: passkey export auto-fires on agree (line 74), so
      // a cancelled ceremony with no retry CTA strands the user. Reset the
      // agreement gate so the user can re-confirm or back out cleanly.
      if (err instanceof UserRejectedError) {
        isAgreed.value = false
        return
      }
      openToast({ label: "Failed to authenticate by passkey", icon: "warning" }, TOAST_DURATION.LONG)
      router.go(-1)
      return
    }
  }
  try {
    key = await managers.profile.exportPlain(appStore.profile.id, password.value, credentialData)
  } catch (error) {
    if (!isPasskeyProfile.value) {
      isWrongPassword.value = true
    } else {
      openToast({ label: "Failed to authenticate by passkey", icon: "warning" }, TOAST_DURATION.LONG)
      router.go(-1)
    }
    return
  }
  // ... rest unchanged (backupStatus = "progress", loop over backupServices, etc.)
}
```

- Delete the `backupStatus.value = "waiting-for-authentication"` write at line 83 and the bespoke inline block at lines 218-224 — the modal subsumes it. Trim the `v-else-if` chain accordingly.

### 3.3 Import-backup composable + page

`packages/extension/src/popup/components/modules/import/useFullBackupImport.ts`

- Add `runCeremony?: (req: PasskeyRequest) => Promise<PasskeyCredentialData>` to `UseFullBackupImportOptions`.
- In `restoreBackup` (line 135), before the existing `profileService.restore(...)` call at line 187, add the passkey-ceremony step. Wrap in a dedicated try/catch so `UserRejectedError` doesn't fall through to the outer "Import failed" surface:

```ts
const profile = data.profile as { id: string; name: string; type: "password" | "passkey" }

let credentialData: PasskeyCredentialData | undefined
if (profile.type === "passkey" && opts.runCeremony) {
  try {
    credentialData = await opts.runCeremony({ mode: "get", credentialId: masterKey })
  } catch (err) {
    if (err instanceof UserRejectedError) {
      // Codex P0 / Opus P0-3: silent cancel. Reset state so the form is
      // usable again — without this reset, restoreStatus stays "progress"
      // and the Import button is permanently disabled.
      restoreStatus.value = ""
      return
    }
    restoreStatus.value = "failed"
    opts.fillError("full_backup", "Couldn't authenticate", err instanceof Error ? err.message : String(err))
    return
  }
}

const newProfile = await profileService.restore(profile, masterKey, opts.password.value, credentialData)
```

`packages/extension/src/popup/pages/import.vue`

- `usePasskeyCeremony()` is already initialized for `handleImportPasskey`. Pass the existing `runCeremony` to `useFullBackupImport({...})`:

```ts
const { ..., runCeremony, ... } = usePasskeyCeremony()

const { ... } = useFullBackupImport({
  password,
  repeatedPassword,
  fillError,
  clearError,
  pickFile,
  completeImport,
  runCeremony,   // NEW — single line addition
})
```

### 3.4 Why not move the ceremony inside `useFullBackupImport`?

Option B considered (composable returns a request ref the page binds): rejected. The page already mounts ONE dialog instance for seed/key/passkey imports. Two dialogs in the same template would be wrong. Threading `runCeremony` matches `CLAUDE.md`'s "C1 hooks receive the do-the-thing fn from the parent" pattern (both audits validated).

## 4. UX

Modal copy is universal — no per-flow customization:
```
Waiting for passkey…
Use your authenticator (Touch ID, Windows Hello, security key) to continue.
Don't navigate away — press Escape to cancel.
```

Cancel paths (Escape, dismount, OS dialog cancel) → `UserRejectedError`:
- **Export**: reset `isAgreed.value = false` so the user returns to the agreement gate and can re-confirm or back out (NO toast).
- **Import**: reset `restoreStatus.value = ""` so the form is usable again (NO toast).

Both match the project convention: silent cancel, no warning toast on Escape (per `auth.vue:93-94`, `profile/new.vue:108-111`, `import.vue:207`).

Removed: bespoke `Waiting for passkey…` inline block in `export/full.vue:218-224`.

## 5. Tests

### 5.1 Unit / integration

`packages/extension/src/wallet/services/profile/service.integration.test.ts` — three new cases:

1. **`exportPlain` PATH A**: pass `credentialData` for a passkey profile, assert (a) returns `credentialId`, (b) `materializeCredential` is called and `getKey` is NOT (proves PATH A taken; `FakePasskeyService` already tracks both), (c) credentialId-rotation check still triggers a throw if a concurrent delete+reimport rotates `credentialId` mid-call.
2. **`exportPlain` PATH A mismatch**: supply `credentialData` whose materialized `credentialId` differs from the profile's stored credentialId → expect `Error("Invalid profile id")`.
3. **`restore` PATH A**: supply `credentialData`, assert profile written, no window opened, secret stashed in pending map. Plus a sibling case: `credentialData.credentialId !== masterKey` → returns `{...profile, restoreError: "credentialId mismatch"}`.

PATH B back-compat: existing tests at `service.integration.test.ts:665-688` (passkey restore) and `:289-294` (passkey exportPlain) stay green byte-for-byte — additive params, existing callers unchanged.

### 5.2 E2E

**Keep `security-backup.test.ts:63-87` unchanged** — it's a password-profile smoke; modifying it would drop coverage AND not exercise the new path.

**New file: `packages/extension/tests/e2e/passkey-backup.test.ts`** (pattern matches `passkey-paths.test.ts:61`):

- **Test 1 — export modal smoke**: `passkey profile → export full backup → modal appears → virtual authenticator completes → CTAs appear`. Uses `freshExtensionPerTest` + `setupPasskeyVirtualAuth(browser, popupPage)` to virtualize the WebAuthn ceremony.
- **Test 2 — export cancel UX**: `passkey profile → export → modal appears → press Escape → agree-gate visible again`. Locks in the v3 cancel reset.
- **Test 3 — in-session round-trip** (NEW in v3, was deferred in v2):
  - Register passkey profile via Path A modal. Read active account address = X. Read the persisted credentialId (`chrome.storage.local.get("nulo:core:profiles@<id>")`).
  - Build a synthetic full-backup payload in node: `profile.type = "passkey"`, `master-key = credentialId`, `data.account = [{ address: X, ... }]` (mirrors the synthetic-backup approach in `import-paths.test.ts` from the prior PR).
  - Reset wallet state (`chrome.storage.local.clear()` + reload popup) — virtual authenticator + credential PERSIST because they live in the same FrameTreeNode.
  - Drive the import flow: file picker → modal appears → virtual auth completes → assert lands on `#/popup/general`.
  - Assert `readActiveAccount(page) === X` (proves the credentialId binding + master-key derivation round-tripped).

The in-session round-trip works because Path A keeps register/export/import in the same FTN — the credential created at register is reachable by every subsequent ceremony. (Path B's per-popup FTN was the blocker that v2 wrongly framed as a fundamental constraint.) Cross-extension round-trip remains blocked by PRF portability — that's the real `PRF-NON-PORTABLE.md` caveat, and it's not what we're testing.

### 5.3 Component

No new component tests. The dialog is already covered by existing tests. Export/import pages are L6 (covered by e2e).

### 5.4 Validation matrix (per project memory: validate after every phase)

| Phase | Run | Pass |
|---|---|---|
| C1: service + spec + client + export migration | `typecheck`, `test` (new unit), manual smoke (export passkey backup with modal) | green |
| C2: import composable + page wiring + e2e | + `test:components` + `test:e2e` (new passkey export smoke + cancel test) | green |
| End | `audit:vue` | green |

## 6. Branch + PR shape

- Branch: `feat/passkey-modal-export-import`
- Base: `master`
- Single PR, **2 commits** (revised per codex):
  1. `feat(profile): Path A passkey export — credentialData on exportPlain` (service + spec + client + unit tests for export + export/full.vue migration + new passkey export e2e)
  2. `feat(import): Path A passkey full-backup import — modal handoff` (service `restore` extension + unit tests + composable opt + page wiring)

## 7. Out of scope (flagged)

- **`confirmProfileOperation` cleanup**: still has a (latent) production caller at `ConfirmPopup.vue:52`. Keeping the passkey branch live. Audit + delete-or-migrate is separate work.
- **Cross-extension passkey backup round-trip e2e**: genuinely blocked by PRF portability (per `fixtures/passkey.ts:14-30` — PRF state can't be serialized via CDP). The IN-SESSION round-trip IS testable and v3 covers it (§5.2 Test 3).
- **`confirmFromCredentialData` coordinator helper**: codex suggested as a security-minimization win. v3 keeps the inline `recover + zeroize` pattern; revisit if a second caller emerges.

## 8. Decisions resolved during audit + user steer

1. ~~Use `mode: "getById"`~~ → **`mode: "get"` with `credentialId`** (real shape, per `passkey/spec.ts:30`).
2. ~~Update `security-backup.test.ts`~~ → **Add new `passkey-backup.test.ts`** with `setupPasskeyVirtualAuth` (preserves password smoke + actually tests the new path).
3. ~~Drop `confirmProfileOperation` as dead code~~ → **Keep** (latent UI caller at `ConfirmPopup.vue:52`).
4. ~~3 commits~~ → **2 commits** (codex's reshape: service+export | restore+import+tests).
5. ~~Keep Path B fallback in passkey branches~~ → **DELETE.** User: "I'd rather have a good clean implementation that WORKS." `credentialData` is REQUIRED for passkey profile operations; missing → throw.
6. ~~Defer round-trip e2e~~ → **Include in-session round-trip.** The PRF/FTN blocker IS what Path A fixes; v2's deferral was based on misreading the fixture comments.

## 9. Audit attachments

- Codex xhigh: `/var/folders/p9/5vbplm5s6p5bjy78gdqnh0500000gn/T/codex-4WD3iNvc/response.md`, session `019e175e-aa54-7703-bb5b-d067681c5111`.
- Opus 4.7: in conversation transcript.

Both reviewers agreed plan v1 had a P0 credential-binding gap + a P0 cancel-path gap; both signed off on the v2 fixes.
