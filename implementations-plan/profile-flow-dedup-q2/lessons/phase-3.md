# Phase 3 — Extract useProfileCreateFlow (+ Quirk 2)

## What changed
- New `src/composables/useProfileCreateFlow.ts` (C1): composes `useProfileNameField` + `usePasskeyCeremony`; owns `authMethod`/`password`/`repeatedPassword`/`isCreating`, `strengthHint`, `isAllowedToContinue`, `createPasskeyProfileViaModal` (delegates to `createPasskeyProfileWithRetry`), `handleCreate`, `dispose()`. **`onKeydown` NOT owned** (page-local; shells differ). Injects `onCreated(profile)` + `notifyCreateFailed(isPasskey)`.
- `handleCreate` keeps the latch-first ordering; isCreating stays true through `onCreated` and resets after (if `onCreated` throws — e.g. popup's "Network not set" — the latch stays set, matching pre-extraction).
- New `src/popup/pages/profile/new-profile-helpers.ts` — extracted popup's two page-local behaviors so they're unit-testable at a real seam (codex final #1): `activateCreatedProfile(profile, { appStore, router })` (the manual sequence, verbatim incl. `setLastActiveProfileId` + the network-null check — codex final #2) and `shouldHandleEnter(e)` (Quirk-2 inclusion guard).
- Migrated `popup/pages/profile/new.vue` (JS): consumes the composable (aliases `authMethod`→`type`), `onCreated` = `activateCreatedProfile`, `onKeydown` = `shouldHandleEnter` guard (Quirk 2), notification title sentence-cased "Profile creation failed" (A1).
- Migrated `onboarding/pages/create.vue` (TS): consumes the composable (aliases `repeatedPassword`→`confirm`, `strengthHint`→`passwordStrengthHint`, `handleCreate`→`handleSubmit`); **preserves its `<form @submit.prevent>` + own `onKeydown` verbatim** (D3 reversed — onboarding untouched) + secret-zeroing + `submitLabel`.

## Tests
- `useProfileCreateFlow.test.ts` — 12 cases (composable-level): password/passkey happy, latch-once, name gate (empty + dup), passkey cancel-silent, password/passkey failure `notifyCreateFailed(false/true)`, `isAllowedToContinue`/`strengthHint`, **latch-stays-set-if-onCreated-throws**, dispose/no-onUnmounted.
- `new-profile-helpers.test.ts` — 7 cases (page-local, codex final #1): activation **ordering pin** (setLastActiveProfileId→getAccounts; setSentinel→push) + "Network not set" guard; **Quirk-2 event-target pins** (input/textarea → submit; button/div/non-Enter → no submit).

## Gate result
| Check | Exit | Result |
|---|---|---|
| typecheck | 0 | clean |
| lint | 0 | 42 warnings (baseline; suppressed the one new `useArrowFunction` on the vitest-4 `new`-mock) |
| `bunx vitest run` | 0 | **199 files / 2431 tests** (= 2412 + 19 new; zero regression) |
| A1 casing | — | no "Profile Import/Creation Failed" Title-Case strings remain anywhere |

## Notes
- Quirk 2 stays popup-only via the page-local `onKeydown` + `shouldHandleEnter`; the ratified side-effect (Enter on a method-tab button no longer submits) is pinned by the button-target test. Onboarding create's Enter behavior is unchanged (its `<form>` + latch already handle it).
- popup-create's manual activation is NOT migrated to `useProfileBootstrap` (constraint #2) — it's a distinct, weaker, listener-dependent sequence.

LESSONS_FILE=implementations-plan/profile-flow-dedup-q2/lessons/phase-3.md
