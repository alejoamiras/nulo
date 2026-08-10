# Phase C1 — e2e verify + arming preflight

## What shipped

- **Armed verification first** (the plan's ordering): `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts` → **2/2 green** — the recon's dist-forensics root cause (unarmed build, gate tree-shaken out) confirmed end-to-end; no product bug, no machine sensitivity.
- **Runner guard** (`agent.sh`): scans the run's file set (explicit args, else the network-suite default dir) for the formal `@requires-proverless` marker BEFORE resolving ports or building; unarmed → `FATAL` with the exact remedial command, exit 2. Verified live: instant refusal.
- **File-level `beforeAll` preflight** in `account-switch-isolation.test.ts` (the belt for direct-vitest invocations that bypass agent.sh): greps the loaded dist's `assets/*.js` for `NULO_E2E_PROVERLESS_BUILD_STAMP`, hard-aborts with the remedial command. beforeAll (per audit F-10), not a sibling test, so the multi-minute polls can never start.
- **Formal marker** added to the test docstring; **skill lesson** appended to `.claude/skills/e2e-testing/SKILL.md` (build-time-armed fixtures: rules, idioms, and the grep-the-dist-first diagnosis step — this trap bit twice in two arcs).

## Honest caveat

The `beforeAll` belt's negative path (unarmed dist + direct vitest) was not exercised live — doing so needs a deliberate unarmed rebuild (~2 min) and the runner guard now makes that invocation unreachable through the normal path. Its logic is a two-line stamp grep, typechecked; the runner guard covers the C1 gate's <30 s criterion (measured: instant).

## Gate result: PASS

- Armed run 2/2; unarmed refusal instant with remedial text (exit 2).
- `bun run lint` 0 errors · `bun run typecheck:all` 13/13 · `bun run test` 3878 passed.
- shellcheck: one pre-existing-style SC2001 note on the new echo|sed line (style-only; matches surrounding script idiom).
