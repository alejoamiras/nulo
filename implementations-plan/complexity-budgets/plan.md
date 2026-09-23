# Complexity budgets — cognitive + function-length gates with a shrink-only baseline

**Status: gate + baseline shipped (#490); trend instrument shipped (#491); burn-down in progress.** Lead 1 (profile service) done — `implementations-plan/profile-service-dedup/` collapsed its 13 clone families and removed all 11 of its directives (manifest 230 → 219, zero residue in that file).

Two independent proposals (Claude Fable with six research subagents + a 22,525-function repo measurement; Codex GPT-5.6 with repo access and its own Biome dry-runs) were reconciled over two critique rounds. Shareable long-form writeup with the worked examples, distribution charts, reconciliation log, and ~30 cited sources: <https://claude.ai/code/artifact/b667636f-1dc6-4f26-89a8-41cff0661d4e>.

## The decision

Biome-only, three rules at **error**, riding the existing pipeline (editor LSP → pre-commit `--staged` → `bun run lint` → `quality-status`). No new linter, no new CI job, no new dependency.

| Rule | Ceiling | Scope |
|---|---|---|
| `noExcessiveCognitiveComplexity` | 15 | everything — src, tests, e2e, scripts, `.vue` script blocks |
| `noExcessiveLinesPerFunction` | 80 non-blank (`skipBlankLines: true`) | production only; tests/e2e overridden off |
| `noExcessiveNestedTestSuites` | 5 | test suites (0 findings at adoption) |

Key rationale (full argument in the artifact):

- **Cognitive over cyclomatic**: Sonar's default-profile metric for understandability (cyclomatic is opt-in there); measured on this repo, cognitive>15 and cyclomatic>10 overlap 82/83 — a second cyclomatic gate (which would require oxlint or ESLint) adds ~one detection.
- **The length cap targets the documented LLM failure mode** — the strongest evidence indicts verbosity/duplication more than branching. `skipBlankLines: true` is anti-gaming: blanks are free, so the only way under the cap is less code.
- **Rejected**: max-depth (repo max nesting 5, all instances already cognitive-flagged; Biome has no such rule), max-params (API-shape churn), Maintainability Index (unexplained 1994 coefficients, no maintained JS tooling, vendor-admitted corpus tuning), SonarQube/dashboards (slower than the edit loop).
- **Error severity everywhere, no advisory tier** — agent loops react to failures; a warning shapes nothing.

## The baseline mechanism (brownfield ratchet)

- `bun run baseline:complexity` (= `scripts/complexity-baseline/generate.ts`) lints, inserts a function-scoped directive above each offender, verifies the tree lints clean, and rewrites `scripts/complexity-baseline/manifest.json` from an actual source scan (`scripts/complexity-baseline/scan.ts`). Idempotent.
- Directive shape: `// biome-ignore lint/complexity/<rule>: baseline (score N) — refactor when touched, never raise`.
- Enforcement is layered: `scripts/complexity-baseline/check.ts` (sub-second git-grep scan) is chained into `bun run lint` (working-tree mode) and the pre-commit hook (`--staged` mode — scans the index via `git grep --cached`, i.e. exactly what the commit captures, so split-staging a suppression past the hook is impossible; codex round 4 caught the working-tree-only gap) so violations red the local agent loop; `scripts/ci-cd/complexity-baseline.test.ts` mirrors it in `test:ci-gating` (already wired into `_unit-tests.yml`, zero CI changes). Both enforce: exact per-rule × per-file count match (grow = forbidden, shrink = regenerate the manifest in the same PR), Biome-version pin match (a Biome bump forces deliberate regeneration — scores drift between releases; the same function scored 89 under eslint-plugin-sonarjs 4.2 and 135 under Biome 2.5.1), and **zero broad suppression forms**: bare `lint:`, group `lint/complexity:`, and `-all`/`-start` (file-wide/range) variants covering budget rules were each verified to suppress on Biome 2.5.9 while evading a naive exact-string scan — codex review round 3 caught this; the scanner classifies every form via one whitespace-tolerant matcher, unit-tested against each evasion.
- The generator refuses to grow the baseline without an explicit `--adopt` flag (legitimate only at policy adoption or after a Biome bump re-flags previously-clean functions), closing the "launder new debt through regeneration" path; growth is always a reviewable manifest diff. Directives made stale by a bump surface as Biome `suppressions/unused` warnings.
- Function granularity is the point: a directive covers ONE declaration; new functions in the dirtiest file still meet 15/80. The rejected alternatives (per-dir threshold overrides, changed-file "fix the whole file" ratchets) either leak new code or force risky refactors of wallet execution paths inside unrelated PRs.
- Accepted residual risk: a baselined function can worsen under its directive without moving a count. Escalation path (a re-scoring audit against per-symbol pinned allowances) is documented, deliberately not built until evasion is observed.

## Baseline at adoption (Biome 2.5.9)

230 directives across 118 files: **172 cognitive + 58 length**. (Earlier research numbers — 154/≈101 — were measured under Biome 2.5.1 on an older dev HEAD; the generator's output under the pinned version is the operative truth.)

## Burn-down leads (separate PRs, not this arc)

Priority candidates where complexity and duplication debt coincide (duplication measured once with jscpd 5.0.16, min-tokens 50 — repo total 5.05% duplicated lines, more than half of it test↔test):

1. `apps/extension/src/wallet/services/profile/service.ts` — 13 internal near-clone blocks (215 dup lines) AND multiple cognitive offenders.
2. `apps/faucet/src/composables/useDeposit.ts` (cognitive 135 at measurement) + `useBridgeJournal.ts` — worst single functions in the repo.
3. `apps/extension/src/composables/useFullBackupImport.ts` (cognitive 114, 650+ line function).
4. `packages/bridge-core/scripts/` — deploy/smoke testnet↔mainnet twins (parameterize) + 13 cognitive offenders.
5. Shallow tail (~51 functions in the cognitive 16–20 band) — mechanical extractions, good batch PRs.

## Deferred (documented, not built)

- **jscpd duplication gate** — NOT gated, but the trend instrument is wired (arc 1.1): `bun run audit:dup` (`scripts/dup-trend/report.ts`, jscpd exact-pinned, formatter unit-tested in `scripts/ci-cd/dup-trend-report.test.ts`) + nightly's advisory `dup-trend` job piping the markdown into the step summary (deliberately absent from `publish-nightly`'s needs). Rationale: clone identity is too unstable to ratchet, test↔test is over half the volume, and prod findings skew to Vue template/CSS shells. A diff-scoped new-clone check is the escalation if the trend worsens post-burn-down.
- Per-symbol re-scoring audit of baselined functions (build only if suppression-gaming is observed).
- oxlint cyclomatic gate (only if a flat-branch pathology evades cognitive scoring).
