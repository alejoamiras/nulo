# Phase 1 lessons — always() guards on the two deploy jobs (2026-07-03)

## The edit
Both `refresh-landing` (`release.yml:348`) and `deploy-faucet` (`release.yml:377`) had byte-identical `if:` blocks (and both distinct from `verify-live`, which carries `timeout-minutes: 10` + its own `always()`), so a single `replace_all` prepended the guard to exactly the two:
```yaml
always() && !cancelled() &&
needs.resolve.result == 'success' &&
needs.attach-assets.result == 'success' &&
```
`verify-live` (now `release.yml:412`) left UNTOUCHED per the codex High finding — it keeps `always()` + `attach-assets` success so it still runs and fails against a stale site (the safety net that caught the bug).

## Validation gate — met (validation (a): actionlint + logic-review)
- `bun run lint:actions` → clean (exit 0).
- Guard grep: `always() && !cancelled() &&` appears exactly 2× (refresh-landing:349, deploy-faucet:381); `verify-live` shows `always()` + `attach-assets.result=='success'` only (no `!cancelled()` → unchanged).
- **Logic-review** (all 8 cases walked):
  1. stable push:main, all success → RUNS ✓
  2. dispatch, network-e2e skipped, attach-assets success (THE BUG) → RUNS ✓ (fix)
  3. prerelease tag → SKIPS ✓ (stable-only)
  4. dry_run=true → SKIPS ✓
  5. attach-assets failed → SKIPS ✓ (fail-closed)
  6. attach-assets cancelled → SKIPS ✓
  7. resolve failed (no tag) → SKIPS ✓
  8. run cancelled after attach-assets → SKIPS ✓ (`!cancelled()` — no late hook fire)
- The live-repro dispatch was NOT run (user picked validation (a); it would republish v0.24.0). The next real 0.24.1 release is the live proof.

## Why `always() && !cancelled()` and not just `always()`
`always()` alone would run the job even when the whole workflow is cancelled → a cancelled release could still fire the production deploy hooks. `!cancelled()` (codex Low) blocks that. The explicit `needs.resolve.result=='success' && needs.attach-assets.result=='success'` are the fail-closed guards (never deploy off a broken/asset-less release); a skipped *sibling* (network-e2e / release-please / auto-unstick) no longer propagates a skip because the status-function (`always()`) overrides the implicit `success()` gate.
