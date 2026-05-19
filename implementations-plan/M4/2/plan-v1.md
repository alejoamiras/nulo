# M4.2 + M4.8 — Strict Security Mode (default ON, opt-out)

> **Status**: v1 execution plan — supersedes the 2026-04-26 decision memo at `M4/2/plan.md` AND collapses M4.8 (`M4/8/plan.md` is now historical). User re-decided 2026-04-26 (post-M4-close): default ON instead of opt-in.

## Why this re-decision

The original DECISIONS.md picked **opt-in** to avoid "constant password re-prompts every 30s of MV3 SW idle." Real-world usage data corrected that assumption:

- The wallet has periodic activity (M4.5 lock alarm, popup port connections, PXE traffic) that keeps the SW alive much longer than the 30s idle timer suggests.
- The user reports passkey profiles do NOT prompt on every popup re-open under normal use — they only prompt on genuine SW death (browser restart, force-stop, true long idle).
- Strict mode for password profiles brings them up to the security baseline that passkey profiles **already enjoy today**, with friction frequency that the user has already confirmed acceptable.

Default ON closes audit findings A1/A2 globally without asking every user to discover an opt-in. Opt-out remains for compliance contexts where re-auth IS frequent or unwanted.

## Goal

After this PR ships:
- New default: password profiles do NOT cache `passhash` in `chrome.storage.session`. Reading session storage during active session yields no useful material.
- New default: SW death → popup shows lock screen for password profiles (matches passkey behavior today).
- Opt-out path: Settings → Security → "Strict security mode" → toggle OFF. Users who flip it OFF get today's silent-restore behavior. The toggle effect applies to subsequent unlocks.
- M4.8 lands "for free": the password/passkey asymmetry is gone in strict-default-ON. A SECURITY.md section documents this.

## Behavior change matrix

| Scenario | Today (pre-M4.2) | After M4.2 default ON | After user toggles OFF |
|---|---|---|---|
| `chrome.storage.session` content during active session (password profile) | `{profile, passhash, since, lockedAt}` — `passhash` is master-key bearer | `{profile, since, lockedAt}` — no bearer | back to today's shape |
| `chrome.storage.session` content during active session (passkey profile) | `{profile, since, lockedAt}` — already strict | unchanged | unchanged |
| Popup re-open while SW alive | Silent (in-memory secret cached) | Silent | Silent |
| Popup re-open after genuine SW death (password) | Silent re-decrypt via passhash | Lock screen → re-enter password | Silent re-decrypt via passhash |
| Popup re-open after genuine SW death (passkey) | Lock screen → re-tap passkey | Unchanged | Unchanged |
| Auto-lock (M4.5 sessionTtl) fires | Lock screen | Unchanged | Unchanged |
| Manual lock | Lock screen | Unchanged | Unchanged |
| `chrome.storage.session.passhash` ever observable on disk | No (session storage is RAM-backed) | No | No |

## Critical invariants preserved

1. **KDF labels** unchanged: `nulo:kdf:v1`, `nulo:master:v1`, `nulo:profile:v1`, `nulo:passkey:prf`. M2.6 crypto vectors pass byte-identically.
2. **AES-GCM ciphertext format** unchanged: `[version byte][12b IV][ct]`.
3. **Master secret derivation chain** unchanged. Signing + viewing keys derive from the same master secret as today.
4. **Storage keys** unchanged: `nulo:core:session` root, `Profile` shape on disk.
5. **Passkey flow** unchanged. The PRF derivation, credential storage, recovery coordinator — all untouched.
6. **Auto-lock (M4.5)** unchanged. Strict mode adds a *second* lock trigger (SW death) but does not modify TTL semantics.
7. **Zeroization (M4.6)** unchanged. Same buffers still get zeroed.

## Source-of-truth references

