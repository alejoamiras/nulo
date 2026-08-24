# Codex audit transcript — vitest-on-bun (Arc C)

## Round 1 — 2026-08-24 — plan v1 + competing outline

Session `01a035c3-c86a-7590-bc9d-9bb0ebfb8aca` · gpt-5.6-sol · xhigh · read-only · packet: adversarial/security + assumption-attack + implementation critique (a–h) + gates + upstream. Prompt: this session's scratch `codex-prompt-arcc-r1.md` (recorded in `lessons/gate-convergence.md`).

### Verdict (verbatim)

VERDICT: conditional approve — conditions: make the soak gate fail-closed, require clean baselines and identical inventories, repair the shard/probes, and replace the stale upstream action

### Findings (verbatim)

**Adversarial / security**
- [High] The soak harness and its committed JSON are self-attesting. An attacker would target argument forwarding, reporter parsing, sentinel output, or baseline files. Record normalized command, git SHA, Bun/Node/Vitest versions, pool/workers, seed, exit status, and test-inventory digest; reject metadata mismatches.
- [High] Frozen dependencies do not guarantee equivalent execution: Bun exposes Node 26.3 compatibility and may select Bun-specific conditional exports while production builds remain Node-driven. Capture critical `import.meta.resolve` results and treat differing dependency paths as investigated evidence.
- [Med] Use argument-array spawning, `--no-install`, explicit `--retry=0`, per-run timeout, signal forwarding, secure temporary files, and cleanup. "No orphan risk" and hang detection are not currently designed.
- [Low] Existing `contents: read` / `pull-requests: read` permissions and unchanged required-check producers are sound.

**Facts**
- [Med] Most Facts match the repo and probes. Qualify F7: unit CI does not explicitly pin Node 24; `_unit-tests.yml` installs Bun only, so the current Node runtime is runner-image ambient. Node baselines must record the actual version.
- [Low] There are eleven workspace `test` scripts, plus separately flipped `test:components` and faucet `test:e2e`; wording such as "eleven scripts … plus" is inconsistent.
- [Low] Call the aggregate results test-set-identical, not "byte-identical."

**Inferences**
- [High] I6's consequence is wrong: different pool sizing can cause races, OOMs, hangs, and worker exits—not merely timing changes. Record sizing and repeat the real concurrent `test:all` fan-out several times.
- [Med] I1/I2 are legitimate hypotheses, not expected outcomes. A red Node baseline should stop the arc, not silently become the bar.
- [Med] I3 needs three watch smokes, not one design smoke. Prefer leaving all `test:watch` scripts on Node this arc.
- [Med] I5 is unsupported: one contended 116s/132s comparison says nothing reliable about Linux CI. Measure before making performance or timeout claims.
- [Low] I4 is well supported by Bun/jsdom behavior and the completed faucet runs.

**Asks**
- [High] Surface any non-zero Node baseline to the owner; accepting an existing flake budget is policy, not an implementation default.
- [Med] Replace A4 with an owner choice about requesting a Vitest-4 backport or waiting for Vitest 5. The issue itself already exists.
- [Low] A1/A2 are safely technical decisions. A3 becomes an owner preference only if local watch-runtime consistency is part of "done." A5 remains settled.

**Architecture & implementation**
- [Med] Choose the root plain-object `interopDefault: false` base. It is smaller and class-wide; zod inlining is narrower but hides the class, waiting blocks unnecessarily, and a config package adds unjustified dependency edges. Add a retirement reference to Vitest #10363.
- [High] Keep per-script `bun --bun`; outline B violates the owner's e2e boundary and flips Vite, Storybook, Puppeteer, and helpers.
- [Med] Prefer the middle ground: foundation commit, one script-flip commit, full matrix gate, docs commit, one PR. Six unlanded rollout phases add ceremony without isolation; two PRs wrongly describe the foundation as inert even though it changes Node interop semantics.
- [High] Keep the soak tool and `node:child_process` boundary, but define IDs as `relative-file :: fullName`, compare complete collected/status inventories, and make `--compare` exit non-zero. Include exact tool/sentinel files in Biome; `scripts/**` is currently excluded.
- [Med] The extension shard omits the explicitly named wallet-core lock/rw/keyed-lock tests and timer-heavy extension-messaging tests. Add them. N=10 full is the previously agreed sampling budget, not proof of zero flakiness.
- [Med] Real suites cover SFC/CSS/aliases/workspace TS/dynamic imports and extensive hoisted mocks/resetModules. Add explicit cross-file fake-timer + `nextTick` ordering and crash/unhandled/timeout positive controls; retain the source-map sentinel. Pool identity is already covered.

