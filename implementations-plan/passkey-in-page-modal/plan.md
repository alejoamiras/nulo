# Passkey in-page modal — implementation plan (post-codex revision)

**Goal:** refactor passkey ceremonies (register, unlock, import) from a separate `chrome.windows.create` popup to an in-page modal in the existing extension popup. Keep the window-opening machinery as a thin transport for future dApp/SW-triggered passkey signing flows — but share the ceremony logic between both paths.

**Why:** unblocks lock+unlock + register-passkey-then-export-plain round-trip e2e tests (Chromium's CDP virtual authenticators are per-FrameTreeNode; in-page invocation runs in the popup's existing FTN so credentials persist across ceremonies). UX improvement: no secondary floating window. Production precedent: MetaMask + Rabby ship this pattern. Also cleans up two pre-existing bugs the new path would otherwise inherit.

---

## Architecture: shared ceremony, dual transport

```
                    ┌─────────────────────────────────┐
                    │  buildCreateOptions / buildGetOptions │  pure helpers
                    │  (userHandle, credentialId, RP_ID, prfInput)│  in @nulo/wallet-crypto or shared
                    └─────────────────────────────────┘
                                  ▲             ▲
                                  │             │ both paths build options identically
                  ┌───────────────┘             └───────────────┐
                  │                                              │
   ┌──────────────┴──────────────┐               ┌──────────────┴──────────────┐
   │ PATH A — popup-originated   │               │ PATH B — SW-originated      │
   │ NEW (active)                 │               │ KEPT (no current callers)   │
   │                              │               │                              │
   │ caller (popup)               │               │ caller (SW): future dApp     │
   │   → opens PasskeyDialog      │               │   → WindowManager.openAndAwait│
   │   → ceremony runs in FTN-A   │               │   → chrome.windows.create   │
   │   → AbortController signal   │               │   → windows/passkey/index.vue│
   │   → returns credData         │               │   → ceremony runs in FTN-B  │
   │   → SW.*(name, credData)     │               │   → resolvePasskeyRequest   │
   │                              │               │   → SW continues            │
   └──────────────────────────────┘               └──────────────────────────────┘
```