| File | Lines | What's there |
|---|---|---|
| `packages/extension/src/wallet/config/config.ts` | 24-28 | Wallet block of `Config` class — sessionTtl lives here; new flag adjacent |
| `packages/extension/src/wallet/services/profile/service.ts` | 84-115 | `createProfile` — first session opens with passhash bearer |
| `packages/extension/src/wallet/services/profile/service.ts` | 124-183 | `unlockProfile` — Phase 3 calls `sessionManager.open(current, secret, passhash)` at line 174 |
| `packages/extension/src/wallet/services/profile/service.ts` | 227-275 | `unlockPasskeyProfile` — already passes undefined to `sessionManager.open` (line 268) |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 185-206 | `open(profile, secret, passhash?)` — persists passhash if provided |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 265-321 | `restore` — short-circuits for passkey (line 281); short-circuits for password if no passhash (line 287) |
| `packages/extension/src/wallet/services/config/service.ts` | 24, 60-62 | `ConfigService.onUpdate` — emits `ConfigProp` on `setValue` |
| `packages/extension/src/popup/pages/settings/security/index.vue` | full file | Existing security settings page — sessionTtl input lives here |
| `SECURITY.md` | 55-92 | Existing M4.2 threat-model section — to be replaced |

## Code changes

### Change 1 — Add `strictSecurityMode` config flag (default ON)

**File**: `packages/extension/src/wallet/config/config.ts`

In the `Config` class, in the "Wallet" block (after `sessionTtl: number = 1_800_000`):

```ts
strictSecurityMode: boolean = true // When ON, password profiles do not cache passhash in session storage. SW death → re-auth. Default ON for new wallets; users can opt OUT in Settings → Security.
```

That's the entire config-layer change. `ConfigKey`/`ConfigProp` types update automatically via TypeScript inference from the class.

### Change 2 — Inject ConfigService into ProfileService

**File**: `packages/extension/src/wallet/services/profile/service.ts`

ProfileService already pulls services from a registry (`services.get(PasskeyService.name)` at line 50). Add a parallel grab for ConfigService:

```ts
private config: ConfigService = null!  // assigned in onInit

// in protected onInit():
this.config = services.get(ConfigService.name)
this.config.onUpdate.add(this.onConfigUpdated)
```

Add `import` from `@/wallet/services/config/service`.

### Change 3 — Gate the passhash bearer at unlock + create

**File**: `packages/extension/src/wallet/services/profile/service.ts`

Two call sites need gating:

#### `unlockProfile` (line 174):

```ts
// before:
await this.sessionManager.open(current, secret, passhash)

// after:
const strict = await this.config.getValue("strictSecurityMode")
await this.sessionManager.open(current, secret, strict ? undefined : passhash)
```

The `passhash` buffer is still computed at line 155 and zeroized at line 181 — that path is unchanged. Only what gets handed to `sessionManager.open` changes.

#### `createProfile` (line 104):

```ts
// before:
await this.sessionManager.open(profile, secret, passhash)

// after:
const strict = await this.config.getValue("strictSecurityMode")
await this.sessionManager.open(profile, secret, strict ? undefined : passhash)
```

Existing zeroize at line 114 unchanged.

#### `unlockPasskeyProfile` (line 268):

NO CHANGE. Passkey already passes undefined.

### Change 4 — `clearPasshash()` on SessionManager + toggle hook

**File**: `packages/extension/src/wallet/services/profile/session-manager.ts`

Add a new method (after `refresh`, before `restore`):

```ts
/** Drops the persisted `passhash` from the active Session if any.
 *  M4.2: called when the user enables strict mode mid-session — the
 *  in-memory secret keeps living (no force-lock), only the bearer
 *  bearer in chrome.storage.session is cleared. Idempotent: no-op
 *  when no session, no passhash, or passkey profile. */
public async clearPasshash(): Promise<void> {
  const session = await this.session.get()
  if (!session?.passhash) return
  const updated: Session = { ...session, passhash: undefined }
  await this.session.set(updated)
  this.logger.log(LOG_SOURCE, LogLevel.Debug, "Cleared persisted passhash bearer (strict mode)")
}
```

**File**: `packages/extension/src/wallet/services/profile/service.ts`

Add the config-update handler:

