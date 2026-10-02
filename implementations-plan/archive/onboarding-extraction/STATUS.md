# Onboarding-tab Extraction — Status

**Branch**: `feat/onboarding-extractions` → PR into `dev`.
**Predecessor**: `implementations-plan/onboarding-tab/` (PR #7, merged into `dev`).

## Outcome

All four planned extractions landed as v2.

| Block | Surface | Consumers | Tests |
|---|---|---|---|
| E1 | `<BrutalistTitle>` L2 component (`components/ui/`) | 6 onboarding pages | 5 cases (≥5 for L2 minimum) |
| E2 | `createPasskeyProfileWithRetry()` helper (`wallet/utils/create-passkey-profile.ts`) | `popup/profile/new.vue` + `onboarding/create.vue` | 6 cases |
| E3 | `waitForProfileActive()` helper (`composables/waitForProfileActive.ts`) | `popup/import.vue` + `onboarding/import.vue` | 5 cases |
| E4 | `redirectToOnboardingTabIfNeeded()` helper (`wallet/utils/onboarding-tab.ts`) | 3 popup pages (`register`, `import`, `profile/new`) | 4 new cases (9 total in file) |

## Audit cycle

v1 of the plan proposed five `useX()` composables. The double-review cycle (Codex + Opus 4.7 in parallel) rejected the framing:

- Codex (REJECT v1): "5 composables for ~120 LOC of duplication is over-engineering. The `useX()` pattern implies reactive state ownership; these are plain functions."
- Opus 4.7 (approve-with-fixes v1): "Helpers fine; LOC math inconsistent; composables vs. helpers boundary wrong."

v2 consolidated both reviews into a smaller four-block plan with three plain helpers and one L2 component. Codex v2 (approve-with-fixes) flagged hygiene items (parameter naming, structural types for store subjects). All landed.

The v1 → v2 diff is summarized in plan.md §"Changes from v1" header.

## Gate results

- `bun run typecheck:all`: passing across 9 packages.
- `bun run audit:vue`: typecheck + tests + lint + build all green.
- Component + helper test files run inside the existing `bun run test` matrix.
- Storybook build is broken on `dev` (pre-existing Vite 8 + Rolldown alias-config compat issue, unrelated to this branch).

## Why no audit-*.md files in this archive

Unlike `onboarding-tab/`, the audit transcripts here were not captured as standalone markdown deliverables. The double-review feedback is encoded directly in plan.md's "Changes from v1" preamble and the explicit non-goals in §2 — each non-goal is a reviewer rejection turned into a guard rail.

## Follow-ups (out of scope)

- L2 minimum on the four `composite/import/` files (pre-existing — not on this branch).
- Storybook Vite 8 compat (unrelated; tracked elsewhere on `dev`).
- L2 vs. composite boundary on `<BrutalistTitle>` if popup pages later adopt it (would graduate to composite if it grows props).