**Gates**
- [High] "No new failing ID" is insufficient: it misses fewer collected tests, changed skip/todo states, and a deterministic Bun failure sharing an ID with a rare Node flake. Compare inventory and per-ID counts/signatures.
- [High] Phase 0 contradicts itself: `failedRuns: 0` versus "non-zero becomes the bar." Require zero or stop for owner disposition.
- [Med] Fix command specifications: faucet smoke needs its config/script explicitly; Bun output paths inconsistently omit the plan prefix; Phase 4 places `--out` after `--`, forwarding it to Vitest.
- [Med] A Bun-only Node-assumption failure is a migration blocker: diagnose, make the test runtime-neutral or document an approved semantic difference, then rerun clean baselines.

**Upstream**
- [High] The locked-4.1.10 diagnosis is correct, and Bun's non-own namespace behavior is deliberate since 1.1.32. But Vitest already closed #10359 via merged #10363, using `defaultExport.__esModule` truthiness—not `Object.hasOwn`—and shipped it in Vitest 5 beta 3. Do not file a duplicate. The `.js`/`type:module` TODO is directionally sound but a broader resolver change.

### Disposition

See `lessons/gate-convergence.md` (adopted / rejected per finding, with verification of the upstream claim) and plan.md v2.

## Rounds 2–3 — same session, plans v2 and v3

Verbatim verdicts and findings are in `lessons/gate-convergence.md` (round 2: "conditional approve — conditions: make provenance comparable across phases, replace the impossible `spawnSync` signal contract, and repair/fail-close sentinel resolution and command metadata"; round 3: "conditional approve — conditions: fix Node lifecycle fidelity, attest ESM resolution, and invalidate stale matrix/dispatch evidence"). Raw responses: the session's `response-1.md` / `response-2.md` (CODEX_DIR recorded in the convergence log).

## Fresh-context final pass — 2026-08-24 — plan v4

Session `01a035de-5ec7-7ae3-b370-2bcc82a01465` · gpt-5.6-sol · xhigh · read-only · NEW session with the consolidated plan + full decision ledger + convergence log.

### Verdict (verbatim)

VERDICT: conditional approve — conditions: close provenance gaps, normalize evidence, isolate fixtures, and make every gate machine-checkable

### Findings (verbatim)

**Adversarial / security**
- [High] Local soaks trust an unverified `node_modules`. `--no-install` prevents auto-install but does not prove installed bytes match `bun.lock` (`plan.md:41,113`). Require a recorded `bun install --frozen-lockfile` immediately before the clean matrix, or equivalent clean-install attestation.
- [Med] "No absolute paths" contradicts recorded `argv`, `execPath`, reporter path, and resolver outputs (`plan.md:44,46-49,115`). `Bun.resolveSync` returns a path while Node returns a `file:` URL, causing false resolution differences and leaking home paths. Canonicalize repo paths, file URLs, temporary paths, and resolver errors before comparison/commit.
- [Med] Compact summaries are review evidence, not tamper-evident: full inventories are gitignored (`plan.md:49`). Avoid calling them "self-attesting"; preserve comparator output/digests in the PR or an immutable run transcript.

