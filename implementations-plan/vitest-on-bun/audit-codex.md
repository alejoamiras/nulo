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
