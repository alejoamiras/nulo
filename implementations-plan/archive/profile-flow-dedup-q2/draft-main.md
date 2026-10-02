# Draft plan (main) — Q2 profile-flow dedup + passkey-UI relocation

**Arc:** Q2 of `/harden quality` run `2026-06-11-ultra-50b45d` — *"Popup/onboarding profile flows duplicated, with shared passkey UI still housed under popup paths."* Re-verified against current `dev`.

**One-liner:** Extract `useProfileImportFlow` + `useProfileCreateFlow` (parameterized by shell), relocate `PasskeyCeremonyDialog` + `runPasskeyCeremony` to neutral paths. Behavior-preserving except two named quirk fixes.

## Core design decision — inject the completion step, don't unify it

The shared part of both flows is the **orchestration**: state refs → name validation → passkey ceremony / secret entry → the `managers.profile.import*` / `create*` RPC call → error routing. The part that **differs per shell is the activation + routing tail**, and it differs *structurally*, not cosmetically:

- **Popup** relies on `popup/app.vue`'s `onActiveProfileChanged` SW-event listener to run the heavy bootstrap and flip `appStore.isLogined`. Popup create *waits* for that (`while (!appStore.isLogined) sleep(100)`) then does a small extra sequence; popup import does no bootstrap at all.
- **Onboarding** has no such listener, so it calls `bootstrapActiveProfile` (`useProfileBootstrap`) **explicitly**.

`useProfileBootstrap.bootstrapActiveProfile` does strictly *more* than popup create's manual sequence (`ensureDefaultAccount`, `setupActiveAccount`, profiles-list refresh, `syncTransactions`). Routing migration of popup → `useProfileBootstrap` would be a **behavior change**, not a refactor.

⇒ Composable owns the shared orchestration; each page injects a `complete*(profile)` callback for activation + routing + toasts. This is **the same seam the codebase already uses** — `useFullBackupImport({ completeImport, showErrorLog, ... })` — so it's proven, not novel. The composable returns an object of refs + handlers (matching existing composables); templates stay in the pages because they differ structurally.

## Phases (each independently shippable)

### Phase 1 — Relocate shared passkey UI to neutral paths (mechanical, lowest risk)
- Move `src/popup/components/popups/PasskeyCeremonyDialog.vue` → `src/components/passkey/PasskeyCeremonyDialog.vue` (service-bound visual component → flat `components/` subdir per the layer model; NOT core/ui/composite). Move its colocated `.test.ts` too.
- Move `src/popup/utils/passkey-ceremony.ts` → `src/wallet/utils/passkey-ceremony.ts` (neutral util home, alongside the already-neutral `create-passkey-profile.ts`).
- Update **6** dialog import sites (popup import.vue, popup auth.vue, popup settings/security/export/full.vue, popup profile/new.vue, onboarding create.vue, onboarding import.vue) + **2** util import sites (the dialog, `popup/windows/passkey/index.vue`) + **3** doc-comment path refs (`wallet/services/passkey/spec.ts`, `service.ts`, `profile/spec.ts`).
- **Remove** the dialog's stale "Used by: …" enumerated header (lines 11-14) rather than update it — CLAUDE.md comment policy bans "referencing the … caller". Keep the WebAuthn/cancel-path documentation (that's WHY/invariant, allowed).
- Preserve: teleport target `#popup`, AbortController + Escape + dismount cancel paths, `UserRejectedError` normalization, all testids.

**Validation gate**
- Commands: `cd packages/extension && bun run typecheck && bun run lint && bun run test:components && bun run test src/components/passkey`
- Also: `! grep -rn "popup/components/popups/PasskeyCeremonyDialog\|popup/utils/passkey-ceremony" src` (no stale import paths remain; doc-comments updated).
- Pass: all green; grep returns nothing.
- Layers: typecheck · lint · unit/component.

