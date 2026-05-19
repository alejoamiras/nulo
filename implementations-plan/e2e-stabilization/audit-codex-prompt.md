# Codex audit prompt — e2e stabilization plan

(This is the prompt template that will be sent to codex via the `codex` skill once the consolidated plan is finalized. Final consolidated plan path will be inserted below.)

---

I'm planning a stabilization + speed pass on the e2e test pipeline of a Chrome-extension Aztec wallet (`@nulo/extension`). 26 tests are currently quarantined (18 network + 8 smoke). I've consolidated two independent plans into one. **I want you to independently re-derive the analysis and challenge mine** — be critical.

## The repo

`(project root)` — Bun-workspaces monorepo. Relevant package: `packages/extension/`.

## Plan to audit

Read `implementations-plan/e2e-stabilization/plan-consolidated.md` end-to-end first. It cites exact file paths and line numbers — verify them.

Background prior art (read in order):
- `packages/extension/tests/e2e/README.md` — fixture model, helper conventions, parallel-isolation.
- `implementations-plan/network-test-triage/plan-reconciled.md` + `phase0-findings.md` + `full-suite-findings.md` — the **earlier** triage that produced PR #70 (`447ca55`), which fixed 19 of these tests once. **Verify those fixes are still in the source.**
- PR #77 (`64477cd`) commit body — the CI bringup that re-quarantined the tests.
- `wallets-architecture-research/nulo/self-analysis.md:427` — pre-existing race documentation.

## What I want you to do

1. **Re-do the cluster split independently** (Smoke S1/S2/S3/S4, Network A/B/C/D/E). For each cluster, form your opinion *before* reading mine — read the cited test files + wallet code, then compare. Don't trust my summaries.

2. **Specifically challenge Phase 0.** Is the "un-skip + run 5×/3×" baseline tactic correct? Are there ways the data could mislead us (e.g., a test passes locally because of a warm /tmp cache that won't exist on CI)? Suggest probes that catch CI-specific failures *during* a local run.

3. **Find better mechanisms for S1 (navigateByHash race).** I propose three hypotheses (no onMounted wait, CSS module hot-swap leftover, async router-view re-render). Read `helpers.ts navigateByHash`, the Vue Router config, and the smoke test's specific navigation paths. **What's the actual race?** Cite the file:line where the race lives.

4. **Find better mechanisms for S2 (waitForToast race in delete contact).** PR #59 fixed the addContact toast race; the delete-contact path uses the same helper. Read `deleteContact` in `helpers.ts`. Is the helper actually doing the same state-driven wait that PR #59 added for addContact?

5. **Challenge S3 deletion-vs-fix call.** I claim the 4 SW-respawn tests are NOT redundant with `security.test.ts` + `registration.test.ts`. Read those two files and confirm or refute. If you find genuine redundancy in any of the 4, recommend deletion.

6. **Challenge S4's runner upgrade recommendation.** Is `runs-on: ubuntu-latest-4-core` actually available in GitHub Actions free tier or requires GH Enterprise? If not free, what's the alternative?

7. **Challenge the Network Phase 2 decision tree** — cumulative-load rotating-flake mitigation (wait for upstream KV migration / per-file restart / grouped batches / scoped retry). My recommendation is "grouped batches + scoped retry"; argue against it if you can.

8. **Phase 3 speed audit estimates.** I claim ~30-45s savings on smoke from `openPopup` triple-nav + `navigateToSettings` 200ms sleep. Verify by reading the actual helpers and counting their invocations per smoke test. Refute if my numbers are off.

9. **Find tests I miscounted or mis-categorized.** Skipped test count should be 18 network + 8 smoke. Verify with `grep -rn "test\.skip\b" packages/extension/tests/e2e/` (excluding `test.skipIf`).

10. **Find anything I glossed over.** Specifically: the helper layer at `fixtures/extension.ts` is ~860 lines and `helpers.ts` is ~941 lines. There may be defensive padding I missed. Spot-check at least 3 helpers I cite for "justified" timeout and tell me if any are over-budget.

## Format

Respond in **under 1000 words**. Structure:

1. **Verdict** (one line): plan correct / partially correct / fundamentally wrong.
2. **Per-cluster review** (S1-S4, A, B, C, D, E): one sentence agree/disagree + specific evidence (file:line) when disagreeing.
3. **Phase 0 critique.**
4. **Phase 3 numbers verification.**
5. **Things I missed.**
6. **What looks fine** (only after genuinely trying to break it).

I want a critical audit, not validation. Push back hard. If the plan is wrong, say so — I'd rather scrap it now than after I've gone down the wrong rabbit hole.

## Context that may help

- Test taxonomy: smoke + network + slow. Slow is correctly gated; not part of this work.
- Recent merges (commit ahead of this work): `de7bec0 feat(ci): bring up CI/CD pipeline from zero (#77)`.
- The 18 network skipped tests **were proven fixable in isolation by PR #70** (full-suite 64/66 + 2 known flakes with `retry: 1`). The CI bringup re-quarantined them for cumulative-load rotating-flake reasons.
- The 8 smoke skipped tests fall into 4 distinct mechanisms; 3 of them (S1/S2/S3) are documented as **pre-existing races** at `self-analysis.md:427`.
- The wallet uses `@aztec/accounts/schnorr` upstream; no custom Noir source.

## Definition of done

Audit lands in `implementations-plan/e2e-stabilization/audit-codex.md` with the critical review. If the plan is approved by codex (or revised post-audit), I'll proceed to Phase 0 implementation.
