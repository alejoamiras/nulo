# Gate convergence log — vitest-on-bun (Arc C)

Owner's standing protocol: plan-time gates resolve by iterating with codex to convergence; an arc proceeds only on an explicit fresh-context codex `approve`. Every round is logged here with the disposition of every finding.

## Round 1 — codex (session `01a035c3-c86a-7590-bc9d-9bb0ebfb8aca`, xhigh) — **conditional approve**

Transcript: [audit-codex.md](../audit-codex.md). Disposition, finding by finding:

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| S1 | Soak harness + committed JSON are self-attesting; record normalized command, git SHA, Bun/Node/vitest versions, pool/workers, exit status, inventory digest; reject metadata mismatches | n/a (design) | **ADOPTED** — summary `meta` (argv, repo-relative cwd, git SHA + dirty flag, runtime record, vitest version, pool + `maxWorkers`, per-run exit status) + `inventoryDigest`; `--compare` refuses SHA/vitest drift unless `--allow-meta-drift` (documented, never in a gate) |
| S2 | Bun may select Bun-specific conditional exports; capture critical `import.meta.resolve` results | ✓ — fable found the four packages that declare a `"bun"` condition (`isows`, `msgpackr`, `@logtape/logtape`, `axios`) | **ADOPTED** — the runtime reporter records `import.meta.resolve` for `zod`, `@aztec/foundation`, `@aztec/stdlib`, `@aztec/bb.js`, `@aztec/aztec.js`, `vue`, `jsdom` AND the four condition-switchers; `--compare` lists differences; the four are expected differences, any OTHER difference is investigated before a gate is green |
| S3 | Arg-array spawning, `--no-install`, explicit `--retry=0`, per-run timeout, signal forwarding, secure temp files, cleanup, hang detection | n/a | **ADOPTED** — argv `spawnSync`, `bun --no-install run …`, `--retry=0`, per-run `timeout` (default 20 min) → `timedOut` is a failed run, `mkdtemp` + removal per run, SIGINT/SIGTERM forwarded |
| S4 | Permissions/required-check producers sound | ✓ | noted |
| F7 | Unit CI does not pin Node; baselines must record the actual Node version | ✓ | **ADOPTED** |
| F-wording | "eleven scripts … plus"; "byte-identical" → "test-set-identical" | ✓ | **ADOPTED** |
| I6 | Pool sizing differences cause real failures; record sizing; repeat the concurrent `test:all` fan-out | ✓ | **ADOPTED** — `bun run test:all` ×5 under Bun in the gate; sizing in `meta` |
| I1/I2 | Hypotheses; a red Node baseline STOPS the arc | ✓ | **ADOPTED** — Phase 0 requires `failedRuns: 0`; non-zero → STOP, owner disposition |
| I3 | Leave all `test:watch` on Node | see fable (e) — CONFLICT resolved below | **ADOPTED WITH AMENDMENT** — `test:watch` flips ONLY if all three watch smokes pass (fable's consistency argument); otherwise stays on Node (codex's default) |
| I5 | Timing claim unsupported | ✓ | **ADOPTED** — deleted |
| A-nonzero | Surface a non-zero Node baseline to the owner | ✓ | **ADOPTED** |
| A4 | Replace "file the issue"; the fix exists upstream | **✓ verified on GitHub**: #10359 closed by #10363 (merged 2026-05-18), in v5.0.0-beta.3 | **ADOPTED** — stopgap + retirement trigger; A4 = owner choice backport-request vs wait |
| Impl-a | Root plain-object base + `interopDefault: false` with a retirement reference | ✓ | **ADOPTED** |
| Impl-b | Per-script `bun --bun`; outline B rejected | ✓ | **ADOPTED** |
| Impl-c | Middle ground: foundation → one flip → full matrix gate → docs; one PR; two-PR stack wrong (foundation not inert) | ✓ | **ADOPTED** (+ fable (c): one commit per package flip inside the single flip phase so `git revert` is per package) |
| Impl-soak | IDs `relative-file :: fullName`; complete inventories; `--compare` exits non-zero; biome includes | ✓ (`biome.json` excludes `scripts/**`) | **ADOPTED** |
| Impl-shard | Widen the shard; N=10 is a budget not proof | ✓ | **SUPERSEDED by fable (g)** — N=30 FULL extension aggregate (≈1 h unattended, affordable) replaces the shard entirely; no hand-picked list to argue about |
| Impl-probes | Cross-file fake-timer + `nextTick` ordering; crash/unhandled/timeout positive controls; source-map sentinel | partly superseded by fable (h) | **ADOPTED (amended)** — fake-timer-leak probe DROPPED (moot: forks + `isolate: true` = fresh process per file; fable verified nextTick/microtask/immediate/timeout order identical); positive controls become PERMANENT fixtures under `scripts/ci-cd/test-soak/fixtures/` exercised by the tool's own `bun:test` (crash, hang → `--timeout`, unhandled rejection, missing JSON) so `test:ci-gating` proves the gate can fail on every CI run; source-map sentinel = a permanent arc-scoped file run once per runtime |
| Gate-1 | Compare inventory + per-id counts/statuses | ✓ | **ADOPTED** |
| Gate-2 | Phase 0 self-contradiction | ✓ | **ADOPTED** |
| Gate-3 | Command spec fixes | ✓ | **ADOPTED** |
| Gate-4 | Bun-only Node-assumption failure = blocker; runtime-neutral fix or approved semantic difference; clean re-baseline | ✓ | **ADOPTED** (+ fable: never `skipIf(process.versions.bun)`) |