### Phase 2 — Extract `useProfileImportFlow` (largest dup)
- New `src/composables/useProfileImportFlow.ts` (TS, C1). Composes `useProfileNameField`, `usePasskeyCeremony`, `useFullBackupImport`. Owns: the import refs, `error`/`fillError`/`clearError`, `isCopied`/`handleCopyError`, `handlePasswordInput`/`handleSecretInput`, the `isAllowedTo*` computeds, `handleImport{Seed,PrivateKey,PublicKey,Passkey}`, `parsedBackupName` prefill watch, `clearFormState`, `dispose()`.
- Injected per shell: `completeImport(profile)` (activation + route + toast), `showErrorLog(errors)` (popup=`data_viewer` popup; onboarding=notification). The passkey-failure notification moves INTO the composable with a single unified title (`"Profile import failed"`) — resolves the casing drift.
- **Drift resolutions:** adopt onboarding's `fillError("unknown", "Import failed", message)` shape (popup's `fillError("unknown", err)` put an Error object in the title → `[object Object]`). Do NOT add Enter handling to onboarding import (popup keeps its full-backup Enter handler page-level; preserve the asymmetry).
- **Quirk fix #1 (double-bootstrap):** dissolves in the extraction — the composable's handlers call the injected `completeImport` exactly once; onboarding's injected `completeImport` calls `bootstrapActiveProfile` once. The old per-handler `bootstrapActiveProfile` calls (onboarding import lines ~145/164/187/215) are simply not reproduced. Pin with a test asserting bootstrap fires once per import path.
- Migrate `popup/pages/import.vue` + `onboarding/pages/import.vue` to consume it. Pages keep: templates, `redirectToOnboardingTabIfNeeded` (popup), scroll/hero (popup), the popup full-backup `onKeydown` (page-level), routes/toasts (via injected `completeImport`).
- Tests `useProfileImportFlow.test.ts` (≥10): seed/private/public/passkey success; name-validation blocks submit; error routing for `Invalid secret length` → "secret" and `Invalid password` → "password"; `UserRejectedError` silent return; `isImporting` latch blocks double-click; full-backup wiring threads `runCeremony`; **bootstrap-once pin**; `dispose()` disposes the name field. BUG-PIN any preserved quirk.

**Validation gate**
- Commands: `cd packages/extension && bun run typecheck && bun run lint && bun run test src/composables/useProfileImportFlow.test.ts && bun run test:components`
- Pass: new test green; both import pages typecheck; component suite unchanged-green.
- Layers: typecheck · lint · unit/component.

### Phase 3 — Extract `useProfileCreateFlow`
- New `src/composables/useProfileCreateFlow.ts` (TS, C1). Composes `useProfileNameField`, `usePasskeyCeremony`. Owns: `authMethod`/`type` ref, password/confirm refs, `isAllowedToContinue`, the strength-hint computed, `createPasskeyProfileViaModal` (delegates to `createPasskeyProfileWithRetry`), `handleCreate` (validate → create|passkey → injected `completeCreate`), the unified error notification, and **secret-zeroing in `dispose()`** (popup gains this — minor security improvement; flag in PR).
- Injected per shell: `completeCreate(profile)` — popup passes its manual activation closure **verbatim** (the `while(!isLogined)` + `AccountServiceClient` + `getAccounts` + `initTransactionService` + `chrome.storage` + `setSentinel` sequence); onboarding passes `bootstrapActiveProfile` + route.
- **Quirk fix #2 (Enter double-fire guard):** composable exposes a guarded `onKeydown` carrying the canonical guard from `NewContactPopup.vue:183-188` (skip when the submit button is the focused/event target — native Enter→click already fires). Both pages wire it. Preserves Enter-from-name-input → submit. Test: Enter from name input submits once; Enter while submit button focused does not double-submit.
- Migrate `popup/pages/profile/new.vue` + `onboarding/pages/create.vue`. Popup keeps: manual activation closure, redirect, scroll/hero, `NewProfileMethodTabs`/`NewProfileCredentials` template, `Create with {type}` label. Onboarding keeps: `OnboardingPage` + inline tabs template, `bootstrapActiveProfile` closure.
- Tests `useProfileCreateFlow.test.ts` (≥10): password-create success; passkey-create success via `createPasskeyProfileWithRetry` (retry-on-conflict pin); name-validation blocks; `isCreating` latch; `UserRejectedError` silent; error notification on failure; **Enter double-fire pin**; **secret-zeroing on dispose**; `dispose()` disposes name field.

