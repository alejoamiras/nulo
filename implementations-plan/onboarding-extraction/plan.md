# Onboarding-tab Follow-up — Extraction Plan v2

**Changes from v1**: incorporates Codex (REJECT) + Opus 4.7 (approve-with-fixes) reviews, then Codex v2 (approve-with-fixes) hygiene pass. Net effect: the plan is radically smaller. Four extractions instead of five. No `useX()` composables — all extractions are plain functions with explicit dependencies (E1 is the only Vue component). E5 dropped. E4 demoted to a single-line helper. E1 narrowed to text-only.

## 0. Context

PR #7 (`feat/onboarding-tab`) merges shortly to `dev`. This follow-up reduces small duplications between popup and onboarding code paths. The audit cycle rejected v1's "5 composables" framing; this v2 is smaller, more honest, and matches the actual pattern surface.

Honest cost/benefit recompute (v1's LOC math was internally inconsistent — Codex flagged):
- v2 new code: ~180 LOC (3 helpers + tests + 1 small component + tests)
- v2 LOC removed from consumers: ~120 LOC
- **Net: +60 LOC.** This is a refactor that pays off in clarity, not line count.

## 1. Goals

- Single source of truth for **only** the patterns that are genuinely uniform across consumers.
- No behavior change at the call site (verified by existing e2e suite).
- Honest test budget (≥5 per L2 component; helpers tested only for behaviors that matter, not by the 10-case minimum which is for `useX()` composables).

## 2. Non-goals

- Don't unify popup + onboarding hero styles into one component (they differ in size/bar/semantics — v1 misread the pattern).
- Don't extract anything with <3 confirmed consumers (kills E5 and `<SkipLink>`).
- Don't promote shared logic to `useX()` composables when there's no reactive state (kills v1's E2 and E4).
- Don't touch `popup/app.vue`'s `onActiveProfileChanged` listener chain (the orchestration difference Codex caught is by design — popup auto-bootstraps via event; onboarding bootstraps explicitly because it has no equivalent listener).

## 3. The three extractions

### E1 — `<BrutalistTitle>` (L2 component, narrowed)

**What changed from v1**: scope tightened to *just the title text*. The accent bar stays inline at each consumer. Popup pages are NOT migrated (the size + bar + DOM-tag matrix is too inconsistent to model in a single component without becoming a prop farm — Codex finding).

**Pattern (DOM after extraction):**
```vue
<header :class="$style.hero">
  <BrutalistTitle main="Create" sub="Wallet" />
  <div :class="$style.hero_bar" />   <!-- stays inline -->
</header>
```

**Consumers (onboarding only — 6):**
- `packages/extension/src/onboarding/pages/welcome.vue` (center align, 56px)
- `packages/extension/src/onboarding/pages/create.vue` (left, 48px)
- `packages/extension/src/onboarding/pages/import.vue` (left, 48px)
- `packages/extension/src/onboarding/pages/learn.vue` (left, 48px)
- `packages/extension/src/onboarding/pages/accelerator.vue` (left, 48px)
- `packages/extension/src/onboarding/pages/done.vue` (center, 48px)

The done page's 56px bar stays inline. The welcome page's 56px main-text size is the `"hero"` variant.

**Popup pages NOT migrated:**
- `popup/pages/profile/new.vue` (40px main, 32px bar, `<div>` not `<h1>`)
- `popup/pages/import.vue` (same shape)
- `popup/pages/settings/security/reset.vue` (destructive red variant + same 40/32 pattern)
- `popup/pages/settings/security/change-password.vue` (Codex found this; same 40/32 pattern)

Migrating popup-side hero styling is a separate concern — it requires either (a) a bigger prop matrix or (b) a separate `<PopupSubpageTitle>` primitive. Either way, out of scope for this PR.

**Proposed API:**
```ts
defineProps<{
  main: string
  sub: string
  align?: "left" | "center"           // default "left"
  size?: "default" | "hero"           // 48 / 56 (only two sizes needed in onboarding)
}>()
```

No `variant`, no `barWidth`, no slot, no `as` prop. If a future case needs more, add it later.

DOM: always `<h1>` (all 6 onboarding consumers are page heroes; semantics check).

**Where:** `packages/extension/src/components/ui/BrutalistTitle.vue` (L2). Both reviewers agreed on L2 once the scope was narrowed.

**Tests** (`packages/extension/src/components/ui/BrutalistTitle.test.ts` — 5 cases, L2 minimum):
1. Renders `main` + `sub` text in two spans.
2. Defaults: align=left, size=default.
3. `align="center"` applies the center class.
4. `size="hero"` applies the 56px scale.
5. Outer element is `<h1>`.

**Storybook** (`packages/extension/src/components/ui/BrutalistTitle.stories.ts` — 2 stories):
- Default (Create / Wallet).
- Hero center (Welcome / to Nulo).

Per CLAUDE.md: run `bun run --cwd packages/extension build-storybook` after adding the story.

**Risk: visual regression — high enough to call out separately.** The 6 onboarding pages have subtly different alignment/spacing matrices: `welcome.vue:80-112` and `done.vue:126-158` use center-aligned stacks with `gap: 4px`; the four left-aligned pages (`create/import/learn/accelerator`) use no gap and 48px text. Lifting the *shared structural rules* (font family, weight, letter-spacing, line-height, text-transform, the two-color split between accent and secondary) into the component, but parameterizing alignment + size via the `align` and `size` props, is the safe approach. **Do NOT literally lift welcome.vue's CSS** — pick out the cross-page invariants and reconstruct, then verify each consumer renders unchanged via Storybook side-by-side.

### E2 — `createPasskeyProfileWithRetry` (helper function, not composable)

**What changed from v1**: this is no longer a `useX()` composable. It's a plain async function with all dependencies injected. Codex + Opus both rejected the composable framing — there's zero Vue reactivity here.

**Pattern**: the `MAX_RETRIES=1` retry-on-`ProfileIdConflictError` loop in `popup/profile/new.vue:88-104` and `onboarding/create.vue:63-78`. Byte-identical retry logic.

**Caller-side delta to preserve** (Opus caught this): `popup/profile/new.vue:161-163` sets `chrome.storage.local["nulo:ui:activeAccount"]` after profile creation; `onboarding/create.vue:116` calls `bootstrapActiveProfile(profile)` instead. **E2 MUST NOT absorb either of these post-create side effects.** The helper's scope is bounded strictly to: (a) generate a profile id, (b) run the ceremony, (c) call `createPasskeyProfile`, (d) retry once on `ProfileIdConflictError`. Everything after the helper returns stays in the caller.

**Proposed signature:**
```ts
export interface PasskeyProfileDeps {
  runCeremony: (req: PasskeyRequest) => Promise<PasskeyCredentialData>
  generateProfileId: () => Promise<string>
  createPasskeyProfile: (name: string, credData: PasskeyCredentialData) => Promise<ProfileInfo>
}

export async function createPasskeyProfileWithRetry(
  name: string,
  deps: PasskeyProfileDeps,
): Promise<ProfileInfo>
```

Full DI: no implicit reach into `managers.profile`. The helper takes all three service calls as explicit deps. Caller wires them:

```ts
const { runCeremony, request, onResolve, onReject } = usePasskeyCeremony()

async function handleSubmit() {
  const profile = await createPasskeyProfileWithRetry(name, {
    runCeremony,
    generateProfileId: () => managers.profile.generateProfileId(),
    createPasskeyProfile: (n, c) => managers.profile.createPasskeyProfile(n, c),
  })
  // ...
}
```

**Where:** `packages/extension/src/wallet/utils/create-passkey-profile.ts` (a `@/wallet/utils/` helper, alongside `auth-registry.ts` etc.). Sibling to existing security-adjacent helpers. Naming chosen to make intent unambiguous: this is creating a passkey-typed profile with retry.

**Tests** (`packages/extension/src/wallet/utils/passkey-create.test.ts` — 6 cases, full DI makes them easy):
1. Happy path: no conflict, returns profile on first attempt.
2. Conflict on attempt 1, retry succeeds.
3. Conflict on attempt 1, conflict on retry → throws final conflict.
4. Non-conflict error throws immediately (parameterized: `UserRejectedError`, generic `Error`).
5. Each retry calls `generateProfileId` again (fresh id per attempt).
6. `runCeremony` is invoked with `{mode: "create", userHandle}` matching the generated id.

Vitest 4 mock note: with full DI, no `vi.mock` of `@/utils/core` or service-client modules is needed. Stub via plain `vi.fn()` in `deps`. Clean.

### E3 — `waitForProfileActive` (helper function, narrowed from v1's E3)

**What changed from v1**: v1 proposed `useImportCompletion` wrapping the entire post-import flow. Codex pointed out this papered over a real difference: onboarding pages call `bootstrapActiveProfile(profile)` BEFORE `completeImport`; popup pages don't (they rely on the SW's `onActiveProfileChanged` event firing through `popup/app.vue`'s listener). v2 extracts only the part that's actually shared: the activation watcher.

**Pattern**: the watcher that awaits `appStore.isLogined && appStore.profile?.id === expectedId`. Identical in `popup/import.vue:127-138` and `onboarding/import.vue:104-114`.

**Proposed signature:** use a minimal structural interface, not `ReturnType<typeof useAppStore>` — keeps the helper decoupled from unrelated store-shape churn.

```ts
export interface ProfileActivationSubject {
  isLogined: boolean
  profile?: { id: string }
}

export function waitForProfileActive(
  store: ProfileActivationSubject,  // pass appStore at the call site; the type only requires the two fields used
  expectedId: string,
  timeoutMs: number,
): Promise<void>
```

Returns a promise that resolves when the profile is active, rejects on timeout. The watcher is set up + torn down internally; no caller obligation.

**Caller (both popup and onboarding):**
```ts
try {
  await waitForProfileActive(appStore, profile.id, 30_000)
  openToast({ label: "Profile imported", icon: "check-circle" })
  router.push("/popup/general")  // or /onboarding/learn
} catch {
  openToast({ label: "Profile imported. Unlock to continue." })
  router.push("/popup/auth")  // or /onboarding/learn
}
```

Routing + toasts + `bootstrapActiveProfile` calls stay in each page — they differ legitimately.

**Where:** `packages/extension/src/composables/waitForProfileActive.ts`. Despite the file location, this is a helper function (no `useX` prefix, no `onBeforeUnmount` hook). The `composables/` directory is fine since it uses Vue's `watch` API, which is what that dir is for.

**Tests** (`packages/extension/src/composables/waitForProfileActive.test.ts` — 5 cases):
1. Resolves immediately when `isLogined && profile.id === expectedId` at call time.
2. Resolves after the watcher fires with the matching state change.
3. Rejects with "Profile activation timeout" after timeoutMs.
4. Watcher is torn down on resolution (no leaked subscription on success).
5. Watcher is torn down on timeout (no leaked subscription on failure).

### E4 — `redirectToOnboardingTabIfNeeded` (helper function, not composable)

**What changed from v1**: not a `useX()` composable. A plain async function. The `onBeforeMount(async () => ...)` stays inline at each call site (3 popup pages); only the predicate + side effect get shared.

**Pattern**: the 7-line predicate in `register.vue:22-29`, `popup/import.vue:59-66`, `profile/new.vue:44-51`.

**Proposed signature:** minimal structural type (same approach as E3) keeps the helper decoupled from `appStore` shape changes.

```ts
export interface OnboardingRedirectSubject {
  onboardingCompleted: boolean
  profiles: ReadonlyArray<unknown>  // we only check .length
  loadOnboardingCompleted: () => Promise<void>
}

export async function redirectToOnboardingTabIfNeeded(
  store: OnboardingRedirectSubject,
): Promise<boolean>  // returns true if redirect fired
```

Implementation owns the load + predicate + dynamic import + tab open + window close.

**Caller (3 popup pages):**
```ts
onBeforeMount(async () => {
  await redirectToOnboardingTabIfNeeded(appStore)
})
```

Each page keeps its own `onBeforeMount` block (Codex: "extract the helper, keep the hook obvious at each call site"). The 3-line wrapper is fine; it makes the call site explicit.

**Where:** `packages/extension/src/wallet/utils/onboarding-tab.ts` (existing file — add as a sibling export to `openOrFocusOnboardingTab`).

**Tests** (`packages/extension/src/wallet/utils/onboarding-tab.test.ts` — extend the existing file with 4 new cases):
1. Returns false (no-op) when `appStore.onboardingCompleted` is true.
2. Returns false when `appStore.profiles.length > 0`.
3. Returns true after calling `openOrFocusOnboardingTab` + `window.close`.
4. Awaits `loadOnboardingCompleted` before checking the flag (verifies hydration order).

Dropping v1's proposed "rejection-fallback" test (would be a behavior change — current code doesn't have a fallback; let it reject) and "no-op outside onBeforeMount" test (nonsense — Codex flagged).

## 4. Dropped from v1

- **v1 E5 (`<BackLink>`)**: 2 consumers, ~25 LOC each. Codex caught that `onboarding/import.vue:434-440` ALSO has a different "Back to methods" back button — the pattern isn't even uniform across the 2 sites. Net of the 10-test minimum + new component + L2/L3 debate, the cost exceeds the benefit. Revisit when consumer #3 appears.
- **v1's `useCreatePasskeyProfile` composable framing**: replaced by E2's plain helper with full DI.
- **v1's `useImportCompletion` composable framing**: replaced by E3's narrower helper. The popup-vs-onboarding `bootstrapActiveProfile` divergence stays inline at the pages (it's a design difference, not duplication).
- **v1's `useOnboardingRedirect` composable framing**: replaced by E4's plain helper. The `onBeforeMount` hook stays inline at each page.
- **Touching popup pages in E1 scope**: deferred. The matrix of sizes / bar widths / DOM tags is too inconsistent for a single primitive.

## 5. File-by-file delta

### New files (7)

```
packages/extension/src/components/ui/BrutalistTitle.vue
packages/extension/src/components/ui/BrutalistTitle.test.ts
packages/extension/src/components/ui/BrutalistTitle.stories.ts
packages/extension/src/wallet/utils/create-passkey-profile.ts
packages/extension/src/wallet/utils/create-passkey-profile.test.ts
packages/extension/src/composables/waitForProfileActive.ts
packages/extension/src/composables/waitForProfileActive.test.ts
```

### Edited files (8 unique)

Per-extraction matrix (✓ = file is touched by this extraction):

| File | E1 | E2 | E3 | E4 |
|---|---|---|---|---|
| `onboarding/pages/welcome.vue`             | ✓ |   |   |   |
| `onboarding/pages/create.vue`              | ✓ | ✓ |   |   |
| `onboarding/pages/import.vue`              | ✓ |   | ✓ |   |
| `onboarding/pages/learn.vue`               | ✓ |   |   |   |
| `onboarding/pages/accelerator.vue`         | ✓ |   |   |   |
| `onboarding/pages/done.vue`                | ✓ |   |   |   |
| `popup/pages/profile/new.vue`              |   | ✓ |   | ✓ |
| `popup/pages/import.vue`                   |   |   | ✓ | ✓ |
| `popup/pages/register.vue`                 |   |   |   | ✓ |
| `wallet/utils/onboarding-tab.ts`           |   |   |   | ✓ (new export) |

`implementations-plan/onboarding-extraction/` also gains `plan.md` + audit transcripts. Per CLAUDE.md's "Implementation plans" rule, all transcripts get a path scrub before commit (strip any temp-file path references the codex/opus runs may have produced).

## 6. Implementation order

Re-ordered per Opus + Codex feedback:

1. **E1** (BrutalistTitle) — biggest visual blast-radius first. Verify all 6 onboarding pages render identically. Run smoke e2e to confirm.
2. **E2** (createPasskeyProfileWithRetry) + **E3** (waitForProfileActive) **together** — they touch DIFFERENT pairs of pages but the same kind of audit gates (popup-and-onboarding mirror pair each). Doing them in one block amortizes the test infra (Vitest mocks for the service calls). E2's pair: `popup/profile/new.vue` + `onboarding/create.vue`. E3's pair: `popup/import.vue` + `onboarding/import.vue`.
3. **E4** (redirectToOnboardingTabIfNeeded) — last. Touches `popup/import.vue` and `popup/profile/new.vue` (already modified by E2/E3 → doing E4 last avoids merge churn) plus `popup/register.vue` (new in this step).
4. `bun run audit:vue` + `bun run test:e2e` after each block (not just at the end).
5. `bun run --cwd packages/extension build-storybook` after E1 (per CLAUDE.md storybook gate).

## 7. Risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| 1 | **E1 collapses the alignment/spacing matrix** — center+gap on welcome/done vs left+no-gap on the 4 mid pages — and rolls them into a single bad default. | **Med-High** | Don't lift welcome.vue verbatim. Identify the cross-page invariants (font, weight, letter-spacing, color split, line-height), parameterize via `align` and `size`. Verify each of the 6 pages via Storybook side-by-side before final commit. |
| 2 | E2 absorbs popup's `chrome.storage.local["nulo:ui:activeAccount"]` write OR onboarding's `bootstrapActiveProfile` call by accident. | Low | §3.E2 calls out the boundary explicitly. Reviewer checklist on the PR: "popup/profile/new.vue:161 storage write still present; onboarding/create.vue's bootstrapActiveProfile call still present". |
| 3 | E3 misses a subtle difference in the popup-vs-onboarding bootstrap chain. | Low | Existing e2e (`registration.test.ts`, `import-paths.test.ts`, `onboarding-tab.test.ts`) is the regression sentinel. Re-run after E3 lands. |
| 4 | E4's helper changes timing/order of the predicate vs current inline code. | Low | Helper is a 1-for-1 lift; only change is where the code lives. `onBeforeMount` hook stays in each page. |
| 5 | Vitest 4 constructor-mock pattern needed somewhere. | Low | All three helpers use full DI / function-style mocks — no constructor-mock needed. Vitest 4 caveat doesn't apply. |
| 6 | Storybook story build fails for BrutalistTitle. | Low | Run `bun run --cwd packages/extension build-storybook` before opening PR. |

Risks that v1 had but v2 drops: visual regression on popup pages (E1 no longer touches them); composable lifecycle hazards (no composables in v2); test budget bloat (smaller, behavior-focused tests instead of the 10-case composable minimum).

## 8. Test plan

| Component | Cases | Minimum per CLAUDE.md |
|---|---|---|
| BrutalistTitle | 5 | 5 (L2) |
| createPasskeyProfileWithRetry (helper) | 6 | No minimum — helpers tested for behavior |
| waitForProfileActive (helper) | 5 | No minimum — helpers tested for behavior |
| redirectToOnboardingTabIfNeeded (helper) | 4 | Extending existing onboarding-tab.test.ts |

**Total new tests: ~20**, vs v1's proposed ~45. Honest budget.

Existing tests that must still pass:
- 1675 unit + component tests
- `tests/e2e/onboarding-tab.test.ts` (5 cases)
- `tests/e2e/registration.test.ts`, `passkey-paths.test.ts`, `passkey-backup.test.ts`, `import-paths.test.ts`, `auth-flows.test.ts`, `security-reset.test.ts`

No new e2e required — behavior unchanged at the call sites.

## 9. Open questions (down from 5 in v1 to 2)

- **Q1**: where should `createPasskeyProfileWithRetry` live? Plan picks `@/wallet/utils/passkey-create.ts`. Alternative: `@/composables/` (no — it's not reactive). Alternative: `@/wallet/services/profile/client.ts` (no — that's the service client, not a helper). Sticking with `wallet/utils/`.
- **Q2**: should v2's `waitForProfileActive` accept the `appStore` as a parameter, or call `useAppStore()` internally? Plan says explicit param. Tradeoff: implicit `useAppStore()` simplifies the caller but couples the helper to Pinia + the specific store. Explicit param is more testable and decoupled. Sticking with explicit.

## 10. PR description sketch

```
chore(onboarding): extract shared title, passkey-retry, profile-wait, redirect helpers

Three patterns from the post-merge audit of feat/onboarding-tab,
extracted into single-source-of-truth helpers (not composables — no
reactive state). Plus one small component for the two-line uppercase
hero title.

E1. <BrutalistTitle> (L2) — six onboarding pages share the two-line
    uppercase title text. Bar styling stays inline (consumer specific).
    Popup pages NOT migrated (size/bar matrix is too inconsistent).
E2. createPasskeyProfileWithRetry(name, deps) — popup/profile/new and
    onboarding/create share the MAX_RETRIES=1 retry-on-
    ProfileIdConflictError loop. Plain helper with full DI.
E3. waitForProfileActive(store, id, timeoutMs) — popup/import and
    onboarding/import share the activation watcher. Routing + toasts +
    bootstrapActiveProfile stay in pages (real divergence preserved).
E4. redirectToOnboardingTabIfNeeded(store) — popup register/import/
    profile-new share the redirect predicate. onBeforeMount hook
    stays inline at each call site.

No behavior change. Net +60 LOC; 20 new tests.
```

---

## Appendix — what changed v1 → v2

| Change | Source | Rationale |
|---|---|---|
| Drop E5 (`<BackLink>`) entirely | Codex + Opus | 2 consumers, non-uniform; cost > benefit |
| Demote E2 to plain helper with full DI | Codex + Opus | No reactive state; "half-DI" via implicit `managers.*` is a smell |
| Narrow E3 to `waitForProfileActive` only | Codex | Popup vs onboarding `bootstrapActiveProfile` divergence is real, not papering-over-able |
| Demote E4 to plain helper, keep `onBeforeMount` inline | Codex + Opus | No reactive state; hiding the hook obscures orchestration |
| E1 onboarding-only, drop popup-side scope | Codex | size/bar/DOM matrix too inconsistent for one primitive |
| E1 narrow to text-only (bar stays inline) | Codex | bar widths vary per page even within onboarding (done.vue 56 vs others 40) |
| Fix LOC math | Codex | v1 had 200/400/400 contradictions across sections |
| Drop test cases that test absent behavior | Codex | "rejection fallback" + "no-op outside onBeforeMount" don't reflect current behavior |
| Add `change-password.vue` to the consumer survey | Codex | I missed it in v1's inventory |
| Re-order implementation: E1 → E2+E3 together → E4 last | Opus | E4 touches 3 popup pages also modified by E2/E3 |
| Storybook build command in plan | Codex | Per CLAUDE.md gate |
