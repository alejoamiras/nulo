# Audit — Opus 4.7 — `e2e-network-recovery` plan v1

Tier A protocol, parallel second-reviewer pass alongside codex (xhigh).
Reviewed against `plan.md` (commit `418ece9` baseline) on 2026-05-22.

---

## Part 1 — Critique of plan v1

### Bucket coverage — incomplete

**The 5-bucket triage is missing two real buckets.** The plan acknowledges A/B/C/D/E but the prior pass at `implementations-plan/network-test-triage/plan-reconciled.md:30-44` (~3 months ago) had to invent revisions *exactly because* the bucket lattice was wrong. Specifically:

- **Bucket F — Sandbox-side flake** (LMDB / PXE init / cold-PXE stall). The prior reconciliation explicitly carved this out (`plan-reconciled.md:34` "LMDB stays (d) sandbox-side"). Counting `tests/e2e/network/sim-methods.test.ts (3 failed) 92463ms` + `session-reconnect (2 failed) 61229ms (retry x1)` in `/tmp/e2e-baseline-9806.log` — the **30-second on-the-nose timeouts** are the smoking gun for `aztec/PXE` lifecycle stalls, not test-side timing rot. Misclassifying these as Bucket B will burn a session on `waitForFunction` micro-tweaks that don't help.

- **Bucket G — Cross-test ordering / shared-fixture cascade** (`tokenReadyExtension` exhausts state for later files; nullifier ordering in `transfers.test.ts:23-26`). The prior reconciliation's Revision 2 explicitly merged "cascade victims" with the root cluster (`plan-reconciled.md:36`). Without an explicit bucket, the plan will try to fix 5 cascade victims one-by-one instead of finding the one root.

### Quarantine threshold — wrong shape

