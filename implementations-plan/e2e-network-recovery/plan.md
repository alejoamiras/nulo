# E2E Network Suite Recovery — Plan v1

Restore `bun run e2e:agent` to a state where the **Network e2e / Status** CI check meaningfully validates production paths, instead of pass-by-skip. Tier A protocol (large, cross-cutting, infrastructure + tests).

## 0. Context

### What's broken

Since at least the open-source initial import (`5ee8ec1`, 2026-05-19), `bun run e2e:agent` has been silently pass-by-skip on every PR and local run. The failure path:

1. `tests/e2e/global-setup.ts:402-411` calls `deployContractsAndProvide` → `createTestWallet` → `createSponsoredFeeOptions` → `deployTestToken`.
2. Inside `createSponsoredFeeOptions`, the SDK runs `WASMSimulator.executeUserCircuit` → calls `WASMSimulator.init()`.
3. `init()` does `await Promise.all([initAbi(), initACVM()])` where `initAbi`/`initACVM` are defaults from `@aztec/noir-noirc_abi` and `@aztec/noir-acvm_js`.
4. Vite's ESM resolver picks the `module: "./web/<name>.js"` entry over the `main: "./nodejs/<name>.js"` entry. The web bundle's default is `__wbg_init`, an async function that loads WASM via `fetch(new URL("...wasm", import.meta.url))` — a `file:` URL.
5. **Node's undici fetch hardcodes `case 'file:': return makeNetworkError("not implemented... yet...")`** (`undici@7.25.0/lib/web/fetch/index.js:956`). Init throws.
6. `deployContractsAndProvide`'s outer catch (line 426) provides `aztecTestConfig: undefined`. Every test in `tests/e2e/network/*.test.ts` gates on `describe.skipIf(!config)` → all 61 tests skip.
7. Vitest reports exit code 0 with `45 skipped / 61 skipped`. CI's `Network e2e / Status` check shows green ✓.

### Status of the patch

**Commit 1 of this branch** (`418ece9 fix(infra): patch @aztec/noir-*_js to drop browser module entry`) strips the `module` field from both packages via `bun patch`. With only `main` available, Vite falls back to the Node CJS bundle (no callable default export) → `typeof initAbi === "function"` evaluates false → `init()` no-ops as designed for Node. The CJS bundle pre-loads the WASM at module-top-level via `require("fs").readFileSync(__dirname + …)`, so `wasm` is populated and `executeUserCircuit` works.

After commit 1, baseline `e2e:agent` shows:

```
[e2e-setup] Test contracts deployed: { ... }
Test Files  41 failed | 4 skipped (45)
Tests       53 failed | 8 skipped (61)
```

Tests now run for real. **53 of 61 fail** — the previously-skipped tests are unmasked.

### What this plan covers

Triaging the 53 unmasked failures and restoring a green or explicitly-quarantined `e2e:agent`. The failures themselves are not part of the patch unlock — they're a backlog that has accumulated while the suite was silent.

## 1. Goals

- `bun run e2e:agent` exits 0 with **zero unexpected failures**. Quarantined tests must have an explicit `describe.skipIf(...)` or `test.skip(...)` with a one-line reason comment referencing the underlying issue.
- The `Network e2e / Status` CI check goes from pass-by-skip to **either green-with-real-runs OR explicit-quarantine-with-tracked-issues**. No more silent skip-everything.
- Net test count (passing + intentionally skipped + quarantined) must equal 61. **No tests deleted** unless duplicates of the same scenario.
- Smoke e2e (`bun run test:e2e`) continues to pass — no regression from this work.
- `bun run audit:vue` continues to pass — no regression in lint/typecheck/build.

## 2. Non-goals

- **Not adding new tests.** This is a recovery, not a feature.
- **Not refactoring the test infrastructure** (global-setup, fixtures, lockfile mechanism). If a fixture has a bug that's triggering multiple test failures, fix the fixture — but don't redesign it.
- **Not rewriting product code to make tests pass.** If a test was written for a now-removed API, prefer updating the test to match current behavior. If the test exposes a real product bug, document and either fix minimally OR quarantine the test with the bug tracked.
- **Not investigating "what flipped 24h ago" further.** The patch from commit 1 makes the behavior deterministic regardless of cache state. Root cause investigation of why the resolver flipped is a separate, lower-priority spike.
- **Not addressing the Cloudflare Pages landing-deploy flake** (orthogonal infra issue, surfaces on every PR).
- **No new dependencies, no version bumps.** This stays within the current lockfile.

## 3. Method — triage + fix + quarantine

