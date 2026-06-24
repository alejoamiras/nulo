# Phase 3 — Full validation + merge readiness

## Local gates — PASS
- `bun install --frozen-lockfile` → exit 0
- All 5 builds → exit 0: extension chrome, extension firefox, faucet, playground, landing (builds always used the hoisted vite 8, so this confirms the devtools removal + override broke nothing).
- `bun run test:all` → exit 0 (all 11 packages, behavior-neutral on vite 8) · `bun run typecheck:all` → exit 0 · `bun run lint` → exit 0 (54 pre-existing warnings, no errors) — from Phase 2, unchanged.

## e2e — via CI (PR #169), not local
Smoke + network e2e run in CI on the PR, consistent with the repo's CI-gates-e2e model and the #166 precedent. `e2e:agent` was not run locally (≈25 min, needs the per-worktree Aztec/anvil sandbox; redundant with CI). The PR's `Smoke e2e / Status` + `Network e2e / Status` are the authoritative e2e evidence — confirm green before merge.

## Post-impl
- `/code-review`: the repo skill is the interactive guided-tour variant; ran an autonomous self-review instead — no logic changed, no fixes. Zero dangling references to the removed devtools chain.
- Codex post-impl (`019ef93d`): conditional approve, 1 Low (stale plan-index entry) → fixed in `implementations-plan/index.md`. Impl matches ledger; override blast-radius safe; lockfile diff clean.

## Note (recurring)
Local builds/tests regenerate the tracked auto-import stubs (`src/types/auto-imports.d.ts`, `.eslintrc-auto-import.json`) — pre-existing dev drift, NOT part of this PR; reverted each time to keep the tree clean (same call as #166). Worth a separate regen + freshness-check PR someday.

## CI timeout remediation (vite 8 cold transform) — the real Phase-3 work
First CI run + a re-run BOTH failed one unit test: `service.scenarios.test.ts > getIncomingTransfers returns [] when incomingTransfersVisible=false` → `Test timed out in 5000ms` on the first `await bootService()`. Deterministic (2×); passed locally on vite 8 (fast machine). Root cause: `bootService` did a dynamic `await import("./service")` — module-cached, so only the FIRST call paid vite 8's cold transform of the inlined `@nulo/*` graph, which exceeds the 5s per-test default on CI's slower shared runner. dev (vitest on vite 7.3.2) never hit it → the genuine cost of moving the test runner onto vite 8.

Codex consult (xhigh, session `019ef9…` / dir `codex-jKfOhJTW`): keep the dedupe; fix the harness, not the runner. Ranked — (best) hoist/preload the service import out of the per-test budget; (2nd) file-scoped timeout bump = band-aid; (worst) runner-wide `deps.optimizer`/`pool` tuning = broad + speculative. Do NOT raise global `testTimeout`. No suite-wide timeout wave expected (signature = first cold import in one file, later boots fine).

Fix: converted the dynamic `await import("./service")` to a **static top-level import** so the cold transform lands in the file's import phase (not subject to the per-test timeout). `vi.mock("./repository")` is hoisted above it, so the mock still applies. Local: that file 50/50 green; lint clean. CI re-validates on the next push.