The **30-minute "fix vs quarantine" gate** treats every failure as independently estimable. Bad model. The prior triage doc shows the **dominant cost is mechanism-discovery** (`plan-reconciled.md:54-66` — five separate revisions of cluster C's mechanism). Once you've spent 60 min on Bucket A's first failure, similar failures cost 5 min each. A flat per-test threshold either over-quarantines (giving up at minute 31 when 5 more min would unlock 14 cascading tests) or under-quarantines (sinking 30 min into something that wants 4 hrs of `wallet-core` work).

**Recommendation:** Replace with "**root-cause budget**" — 90 min per *mechanism* to root-cause; once mechanism is understood, fix all victims of that mechanism in one go OR quarantine the whole cluster together.

### "No product code changes" — too conservative

The product code at `extension-messaging/background/client.ts:77-83` was identified as a real bug by both prior audits (`plan-reconciled.md:51-66`). Re-quarantining tests that exist *exactly to catch this bug* recreates the silent-skip problem the recovery is fighting. The plan should explicitly carve out **"one-line product fixes when the same fix unlocks ≥3 quarantined tests"** as in-scope.

### "No infra refactoring" — misses the prevention point

The root cause of this whole recovery (`plan.md:7-17`) is **silent skip** (`describe.skipIf(!config)` evaluating false because `project.provide("aztecTestConfig", undefined)` swallowed an error at `global-setup.ts:426-428`). Plan v1 fixes the symptom (the patch) but leaves the silent-skip mechanism in place. **Recommendation:** add a Phase 0.5 that converts `global-setup.ts:426-428` from `provide(undefined)` to `throw` (or sets a global `setupFailed` flag and makes a single sentinel test fail with the captured error). 5-minute change; prevents a re-occurrence forever. The current `Network e2e / Status` check uses `if-no-files-found: error` mode (`.github/workflows/_e2e.yml`) only for artifacts — the *vitest exit code* path is what's silent.

### Adversarial — new silent-failure surfaces

- **`describe.skipIf(!hasConfig)` is replicated in 43 files** (grep verified). A quarantine helper that reuses the same pattern with a new env var (`E2E_RUN_KNOWN_BROKEN`) creates a second silent-skip channel. Anyone who runs `E2E_RUN_KNOWN_BROKEN=1 e2e:agent` in CI by accident gets a green pass-by-failure-then-skip. Quarantines should `test.skip("reason — see issue #N")` (visible failure marker), not env-gated `skipIf`.
- **`retry x1`** is visible in `/tmp/e2e-baseline-9806.log` (`session-reconnect (retry x1)`, `tx-sendTx-multicall (retry x1)`). If a test retried-and-passed, it'd disappear from the failure list — but the plan's "61 net count" check won't catch *retry-flake hiding a real bug*. Track retried-passes as a third state.
- **Aztec 4.2.0 sandbox identity** (`global-setup.ts:469-499`) — if quarantine fixes hide a contract-address mismatch, future bumps replay the same identity-mismatch silently. The patch in `418ece9` works at `4.2.0`; the next nightly may shift the bundle and re-mask. Add a CI gate that asserts the patch still applies cleanly (`bun install --frozen-lockfile && test ! -z "$(ls node_modules/@aztec/noir-acvm_js)"`).

---

## Part 2 — Plan v2 deltas

1. **Add Bucket F (sandbox flake)** and **Bucket G (cascade victim)** to §3. Triage script (see §3) must distinguish 30s-on-the-nose timeouts (F) from cascade-from-shared-fixture (G) before any A/B/C/D/E assignment.

2. **Insert Phase 0.5 — fail-loud setup** between P0 (capture) and P1 (Bucket A). Convert `global-setup.ts:426-428` to either re-throw or write `setupError` into `aztecTestConfig` and have a single sentinel test `expect(config.setupError).toBeUndefined()`. Land as commit 2 before any test fixes.

3. **Replace per-test 30-min quarantine threshold** in §8 with **per-mechanism 90-min root-cause budget**. After root cause is identified, batch-fix or batch-quarantine the cluster together.

4. **Add allowed-product-code-changes carve-out** to §2: "one-line product fixes when the same fix unlocks ≥3 quarantined tests" in-scope. Cite `extension-messaging/background/client.ts:77-83` as the documented precedent.

5. **Write a triage helper** `scripts/e2e/classify-failures.ts` — reads vitest's JSON reporter output, groups by error-message-prefix, surfaces "30-second on-the-nose" timeouts as bucket F, and marks files where ≥80% of tests share an identical error as cascade-from-fixture (G). Saves to `implementations-plan/e2e-network-recovery/triage.md` automatically. 1-2 hr investment, pays back the rest of the session.

6. **Ban `skipIf(env)` for quarantines** in §3 Bucket D. Use `test.skip("known broken — issue #N")` so vitest reports the skip and the count stays honest.

7. **Track retried-passes as a distinct outcome.** Vitest's JSON reporter exposes `retryCount`. The triage script should flag any test that needed retries.

8. **Add the `lessons/phase-N.md` index discipline** explicitly. Plan v1 mentions lessons but the prior `network-test-triage/` plan went 7 docs deep — add `implementations-plan/index.md` upkeep to §4.

---

## Part 3 — Concrete questions for plan v2 verification

1. **How many of the 53 failures share an error-message prefix?** Run the triage helper before bucketing. If >30 share a single prefix, the plan needs a "root-cause first" phase, not the parallel-bucket flow in v1.

2. **Does the patch from commit 1 (`418ece9`) survive `bun install --frozen-lockfile` cleanly?** The plan claims it does; the lockfile diff is in `bun.lock` but the auto-apply behavior under frozen-lockfile mode is not in v1's verification list. Verify before any other work.

3. **Are the `retry: 1` settings in `vitest.e2e.network.config.ts` or per-file?** Network log shows `(retry x1)` on `session-reconnect` and `tx-sendTx-multicall` only — confirm whether this is config-level or file-level so the triage script can attribute correctly.

4. **What does `global-setup.ts:426-428`'s catch block actually swallow on commit `5ee8ec1`** (the moment skip-everything started)? If it caught something other than the WASM init error, there's a second silent-failure surface that the patch alone won't fix.

5. **Has anyone hit the `existingLock.deployedConfig` reuse path at `global-setup.ts:391-397` during the 53-failure baseline run?** If yes, the failures may be against a *stale* lock — which is also a silent corruption that the v1 plan doesn't address. Verify by deleting `.e2e-state/` before re-running baseline.

---

**Verdict:** APPROVE-WITH-DELTAS