## Round 1 — fable (Plan agent on Fable) — **conditional approve**

Transcript: [audit-fable.md](../audit-fable.md). Disposition:

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| (1) | Self-contradictory soak pass rule; tool-defined `failedRun` (`exit≠0 ∨ !success ∨ missing/unparseable JSON ∨ timeout`) | ✓ | **ADOPTED** — the definition is in the tool and the plan; Node baselines must be zero (codex Gate-2) |
| (2) | Soak the REAL `test` script (`bun run --cwd <ws> <script> -- --reporter=json --outputFile=…`), not a composed `vitest run`, so `pretest`, `--passWithNoTests` and the flipped string are what is soaked | ✓ — `bun run test -- <args>` forwards the args and runs landing's `pretest` (checked) | **ADOPTED** — the tool takes `--script <name>` (default `test`); the runtime comes from the script itself (pre-flip = Node, post-flip = Bun); no `--bun` flag in the tool. A post-flip Node re-baseline (failure procedure) = `git revert` that package's flip commit, soak, re-apply — which is why flips are one commit per package |
| (3) | Mechanical shard or N=30 full | ✓ (the five paths covered 7 of 37 fake-timer files) | **ADOPTED** — N=30 full aggregate on both runtimes; shard dropped |
| (4) | `gh workflow run pr-quick.yml --ref <branch>` after the flip for real-runner evidence (dispatch forces `full=true`, `pr-quick.yml:149-151`) | ✓ (`workflow_dispatch` at line 4; `full=true` override at 149-151) | **ADOPTED** — Phase 1 gate: push the flip commits, dispatch `pr-quick.yml` on the branch, `quality-status` must pass on the runner BEFORE the docs phase (no PR yet, explicit dispatch — within the "branch pushes trigger nothing" convention) |
| (5) | Bun-only deterministic-failure protocol; never `skipIf(process.versions.bun)` | ✓ | **ADOPTED** — written into the failure procedure |
| Sec-Low-1 | `--bun` symlinks `node` for the process tree; no unit test spawns processes (grep 0) → the actual blast-radius boundary | ✓ (fable's grep) | **ADOPTED** as Fact F12 |
| Sec-Low-2 | Four deps declare a `"bun"` export condition | ✓ | **ADOPTED** (see codex S2) |
| Sec-Low-3 | Committed baselines: absolute paths → relativize; ~13 files acceptable? | ✓ | **ADOPTED** — ids and `cwd` repo-relative, no home paths (the pre-commit brand/path guard also enforces it); committed artefacts are COMPACT summaries (`meta`, counts, failing ids + counts, `inventoryDigest`, timings); the full inventories stay in the gitignored `lessons/baselines/full/` for the local `--compare` |
| F1/F5/F8/F10 | Wording/count corrections (pretest, `--passWithNoTests`; 7 bb.js files; `NULO_FUZZ_RUNS` is a run-count knob; `scripts/**` unlinted) | ✓ | **ADOPTED** — probes doc fixed (7), Facts reworded, biome includes make the Phase 2 lint gate true |
| Inf-interop | `interopDefault: false` ≠ "native semantics on both runtimes": named access loses vitest's `mod[prop] ?? default[prop]` fallback; CJS named exports then follow each runtime's own loader | ✓ (`module-evaluator.js:86-93`) | **ADOPTED** — comment + Security bullet reworded; the Node baselines with the flag on EVERY suite (not only the aggregate) are the evidence nothing depends on the fallback |
| Inf-power | State the statistical power: N=30 detects ≥10 % flake w/ 96 %, 5 % w/ 78 %; N=10 detects ≥25 % w/ 94 % | ✓ (binomial) | **ADOPTED** — in the plan's gate rationale and in CLAUDE.md's bar |
| Inf-runner | vitest 4.1 `experimental.viteModuleRunner` defaults true; `viteModuleRunner: false` would need `module.registerHooks` (absent on Bun) → never-flip | ✓ (`cli-api.*:9263`, `native.*:49-50`) | **ADOPTED** — documented next to the stopgap |
| Asks (i) | CI's test runtime becomes PINNED post-flip (was runner-ambient Node) | ✓ | **ADOPTED** — owner FYI in the PR body (a reproducibility gain) |
| Asks (ii) | If a package must stay on Node the Done criterion changes | agreed | **ADOPTED** — owner ask A7, raised only if it happens |
| Asks (iii) | Baseline JSON as repo content | agreed | **ADOPTED** — compact summaries only (Sec-Low-3) |
| (c) | One commit per package flip | ✓ | **ADOPTED** |
| (e) | Flip `test:watch` after smokes (consistency) | conflicts with codex I3 | **RESOLVED** — conditional flip on three passing smokes (edit → rerun → Ctrl-C, no orphan `bun` workers); else Node |
| (f) | Tool subdir `scripts/ci-cd/test-soak/`; custom reporter by path instead of a `--root` sentinel; `import.meta.main` guard | ✓ | **ADOPTED** — `scripts/ci-cd/test-soak/{cli.ts, lib.ts, lib.test.ts, runtime-reporter.ts, fixtures/**}`; the reporter's `onInit` records execPath/versions/resolves (the launcher spawns workers with its own `execPath`, verified equal) |
| (h) | Fake-timer-leak probe moot; nextTick ordering verified identical; keep a permanent source-map sentinel | ✓ | **ADOPTED** |

Rejected: nothing. Disputed after both rounds: nothing (the one conflict, `test:watch`, resolved by the conditional flip).

## Round 2 — codex (resumed, plan v2) — **conditional approve**

Verbatim verdict: "conditional approve — conditions: make provenance comparable across phases, replace the impossible `spawnSync` signal contract, and repair/fail-close sentinel resolution and command metadata". Round-1 fold judged "otherwise folded correctly" (Med). Disposition:

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| R2-1 | [High] Same-SHA comparison impossible as phased (Node summaries precede the flip commit); generate both matrices after the flip at one clean HEAD (direct invocation can still select Node) or compare a tested-input digest; baseline files must not affect the dirty flag | ✓ (design error in v2) | **ADOPTED** — both matrices at the matrix commit; `--runtime node` = same-commit reference mode (the script's string with `bun --bun ` stripped, Node by shebang), `--runtime script` = the real script (Bun after the flip); `gitDirty` excludes `lessons/baselines/**`; the digest alternative rejected (machinery for no gain) |
| R2-2 | [High] `spawnSync` blocks signal handlers and its timeout kills only the direct child, not vitest's worker group → async `spawn` + timer + process-group termination | ✓ | **ADOPTED** — `spawn` with `detached: true`, group kill `process.kill(-pid, "SIGKILL")` on timeout and on SIGINT/SIGTERM; still `node:child_process` (Arc D boundary intact) |
| R2-3 | [High] The `--root scripts/...` sentinel is not executable: relative root from workspace cwds; `@aztec/foundation`/`stdlib`/`aztec.js` have no root exports; under isolated linking a root-located sentinel cannot resolve workspace deps → absolute root + workspace-anchored resolution + real subpaths; represent unavailable packages explicitly | ✓ (`@aztec/*` root exports checked) | **ADOPTED (merged with fable (f))** — the sentinel is replaced by `runtime-reporter.ts` attached to every run; it resolves via `createRequire(join(cwd, "package.json"))` (workspace-anchored, both linkers) with subpaths `@aztec/foundation/curves/bn254`, `@aztec/stdlib/abi`, `@aztec/aztec.js/wallet`; unresolvable specs are recorded as `{ error }` |
| R2-4 | [Med] `--outputFile=${tmp}` passed the directory | ✓ | **ADOPTED** — `join(tmpDir, "results.json")` |
| R2-5 | [Med] Enforced flags precede forwarded args → overridable; reject reserved flags or append last | ✓ | **ADOPTED** — enforced flags appended LAST; reserved flags (`--retry`, `--reporter`, `--outputFile`, `--root`, `--config`, `--pool*`, `--watch`) rejected up front |
| R2-6 | [Med] Comparator must validate runtime identity (Node summary has no `versions.bun`, Bun summary has it), cwd, script/filters, requested runs, argv — not just SHA/version | ✓ | **ADOPTED** |
| R2-7 | [Med] Inventory union hides a test missing from some runs → per-run digest/observation counts; every id/status in every run | ✓ | **ADOPTED** — per-run `inventoryDigest`, per-id `observations`, compare requires `observations === runs` in both |
| R2-8 | [Med] A genuine Bun defect that reverts a package makes Done impossible → explicit STOP, owner chooses abort vs reduced scope | ✓ | **ADOPTED** — owner ask A7 + failure procedure (b) |

Rejected: nothing. Disputed: nothing.

## Round 3 — codex (resumed, plan v3 = fable + r2 fold) — **conditional approve**

Verbatim verdict: "conditional approve — conditions: fix Node lifecycle fidelity, attest ESM resolution, and invalidate stale matrix/dispatch evidence". Fold assessment (Low): "Process-group control, fail-closed JSON handling, reserved flags, inventory observations, full-extension N=30, conditional watch flips, and stop-on-reduced-scope are correctly folded. No new owner ask is needed beyond those already recorded."

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| R3-1 | [High] Matrix provenance incomplete: re-soaking one workspace after a test fix, and post-impl review commits without a re-gate, both violate "one clean matrix commit" → any executable/config/test/tool change after the matrix re-runs the full matrix + dispatch; PR HEAD may differ only by a documentation-only allowlist | ✓ (v3 gap) | **ADOPTED** — "Matrix commit rule" in Phase 1; failure procedure (a) re-runs the full matrix; Post-implementation step 4 re-gates after the review loop; allowlist = `*.md`, `implementations-plan/**`, `CLAUDE.md`, `CI.md`, `ARCHITECTURE.md` |
| R3-2 | [Med] `--runtime node` bypasses `pretest`/`posttest` (landing's `pretest` generates a required input); execute lifecycle hooks with matching failure semantics; strictly parse the simple script grammar | ✓ (`apps/landing/package.json:14`) | **ADOPTED** — grammar `bun --bun vitest run( <token>)*`, `pre<script>`/`post<script>` executed explicitly, non-zero pre = failed run |
| R3-3 | [Med] `createRequire().resolve` measures CJS resolution; vitest externalizes ESM imports → record workspace-anchored `import.meta.resolve`, optionally alongside; correct the claim that all four `"bun"` declarations necessarily differ | ✓ | **ADOPTED** — `resolves[spec] = { esm, cjs }`; ESM via `Bun.resolveSync(spec, wsDir)` on Bun and `import.meta.resolve(spec, wsURL)` on Node with `NODE_OPTIONS=--experimental-import-meta-resolve` set by the tool for the Node reference runs; a missing `esm` record fails the compare; "may differ" wording |
| R3-4 | [Med] Dispatch evidence must be race-proof: the run whose workflow/event/branch/`headSha` match the matrix commit, and the named `quality-status` JOB succeeded | ✓ | **ADOPTED** — `gh run list … --json databaseId,headSha …` → `headSha == matrix`, `gh run view <id> --json jobs` → `quality-status` success |
| R3-5 | [Med] Fixtures under `scripts/**` resolve vitest only by hoisting accident (root declares none) → anchor to a workspace that declares vitest or prove the launcher under isolated linking | ✓ (root `package.json` has no vitest) | **ADOPTED** — fixtures run via `bun --no-install run --cwd apps/landing vitest run --root <abs fixture dir>` (the `--root` launch was probed pre-plan) |

Rejected: nothing. Disputed: nothing. Three resumed rounds reached zero disputes with every finding adopted; per the owner's protocol the gate itself is the fresh-context pass below.

## Final — fresh-context codex pass, round 1 (new session `01a035de-5ec7-7ae3-b370-2bcc82a01465`, xhigh, plan v4) — **conditional approve**

Verbatim: "VERDICT: conditional approve — conditions: close provenance gaps, normalize evidence, isolate fixtures, and make every gate machine-checkable". Looks-fine: "Per-script `--bun`, the repo-wide stopgap, one-PR topology, full N=30 matrix, ×5 fan-out, and rejection of the global `bunfig.toml` flip are the right choices. No rejected alternative is better." Asks: "No owner decision is silently consumed."

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| F-1 | [High] Local soaks trust an unverified `node_modules`; `--no-install` does not prove installed bytes match `bun.lock` → recorded `bun install --frozen-lockfile` immediately before the clean matrix | ✓ | **ADOPTED** — clean-install attestation step in Phase 1; `lockfileSha256` in every summary; compare requires equality |
| F-2 | [Med] "No absolute paths" contradicts recorded argv/execPath/reporter path/resolver outputs; `Bun.resolveSync` returns a path, Node a `file:` URL → canonicalize | ✓ (F14) | **ADOPTED** — canonicalization in `lib.ts` (`<repo>/…`, `<tmp>/…`, `<bun>`/`<node>`, URLs → paths, error messages too), tested |
| F-3 | [Med] Compact summaries are not tamper-evident; do not call them self-attesting; preserve comparator output/digests | ✓ | **ADOPTED** — wording changed; comparator stdout + digests preserved in `lessons/phase-1.md` and the PR body |
| F-4 | [Low] F1 "no workflow YAML names vitest" is false (`_network-e2e.yml` does) | ✓ | **ADOPTED** — reworded to "no unit workflow invokes vitest directly" |
| F-5 | [Med] The Node reference reconstructs lifecycle and injects `NODE_OPTIONS` → resolve ESM evidence outside the test process, or prove the difference inert | ✓ | **ADOPTED** — `resolve-esm.mjs` runs outside the test process (once per summary, workspace-anchored, engine matched to the run records); no environment injection remains; I7 states the residual equivalence claim explicitly |
| F-6 | [High] Fixtures under `scripts/ci-cd/test-soak/fixtures/**` risk discovery by recursive `bun test scripts/ci-cd/` → crash/hang controls could crash or hang CI | ✓ (`bun test` recurses; F10) | **ADOPTED** — `*.fixture.ts` names, fixture-local `include: ["*.fixture.ts"]`, and `cli.test.ts` asserts no fixture file matches `bun test`'s pattern |
| F-7 | [Med] `sourcemap.sentinel.ts` would not match vitest's pattern and had no machine check → discoverable name/config + a wrapper requiring failure at the exact location | ✓ | **ADOPTED** — the sentinel becomes the `sourcemap` fixture; `cli.test.ts` requires the run to fail with `sourcemap.fixture.ts:<line>` on both engines |
| F-8 | [Med] The post-matrix allowlist admitted `implementations-plan/**` including executable probe code → narrow to Markdown + baseline evidence | ✓ | **ADOPTED** — allowlist = `**/*.md` + `implementations-plan/vitest-on-bun/lessons/baselines/**/*.json`; the arc-scoped `tools/probes/` directory no longer exists |
| F-9 | [Low] Do not add `globals: true` to formerly config-less workspaces | ✓ | **ADOPTED** — `...sharedTest` + explicit `environment: "node"` only |
| F-10 | [High] `compare` must require `gitDirty === false` on both, `failedRuns === 0` on BOTH, and one consistent reporter record per run | ✓ | **ADOPTED** — per-run runtime records (`runs[i].runtime`), both-sides clean and zero-failure requirements; `failedRun` also true when the runtime record is missing |
| F-11 | [Med] Resolution differences need an acceptance rule → fail automatically outside an exact reviewed allowlist | ✓ | **ADOPTED** — `--resolve-allow` (default: the four `"bun"`-condition packages); any other differing spec fails the compare |
| F-12 | [Low] Standardize on `gh run view <id> --json jobs` + assert `quality-status`; delivery asserts all three named required checks at PR HEAD | ✓ | **ADOPTED** |

Rejected: nothing. Disputed: nothing.

## Final — fresh-context codex re-pass, round 2 (same session, plan v5) — **conditional approve**

(The first launch of this re-pass was killed by the harness two minutes in — no OOM, 17 GiB free — and relaunched; the relaunch completed.) Verbatim: "conditional approve — conditions: eliminate the remaining reporter environment injection, specify the full/compact artifact flow, and pin the gate's resolver allowlist". Low: "Every previous disposition is otherwise accurately folded."

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| F2-1 | [Med] The reporter's per-run `SOAK_RUNTIME_OUT` env var is an environment injection the Node reference claims not to have → derive `runtime.json` from vitest's configured `outputFile`, or attest inertness and correct I7 | ✓ | **ADOPTED** — `onInit(ctx)` writes `runtime.json` to `dirname(ctx.config.outputFile)`; no env var in either mode; I7 corrected |
| F2-2 | [Med] Artifact flow underspecified (compare needs full inventories but Phase 1 wrote compact paths; no compaction command) → soaks write full files, compare consumes them, a defined command produces the committed compact copies | ✓ | **ADOPTED** — `soak --out full/…` → `compare full/… full/…` → `compact full/… --out …`; Phase 1 commands + gate list the 24 compactions |
| F2-3 | [Med] `--resolve-allow` is operator-expandable → the gate must forbid the option or pin the four-spec list and print the effective allowlist | ✓ | **ADOPTED** — allowlist is a pinned constant in `lib.ts`, no CLI/config widening (a code change re-gates by the matrix rule); the comparator prints it |

Rejected: nothing. Disputed: nothing.

## Final — fresh-context codex re-pass, round 3 (same session, plan v6) — **APPROVE**

Verbatim: "VERDICT: approve — [Low] All three round-2 conditions are completely folded: reporter output is environment-free, full→compare→compact flow is explicit, and the resolver allowlist is pinned with no runtime override. [Low] The round-2 disposition table accurately matches v6. No new High/Med findings remain. looks fine"

**Gate passed 2026-08-24.** Tally: codex resumed rounds 1–3 (conditional ×3, all adopted), fable round 1 (conditional, all adopted, one conflict resolved), fresh-context session rounds 1–2 (conditional, all adopted) → round 3 approve. Rejected findings: none. Unresolved disputes: none. Owner-reserved asks carried into implementation: A4 (backport request vs wait), A5 (non-zero Node reference → stop), A7 (a package that must stay on Node → stop), plus the pinned-runtime FYI.

## Final — fresh-context codex pass — pending
