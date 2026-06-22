# Phase 5 — Arc close

## Gates
- `bun run lint` ✓ · `bun run typecheck:all` ✓ · `bun run test` (2363) ✓ · actionlint ✓.
- Self-review of the arc diff: no leftover diagnostic code (spike/dump-hook/temp-NOOP/stack-logging all reverted), `ProofGate` correctly extension-local, offscreen free of the gate.
- Docs: CI.md + e2e README document the proverless model + barrier + canary set + prod safety.

## Codex post-impl audit (session in audit trail) — NO BLOCKER
The prod-guard holds: one-flag builds fail closed, two-flag release artifacts are stopped by the `_build-extension.yml` grep. D13 + the `_network-e2e.yml` boolean expressions confirmed clean; no test runs nowhere/both; the canary upgrade is sound. Four findings, all addressed:

- **High — DCE invariant weaker than documented.** The gate is a top-level static import; prod-cleanliness relies on tree-shaking, not literal non-import. Codex suggested a dynamic `import()`.
  - **Tried it → REJECTED (empirical).** A dynamic `import()` makes rollup emit a code-split CHUNK that SHIPS in `dist/chrome` even when the call is in a statically-dead branch — the prod build then LEAKED `nulo:e2e:proof-gate` + `ChromeStorageProofGate`. **The `_build-extension.yml` negative grep caught it** — exactly its purpose (DCE is a belief; the grep is the enforcement).
  - **Resolution:** keep the static import (tree-shaking removes the dead-branch unused import — verified: prod dist has neither the class nor the key). Documented accurately in `runtime.ts` + the gate docstring, including the rejected dynamic-import attempt so no one re-introduces it. This is a case where codex's "smallest fix" was wrong and the layered guard (grep) was the safety net.
- **Medium — env scrubbing.** Non-proverless `agent.sh` builds didn't scrub inherited `VITE_NULO_E2E_PROVERLESS*`; a leaked runner env could silently build the prover-ON canary proverless. → `unset VITE_NULO_E2E_PROVERLESS VITE_NULO_E2E_PROVERLESS_CONFIRM` on the non-proverless build.
- **Medium — concurrent-sendtx-approve timing.** Released T1 before rejecting T2, so proverless T1 could settle `ok` first and the helper catch it instead of T2's error. → reject T2 + assert error WHILE T1 is held, then release.
- **Low — stale comments.** `fixtures/proof-gate.ts`, `chrome-storage-proof-gate.ts`, `cancel-mid-prove.test.ts` still said offscreen/`PxeService` → updated to the SW `ExecutionCoordinator`.

## Re-validation after fixes
- lint + typecheck + 2363 unit tests ✓ (post-revert).
- Prod-guard two-build grep ✓ (gate absent in prod, present proverless) — re-confirmed after the static-import revert.
- `concurrent-sendtx-approve` proverless re-run after the timing fix: see below.

## CI verdict (PR #86)
- **Quality / Status (REQUIRED on dev): SUCCESS** ✓ — Build chrome (incl. the `_build-extension.yml` negative grep → no proverless leak in the shipped artifact), Commitlint, Lint+Typecheck, Unit tests.
- **Network e2e: SUCCESS** ✓ — the whole proverless split end-to-end: all 5 proverless shards + `heavy/fee-methods` (PLAIN) + `heavy/concurrent-confirm` (STUB barrier) + **`canary/real-proving`** (prover-ON: transfers + tx-sendTx-default with REAL BB proving + accelerator). The canary's real-prove timing — the one thing un-runnable locally — passes in CI.
- **Smoke e2e: FAILURE (advisory, pre-existing flake, NOT this arc).** `accounts.test.ts > "switch between accounts"`: `consoleErrors.toEqual([])` caught a benign `Error: Client disconnected` (SW port-close cascade) under CI runner load. My diff touches none of the account-switch / port-disconnect path; dev's own smoke runs flake; the brittle `consoleErrors.toEqual([])` (5 instances) is pre-existing. Advisory on dev (not the required check). Not fixed — out of arc scope; candidate for the same smoke fixture-cleanup follow-up CLAUDE.md already tracks.

LESSONS_FILE=implementations-plan/e2e-proverless-stub/lessons/phase-5.md
