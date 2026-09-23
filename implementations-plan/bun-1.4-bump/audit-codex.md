# Codex audit — bun-1.4-bump (round 1)

Session `01a03421-a1cb-7882-8a89-a2c47923e700` · model gpt-5.6-sol · effort xhigh · sandbox read-only · fresh context. Prompt summarized; response verbatim. Dispositions in plan.md § Audit log.

## Prompt (summary)

Audit `implementations-plan/bun-1.4-bump/plan.md` (+ recon.md, + parent dossier) for the bun 1.3.14→1.4.0 bump arc. Asks: adversarial/security pass (4-day-old runtime, dedupe downgrades, bunx swap in a required workflow, lockfile v2, workflow permissions); assumption-attack (Facts/Inferences/Asks buckets); implementation critique vs recon's reuse map; and two delegated rulings — (1) `bun dedupe --check` blocking vs advisory given observed range-intersection downgrades (mime-db 1.54.0→1.52.0, string_decoder 1.3.0→1.1.1), (2) the most reliable empirical method to verify whether Bun 1.4's `bun update` applies `minimumReleaseAge` to transitives (Bun bug #25305). Explicit verdict required. Verified empirical probes were supplied (94/94 bun:test green under 1.4.0; `--parallel` flags present; 4 lockfile duplicates; bunx renovate validator green; lockfile v1/configVersion 1).

## Response (verbatim)

VERDICT: conditional approve — conditions: make dedupe advisory; treat lockfile v2 as a Bun ≥1.4 fleet cutover; eliminate or explicitly accept bunx's floating, age-ungated closure; use a positive-control #25305 repro; add semantic lockfile and full-suite gates.

1. **[High] Facts:** Fact 3 is misstated: `toContain` is used on arrays of strings, not only strings—still safe under `===`, but correct the claim. Fact 7 is literally false because `concurrently` also appears in `bun.lock` and history; say "only live manifest/script use." More importantly, the security section's assertion that bunx receives the project's seven-day protection is unsupported: Bun documents bunfig lookup for install/add/remove, not bunx, and an open Bun bug shows bunx's age flag is a no-op. Exact `renovate@43.150.0` pins only Renovate; its transitive closure remains dynamically resolved and executed. [Bun #30748](https://github.com/oven-sh/bun/issues/30748)

2. **[High] Inferences:** A Node shebang does not make Vitest "unaffected": Bun still resolves/installs dependencies, dispatches scripts, and rewrites the lock. Dedupe changes executable production transitives—`string_decoder` is reachable through `vite-plugin-node-polyfills`/`node-stdlib-browser`—so "bundle byte-identical" is false. `bun audit` alone cannot establish downgrade safety. Also, the predicted cold cache is wrong: the generic `${runner.os}-bun-` restore key can restore a 1.3-era cache.

3. **[High] Asks:** A3 understates the compatibility break. Older Bun cannot read lockfile v2, so leaving the shared/global binary on 1.3.14 breaks installs—not merely the new parallel scripts. Coordinate every developer/agent to ≥1.4 or defer v2. [Bun's 1.4 breaking-change record](https://github.com/oven-sh/bun/issues/28792) A1 should not offer "newest 1.4.x" blindly: that resets the soak window. Explicitly approve a specific artifact after provenance, regression, and age review. Surface a further ask: whether dynamically resolved CI executables are acceptable for this wallet repo.

4. **[Med] Workflow/security:** `oven-sh/setup-bun@v2` is a mutable tag. Release checksums protect transport, not compromise of the action or upstream release account; pinning the action by commit SHA is the stronger boundary. Give the reusable lint workflow explicit `contents: read` permissions. Current callers are read-only, so the edits do not presently expand privileges, but the plan misses that the reusable workflow—and therefore dedupe failure—is also used by release and nightly.

5. **[Med] Implementation:** Keep the three lockfile-caused commits; they materially improve reviewability and are not ceremony. Use `bun pm diff` during implementation, compare pre/post resolved name/version/integrity tuples, run install twice to prove a fixed point, then frozen install. Add a clean-cache Ubuntu bunx probe, before/after `bun audit` triage, and `test:all`; `audit:vue` only covers extension tests. Watch parallel `audit:vue` memory pressure.

### Delegated rulings

**Dedupe check: advisory.** Blocking a required correctness check on a resolver-normalization preference is too brittle. Bun 1.4 can make `bun update` and `bun dedupe` oscillate, so Renovate/manual bumps could go red until reviewers accept unrelated transitive downgrades. [Bun #38903](https://github.com/oven-sh/bun/issues/38903) Avoid invisible drift with a named warning, step summary containing the duplicate set, and scheduled maintenance/issue creation. Promote it to blocking only after update→dedupe reaches a stable canonical result and downgrade policy is explicit.

**#25305 verification:** The proposed live "fast-moving dependency" test can pass without exercising the bug. Prefer a local mock npm registry with:

- Parent 1.0 old / 1.1 young; child 1.0 old / 1.1 young.
- Both parent versions depend on `child:^1`.
- Seed the lock without the gate, proving 1.1/1.1.
- Clone that exact seed; enable seven days; run `bun update --latest` under 1.3.14 and 1.4.0.
- Parent downgrading proves the age-gated update path fired; only child also downgrading proves the transitive bug fixed.

Use explicit packument `time[version]` timestamps with wide boundary margins and assert none are missing—Bun treats missing time as passing. A public-registry fallback should replay the original Vitest reproducer on both versions and read timestamps from npm packuments, but it is less deterministic. The issue remaining open is useful prior evidence, not an empirical verdict. [Bun #25305](https://github.com/oven-sh/bun/issues/25305)

What looks fine: pin-surface consolidation, composite reuse, preserved check names/topology, isolated v2/dedupe/removal commits, empirical 94-test and re2 probes, and keeping linker/Aztec/runtime migrations out of scope.

## Post-audit verification by the main agent (before adoption)

- **C2 verified true**: scratch project, 1.4.0-written v2 lockfile → `bun@1.3.14 install --frozen-lockfile` fails (`warn: Ignoring lockfile` / `error: lockfile had changes, but lockfile is frozen`). → Fact 9, Ask A3 upgraded to merge precondition.
- **C6 verified true**: `bun.lock:1812` — `node-stdlib-browser@1.3.1` (inside `vite-plugin-node-polyfills`, present in all three app vite configs) depends directly on `string_decoder ^1.0.0`; nested `1.1.1` copies sit under `browserify-sign/` and `ripemd160/` chains. → Fact 10, Phase 3 bundle-resolution gate.
- **C8 verified true**: no `permissions` block in `_lint-and-typecheck.yml`. → Fact 11, Phase 5.
- **C3 adopted with correction**: the floating-closure exposure is identical under the incumbent npx step — the swap is exposure-neutral; the genuine decision (accept / vendor / drop) is surfaced as Ask A4.
- Issue links (#30748, #38903, #28792) are post-cutoff and unverifiable offline; the rulings were adopted on the strength of the arguments and the locally verified evidence, not the citations.
