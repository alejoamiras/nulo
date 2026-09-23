# Fable audit — isolated-linker-store (round 1)

Independent Claude-side planning audit (fable role; Plan agent on the Fable model), run in parallel with the codex round-1 audit against plan.md @ 0f38168a. Verbatim below; dispositions land in plan.md's Audit log after consolidation with codex.

## Verdict

**Conditional approve — conditions:**
1. **Regen-gate mechanism specified for wallet grade**: tuple diff must cover ADDED/REMOVED package names both directions; "@aztec/* byte-identity" enforced via `integrity` + `resolved` field equality old-lock vs new-lock (name@version equality cannot see a registry-side tarball swap); any move inside the @aztec transitive graph or the extension prod bundle gets `bun pm diff` review regardless of semver class — "patch within range" auto-pass is exactly where a patient ≥7-day-old attacker lives.
2. **Remove the aged-out `minimumReleaseAgeExcludes` (bunfig.toml:56-91) BEFORE the Phase 2 regen** — bunfig's own comment says the @aztec set aged out ~2026-07-22, yet the plan runs its one full re-resolve with the entire @aztec namespace blanket-exempt from the 7-day gate. (Executes bunfig's own recorded TODO.)
3. **Add a `vite dev` boot smoke to the Phase 2/4 gates** — no gate exercises dev mode, and the global store lives OUTSIDE the workspace root (unlike pnpm's in-repo `.pnpm`), so `server.fs.allow` 403s on `/@fs/` realpathed store paths are a plausible break the plan never tests (dev middleware exists: apps/extension/vite.config.ts:203-214).

## Findings

**High**
- Regen gate under-specified (plan.md Phase 2): version-move classification only; new/removed names, integrity-hash drift on unchanged versions, resolved-URL changes invisible. Fact 4 freezes versions, not bytes, and not the semver-ranged transitives INSIDE the @aztec graph.
- Stale gate exemptions at regen time (bunfig.toml:43-91): condition 2.
- Dev-mode blind spot (apps/extension/vite.config.ts:16,203-214): condition 3 — custom middleware bypasses fs.allow, but transformed dep imports served as `/@fs/` do not.

**Medium**
- The explicit `@aztec/sqlite3mc-wasm: "5.0.1"` declaration: judgment "manifest edit ≠ version-line change" is SOUND (graph already resolves 5.0.1 via kv-store:43; nothing re-resolves) — but it creates a future skew channel: an aztec bump moving kv-store while missing the new pin yields emitted sqlite3.wasm vs kv-store glue skew (the silent worker-hang the plugin comment documents). UPDATE.md note is weak; REQUIRE the identity test to assert realpath(resolve-from-extension) == realpath(resolve-through-kv-store) (lockstep assertion).
- Resolver fallback algorithm wrong for its motivating package: sqlite3mc-wasm's `.` export carries ONLY an `import` condition → `createRequire().resolve(pkg)` throws ERR_PACKAGE_PATH_NOT_EXPORTED. Both needed assets are condition-less exported SUBPATHS — resolve those directly (or `import.meta.resolve`). Unit-test against the real package, not fixtures.
- Phase 2 bundles two risk events: regenerate the lockfile FIRST on hoisted (full battery), THEN flip with an empty/format-only lock diff — one root cause per commit; "linker doesn't affect resolution" becomes observable instead of assumed.
- Inference 5: a single two-install smoke is anecdote; raise to N-way (5–10) repeated with post-run frozen-install verification; name the fallback control (advisory cross-worktree install mutex via the ~/.agents run-registry pattern) if inconclusive.

**Low**
- If `install.globalStore` proves non-togglable, machine-shared storage of wallet deps becomes unconditional — add the posture question to Phase 4's keep/abort explicitly.
- remappings.txt precedence matches foundry docs; post-flip a bare `forge build` without gen fails confusingly — document in the contracts README.
- The identity test lives in apps/extension but must assert bridge-core/aztec-runtime-anchored assets — `createRequire` anchors by path, fine; state it.
- Inference 1: build-side plausible (realpath default, pnpm-parity for vite 8/rolldown + @crxjs 2.6.1); the genuine exposure is dev serving (condition 3), which "build+smoke" never touches.

## Outline B ruling

**LOSES; keep as documented fallback.** Steelman: ~10-line diff, day-one payoff, zero build-plumbing churn, sidesteps the sqlite3mc question. But the recon corrections cut against it: patched-noir locality and store concurrency are undocumented for BOTH outlines, and only the main plan builds the empirical identity scaffolding before flipping; B makes the least-documented corner (hoist patterns) load-bearing, leaves both pre-existing bugs in place, muddies identity semantics (root-hoisted copy vs workspace symlink can disagree), and still requires every deferred refactor plus a bridge-unwind to reach `hoist = false`. Consumers-first stands.

## Regen-review gate, consolidated missing items

Added/removed names; integrity + resolved-URL equality for the frozen scopes; diff review for prod-bundle/@aztec-subtree moves irrespective of semver class; stale-excludes removal so min-age verification is meaningful; record the post-regen `bun pm ls --all` duplicate-count for the Aztec/Noir set (pre-consult asked; the draft dropped it).

## What looks fine

The inventory (every file:line verified); `@nulo/resolve-asset` as a new bottom-layer package (layer-ban makes vite.shared.ts unshareable; in-place ×6 re-arms the drift class); B1/B2 stacking with standalone-valuable B1 + clean abort; identity tests under both linkers; `hoist = false` out-of-arc; forge-not-in-CI and CI-cache claims consistent.