```ts
private readonly onConfigUpdated = (prop: ConfigProp): void => {
  if (prop.key === "strictSecurityMode" && prop.value === true) {
    // Strict mode just enabled — drop any persisted bearer from prior
    // lenient unlocks. In-memory secret survives; user stays unlocked
    // until SW death OR auto-lock OR manual lock.
    this.sessionManager.clearPasshash().catch((err) => {
      this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to clear passhash on strict toggle", err)
    })
  }
  // strict mode → OFF: no immediate effect. Bearer is restored on the
  // NEXT unlock. Documented in the settings UI subcopy.
}
```

### Change 5 — Settings UI: opt-out toggle

**File**: `packages/extension/src/popup/pages/settings/security/index.vue`

Add a new toggle row above or below the auto-lock input. Use the existing `Switch` component (or whatever binary toggle pattern the codebase already uses for `stealthMode`-like flags — find one and match it):

```vue
<Flex justify="between" align="center">
  <Flex direction="column" gap="6">
    <Text size="13" weight="600" color="primary">Strict security mode</Text>
    <Text size="12" weight="500" color="tertiary">
      Require password on browser restart. Recommended.
    </Text>
  </Flex>
  <Switch v-model="strictSecurityMode" @change="updateStrictSecurityMode" />
</Flex>
```

Wire `strictSecurityMode` ref, `onSettingUpdate` event branch, `onBeforeMount` initialization (matching the existing `sessionTtl` pattern). On disabling, show a confirm dialog:

```js
async function updateStrictSecurityMode(value) {
  if (value === false) {
    cacheStore.confirm.title = "Disable strict security mode?"
    cacheStore.confirm.description =
      "Your wallet will silently re-unlock across browser restarts. " +
      "A recovery key gets cached in browser session storage. " +
      "Continue?"
    cacheStore.confirm.confirm_text = "Disable"
    cacheStore.confirm.confirm_color = "warning"
    cacheStore.confirm.callback = async () => {
      await configService.setValue("strictSecurityMode", false)
      strictSecurityMode.value = false
    }
    popupStore.open("confirm")
  } else {
    await configService.setValue("strictSecurityMode", true)
    strictSecurityMode.value = true
    openToast({ label: "Strict security mode enabled", icon: "info" }, TOAST_DURATION.SHORT)
  }
}
```

(Match exact component imports + cacheStore pattern from `pages/settings/privacy/index.vue` lines 76-86 for fidelity.)

### Change 6 — SECURITY.md update

**File**: `SECURITY.md`

Replace the M4.2 threat-model row (line 77) and the M4.2/M4.8 future-work entries (lines 82-88, 89-92) with:

```markdown
| Can read `chrome.storage.session` during active session (strict mode ON, default) | None — only opaque session record (profile, since, lockedAt) |
| Can read `chrome.storage.session` during active session (strict mode OFF, opt-out) | Full master-secret compromise via cached `passhash` bearer |
```

Add a new section "Strict security mode (M4.2 + M4.8 — shipped)":
- Default: ON.
- Behavior: password profiles do not cache `passhash`; SW death = lock screen.
- Passkey profiles: behavior unchanged (already strict via WebAuthn API constraints).
- Opt-out: Settings → Security → "Strict security mode" → OFF. Restores the legacy bearer-cache behavior. Documented as reduced security for the user's choice.
- M4.8 (passkey symmetry): when strict ON, password and passkey profiles converge — both require fresh auth on SW death. When strict OFF, the asymmetry returns and is documented here.

## Test plan

### Unit / integration

#### `service.integration.test.ts` (new tests in a new `describe` block)

Add a new describe block: `describe("M4.2 strict security mode")`. Existing tests stay untouched but get a `beforeEach` that ensures `strictSecurityMode: false` so they continue to assert today's bearer-cache semantics:

```ts
// At the top of the existing describes, in beforeEach:
await config.set("strictSecurityMode", false)
```

(Avoids existing-test breakage — they were written for the bearer path.)

New tests in `M4.2 strict security mode`:

