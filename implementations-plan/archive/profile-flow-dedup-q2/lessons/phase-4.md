# Phase 4 — Integration + smoke e2e + docs

## What ran
- **Extension build** (`bun run --cwd packages/extension build`): exit 0 (2.23s). The new composables + the relocated dialog auto-import compile + bundle cleanly.
- **`bun run audit:vue`**: FAILS — but entirely in `@nulo/faucet` (102 `Cannot find module '@nulo/bridge-core'`/`@nulo/design` + faucet implicit-any). `typecheck:all` `&&`-halts on faucet before reaching the extension. Confirmed pre-existing: `bun run --cwd packages/faucet typecheck` fails identically (my branch never touches faucet or bridge-core). Out of scope — the extension's own typecheck/lint/test/build all pass.
- **Smoke e2e** (`bun run test:e2e`): **1 failed | 17 passed | 1 skipped** (66 tests passed, 1 failed). Every Q2 flow spec passed: registration, import-paths, onboarding-tab, passkey-paths, passkey-backup, security-backup, auth-flows, security-*.
- Regenerated auto-import types (`components.d.ts`, `auto-imports.d.ts`, `.eslintrc-auto-import.json`) committed; CLAUDE.md component-placement note added.

## The one smoke failure — PRE-EXISTING, not Q2
`settings-crud.test.ts > manage-fpcs page renders the synthetic Public Fee Juice anchor row` (fails 3× = deterministic, not a flake).
- **Proven Q2-independent:** my branch touches zero FPC/settings files (only `export/full.vue`, a dialog-import rewrite — a different settings page). The manage-fpcs page imports nothing Q2 changed.
- **Verified on dev:** checked out clean `dev`, ran the one test → `DEV_FPC_EXIT=1`, identical failure. So it fails without any of my changes.
- **Verdict:** pre-existing dev breakage (FPC synthetic-row rendering on the no-PXE harness), out of scope for Q2. NOT fixed here (would be scope expansion). Flagged for the user / the agent currently working on e2e.

## Gate verdict
The Phase 4 gate's intent — "smoke proves the real import + create journeys end-to-end in both shells" — is **met**: all Q2 flows green. The lone red is a pre-existing, Q2-independent FPC test (reproduced on dev). Extension build green; extension typecheck/lint/unit green (2431).

LESSONS_FILE=implementations-plan/profile-flow-dedup-q2/lessons/phase-4.md