After commit 1 (patches), every subsequent commit covers one bucket of fixes. Branch stays on `fix/e2e-network-suite-recovery`.

### Bucket A — Test wiring rot

Tests that reference a renamed selector, removed testid, changed API shape, or moved file. **Smallest, safest fixes.** Each commit addresses one or two related files.

Signals to look for: assertion mismatches (`expected "A" got "B"`), `waitForSelector` timeouts on a testid that no longer exists in production code, imports from a renamed module.

### Bucket B — Timing / flakiness

Tests whose flow now takes longer or shorter than the original timeout assumed. Bumping the `timeout:` per test, or replacing `await sleep(N)` with `waitForFunction` polling. Conservative timeout bumps only — never disable retries or skip flake-detection.

### Bucket C — Setup / fixture issues

Tests that depend on shared state (test profile, network, contract addresses) that's no longer being set up correctly. Most likely: the per-test `freshExtensionPerTest` fixture, or the shared `registerProfile` / `importProfile` path. Fix in `tests/e2e/fixtures/extension.ts` if the root cause is shared.

### Bucket D — Real product bugs

Tests that fail because the production code no longer does what the test asserts. **Two paths**:
- **Minimal fix** at the production code level if the bug is small and well-scoped (e.g., a string changed, an event payload renamed). Touch only the file with the bug.
- **Quarantine** with `describe.skipIf(!process.env.E2E_RUN_KNOWN_BROKEN)` or `test.skip` + a comment line referencing an issue to file. **Acceptable end state for the recovery PR**, especially if the fix would touch wallet-core / aztec-runtime layers that need a separate dedicated PR.

### Bucket E — Newly-broken-by-the-patch

Failures that are **caused by** commit 1's patch (rare). If the Node CJS bundle behaves differently than the web bundle in some edge case, we may see new failures specifically from that code path. **Highest-priority bucket** — must investigate before quarantining. If we can't fix, the patch itself may need adjustment (e.g., adding a runtime shim).

## 4. Phase plan

Each phase ends with a checkpoint commit. **No phase merges without `bun run audit:vue` green + smoke e2e still passing.**

**P0 — Failure capture + triage (this is happening NOW in parallel with planning)**
1. Full `e2e:agent` run with output captured to `/tmp/e2e-baseline-<pid>.log`. Started before this plan; results feed Phase 1.
2. Parse the log into a categorized list — per file: did each test in the file pass / fail / skip; what was the error message; what's the most likely bucket (A/B/C/D/E).
3. Output: `implementations-plan/e2e-network-recovery/triage.md` — table with one row per failing test.
4. **Soft budget**: 60 minutes of triage. If categorization is impossible without running individual tests, sample 5-10 tests by category.

**P1 — Bucket A (test wiring rot)**
- Read each failing test in the bucket, identify the broken selector / import / API.
- Update the test minimally (no behavior changes).
- After each file, run that file in isolation: `bun run --cwd packages/extension vitest run --config vitest.e2e.network.config.ts tests/e2e/network/<file>.test.ts`.
- Commit per logical group (e.g., "fix(e2e): update transfer test selectors to match current Send page").

**P2 — Bucket B (timing/flakiness)**
- Identify timeout patterns. Look for `waitForSelector(..., timeout: 5_000)` → bump to 10-15s if the operation is network-bound.
- Replace `await sleep(N)` with `await page.waitForFunction(() => …, { timeout: N })`.
- Commit per logical group.

**P3 — Bucket C (fixture issues)**
- Read `tests/e2e/fixtures/extension.ts`, identify shared fixtures that need updating.
- Update fixtures, then run a sample test from each affected file.
- Commit: "fix(e2e): update shared fixtures for current registration / import flow".

**P4 — Bucket D (real product bugs)**
- For each, decide: minimal fix OR quarantine.
- If quarantine: add `describe.skipIf(...)` with a comment and a tracking entry in `implementations-plan/e2e-network-recovery/quarantine.md`.
- If minimal fix: touch only the file with the bug, run the affected test, run smoke e2e to verify no regression.
- Commit per bug.

**P5 — Bucket E (patch-induced failures)**
- For any failure that is *new* compared to a hypothetical "no-patch but no-WASM-init-issue" world, treat as critical.
- Fix the patch (e.g., bun patch the Node CJS bundle to handle ESM context) or roll back if unfixable.

**P6 — Final validation**
- `bun run audit:vue` — must exit 0.
- `bun run e2e:agent` — must exit 0 (with quarantine list documented).
- `bun run test:e2e` (smoke) — must exit 0 (no regression).
- `bun run typecheck:all` — must exit 0.
- Final commit: "fix(e2e): close out network-suite recovery + document quarantine".

