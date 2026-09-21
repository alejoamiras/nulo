# vitest-5-bump — codex audit transcript

Reviewer: GPT-6 Astra via `/codex`, effort `high`, read-only against the worktree at plan v1. Session
`01a0c…` (this session's CODEX_DIR holds the raw prompt/response). Paths below are rewritten repo-relative.

## Round 1 — plan v1 → `conditional approve`

**Prompt (summary).** Read `plan.md`, `recon.md`, `vitest.base.ts`, the soak tool (`lib.ts` `checkMeta` /
`compareSummaries`, `cli.ts` `BASELINES_DIR` / launcher argv / `gitDirty`), the `vitest-on-bun` plan and its
`upstream-vitest-interop.md`, CLAUDE.md's runtime + age-gate paragraphs, the extension's `vitest.setup.ts`,
`vite.shared.ts`, `retry-error-reporter.ts`, `packages/resolve-asset/package.json`. Facts listed (publish dates,
gate dates, peers/engines, the grep-verified breaking-change table, `checkMeta`'s meta equality, the stored
baselines' shape, the launcher's explicit `--outputFile`, the owner's Phase 0 answers); inferences I1–I5 and
D1–D7 marked as unverified. Nine questions: the evidence design (both engines re-recorded, 15 suites, 10 runs);
unlisted vitest 5 / jsdom 30 behaviour shifts; the harvest decisions; whether Phase 1a bends the age gate;
the Node floor; D2; single PR vs stack; contradictions with recon / CLAUDE.md / the prior protocol.

**Response (verbatim, paths rewritten).**

> conditional approve
>
> **BLOCKING findings** — high confidence unless stated otherwise.
>
> 1. **The matrix arithmetic is wrong.** plan.md Phase 3 enumerates **16 suites**, requiring **32 compacts**, not 15/30. Fourteen workspaces plus extension components and tools smoke equals sixteen. Likewise, §1 lists **14 Vitest pins**, not twelve: twenty dependency edits including jsdom. Correct the gates, estimates, and recon. The stored twelve omitted extension-components too.
>
> 2. **The reduction becomes an unjustified permanent policy.** The plan turns this owner-approved reduction into a standing ten-run rule. But `resolve-asset` actually changes runtime, and D4 potentially changes isolation/pools. Preserve thirty for those changes unless explicitly covered by an exception; document ten as this bump's exception rather than extrapolating. Assuming independent runs, ten detects a 10% per-run flake with only **65% probability**, or a 5% flake with **40%**, versus 96%/79% at thirty.
>
> 3. **Phase 1a bypasses the age gate in substance.** It executes newly published code; discarding the lockfile cannot undo that exposure. CLAUDE.md § Dependency policy and SECURITY.md describe an advisory-driven exception, not general early evaluation. Remove Phase 1a or identify it as an explicit policy exception with narrowly named packages. "Whatever the gate names" is particularly inappropriate.
>
> 4. **D4's adoption criterion is insufficient.** The plan promotes an extension-only result into `sharedTest`. Verified doctor source (vitest v5.0.1 `packages/vitest/src/node/cli/doctor.ts`): measurements are warm, and filesystem-cache candidates receive a priming run. Require repeatable Bun measurements for the intended workload, separate cold/warm results, and check other affected suites before global adoption. Isolation changes additionally need order-variation checks. The Node-v5/Bun-v5 comparison cannot establish a **v4→v5 speedup**; remove that claim or collect a separate controlled comparison.
>
> 5. **Restore the complete evidence procedure.** Phase 3 omits the prior protocol's frozen install **at the final matrix commit**. Add it explicitly, preserve complete comparator output/digests — not merely wall-clock lines — and write lessons after sampling so they do not dirty subsequent recordings (`cli.ts:343`). Resume only complete, successful summaries matching all metadata, including runtime versions and run count. Restore explicit disposition for a failing Node reference. Move the review loop before PR creation: the plan contradicts the prior protocol's review-before-delivery ordering.
>
> 6. **The migration table misses a relevant DOM breaking change.** Verified vitest #10373: assignments through populated globals now propagate into the underlying jsdom window; restoration preserves original descriptors. Concrete exposure includes `apps/extension/src/popup/windows/capabilities/index.test.ts:165`, plus discover lifecycle and approval-window tests replacing event listeners. Add these to recon and the targeted probe list; do not classify every resulting failure automatically as a pre-existing test bug. Actual breakage remains **unknown**.
>
> **NON-BLOCKING findings**
>
> - **Node:** move the supported-Node prerequisite before Phase 1's Node fixture tests and Phase 2's doctor/e2e runs. A different supported reference version does not invalidate local Bun/Node parity, but does not prove another Node version. Recon overstates CI uniformity: smoke and unit workflows lack explicit Node setup; network inherits it through setup-aztec. Moreover, `node-version: 24` can select a cached matching version; it does not guarantee newest. Record actual versions.
> - **jsdom:** verified additional changes include computed-style serialization, mutation-observer ordering, retained DOM references after `window.close()`, and suppression of post-close activity. Include existing lifecycle/style tests and wallet-crypto KATs in targeted validation. The oversized-randomness change does not establish anything about native `crypto.subtle`.
> - **D2:** reasonable optional cleanup, not necessary for this bump. Preserve historical evidence with a precise pointer. The claimed existing `cli.test.ts` assertion pinning `BASELINES_DIR` does not exist.
> - **Harvest:** `vi.when` should preserve fallback, argument-matching, and sequential behavior; prefer a recommendation over a blanket idiom. `clearMocks` clears history, not implementations or globals. Verified v5 types put the filesystem cache at `node_modules/.vitest-cache`, contradicting recon's `.vitest/` claim. `configDefaults.reporters` is a worthwhile optional simplification for `e2eReporters()`.
>
> **What looks fine**
>
> - `checkMeta` is correctly read. Stored compacts also lack the inventory required by `compare`; retain them as historical context only.
> - D1, keeping `clearMocks`, documenting per-test `--repeats`, and deferring root projects are sensible.
> - I2 and the used reporter/global-setup contracts are verified in tagged v5 source. Doctor uses `process.execPath`; successful Bun execution remains unverified.
> - One PR is sensible; the matrix rule does not inherently prohibit a stack.
> - Read-only review completed; no files modified or suites executed.

**Disposition.** All six blocking and all non-blocking findings folded into plan v2 — see the ledger in
`plan.md` (B1–B6, N1–N4). Verified by the driver before folding: the #10373 exposure at
`useDappApprovalWindow.test.ts:63-64,81-82` and `capabilities/index.test.ts:165-166`; the suite count (16);
the pin count (14); the absence of a `cli.test.ts` pin on `BASELINES_DIR`; `_unit-tests.yml` and the smoke
workflow carrying no `setup-node`. Not independently verified by the driver (accepted on codex's reading of
the tagged v5 source, re-verified at Phase 1 install): the `node_modules/.vitest-cache` location, doctor's
warm-measurement / priming-run behaviour, `experimental.viteModuleRunner`'s survival in 5.0.1.

## Round 2 — plan v2 (resumed session) → `conditional approve`, three corrections

**Prompt (summary).** The B1–B6 / N1–N4 fold listed item by item; two decisions left unchanged and put up
for objection (D1 delete the empty seam; D2 move as the default under A2).

**Response (verbatim, paths rewritten).**

> conditional approve
>
> Three corrections remain (high confidence):
>
> - **B5 is incorrectly folded.** plan.md Phase 3 automatically calls a red Node reference a flaky test. It could be a deterministic dependency regression, environment failure, or product defect. Require reproduction and classification first; fix demonstrated test bugs and rerun the matrix, but preserve owner disposition for unresolved Node failures. Never automatically adapt assertions merely to obtain green.
> - **Phase 1a's rollback is incomplete.** It restores manifests and lockfile after removing the stopgap, leaving Vitest 4 without its required workaround — and installed dependencies potentially inconsistent with the restored lockfile. Restore the stopgap too, then reinstall from the restored lockfile before claiming the fixes work on v4. Keep those probe-only changes out of test-fix commits.
> - **D1 is sound, but its bookkeeping remains contradictory.** Current grep finds **15 spreads**, not seventeen. Remove their imports and the `biome.json` `includes` entry too. Update plan/recon counts, and fix the Done criterion, which still requires `resolve-asset` to spread the deleted `sharedTest`.
>
> The substantive B1–B4/B6 and N1–N4 corrections are otherwise folded satisfactorily. The gated early probe, per-suite run counts, measure-only D4, and review-before-PR ordering address the original concerns.
>
> I agree with deleting the empty shared config. D2 can remain the optional default under A2; neither decision needs reversal.

**Disposition.** All three folded into plan v3 (ledger rows R2-1..R2-3). The driver re-counted the spreads
(15: every unit/component config; `biome.json` `includes` names `vitest.base.ts` at line 10) before folding.
The conditions were procedural and bookkeeping corrections, each verified locally; no third round was run.