**Assumption attack**
- Facts: [Low] F1's literal "no workflow YAML names `vitest`" is false: `.github/workflows/_network-e2e.yml:20,47,84,126` does. The intended fact—no unit workflow directly invokes Vitest—is correct: `_unit-tests.yml:24-25` calls `test:all`. [Low] The eleven scripts, landing lifecycle, faucet smoke, Vitest defect, versions, Bun pin, and required-check producers check out.
- Inferences: [Med] The Node reference is not literally the pre-flip environment: it manually reconstructs lifecycle execution and injects `NODE_OPTIONS` (`plan.md:43,46`). Resolve ESM evidence outside the test process, or prove and record that this environment difference is observationally inert.
- Asks: [Low] No owner decision is silently consumed. A1–A3 are technical choices; policy/scope changes remain A4/A5/A7.

**Implementation critique**
- [High] Failure fixtures under `scripts/ci-cd/test-soak/fixtures/**` risk direct discovery by recursive `bun test scripts/ci-cd/` (`package.json:33`; `recon.md:38`; `plan.md:41`). Use non-`*.test.*` fixture names plus fixture-local Vitest `include`, otherwise crash/hang controls can crash or hang CI itself.
- [Med] `sourcemap.sentinel.ts` will not match Vitest's normal test pattern, and its expected nonzero result has no machine-checking command in the Phase 0 gate. Give it a discoverable name/config and a wrapper that requires failure while asserting the exact source location.
- [Med] The post-matrix allowlist permits all `implementations-plan/**`, including executable probe code, contradicting "any executable change invalidates the matrix". Narrow it to explicit Markdown and baseline-evidence paths.
- [Low] Do not enable `globals: true` in formerly config-less workspaces merely for convention; preserve their existing defaults and add only `sharedTest` plus explicit Node environment.

**Gates**
- [High] `compare` does not require `gitDirty === false` or Node `failedRuns === 0`, and the singular runtime record does not prove all N executions used the claimed engine. Require both summaries clean, both `failedRuns === 0`, and one present, consistent reporter record per run.
- [Med] Unexpected ESM-resolution differences merely require "investigation," with no acceptance rule. Fail automatically outside an exact reviewed allowlist.
- [Low] Phase 1's command asks for run-level `conclusion`, while its pass rule requires the named job. Standardize on `gh run view <id> --json jobs` and assert `quality-status`; delivery should explicitly assert all three named required checks at PR HEAD.

**looks fine** — Per-script `--bun`, the repo-wide stopgap, one-PR topology, full N=30 matrix, ×5 fan-out, and rejection of the global `bunfig.toml` flip are the right choices. No rejected alternative is better.

### Disposition

All twelve findings adopted in plan v5 (table in `lessons/gate-convergence.md`); re-pass requested on the same fresh session.

## Fresh-context session, round 2 — plan v5

### Verdict (verbatim)

VERDICT: conditional approve — conditions: eliminate the remaining reporter environment injection, specify the full/compact artifact flow, and pin the gate's resolver allowlist

### Findings (verbatim)

- [Med] "No environment injection" is not fully folded: the Node-reference command claims none (`plan.md:46`), but the reporter requires a per-run `SOAK_RUNTIME_OUT` environment variable (`plan.md:49`). Derive `runtime.json` from Vitest's configured `outputFile`, or explicitly attest this injected variable as observationally inert and correct I7.
- [Med] Artifact flow is underspecified. `compare` requires full inventories, full summaries supposedly live under `baselines/full/`, but Phase 1 directs soak outputs to the compact `baselines/{node,bun}/` paths and gives no compaction command. Specify that soaks write full files, comparisons consume those files, and a defined command produces compact committed copies.
- [Med] `--resolve-allow` remains operator-expandable, while the Phase 1 commands merely say "compare". That permits an unexpected resolution difference to be made green by widening the CLI list. The migration gate must forbid the option or explicitly pin the exact four-spec list and record the effective allowlist in comparator output.
- [Low] Every previous disposition is otherwise accurately folded: clean/frozen provenance, per-run identity, canonical paths, fixture isolation, source-map checking, narrow post-matrix paths, minimal configs, named-job dispatch evidence, and all three required checks.

### Disposition

All three adopted in plan v6; round-3 re-pass requested.