**Validation gate**
- Commands: `cd packages/extension && bun run typecheck && bun run lint && bun run test src/composables/useProfileCreateFlow.test.ts && bun run test:components`
- Pass: new test green; both create pages typecheck; component suite green.
- Layers: typecheck · lint · unit/component.

### Phase 4 — Integration + smoke e2e + docs
- Root `bun run audit:vue` (typecheck:all → test → lint → build).
- `cd packages/extension && bun run test:e2e` (smoke) — proves the real import + create flows in a launched extension.
- Verify no testid changed: grep the 4 pages' testids against the pre-change set.
- Update `implementations-plan/index.md`; note the new `components/passkey/` home in CLAUDE.md's L-model section if warranted.

**Validation gate**
- Commands: `bun run audit:vue && cd packages/extension && bun run test:e2e`
- Pass: audit:vue exit 0; smoke e2e green (import + create journeys).
- Layers: typecheck · lint · unit · build · smoke e2e.

## Behavior-preservation constraints registry
1. **Popup activation is listener-based** — the composable must never call `bootstrapActiveProfile` for the popup shell; popup injects its own (no-bootstrap for import; manual sequence for create). Onboarding injects the bootstrap.
2. **Passkey cancel/abort semantics** — teleport `#popup`, `AbortController`, Escape + dismount cancel, and `UserRejectedError` normalization unchanged by the relocation.
3. **Load-bearing error strings** — "Invalid key length", "Wrong password", "Invalid encrypted key", "Profile imported", import/create success toasts. Preserve verbatim (the two deliberate changes — popup `fillError` shape + notification title casing — must be checked against tests/e2e for no pin first).
4. **Latches** — `isImporting`/`isCreating` set BEFORE the async `getProfiles()` fetch (double-submit/double-create guard).
5. **Guarded prefill** — `parsedBackupName` fills the name only when the name input is empty.
6. **testids** — every `data-testid` verbatim across all 4 pages + the relocated dialog.

## Assumptions
**Facts** — leaf composables exist + dual-shell-used (`composables/use{PasskeyCeremony,ProfileNameField,FullBackupImport,ProfileBootstrap}.ts`); page sizes/dup (import 668 JS vs 540 TS; create 397 JS vs 377 TS); relocation blast radius (6 + 2 + 3); `onboarding/app.vue:78` `#popup` anchor; `useProfileBootstrap` superset of popup-create manual seq (`useProfileBootstrap.ts:63-77`); canonical Enter guard (`NewContactPopup.vue:183-188`).
**Inferences (challenge):** (a) activation is not safely unifiable → inject `complete*` [load-bearing]; (b) the two quirk fixes are safe (double-bootstrap idempotent; Enter guard preserves input-submit); (c) drift resolutions are not user-visible regressions / not test-pinned; (d) neutral paths `components/passkey/` + `wallet/utils/passkey-ceremony.ts` satisfy the biome layer rules.
**Asks:** confirm the neutral target paths; confirm folding the popup create secret-zeroing (behavior add) is acceptable.

## Security & Adversarial Considerations
- **WebAuthn ceremony integrity** — relocation must not change abort/cancel/`UserRejectedError` normalization; a regression could mis-handle cancel or change which errors surface. Pin via the moved dialog test.
- **Secret material in memory** — seed/private key refs: error routing must never embed raw secret values in `fillError`/notifications; create flow zeroes secrets on dispose (extend to popup). No secret logging.
- **Error info leak** — keep "Wrong password"/"Invalid key length" generic; don't surface stacks or decrypted material.
- **Double-create race** — preserve the pre-fetch latch (two profiles otherwise).
- **No new deps, no crypto changes, no privilege surface** — supply-chain / least-privilege N/A; `bun.lock` untouched.

## Decision ledger (to be completed at consolidation)
- Fable planner unavailable (Fable 5 down) → substituted a Claude `Plan` subagent as the 2nd independent planner; cross-family diversity preserved via codex. _(record)_
