# Phase 3 — Send recipient card + remove Send vault (#3, #4-Send)

**Status:** ✓ complete (code + gate green). Commit pending 1Password unlock.

## What changed
- **New** `src/components/composite/send/RecipientCard.vue` — the selected-recipient summary: AccountAvatar
  + name (or "Address" for a raw address) + the address masked `0x?????? *** ????????` (`slice(0,8)` +
  ` *** ` + `slice(-8)`, the user's "first 8 / last 8"). A prominent **eye** toggle reveals the FULL
  address (mono, `selectable`) + a copy button. 13 component tests.
- **`RecipientField.vue`** restructured: when `selectedContact` is set, the typing `<Input>` is REPLACED by
  `<RecipientCard>` (with a `close` "change" button → `handleChange` clears selection + searchTerm and
  restores the input via `:autofocus="justCleared"`). The vault `<Icon>` is gone from the suffix (89) and
  the suggestion list (131); suggestion rows now render `<AccountAvatar>` for both contacts AND accounts
  (the old `c.abbr` chip + vault fallback unified). Copy emits `copied` → parent shows a toast.
- **`RecipientField.test.ts`** rewritten — the old tests asserted the `vault` fallback (the thing deleted);
  now: no vault icon, AccountAvatar per suggestion, card-on-selection with the full address, change-clears.

## Design decisions
- **Card REPLACES the input on selection (not additive).** Matches the user's "card of name + masked
  address". The typing input only exists pre-selection; the e2e (`fee-methods` etc.) types into the input
  during the typing phase, so replacing post-selection is safe. The recipient's full address always rides
  in `searchTerm` (what `send.vue:247` submits) — the card just displays it.
- **Reveal is OPTIONAL** (user's informed risk-acceptance): the eye is prominent + one tap, so verifying
  to 100% certainty is easy, but it does NOT gate Send. Raw typed/pasted addresses stay in the input and
  are made readable by P4's affordance (so they have a verification surface too — no card bypass).
- **`recipientCandidates = [...contacts, ...accounts]`** (send.vue:165) → the card/avatar handle both
  contacts and accounts uniformly via `{ name, address }`.

## Validation gate — PASSED
- `bun run --cwd packages/extension test -- run src/components/composite/send/RecipientCard src/popup/components/modules/send/RecipientField` → 18 passed.
- `bun run typecheck:all` → exit 0. `bun run lint` → exit 0.
- `! grep -rn 'name="vault"|icon="vault"' packages/extension/src` → EMPTY (the last 2 source usages gone;
  the test asserts absence via `iconNames.not.toContain("vault")`, no literal `name="vault"`).
- `bun run build` → exit 0 (`components.d.ts` gains `RecipientCard`, kept; auto-imports churn restored).
- `bun run test:e2e` (relevant smoke specs: contacts, accounts, settings-crud, navigation, registration) →
  23 passed. (Full 20-spec suite runs at the P5b gate per the plan.)

## Lessons
- **`useToast` did NOT auto-import in the vitest transform** (`useToast is not defined` at setup) even
  though Vue-core auto-imports work — composable `dirs` scanning isn't applied in the test transform here.
  Fix: add an explicit `import { useToast } from "@/composables/toast"` (the file already explicitly
  imports its utils; the app's unplugin-auto-import skips already-imported names, so no double-import).
- **A "no vault" assertion must not embed the literal `name="vault"`** or it trips the gate's
  `grep 'name="vault"'`. Assert via the stub's collected `data-name` values + `.not.toContain("vault")`.
- **defineModel emits only on CHANGE**: testing "change clears searchTerm" needs the mount to start with a
  NON-empty `searchTerm` (= the selected address), else clearing "" → "" emits nothing.

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-3.md
