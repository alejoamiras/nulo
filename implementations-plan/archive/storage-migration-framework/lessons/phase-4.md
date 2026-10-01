# Phase 4 — Proof: build-excluded fixture + smoke e2es

## Work
- **`E2E_MIGRATION_FIXTURE`** flag in `apps/extension/src/e2e/config.ts` (env `VITE_NULO_E2E_MIGRATION_FIXTURE=1` at build time; single flag, not the proverless confirm-pair — an accidentally-shipped fixture is inert since it transforms only its own test-only root, and the grep guard still enforces absence).
- **`src/e2e/migration-fixture.ts`**: v2 migration on root `nulo:e2e:mig-fixture` (rename `legacyName`→`name`, idempotent). Two test knobs deliberately OUTSIDE the declared footprint (a footprint key would be snapshotted + restored on failure, resurrecting a "throw" toggle forever): `nulo:e2e:migration-boom` (throw) + `nulo:e2e:migration-hold` (park mid-`up()`, 15s safety cap < the 60s smoke testTimeout).
- **Registry** spreads the fixture behind the static-false const (proof-gate pattern); marker added to `_build-extension.yml`'s negative grep; `_smoke-e2e.yml` stamps the in-job build + sets `NULO_E2E_MIGRATION_FIXTURE=1` for the test step (UNSET on the release-artifact path — prod zips exclude the fixture, and `migration.test.ts` skips itself via `describe.skipIf`).
- **`tests/e2e/migration.test.ts`** — 4 specs through the REAL boot path (fresh install stamps max ⇒ each test seeds pre-shape rows + REWINDS the marker + kills the SW via CDP `Runtime.terminateExecution`; a reopened popup respawns it and the boot migrator fires): (1) transform + checkpoint + journal cleared; (2) boom ⇒ fail-closed (version unadvanced, data untouched, `migration-blocked` recovery screen) → remove boom → reboot ⇒ restore→re-run→green; (3) hold ⇒ popup shows `migration-updating`, data mid-flight untouched → release ⇒ transformed exactly once; (4) SW killed mid-hold (journal armed: running+backup) → release + respawn ⇒ converges. Deterministic waiters on `nulo:schema:version` / journal keys — no sleeps.

## The DCE leak (the audit called it)
First prod-shaped build **leaked the fixture**: the registry's ternary folded correctly (`migrations = []`) but the `defineMigration({...})` CALL was retained as a possible side effect once its binding was dropped — exactly the Opus auditor's C3 warning that "a migration in an array is not DCE-friendly like a dead-`if`". Fix: a **load-bearing `/* @__PURE__ */` annotation** on the call. Proven both directions: prod-shaped build → marker absent ✓; stamped build → present ✓. Lesson: for conditional-spread registry entries, PURE-annotate the factory call AND verify with a build grep in both states.

## The zombie-SW discovery → relaunch design
First spec design used sw-resilience's CDP `Runtime.terminateExecution` to force a re-boot. **All 4 specs failed systematically** (not flake): an instrumented probe showed the killed SW target lingers as a **zombie** — `swTarget=true`, liveness never rewritten, and opening a new extension page does NOT revive it (20s observed), with or without other popup pages open. This is precisely why sw-resilience's respawn tests are skipped on CI.

**Fix: persistent `userDataDir` + full browser relaunch** — strictly MORE faithful: closing the browser and relaunching on the same profile dir is a real extension cold boot over surviving `chrome.storage.local`, and closing the browser mid-migration IS the crash the journal exists for (no simulation). `launchExtension` gained additive opts `{ userDataDir, waitForLiveness }` — the liveness gate must be skippable because a held/failing migration parks the boot BEFORE the heartbeat starts (migration is deliberately the first storage action). Each test: launch on a temp profile → stamp → seed + rewind → close → relaunch → deterministic waiters on `nulo:schema:*` keys.

## Gate
- DCE proof ✓ (both directions, above).
- `bun run typecheck` ✓ (registry ← `@/e2e` import mirrors runtime.ts's existing precedent).
- `bun run lint:actions` ✓ (both workflow edits).
- migration.test.ts: (appended below).
- Full smoke suite against the stamped build: (appended below).

## Gate results (final)
- **migration.test.ts: 4/4 in 27s** after two observation fixes: (a) `openPopup`'s readiness predicate waits for the GlobalLoader to clear, which never happens while the SW is parked pre-services → held/failed boots use a RAW popup page (plain goto); (b) the hold safety cap (15s) could self-release before the waiters observed `running` → raised to 30s (still under the 60s testTimeout). The engine behaved correctly in every run — all failures were test-observation mechanics.
- **Full smoke suite vs the stamped build: 73 passed | 6 skipped, 1 failed — `passkey-backup.test.ts` "full-backup export modal"; CONTROL-VERIFIED PRE-EXISTING**: the identical test fails the same way against a clean origin/dev build (worktree control). Dev's CI smoke is green ⇒ likely local-env-specific (Chrome/virtual-authenticator on this machine). Not caused by this branch; reported, not neutralized.
