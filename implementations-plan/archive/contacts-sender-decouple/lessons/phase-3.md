# Phase 3 — Focused component tests

## What shipped (34 tests across 5 files, all green)
- `NewContactPopup.test.ts` (5): submit → addContact only (trimmed name), success/error toasts,
  no `new-contact-register-sender` testid or "Register as sender" copy, duplicate-guard submit
  gating, disconnect-on-close.
- `EditContactPopup.test.ts` (5): prefill + clean-state submit gate, **address edit calls
  updateContact only — no sender toggle/migration** (the decoupling pin), trimmed name, error
  path, import-staging mode (writes cacheStore, no service call).
- `ImportContactsPopup.test.ts` (3): counted sender banner — exact count + network name,
  singular/plural, hidden at zero.
- `useContactImportExport.test.ts` (6): adds-only sender semantics — isSender:true registers on
  the ACTIVE network with counted toast; **merge-by-name address swap NEVER deletes the old
  registration** (regression pin for the removed migration); no-network skip surfaced; in-file
  per-address dedup (first wins); sender-free import plain-success toast; export isSender from
  the cross-network union.
- `contacts-export-format.test.ts` (+2): MAX_CONTACT_IMPORT_ROWS boundary (accepts exactly the
  cap, rejects cap+1 on both v1 and v2 shapes).

## Root-caused during the phase (2 fix rounds, logged per failure-retry policy)
1. `useFormState is not defined` in both popup component tests: the vitest config's auto-import
   covers ONLY `vue` + `vue-router` — NOT `src/composables/` or `src/utils/` (the prod vite
   config auto-imports those dirs). This is why `NewTokenPopup.vue` imports `useFormState`
   explicitly. Fix: explicit imports in `NewContactPopup.vue` + `EditContactPopup.vue`
   (`useFormState`, `TOAST_DURATION`).
2. 3 unhandled rejections from `ImportContactsPopup` renders (`trimAddress` undefined in row
   loop) — same auto-import gap, template-side, surfacing as unhandled errors with tests still
   "passing" (vitest exit 1). Fix: explicit `trimAddress` import. **Durable lesson: any SFC that
   gets a component test must explicitly import its composables/utils — auto-import does not
   exist under vitest.** (Candidate for the e2e-testing/debug skill if it recurs.)

## Validation gate (plan Phase 3)
- `bun run lint` → exit 0 (after biome format pass on the new test files)
- `bun run typecheck` → exit 0
- `bun run test` → 3194 passed | 7 todo (268+ files), zero unhandled errors