1. **Default unlock is strict (no passhash)**:
   - Set `strictSecurityMode: true` (default).
   - `createProfile` then `unlockProfile`.
   - Assert: persisted Session has `passhash === undefined`.

2. **Opt-out unlock keeps bearer**:
   - Set `strictSecurityMode: false`.
   - `unlockProfile`.
   - Assert: persisted Session has `passhash !== undefined`.

3. **Toggle ON clears existing bearer**:
   - Set `strictSecurityMode: false`. Unlock. Verify passhash present.
   - Set `strictSecurityMode: true`. Wait for `onUpdate` event to propagate.
   - Assert: persisted Session has `passhash === undefined`.
   - Assert: `getSecret(profileId)` still returns the master secret (in-memory unchanged).

4. **Toggle OFF doesn't backfill bearer**:
   - Set `strictSecurityMode: true`. Unlock. Verify no passhash.
   - Set `strictSecurityMode: false`.
   - Assert: persisted Session STILL has no passhash (no auto-backfill).

5. **Strict mode + SW restart simulation: password profile**:
   - Set `strictSecurityMode: true`. Unlock.
   - Construct a fresh SessionManager (same fake browser), call `restore()`.
   - Assert: `activeSession` is undefined (lock-screen state).

6. **Strict OFF + SW restart simulation: password profile**:
   - Set `strictSecurityMode: false`. Unlock.
   - Construct a fresh SessionManager, call `restore()`.
   - Assert: `activeSession` is defined and contains the master secret (silent restore).

7. **Strict mode + passkey profile**:
   - Set `strictSecurityMode: true`. Unlock passkey profile.
   - Assert: persisted Session has no passhash (unchanged from today).

8. **Toggle interaction with passkey session**:
   - Unlock passkey profile (no passhash regardless).
   - Toggle strict OFF.
   - Assert: passkey Session still has no passhash (clearPasshash is a no-op).

#### `session-manager.test.ts`

Add a `describe("clearPasshash")` block:

1. **No-op when no session**: `clearPasshash()` returns; no error; no `session.set` call.
2. **No-op when session has no passhash**: passkey-style session in storage; call `clearPasshash()`; assert session unchanged.
3. **Drops passhash + preserves other fields**: session with passhash; call `clearPasshash()`; assert `session.passhash === undefined`, other fields (profile, since, lockedAt) intact.
4. **Idempotent**: call twice; both succeed.

#### `config.test.ts` or wherever Config defaults are tested

Add: `expect(new Config().strictSecurityMode).toBe(true)`.

### M2.6 crypto vectors

Run `bun run --filter '@nulo/extension' test -- key-vectors.test.ts` before and after. Expected: byte-identical pass. Strict mode does not touch KDF or AES-GCM.

### E2E smoke (manual — record results in commit body)

Test profile setup: register a fresh password profile, unlock.

1. **Strict mode default ON, SW alive**:
   - Open popup → wallet shows assets.
   - Close popup. Reopen within 5s. Wallet shows assets (SW stayed alive).
   - Close popup. Wait 60s. Reopen. Wallet shows assets (SW likely still alive due to alarms).
   - Verify `chrome.storage.session.nulo:core:session` does NOT contain a `passhash` field (DevTools → Application → Storage → Session storage).

2. **Strict mode default ON, force SW death**:
   - Open popup. Verify unlocked.
   - `chrome://serviceworker-internals` → find Nulo → Stop.
   - Reopen popup → expect lock screen.
   - Enter password → re-unlocks normally.

