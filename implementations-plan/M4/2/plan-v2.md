# M4.2 + M4.8 — Strict Security Mode (default ON, opt-out) — v2

> **Status**: v2 execution plan, post-dual-audit (codex xhigh + Plan-agent). Supersedes `plan-v1.md`. See `audit-codex-v1.md`, `audit-agent-v1.md`, and "Audit-diff" section at the bottom for what changed.

## Why this re-decision

The original DECISIONS.md picked **opt-in** to avoid "constant password re-prompts every 30s of MV3 SW idle." Real-world usage data corrected that assumption:

- The wallet has periodic activity (M4.5 lock alarm, popup port connections, PXE traffic) that keeps the SW alive much longer than the 30s idle timer suggests.
- The user reports passkey profiles do NOT prompt on every popup re-open under normal use — they only prompt on genuine SW death.
- Strict mode for password profiles brings them up to the security baseline that passkey profiles already enjoy today, with friction frequency the user has already confirmed acceptable.

Default ON closes audit findings A1/A2 globally without asking every user to discover an opt-in. Opt-out remains for compliance contexts.

## Architectural decision (NEW in v2)

**Push strict-mode ownership into `SessionManager`, not `ProfileService`.**

`SessionManager` already takes `IConfig` in its constructor (`session-manager.ts:114-118`) and already has an `onConfigUpdated` listener for M4.5's `sessionTtl`. Strict mode extends that exact pattern. Three benefits:

1. **One decision point** — `SessionManager.open()` reads strict mode itself; ProfileService doesn't need to gate at every caller. No risk of missing a `sessionManager.open(...)` write site.
2. **Race-free** — strict mode is read inside `open()` AT THE SAME MOMENT the session is written. No window where a config flip + concurrent unlock can interleave.
3. **No new injection** — ProfileService stays unchanged structurally. No registry roundtrip, no test-fixture breakage, no init-order concern.

ProfileService keeps passing `passhash` to `sessionManager.open(profile, secret, passhash)` from all four current call sites unchanged. SessionManager decides whether to persist it.

## Goal