**Shared between A and B:** option-building helpers, post-ceremony decoding, `PasskeyCredential` materialization in SW. **NOT shared** (and can't be): the actual `navigator.credentials.create/get` call site, because Path B's call site has to live in a frame the SW can spawn (`windows/passkey/index.vue`), while Path A's lives in the popup.

**Why keep Path B at all** — `WindowManager` is already general-purpose approval infrastructure. Future SW/content-script-triggered WebAuthn (dApp-initiated tx confirm via passkey) needs a DOM host; the SW has no DOM. Re-implementing later costs more than the ~150 LOC kept here, AS LONG AS Path B stays a thin transport that reuses Path A's ceremony parameters.

---

## Pre-existing bugs we fix in this PR

These are caught now because the refactor would inherit them. Fix at the start of the PR.

### Bug 1: createPasskeyProfile id/userHandle desync (codex audit)

[`packages/extension/src/wallet/services/profile/service.ts:185-218`](packages/extension/src/wallet/services/profile/service.ts) currently:
1. `id = generateUniqueId()` — pre-lock pick
2. `passkey.createKey(id)` — WebAuthn binds passkey credential's `userHandle = id`
3. enter lock
4. **`while (repo.contains(id)) { id = generateUniqueId() }`** ← regenerates id without re-running WebAuthn
5. persists profile with the NEW id but the credential is still bound to the OLD id

If step 4 fires, the persisted profile's id ≠ the credential's userHandle. Subsequent unlocks-by-credentialId still work (they use credentialId, not userHandle), but the userHandle becomes orphan metadata — and any code path that ever checks `userHandle === profileId` is silently wrong.

**Fix**: on conflict, throw a retryable `ProfileIdConflictError` instead of silently regenerating. Caller (Path A modal or Path B window) catches it, generates a new id, runs the ceremony again. ProfileService never silently rebinds.

### Bug 2: stale lock-scope drift comment

[`passkey-recovery-coordinator.ts:24-31`](packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts) claims `unlockPasskeyProfile` "today still holds the lock across the WebAuthn prompt" — codex confirmed this is no longer true. [`profile/service.ts:221-274`](packages/extension/src/wallet/services/profile/service.ts) already does the snapshot → unlocked-prompt → revalidate flow. Just edit the docstring to match current state.

---

## API design (post-codex)

Codex flagged: the original plan duplicated public API and ceremony logic. Revised:

### SW-side public methods — extend existing, don't proliferate

Add an optional `credentialData?: PasskeyCredentialData` parameter to existing methods. If provided, skip the window path and materialize directly. Backward-compatible.

```ts
// profile/service.ts — existing methods, extended:
public async createPasskeyProfile(name: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo>
public async unlockPasskeyProfile(id: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo>
public async importPasskey(name: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo>
```

Body refactor: each method delegates to a private `acquireRecovery(...)` helper that either:
- materializes the supplied `credentialData` via `passkey.materializeCredential(data)`, OR
- falls through to the existing `passkeyCoordinator.create*/recover*` (which opens the Path B window).

```ts
// profile/service.ts — private helper:
private async acquireRecovery(
  opts: { ceremony: "create"; userHandle: string }
       | { ceremony: "getById"; credentialId: string }
       | { ceremony: "getAny" },
  credentialData: PasskeyCredentialData | undefined,
): Promise<PasskeyRecovery> {
  if (credentialData) {
    return await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
  }
  switch (opts.ceremony) {
    case "create":  return await this.passkeyCoordinator.createForNewProfile(opts.userHandle)
    case "getById": return await this.passkeyCoordinator.recoverByCredentialId(opts.credentialId)
    case "getAny":  return await this.passkeyCoordinator.recoverUnknown()
  }
}
```

**`PasskeyService`** — add `materializeCredential(data: PasskeyCredentialData): Promise<PasskeyCredential>` that just wraps `PasskeyCredential.create(data)`. No window. Used by Path A.

**`PasskeyRecoveryCoordinator`** — add `recoverFromCredentialData(data)` that calls `passkey.materializeCredential` + `deriveMasterSecret`. Single new method.

**Specs/clients** — propagate the optional parameter. No new methods, no proliferation.

### Popup-side ceremony — page-local component, NOT popupStore

Codex flagged: `popupStore` + `Popup.vue` allow click-outside dismiss, which contradicts our "don't click away" policy ([Popup.vue:29-33,59](packages/extension/src/components/Popup/Popup.vue)). Use a page-local component instead.

**NEW: `src/popup/components/popups/PasskeyCeremonyDialog.vue`** — a new L5 popup that:
- Renders inline in the page that needs it (auth.vue / profile/new.vue / import.vue), gated by a `showing` ref
- Has its own non-dismissible backdrop (no click-outside-to-close, no Escape-to-close at the dialog level — Escape goes to AbortController, see below)
- `onMounted` reads `request` prop, builds options via shared helpers, calls `navigator.credentials.create/get({signal})` with an AbortController
- Emits `resolve(data: PasskeyCredentialData)` on success, `reject(error: PasskeyError)` on failure
- `onBeforeUnmount` aborts the controller (kills the WebAuthn promise) and emits `reject(new PasskeyCancelledError("dialog dismounted"))`

**NEW: `src/composables/runPasskeyCeremony.ts`** — NOT a composable, a plain helper function (per codex's correct framing — it's "open and await", not a service-bound subscription):

```ts
/**
 * Open an in-page passkey ceremony dialog, await the result, return credential
 * data. Throws PasskeyCancelledError on user cancel / escape / dialog dismount.
 *
 * Page-local helper; NOT a C1-style service composable. The caller is
 * responsible for rendering <PasskeyCeremonyDialog> and wiring the resolve/reject
 * emits to the returned promise.
 */
export async function runPasskeyCeremony(request: PasskeyRequest, signal?: AbortSignal): Promise<PasskeyCredentialData>
```

Each calling page (auth.vue / profile/new.vue / import.vue) renders `<PasskeyCeremonyDialog v-if="ceremonyRequest" :request="ceremonyRequest" @resolve="..." @reject="..." />` inline. The helper just hides the promise plumbing.

### AbortController plumbing

Codex flagged: WebAuthn supports `{signal: AbortSignal}`; today's code passes nothing, so once OS prompt is up there's no way to cancel. Fix:

- Dialog creates a single `AbortController` in `onMounted`
- Passes `signal` to BOTH `navigator.credentials.create({signal})` and `.get({signal})`
- Sources of abort:
  - User presses Escape (popup-side keydown handler) → `controller.abort()`
  - Dialog `onBeforeUnmount` (popup nav, page unmount) → `controller.abort()`
  - Explicit cancel button → `controller.abort()`
- `controller.abort()` emits `reject(new PasskeyCancelledError(reason))`
- AbortController also wired into Path B's `windows/passkey/index.vue` (mirrors the same change there)

### Cancel/error taxonomy

Codex flagged: callers today use brittle string-matching for "user closed" / "operation either timed out" ([profile/new.vue:74-97](packages/extension/src/popup/pages/profile/new.vue), [import.vue:158-179](packages/extension/src/popup/pages/import.vue)), and [auth.vue:67-76](packages/extension/src/popup/pages/auth.vue) has no path at all. Fix:

- New `PasskeyCancelledError extends WalletError` in `@nulo/extension-messaging/errors` (mirrors `InvalidPasswordError` pattern)
- Reasons: `"user-cancelled"` (Escape / explicit cancel / OS NotAllowedError), `"timeout"`, `"prf-not-available"`, `"transport-failure"`, `"dialog-dismounted"`
- All three callers replace string-matching with `instanceof PasskeyCancelledError`. auth.vue gains the missing path: cancel returns the user to the auth screen with no error toast (matches profile/new.vue's silent behavior on user cancel)

---

## File-by-file changes

### A. SW-side

| File | Change |
|------|--------|
| `src/wallet/services/passkey/service.ts` | Add `materializeCredential(data)`. Add Path A / Path B comment block at class level. |
| `src/wallet/services/passkey/spec.ts` | Add `materializeCredential` to the public spec. |
| `src/wallet/services/passkey/client.ts` | Add `materializeCredential` client wrapper. |
| `src/wallet/services/profile/passkey-recovery-coordinator.ts` | Add `recoverFromCredentialData(data)`. Fix the stale lock-scope drift comment at lines 24-31 (Bug 2). |
| `src/wallet/services/profile/service.ts` | Extend `createPasskeyProfile`, `unlockPasskeyProfile`, `importPasskey` with optional `credentialData` parameter. Extract private `acquireRecovery` helper. Replace silent id-regeneration loop with `ProfileIdConflictError` throw (Bug 1). |
| `src/wallet/services/profile/spec.ts` | Propagate optional parameter. |
| `src/wallet/services/profile/client.ts` | Propagate optional parameter. |
| `@nulo/extension-messaging/errors` | New `PasskeyCancelledError` + `ProfileIdConflictError`. |
| `src/popup/windows/passkey/index.vue` | Refactor to use shared option-building helpers + AbortController. Top-level `<!-- PATH B -->` comment. No behavior change for current Path B callers (none exist). |

### B. Popup-side

| File | Change |
|------|--------|
| `src/popup/components/popups/PasskeyCeremonyDialog.vue` | NEW. Page-local non-dismissible dialog. Runs WebAuthn with AbortSignal. Emits resolve/reject. |
| `src/composables/runPasskeyCeremony.ts` | NEW. Plain async helper — wraps "render dialog + await result + return credential data". Not a service composable; not in `composables/` C1 layer. Maybe move to `src/popup/utils/passkey.ts` to make the layer obvious. |
| `src/popup/pages/auth.vue` | Replace string-match catch with `instanceof PasskeyCancelledError`. Use `runPasskeyCeremony` + new `unlockPasskeyProfile(id, credData)` signature. |
| `src/popup/pages/profile/new.vue` | Same pattern; `mode: "create"`, generate userHandle on popup side. Handle `ProfileIdConflictError` retry: re-run ceremony with new id (max 1 retry). |
| `src/popup/pages/import.vue` | Same pattern; `mode: "get"` no allowedCredentials. |

### C. Pure helpers (shared between A and B)

`src/wallet/services/passkey/options.ts` (or in `@nulo/wallet-crypto`):

```ts
export function buildCreateOptions(userHandle: string, prfLabel: string): PublicKeyCredentialCreationOptions
export function buildGetOptions(credentialId?: string, prfLabel?: string): PublicKeyCredentialRequestOptions
export function decodeCreateAssertion(credential: PublicKeyCredential, userHandle: string): PasskeyCredentialData
export function decodeGetAssertion(assertion: PublicKeyCredential): PasskeyCredentialData
```

Both `PasskeyCeremonyDialog.vue` and `windows/passkey/index.vue` import + call these. Single source of truth for the WebAuthn parameter shape.

### D. E2E

| File | Change |
|------|--------|
| `tests/e2e/fixtures/passkey.ts` | Drop the per-popup-target authenticator. Anchor authenticator on the long-lived popup target is sufficient now. Keep the fixture's surface so future Path B tests can opt back in to per-window auth. |
| `tests/e2e/passkey-paths.test.ts` | Add: `lock + unlock via passkey: header-lock → auth-submit returns to /popup/general`. Add: `register passkey → export plain key → import via plain key in fresh extension → same address` (named honestly — NOT a passkey round-trip, see Section "Tests we add"). |
| `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md` | Update. Mark lock+unlock as ✅. Mark cross-browser pure-passkey round-trip as still blocked (PRF non-portable across browsers). Mark register-passkey + export-plain + import as ✅. |

### E. Comments + docs

- `src/popup/windows/passkey/index.vue` top-level comment: PATH B, currently no production callers, kept for future dApp/SW-triggered passkey ceremonies.
- `src/wallet/services/passkey/service.ts` class JSDoc: explain Path A (caller hands credential data) vs Path B (SW spawns window). Reference `windows/passkey/index.vue` and `PasskeyCeremonyDialog.vue` as the two ceremony hosts.
- `src/wallet/services/window-manager/window-manager.ts`: note that `kind: "passkey"` is currently exercised only by Path B (no production callers).

---

## Tests we add

### Unit tests

- `passkey/service.test.ts` — extend with `materializeCredential` cases.
- `passkey-recovery-coordinator.test.ts` — extend with `recoverFromCredentialData` cases.
- `profile/service.test.ts` (or integration) — `createPasskeyProfile(name, credData)` with provided credential, `unlockPasskeyProfile(id, credData)` ditto, `importPasskey(name, credData)` ditto. Plus: `ProfileIdConflictError` retry path.
- `runPasskeyCeremony.test.ts` — happy path, abort path, error path, timeout path. ≥10 cases.

### Component tests

- `PasskeyCeremonyDialog.test.ts` — lifecycle (mount triggers WebAuthn), success path, error path, AbortController on Escape / unmount / explicit cancel. ≥10 cases per L3 component standard.

### E2E

- Existing `create passkey profile` test — should still pass (validates Path A end-to-end via the modal).
- NEW `lock + unlock via passkey` — register passkey, click `header-lock`, wait for `/popup/auth`, click `auth-submit`, wait for `/popup/general`, assert same account address.
- NEW `register passkey, export plain key, import in fresh extension, same address` — NOT named "round-trip" because it's NOT a passkey round-trip (which is impossible across browsers per `PRF-NON-PORTABLE.md`). This validates that a passkey-derived master can be exported as a plain key and re-imported deterministically.
- (Optional follow-up PR) Path B regression test using mocked `WindowManager` — keeps the dApp-trigger plumbing alive without an actual dApp caller.

### Manual smoke

- macOS Chrome with real Touch ID — register, lock, unlock, import (same passkey)
- Linux Chrome (if available) — verify passkey picker doesn't clip popup geometry (only matters when user lands on Chrome chooser instead of OS dialog)
- Windows Hello (if available)
- All three: verify no popup auto-close during OS biometric prompt (validates external research's claim vs codex's prior concern)

---

## Phases (single PR, gated by validation)

```
Phase 0: Pre-existing bug fixes (small, low-risk, useful even if rest reverts)
  - createPasskeyProfile silent id regeneration → ProfileIdConflictError
  - passkey-recovery-coordinator.ts:24-31 stale comment → corrected docstring
  - Add unit tests pinning the new contract

Phase 1: SW infrastructure
  - Pure option-building helpers (shared between paths)
  - PasskeyService.materializeCredential
  - PasskeyRecoveryCoordinator.recoverFromCredentialData
  - ProfileService.* with optional credentialData parameter
  - acquireRecovery private helper
  - Specs + clients
  - PasskeyCancelledError class
  - Unit tests

Phase 2: Popup-side dialog + helper
  - PasskeyCeremonyDialog.vue
  - runPasskeyCeremony helper
  - PasskeyCeremonyDialog.test.ts
  - runPasskeyCeremony.test.ts
  - AbortController wiring

Phase 3: Migrate callers (one-by-one with smoke between each)
  - auth.vue → runPasskeyCeremony + unlockPasskeyProfile(id, credData) + PasskeyCancelledError handling
  - profile/new.vue → ditto + ProfileIdConflictError retry
  - import.vue → ditto
  - Path B's windows/passkey/index.vue → migrate to shared option helpers + AbortController
  - macOS smoke after each

Phase 4: E2E + docs
  - Simplify tests/e2e/fixtures/passkey.ts
  - Add lock+unlock test
  - Add export-plain + import test
  - Update PRF-NON-PORTABLE.md
  - Path A / Path B comments at all touchpoints
```

Validation between phases: `bun run audit:vue` (typecheck + tests + lint + build) + targeted e2e for the affected flow. Per `feedback_iterative_validation.md` — never plow through phases.

## Risks + mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Click-outside aborts mid-ceremony | Dialog backdrop intercepts pointer events; no click-outside dismissal. AbortController kicks in via Escape + dismount only. |
| 2 | OS biometric prompt steals focus → action popup auto-closes (codex prior concern) | External research + MetaMask/Rabby production precedent says this doesn't happen. Validate in macOS smoke (Phase 3 gate). If it DOES happen on some platform, fall back to Path B for that platform — Path B is preserved for exactly this contingency. |
| 3 | Promise leak on popup nav mid-ceremony | Dialog `onBeforeUnmount` aborts controller and emits `reject(PasskeyCancelledError)`. Caller's promise rejects cleanly. |
| 4 | Linux passkey-picker clips popup geometry | Smoke test before merge. Path B fallback if affected. |
| 5 | Path B drifts because nothing exercises it | All ceremony parameters built via shared helpers. ANY change that breaks the WebAuthn shape breaks both paths' tests. Plus optional follow-up PR adds a mocked-WindowManager test. |
| 6 | Backward compat — existing storage/profile shape | Unchanged. Profile.type === "passkey" still uses credentialId. Master derivation chain unchanged. |
| 7 | Lock-scope contract regression | Phase 3 of unlock (revalidate under lock) preserved verbatim. Phase 0 fixes the comment but does not change behavior. |
| 8 | createPasskeyProfile id retry behavior change | Old code silently regenerated and bound to wrong userHandle (Bug 1). New code throws + retries with full ceremony. Subtle behavior change but unambiguous improvement. |
| 9 | Cancel error semantics differ from current string-match | `PasskeyCancelledError` is what callers SHOULD have used all along. Refactor existing string-match catches in same PR; behavior is equivalent at the user-visible level (silent return on cancel). |

## Acceptance criteria

- [ ] All existing passkey unit + e2e tests still pass
- [ ] New unit tests for `materializeCredential`, `recoverFromCredentialData`, `*WithCredential` paths, `ProfileIdConflictError` retry
- [ ] New component tests for `PasskeyCeremonyDialog` (≥10 cases)
- [ ] New e2e: `lock + unlock via passkey`, green 5/5 runs
- [ ] New e2e: `register passkey, export plain key, import in fresh extension, same address`, green 5/5 runs
- [ ] `bun run audit:vue` passes (typecheck + unit + component + lint + build)
- [ ] Manual macOS Chrome smoke: register + unlock + import all work with real Touch ID
- [ ] No popup auto-close observed during OS biometric prompts
- [ ] Comments at all Path A / Path B touchpoints explain the dual-path architecture
- [ ] `PRF-NON-PORTABLE.md` reflects new coverage + remaining gaps

## Path B stay-or-go — definitive

**STAY**, but as thin transport that reuses Path A's ceremony parameters via shared helpers. `windows/passkey/index.vue` survives but its WebAuthn-call code is refactored to use the same `buildCreateOptions` / `decodeCreateAssertion` helpers. No second full ceremony implementation; ANY divergence between Path A and Path B is impossible by construction. One focused unit test (or the existing create test parameterized) keeps Path B alive.
