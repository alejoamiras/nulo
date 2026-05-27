# Codex review of plan v1 — 2026-05-21 23:59

## Part 1 — Critique

1. **5-bucket model is symptom-shaped, ignores repo-local prior art.** `packages/extension/tests/e2e/README.md:107-109` already points at `implementations-plan/network-test-triage/plan-reconciled.md:82-124`, which collapsed earlier failures into shared roots (R1/R2) instead of per-test buckets. For a long-silent suite, "A wiring / B timing / C fixture / D real bug / E patch-induced" will duplicate work because one root can surface as all four.

2. **P0 missing the fastest discriminator**: group by fixture family + first failing frame, not just per-test rows. Start from `packages/extension/tests/e2e/fixtures/extension.ts:242-603` (`tokenReadyExtension`, `feeJuiceImportedExtension`, `localNetworkExtension`, `dappConnectedExtension`) and cluster by stack regex (`importToken`, `switchToLocalNetwork`, `closeStuckPopup`, `waitForPgResult`). One representative test per cluster is faster than file-by-file from the top.

3. **Quarantine-after-30min is too aggressive.** On a suite that was silently skipped, many failures will be cascade victims. Quarantining before root-cause collapse risks turning one real wallet bug into 10 "known-broken" skips. Only quarantine after proving the failure is independent and not shared setup/helper debt.

4. **Adversarially**, the current approach can mask real product bugs by "making tests match current behavior." The exact regression that hid this suite is `packages/extension/tests/e2e/global-setup.ts:426-428` swallowing deploy failure and feeding `undefined` into `test.skipIf(!hasConfig)`. That should be a **recovery scope item**, not left as convention.

5. **The non-goal at plan.md:49 is too rigid.** "No rewriting product code to make tests pass" won't survive contact with this suite if the real issue is wallet-side state hydration or popup lifecycle. Reword to: "no product-only test hacks; targeted correctness fixes are in scope."

6. **Factual issue**: `plan.md:155` says `53 failed + 4 skipped + 4 unaccounted`; the plan itself says `53 failed | 8 skipped` at 25-29. Fix arithmetic.

## Part 2 — Concrete changes

1. Add a **P0a historical bootstrap**: mine `implementations-plan/network-test-triage/plan-reconciled.md:82-124` and `phase0-findings.md:60-126` BEFORE new triage. Even if stale, they give ready-made probes and hot paths.

2. Move Bucket E into P0. Patch-induced failures are a gate, not a late phase. If commit `418ece9` changed semantics, every other bucket is contaminated.

3. Make the suite fail loud when setup dies. Add env-gated throw at `tests/e2e/global-setup.ts:426-428`, driven by `scripts/e2e/agent.sh:43-52`. `describe.skipIf(!config)` should not be the only guard on the CI path.

4. Timing fixes must respect helper conventions in `tests/e2e/README.md:86-95`. Don't sprinkle raw `page.waitForFunction()` in test files; route waits through existing patched helpers or helper-level fixes.

5. Don't run `bun run audit:vue` after every small group. Use isolated test/file runs during triage; smoke + `audit:vue` at checkpoints only. Full audit on every loop will burn most of the session.