**P7 — Push branch, open draft PR (no merge per user)**
- Push.
- Open as draft PR titled `fix(e2e): restore network suite — patches + triage of 53 unmasked failures`.
- Body summarizes commits + lists quarantined tests with tracking notes.
- **Do not merge.**

## 5. Implementation constraints

- **No commit signing** for this branch (user-authorized). Use `git -c commit.gpgsign=false commit ...`.
- **Conservative on product code changes.** Default to fixing the test rather than the code. If a real product bug is found, scope the fix tightly.
- **Each commit is independently reviewable.** No omnibus "fix all the things" commit.
- **`audit:vue` after every group of commits.** Don't let lint debt accumulate.
- **3-failure stop rule**: if any single fix attempt fails 3 times, stop, log to `lessons/phase-N.md`, and move to the next bucket. Come back to the stuck one only if time permits at the end.
- **Lessons logging**: per protocol, every meaningful attempt goes in `implementations-plan/e2e-network-recovery/lessons/phase-N.md`.

## 6. Security & adversarial considerations

Per CLAUDE.md security mindset, even a test-recovery PR can introduce risk:

- **Patches against published packages**: `bun patch` modifies dependencies on disk. Bun re-applies on every install. Risk: a future `@aztec/*` version bump that removes the relevant code paths could silently bypass the patch (since the patch targets line offsets). Mitigation: patch text is minimal (one-line `-` removal of `module` field), so it should apply cleanly across `4.2.0` and `4.2.x` patch versions. Re-verify on the next `@aztec` bump.
- **Test fixtures with hardcoded test secrets**: not new; the test wallet uses well-known seed phrases. Make sure none leak into production code paths. Audit any fixture changes for accidental imports outside `tests/`.
- **Skipping tests that were exposing real bugs**: Bucket D quarantines must be reviewed individually. Each quarantine = a documented known-bad state. The risk is that a future regression on the same code path silently lands because the test is skipped. Mitigation: every quarantine entry must have a tracking marker (file + issue placeholder) so it's discoverable.
- **The patch itself is supply-chain visible**: it lives in `patches/`, committed to git. Reviewers can see exactly what we modified. ✓
- **No new dependencies**: zero supply-chain surface added.

Adversarial question: what could go wrong? A malicious actor could potentially craft a Node-side e2e exploit if the patched CJS path has different sandbox semantics than the original web ESM path. Unlikely (same WASM, same code paths), but if e2e tests load arbitrary user-controlled WASM (they don't, but check), the patch could matter. Verified: e2e tests use only `@aztec/*`-shipped circuits, not user input.

## 7. Open assumptions to verify in P0

- The 53 failures cluster into the 4-5 buckets above. **If the distribution is very different (e.g., 50/53 are real product bugs), the plan needs re-cutting.** The codex+opus parallel reviews should flag this.
- The patch from commit 1 doesn't cause new failures beyond unmasking existing ones. Verified by comparing pre-patch test list (45 skipped) to post-patch (53 failed + 4 skipped + 4 unaccounted) — the deltas should add up.
- Smoke e2e remains green after this work. **Re-run smoke after every 5-10 commits.**
- The "Network e2e / Status" CI check on the resulting PR will go red (since some tests really fail now). User is AFK; this is expected. PR body documents the situation.

## 8. Trade-offs

- **Quarantine vs fix**: quarantining is fast but leaves real coverage gaps. Fixing is thorough but consumes session time. Default lean: quarantine if the underlying issue would take >30min to fix; otherwise fix.
- **Per-file commits vs grouped commits**: per-file = max reviewability but lots of commits. Grouped = easier mental model but harder to bisect. Default: group commits by bucket + theme (e.g., "fix(e2e): bucket B timing fixes batch 1").
- **Patching product code vs test code**: lean test-side unless the bug is small and clear at the product layer.

## 9. Rollout

Single branch `fix/e2e-network-suite-recovery`, multiple commits, ends in a draft PR (per user: no merge during their AFK).

## 10. Audit history

| Version | Date | Status | Notes |
|---|---|---|---|
| v1 | 2026-05-21 | draft, pending codex + opus parallel review | This document |
| v2 | (pending) | (pending) | post-consolidation |

## 11. Index entry to add at end of session

```
- [e2e-network-recovery](e2e-network-recovery/plan-v2.md) — completed/quarantine-list — restored e2e:agent from pass-by-skip; N tests fixed, M quarantined
```