After this PR ships:
- **Default**: password profiles do NOT cache `passhash` in `chrome.storage.session`. Reading session storage during active session yields no useful material.
- **SW death**: password profile popup shows lock screen (matches passkey today).
- **Opt-out**: Settings → Security → "Strict security mode" → toggle OFF. Subsequent unlocks cache the bearer (today's behavior).
- **M4.8 lands "for free"**: password/passkey asymmetry is gone in strict-default-ON. SECURITY.md documents this.
- **Stale bearer cleanup**: existing `Session` records with `passhash` from prior lenient unlocks are treated as untrusted by `restore()` when strict mode is ON.

## Behavior change matrix

| Scenario | Today | After M4.2 strict ON (default) | After user toggles OFF |
|---|---|---|---|
| Persisted Session shape (password) | `{profile, passhash, since, lockedAt}` | `{profile, since, lockedAt}` | `{profile, passhash, since, lockedAt}` |
| Persisted Session shape (passkey) | `{profile, since, lockedAt}` | unchanged | unchanged |
| Popup re-open while SW alive | Silent | Silent | Silent |
| Popup re-open after SW death (password) | Silent re-decrypt via passhash | Lock screen → re-enter password | Silent re-decrypt via passhash |
| Popup re-open after SW death (passkey) | Lock screen → re-tap | Unchanged | Unchanged |
| `chrome.storage.session.passhash` ever observable | Yes (whole session) | Never | Same as today |
| Stale Session.passhash from pre-toggle on next restore | Silently restored | **Silently closed** + log | Silently restored |
| Toggle ON mid-session | n/a | Storage + in-memory passhash cleared, `activeSession.secret` keeps living | n/a |
| Toggle OFF mid-session | n/a | n/a | No backfill; effective on NEXT unlock (subcopy makes this explicit) |

## Critical invariants preserved

1. **KDF labels** unchanged: `nulo:kdf:v1`, `nulo:master:v1`, `nulo:profile:v1`, `nulo:passkey:prf`. M2.6 vectors pass byte-identically.
2. **AES-GCM ciphertext format** unchanged.
3. **Master secret + viewing-key derivation chain** unchanged. Both signing AND viewing keys derive from the same master secret as today.
4. **Storage keys** unchanged: `nulo:core:session` root, `Profile` shape on disk.
5. **Passkey flow** unchanged.
6. **Auto-lock (M4.5)** unchanged. Strict mode adds a SECOND lock trigger (SW death).
7. **Zeroization (M4.6)** unchanged. Same buffers still get zeroed.
8. **`Session.passhash` schema field stays optional** — existing field, no shape change.

## Source-of-truth references

| File | Lines | What's there |
|---|---|---|
| `packages/extension/src/wallet/config/config.ts` | 24-28 | "Wallet" block of `Config` — sessionTtl lives here; new flag adjacent |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 114-118 | Ctor takes `IConfig` |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 121-122 | `sessionTtl = config.get("sessionTtl")` + `config.onUpdate.add(this.onConfigUpdated)` |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 185-206 | `open(profile, secret, passhash?)` — currently writes passhash unconditionally if provided |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 231-251 | `refresh()` — re-persists `activeSession.session` (incl. passhash) |
| `packages/extension/src/wallet/services/profile/session-manager.ts` | 265-321 | `restore()` — short-circuits if `!session.passhash` (line 287); does NOT check strict mode today |
| `packages/extension/src/wallet/services/profile/service.ts` | 104, 174, 360, 628 | All four `sessionManager.open(...)` call sites that pass `passhash` |
| `packages/extension/src/components/ui/Toggle.vue` | full | Existing binary toggle component (used by privacy/index.vue) |
| `packages/extension/src/popup/pages/settings/privacy/index.vue` | 217-220 | Toggle usage example (controlled-component pattern) |
| `packages/extension/src/popup/pages/settings/security/index.vue` | full | Existing security settings page — sessionTtl input lives here |
| `SECURITY.md` | 51-92 | Existing M4.2 threat-model section to be rewritten in full |

## Code changes

### Change 1 — Add `strictSecurityMode` config flag (default ON)

**File**: `packages/extension/src/wallet/config/config.ts`

In the `Config` class, "Wallet" block (after `sessionTtl`):

```ts
// Security
strictSecurityMode: boolean = true // When ON, password profiles do not cache passhash in session storage. SW death → re-auth. Default ON; opt OUT in Settings → Security.
```

`ConfigKey`/`ConfigProp` types update via TypeScript inference.

### Change 2 — `SessionManager` becomes strict-mode-aware

**File**: `packages/extension/src/wallet/services/profile/session-manager.ts`

#### 2a. Track strict-mode state alongside `sessionTtl`

Add field, initialize in ctor (right after the existing sessionTtl read at line 121):

```ts
private strictSecurityMode: boolean

// in constructor:
this.sessionTtl = config.get("sessionTtl")
this.strictSecurityMode = config.get("strictSecurityMode")
config.onUpdate.add(this.onConfigUpdated)
```

#### 2b. Extend `onConfigUpdated`

The existing `onConfigUpdated` already handles `sessionTtl`. Add a `strictSecurityMode` branch:

```ts
private readonly onConfigUpdated = (prop: ConfigProp): void => {
  if (prop.key === "sessionTtl") {
    // existing logic — unchanged
  } else if (prop.key === "strictSecurityMode") {
    this.strictSecurityMode = prop.value as boolean
    if (this.strictSecurityMode) {
      // Toggle ON: drop bearer from BOTH storage AND in-memory
      // session object. The latter is critical — refresh() / TTL
      // updates re-persist activeSession.session, so leaving the
      // in-memory passhash present would silently re-write it.
      void this.clearPasshash().catch((err) =>
        this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to clear passhash on strict toggle", err),
      )
    }
    // Toggle OFF: no immediate effect. Bearer restored on NEXT unlock.
  }
}
```

#### 2c. `open()` reads strict-mode and gates persistence

Modify `open()` (line 185) to ignore the passed `passhash` when strict mode is on. ProfileService callers are unchanged.

```ts
public async open(profile: Profile, secretBuffer: Uint8Array<ArrayBuffer>, passhash?: ArrayBuffer): Promise<void> {
  try {
    const since = Date.now()
    const persistPasshash = passhash && !this.strictSecurityMode
    const session: Session = {
      profile: profile.id,
      passhash: persistPasshash ? Buffer.from(passhash).toString("base64") : undefined,
      since,
      lockedAt: this.sessionTtl > 0 ? since + this.sessionTtl : undefined,
    }
    await this.session.set(session)
    const secret = Fr.fromBuffer(Buffer.from(secretBuffer))
    this.activeSession = { profile, session, secret }
    this.onChange(this.toInfo(profile))
    await this.scheduleLockAlarm(session.lockedAt)
  } catch (error) {
    this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to open profile session", getErrorMessage(error))
  }
}
```

This single change covers ALL four caller sites (`createProfile`, `unlockProfile`, `changeProfilePassword`, `importPasswordProfile`) — because the gate is in the callee.

#### 2d. `restore()` ignores stale passhash when strict ON

Modify `restore()` (line 265) to treat a passhash-bearing session as untrustworthy when strict mode is ON. Insert a check right before the `passhash` read at line 287:

```ts
if (this.strictSecurityMode && session.passhash) {
  // Stale bearer from a prior lenient unlock OR a race with a
  // concurrent strict-toggle. Treat as untrusted; silentClose so the
  // popup shows lock screen and the user re-auths fresh.
  this.logger.log(LOG_SOURCE, LogLevel.Debug, "Strict mode + persisted passhash → silentClose")
  await this.silentClose()
  return
}
if (!session.passhash) {
  // existing branch — unchanged
}
```

#### 2e. `clearPasshash()` clears storage AND in-memory `activeSession.session.passhash`

New method. Critical: must mutate the in-memory `activeSession.session` because `refresh()` and TTL-update paths re-persist that object — leaving `passhash` in memory would silently re-write the bearer on next refresh.

```ts
/** M4.2: drops the persisted `passhash` bearer from BOTH the storage
 *  record and the in-memory ActiveSession. Called when the user enables
 *  strict mode mid-session. The Fr secret keeps living — no force-lock.
 *  Idempotent. */
public async clearPasshash(): Promise<void> {
  const persisted = await this.session.get()
  if (persisted?.passhash) {
    await this.session.set({ ...persisted, passhash: undefined })
  }
  if (this.activeSession?.session.passhash) {
    this.activeSession.session.passhash = undefined
  }
  this.logger.log(LOG_SOURCE, LogLevel.Debug, "Cleared passhash bearer (strict mode)")
}
```

### Change 3 — `ProfileService`: NO changes

The architectural decision keeps ProfileService untouched. All four call sites (`createProfile:104`, `unlockProfile:174`, `changeProfilePassword:360`, `importPasswordProfile:628`) keep passing `passhash` to `sessionManager.open()`. SessionManager decides what to do with it.

This is the key win vs. v1: no risk of missing a callsite, no race window, no new dependency injection.

### Change 4 — Settings UI: opt-out toggle

**File**: `packages/extension/src/popup/pages/settings/security/index.vue`

Use the existing `Toggle` component (`packages/extension/src/components/ui/Toggle.vue`) following the controlled-component pattern from `pages/settings/privacy/index.vue:217-220`. Add a new row above auto-lock:

```vue
<!-- Strict security mode -->
<Flex justify="between" align="center">
  <Flex direction="column" gap="6">
    <Text size="13" weight="600" color="primary">Strict security mode</Text>
    <Text size="12" weight="500" color="tertiary">
      Require password on browser restart. Recommended.
    </Text>
  </Flex>
  <Toggle :model-value="strictSecurityMode" @update:model-value="onStrictToggle" />
</Flex>
```

Handler — runs the confirm dialog **before** changing config (so cancel is harmless and the visual stays in sync via the controlled `:model-value`):

```ts
const strictSecurityMode = ref(true) // initialized from config in onBeforeMount

async function onStrictToggle(next) {
  if (next === false) {
    // Disabling = security regression. Confirm first.
    cacheStore.confirm.title = "Disable strict security mode?"
    cacheStore.confirm.description =
      "Your wallet will silently re-unlock across browser restarts on your next unlock. " +
      "A recovery key gets cached in browser session storage."
    cacheStore.confirm.confirm_text = "Disable"
    cacheStore.confirm.confirm_color = "red" // matches destructive-action convention; "warning" is not a valid Button color
    cacheStore.confirm.callback = async () => {
      await configService.setValue("strictSecurityMode", false)
      strictSecurityMode.value = false
    }
    popupStore.open("confirm")
    // Note: do NOT mutate strictSecurityMode here. The Toggle is bound to
    // strictSecurityMode.value (controlled). Cancel = no state change.
  } else {
    await configService.setValue("strictSecurityMode", true)
    strictSecurityMode.value = true
    openToast({ label: "Strict security mode enabled", icon: "info" }, TOAST_DURATION.SHORT)
  }
}
```

Wire `onSettingUpdate` event branch to keep the visual in sync if config changes from elsewhere (e.g., a future "reset settings" path). Initialize from `configService.getValue("strictSecurityMode")` in `onBeforeMount`.

### Change 5 — SECURITY.md: rewrite lines 51-92

Replace the entire current "Session secret" subsection (lines ~50-92) with a strict-ON / strict-OFF variant structure. Content sketch:

```markdown
## Session secret (password profiles)

Default: **strict security mode** (ON). Password profiles do NOT cache any
master-secret bearer in `chrome.storage.session`. The persisted session
record contains only `{profile, since, lockedAt}` — opaque to a session
storage reader. SW restart drops the in-memory `Fr` master secret; the
next popup interaction shows the lock screen and the user re-authenticates
(PBKDF2 ~1s).

Opt-out: **lenient mode** — Settings → Security → "Strict security mode" → OFF.
Reverts to the legacy bearer behavior:
1. The password is hashed once with SHA-256 to produce `passhash`.
2. `passhash` is persisted to `chrome.storage.session` as the silent-restore key.
3. `passhash` is re-imported as a PBKDF2 base key (600k iterations, SHA-256).

Trade-off: `chrome.storage.session.passhash` becomes sufficient to decrypt
the master secret without the password. Adversaries with read access to
session storage during an active session can perform a full master-secret
compromise. The user is shown a confirm dialog explaining this on disable.

## Session secret (passkey profiles)

Passkey profiles never cache any bearer regardless of strict mode — WebAuthn
PRF requires a user gesture, which is impossible to satisfy silently. SW
restart always shows the lock screen. M4.8 (passkey symmetry): when strict
mode is ON, password and passkey profiles converge — both require fresh auth
on SW death. When strict mode is OFF, the asymmetry returns and is documented
above.

## Threat model rows

| Adversary capability | Result (strict ON, default) | Result (strict OFF, opt-out) |
|---|---|---|
| Read `chrome.storage.session` during active session | None — only opaque session record | Full master-secret compromise via cached `passhash` |
| Read `chrome.storage.local` while wallet running/locked | Partial — encrypted blob, must brute-force password (600k PBKDF2) | Same as strict ON |

## Future work

- (M4.2) — shipped in 0.13.9. Default ON.
- (M4.3) — class-id verification at registry seam — shipped in 0.13.7.
- (M4.5) — proactive auto-lock via chrome.alarms — shipped in 0.13.7.
- (M4.6) — best-effort zeroization — shipped in 0.13.7.
- (M4.8) — passkey symmetry under strict mode — shipped in 0.13.9 alongside M4.2.
- (M4.10) — network-model rework — separate planning effort, deferred.
- (M4.7, M4.11) — deferred to launch-prep / future arcs.
```

(Tighten and match repo's existing prose style during execution.)

## Test plan

### Unit / integration

#### `service.integration.test.ts`

The existing `fakeConfig()` (line 29 area) currently has only `get()` + `onUpdate`. Extend it with `set()`:

```ts
function fakeConfig(initial?: Partial<Config>) {
  const state: Record<string, unknown> = { ...new Config(), ...initial }
  const onUpdate = new EventHandler<ConfigProp>()
  return {
    get: <K extends ConfigKey>(key: K) => state[key] as Config[K],
    set: async <K extends ConfigKey>(key: K, value: Config[K]) => {
      state[key] = value
      onUpdate.invoke({ key, value } as ConfigProp)
    },
    onUpdate,
    // any other IConfig methods referenced — match real shape
  }
}
```

(Adjust to match the real `IConfig` interface — verify in `config/index.ts`.)

Existing tests keep their assertions by setting `strictSecurityMode: false` in `beforeEach` (preserves bearer-cache assumptions). Then add `describe("M4.2 strict security mode")`:

1. **Default unlock is strict** — `fakeConfig()` default → register + unlock → persisted Session has no `passhash`.
2. **Opt-out unlock keeps bearer** — `fakeConfig({ strictSecurityMode: false })` → unlock → Session has `passhash`.
3. **Toggle ON clears bearer** — start lenient + unlock + verify passhash present → `config.set("strictSecurityMode", true)` + flush microtasks → both persisted Session AND `activeSession.session.passhash` are cleared. Verify `getSecret()` still returns the in-memory secret.
4. **Toggle OFF doesn't backfill** — start strict + unlock + verify no passhash → `config.set("strictSecurityMode", false)` → persisted Session still has no passhash; in-memory unchanged.
5. **changeProfilePassword respects strict mode** — strict ON + unlock + change password → re-persisted Session has no passhash. Strict OFF + same → has passhash.
6. **importPasswordProfile respects strict mode** — strict ON + import (encrypted/plain/mnemonic) → Session has no passhash.
7. **Race: toggle ON during in-flight unlock** — Strict OFF + start unlock (don't await) → toggle strict ON → await unlock → persisted Session has no passhash, in-memory `activeSession.session.passhash` is undefined. (Demonstrates that `open()` reading strict-mode at write-time + toggle-handler clearing afterward together produce the correct end state regardless of interleaving.)
8. **SW restart simulation: strict ON + stale passhash** — Strict OFF + unlock (Session now has passhash). Set strict ON in fakeConfig DIRECTLY (skipping the toggle clearPasshash listener — simulates a config-only upgrade). Construct fresh ProfileService + SessionManager against same FakeBrowserApi. `restore()` is called by init. Assert: `activeSession` is undefined (silentClose path took it).
9. **SW restart simulation: strict ON + clean session** — Strict ON + unlock + close. Construct fresh ProfileService against same FakeBrowserApi. Assert: lock screen state (no in-memory secret).
10. **SW restart simulation: strict OFF** — Strict OFF + unlock. Construct fresh ProfileService against same FakeBrowserApi. Assert: silent restore with in-memory secret populated.
11. **Passkey profile + strict ON** — unlock passkey (no passhash anyway) → toggle strict ON → no error, Session still has no passhash, in-memory unchanged.

To support tests 8-10, add a `makeServiceFromExistingApi(api: FakeBrowserApi)` helper that constructs a fresh ProfileService bound to a pre-existing FakeBrowserApi (no storage reset). Models the M4.5 SW-restart pattern from `session-manager.test.ts:540-569`.

#### `session-manager.test.ts`

Add `describe("clearPasshash")`:

1. **No-op when no session**.
2. **No-op when session has no passhash** (passkey-style record).
3. **Drops persisted passhash + preserves other fields**.
4. **Also drops in-memory `activeSession.session.passhash`** — open with passhash → assert `activeSession.session.passhash` is set → call `clearPasshash()` → assert it's `undefined`. **This is the v2-critical test that catches the v1 BLOCKING.**
5. **`refresh()` after `clearPasshash` does NOT re-persist passhash** — open with passhash → clearPasshash → call refresh → re-fetch persisted Session → no passhash. Pins the M4.5 interaction.

Add `describe("restore + strictSecurityMode")`:

1. **Strict ON + stale passhash** — preload Session with passhash + strictSecurityMode=true → restore → activeSession undefined + persisted Session deleted (silentClose).
2. **Strict OFF + passhash** — preload Session with passhash + strictSecurityMode=false → restore → activeSession populated.
3. **Strict ON + no passhash** (passkey-shape record) — restore short-circuits via the passkey-type or no-passhash branch as today; activeSession undefined.

Add `describe("open + strictSecurityMode")`:

1. **Strict ON: open ignores passhash** — call `open(profile, secret, passhash)` with strictSecurityMode=true → persisted Session has no `passhash`. In-memory `activeSession.session.passhash` is undefined.
2. **Strict OFF: open persists passhash** — same call, strictSecurityMode=false → persisted Session has passhash + in-memory has it.
3. **Strict ON: open with no passhash** — call `open(profile, secret)` (passkey-style) → persisted Session has no passhash regardless of mode.

#### `config.test.ts` (or wherever Config defaults are tested)

Add: `expect(new Config().strictSecurityMode).toBe(true)`.

### M2.6 vectors

Run `bun run --filter '@nulo/extension' test -- key-vectors.test.ts` before and after. Expected: byte-identical pass.

### E2E smoke (manual; record in commit)

Same five scenarios as v1's plan but with the JSON-parse correction from the audit-agent:

1. **Strict default ON, popup re-open within active SW**: silent.
2. **Strict default ON, force SW death** (`chrome://serviceworker-internals` → Stop): lock screen.
3. **Toggle OFF**: confirm dialog → disable → unlock again → `await chrome.storage.session.get('nulo:core:session')` from SW console → assert `passhash` field present after unlock.
4. **Toggle ON during unlocked session**: from strict OFF state → toggle ON → assert `chrome.storage.session.get('nulo:core:session').passhash` is undefined immediately. Popup remains unlocked. Force SW stop → reopen → lock screen.
5. **Passkey profile, strict ON**: unchanged behavior; lock screen on SW death + tap.
6. **Upgrade simulation**: with strict OFF in config + an active passhash-bearing Session, set `strictSecurityMode: true` directly via DevTools (`chrome.storage.local`'s config storage). Force SW restart. Reopen popup → expect lock screen (the in-storage passhash is treated as untrustworthy by `restore()`).

### Automated E2E

```bash
bun run --filter '@nulo/extension' test:e2e
```

Plan-agent verified `tests/e2e/wallet-lock.test.ts`, `auth-flows.test.ts`, `sw-resilience.test.ts` don't depend on silent-restore. The `registeredExtension` fixture (per-file SW lifetime) keeps the in-memory secret alive across popup re-opens within a test file. No e2e regression risk.

## Verification gates

```bash
bun run typecheck:all                             # 8/8 packages
bun run --filter '@nulo/extension' test           # green, including new strict-mode tests
bun run --filter '@nulo/extension' build          # clean
bun run test:all                                  # M2.6 vectors green
bun run lint                                      # clean
bun run --filter '@nulo/extension' test:e2e       # green
```

## Migration

**No production-user migration needed** (no users yet per `M4/DECISIONS.md`).

Dev wallet upgrade behavior:
- After upgrading to 0.13.9, any existing in-storage `Session.passhash` is treated as untrusted by `restore()` (silentClose path triggers). Dev's wallet shows lock screen on next SW restart.
- Dev can opt out via toggle if they prefer the legacy bearer behavior temporarily.

## Risks

1. **Test-fixture extension** (`fakeConfig` needs `set()` + correct `onUpdate.invoke` shape). Mitigation: spec it precisely, verify against real `IConfig` interface during execution, run the existing 11 tests + 14 new tests as the gate. Codex SHOULD-FIX call.
2. **Race on toggle-during-unlock**: addressed by SessionManager.open reading strict-mode at write-time AND the onConfigUpdated handler clearing afterward. Test #7 explicitly covers this. v2-critical fix.
3. **`refresh()` re-writing the bearer**: addressed by `clearPasshash()` mutating the in-memory `activeSession.session.passhash` (test #4 of session-manager). v2-critical fix.
4. **`restore()` config-blindness**: addressed by `restore()` short-circuiting when strict ON + passhash present. Tests #1 of restore + #8 of integration. v2-critical fix.
5. **Toggle UX confusion**: confirm dialog runs before `setValue`; controlled-toggle prevents ghost state on cancel. Plan-agent SHOULD-FIX.
6. **M4.5/M4.6 interactions**: confirmed unchanged by both audits. No new test gates needed.

## Out of scope (do NOT include in this PR)

- Removing `EncryptionKey.getPasshash` or `unsealWithPasshash` (lenient path needs them).
- Removing `Session.passhash` schema field (kept for lenient mode + backwards-compat with stale records, which `restore()` now handles correctly).
- Network-model rework (M4.10) — next session.
- Per-collection migrations (M4.7) — deferred to launch-prep.
- Encrypted metadata at rest (M4.11) — deferred.

## Bump

0.13.8 → 0.13.9.

## File diff estimate

| File | Lines added | Lines changed |
|---|---|---|
| `wallet/config/config.ts` | ~1 | 0 |
| `wallet/services/profile/session-manager.ts` | ~30 | ~5 (open() + onConfigUpdated + restore() guard) |
| `wallet/services/profile/service.ts` | 0 | 0 (no changes — architecture moved gating to SessionManager) |
| `wallet/services/profile/service.integration.test.ts` | ~180 | ~10 (extend fakeConfig + beforeEach hook) |
| `wallet/services/profile/session-manager.test.ts` | ~160 | 0 |
| `popup/pages/settings/security/index.vue` | ~35 | 0 |
| `SECURITY.md` | ~50 | ~30 (rewrite the 51-92 block) |
| **Total** | **~456** | **~45** |

About 200 lines more than v1 due to the v2-required tests (race + refresh + restore interactions) and the broader SECURITY.md rewrite. Still a contained PR.

## Audit-diff (what changed v1 → v2)

### Resolved BLOCKERs

| # | Audit source | v1 issue | v2 fix |
|---|---|---|---|
| 1 | both agents | Plan only gated `createProfile` + `unlockProfile`; missed `changeProfilePassword:360` and `importPasswordProfile:628` | SessionManager.open is now the single gate. All 4 callers automatically respect strict mode. |
| 2 | codex | `clearPasshash()` was storage-only — `refresh()` would re-persist via in-memory `activeSession.session.passhash` | `clearPasshash()` clears BOTH persisted Session AND in-memory `activeSession.session.passhash`. Test #4 + #5 in session-manager pin the invariant. |
| 3 | codex | `onConfigUpdated(strict=true)` race with in-flight `unlockProfile` not benign | SessionManager.open reads strict-mode at write-time (race-free) + onConfigUpdated handler clears afterward (idempotent). Integration test #7 explicitly covers the interleaving. |
| 4 | both agents | `restore()` config-blind — stale passhash silently restored on upgrade | `restore()` short-circuits when strict ON + passhash present. Restore tests #1 + integration test #8 cover. |
| 5 | plan-agent | `Switch` component doesn't exist — should be `Toggle` | Plan now references `src/components/ui/Toggle.vue` + the controlled pattern from privacy/index.vue. |
| 6 | plan-agent | Integration tests break at `services.start()` because ConfigService isn't registered as a fake | Architecture change avoids this entirely — no `ConfigService.name` lookup. ProfileService unchanged; SessionManager already takes IConfig. |
| 7 | plan-agent | `confirm_color: "warning"` is not a valid Button color | Changed to `"red"` per destructive-action convention. |

### Resolved SHOULD-FIX

- v1's "use ConfigService registry" → v2 keeps using injected `IConfig` (codex + plan-agent both flagged).
- v1 `fakeConfig` lacking `set()` API → v2 specifies the extension explicitly.
- v1 SECURITY.md "row update only" → v2 rewrites the entire 51-92 block with strict-ON / strict-OFF / passkey variants.
- v1 toggle confirm-dialog → v2 controlled-component with confirm BEFORE setValue (cancel-safe).
- v1 missed test paths (changeProfilePassword, imports, race) → v2 explicitly tests each.

### Remaining NITs (cosmetic; addressed at execution time)

- Init-order discussion noted at runtime.ts:100 (codex NIT).
- DevTools E2E step uses `chrome.storage.session.get(...)` from SW console (plan-agent NIT) — already updated in v2's E2E section.
- Test sync points: use `await Promise.resolve()` × 3 idiom (plan-agent NIT) — applied implicitly in test #7.
- Single-line rationale comment for "no ConfigService registry dependency" → add inline doc comment.

## Architectural notes

The v2 architecture (gate at SessionManager) is genuinely simpler than v1 (gate at every ProfileService caller). It exploits the existing IConfig+onUpdate plumbing that M4.5 already established for sessionTtl. No new injection, no new test fixture machinery, no risk of missing a future caller. M4.8 falls out automatically — the SECURITY.md doc is the only deliverable.

If a future code path adds a new `sessionManager.open(...)` caller — it inherits strict-mode gating for free. No need to remember to add a config check.