3. **Toggle OFF**:
   - Settings → Security → "Strict security mode" → OFF (acknowledge the warning dialog).
   - Confirm via DevTools that session storage does NOT yet contain `passhash` (toggle OFF doesn't backfill).
   - Lock + unlock again.
   - Confirm session storage NOW contains `passhash`.
   - Force SW stop. Reopen popup. Expect silent re-unlock (no lock screen).

4. **Toggle ON during unlocked session**:
   - With strict OFF, unlock. Verify passhash is present.
   - Toggle strict ON.
   - Confirm session storage `passhash` is cleared immediately (without lock screen).
   - In-memory unlock continues — the popup still shows assets, no re-prompt.

5. **Passkey profile, strict ON**:
   - Create + unlock passkey profile. Tap passkey.
   - Force SW stop. Reopen popup. Expect lock screen → tap passkey → re-unlocks.
   - Behavior unchanged from today.

### Automated E2E (existing suite)

```bash
bun run --filter '@nulo/extension' test:e2e
```

Should remain green. The suite tests basic unlock/lock flows; strict mode default doesn't break them as long as the SW stays alive during the test (which it does — Puppeteer keeps the popup open).

## Verification gates

```bash
bun run typecheck:all                             # 8/8
bun run --filter '@nulo/extension' test           # all green, including new strict-mode tests
bun run --filter '@nulo/extension' build          # clean
bun run test:all                                  # M2.6 vectors green
bun run lint                                      # clean
bun run --filter '@nulo/extension' test:e2e       # green
```

## Migration

**No user migration needed.** The wallet has no production users yet (per `M4/DECISIONS.md`).

For the developer's own dev wallet:
- After upgrading to 0.13.9, the next browser restart / SW death triggers a lock screen instead of silent restore. Type password to re-unlock. This IS the expected new behavior.
- If the dev wants to keep the old behavior temporarily, flip the toggle OFF in Settings → Security.

## Risks

1. **Existing integration tests** assume passhash IS persisted. Mitigation: add `beforeEach` that sets `strictSecurityMode: false` for the existing suite; new tests in their own describe block. Caveat: this preserves the exact prior assertions but the "happy path" of integration tests doesn't exercise strict mode unless we also add it. Done — see test plan.
2. **ConfigService availability at ProfileService init time**: ConfigService must register in the services registry before ProfileService.onInit runs. Verify the registration order in `wallet/index.ts`. If ConfigService comes after ProfileService, swap.
3. **`onConfigUpdated` race with concurrent unlock**: if user toggles strict ON while an `unlockProfile` is mid-flight, the `clearPasshash` could land BEFORE `sessionManager.open` writes the session. The `open` call would then write a session containing the (just-derived) passhash, contradicting strict mode. Mitigation: `open` reads `strictSecurityMode` AT the call site (inside the in-flight unlock), not before — which we already do. Worst case: brief inconsistency, resolved on next interaction.
4. **Toggle UX confusion**: defaulting ON might surprise existing dev users. Mitigation: confirm dialog on disable, clear subcopy on the toggle, SECURITY.md docs.
5. **M4.6 zeroize interaction**: the existing zeroize at line 181 still runs on the `passhash` buffer regardless of strict mode (the buffer was computed earlier). No regression.
6. **M4.5 alarm interaction**: strict mode does NOT cancel the M4.5 sessionTtl alarm. Both lock triggers coexist. No interaction concern verified.

## Out of scope (do NOT include in this PR)

- Removing `EncryptionKey.getPasshash` or `unsealWithPasshash` from the codebase. They stay — the lenient (opt-out) path needs them.
- Removing the `passhash` field from `Session` schema. It stays as `passhash?: string` (already optional; passkey profiles already write without it).
- Changing the auto-lock alarm semantics (M4.5).
- Changing zeroization patterns (M4.6).
- Network-model rework (M4.10) — separate planning effort, next session.

## Bump

0.13.8 → 0.13.9.

## File diff estimate

| File | Lines added | Lines changed |
|---|---|---|
| `wallet/config/config.ts` | ~1 | 0 |
| `wallet/services/profile/service.ts` | ~15 | ~6 |
| `wallet/services/profile/session-manager.ts` | ~12 | 0 |
| `wallet/services/profile/service.integration.test.ts` | ~120 | ~5 (beforeEach in existing tests) |
| `wallet/services/profile/session-manager.test.ts` | ~50 | 0 |
| `popup/pages/settings/security/index.vue` | ~30 | 0 |
| `SECURITY.md` | ~30 | ~10 |
| **Total** | **~258** | **~21** |

Compact PR. Most volume is tests + docs.
