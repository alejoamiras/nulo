# Pre-arc codex consults (dossier open questions)

Consults run ahead of the Arc B/C blueprints so both start pre-armed. Advisory only; each future arc's blueprint re-audits its own plan. Verdicts below were fact-checked against the repo before adoption.

## 2026-08-24 — Q1 (Arc B: @aztec hoistPattern strategy) + Q2 (Arc C: jsdom-on-Bun readiness)

Codex session `01a0342f-c4eb-7093-84ab-e9d530a4c20e` · gpt-5.6-sol · xhigh · read-only. (Arc A's separate audit: see `../../bun-1.4-bump/audit-codex.md`.)

### Q1 ruling — consumers-first, hoist patterns are a bridge not a target

**Adopted for the Arc B plan:**
- Make every layout-sensitive consumer **layout-agnostic FIRST, while still on the hoisted linker** (zero-risk refactor), THEN flip the linker. `publicHoistPattern` recreates the phantom-dependency API and can select wrong versions across diverging workspaces; keep it only as an emergency bridge.
- Centralize package-root resolution: `createRequire` anchored at the **declaring workspace**, resolve an exported entry, walk up to the matching `package.json`, then append the unexported asset path (never resolve blocked subpaths directly). Consumers beyond the three named in bunfig: `vite.shared.ts` (`resolvePackageFile` + `noirAliases`), the sqlite3mc emission in `vite.config.ts`, `extract-bb-wasm.ts`, `opfs-store.test.ts`, bridge-core's artifact walkers; foundry gets a generated (gitignored) remappings file resolved from bridge-core.
- Gates: per-asset identity assertions (logical path + realpath + declaring workspace — "exists" is not "correct copy"); patched noir packages must realpath to a PROJECT-LOCAL store (Bun excludes patched packages from the global store) and contain patch markers; three-step clean-install matrix hoisted → isolated/local-store → isolated/global-store; `bun pm ls --all` + peer-set + bundle-metadata comparison for duplicate Aztec/Noir copies; forge build + deploy-script dry runs.
- Concurrency: same-user local-FS global store is designed safe (atomic renames, ignored staging trees) — many parallel worktree installs OK; avoid multi-UID/NFS sharing and concurrent `bun pm cache rm`.
- No `configVersion` flip expected (already 1). `hoist=false` is a later strictness step, not part of the first flip.
- Note: codex's bun.com/docs citations are post-cutoff and unverified; rulings adopted on argument strength.

### Q2 ruling — probe now, promote package-by-package; the vitest claim is not a jsdom certification

**Adopted for the Arc C plan:**
- **Dossier correction (verified)**: `wallet-crypto` is a **jsdom** suite (`packages/wallet-crypto/vitest.config.ts:12`), not pure-node; `bridge-core` is node but loads a heavy Aztec/WASM graph. Corrected ordering: tiny node control (`landing`) → low-complexity node packages → `bridge-core` → leaf jsdom packages → Vue suites → extension aggregate. Puppeteer e2e stays on Node.
- Pin the real matrix before judging: lockfile resolves **vitest 4.1.10** (manifests say ^4.1.9 — verified bun.lock:2250); add the exactly-matching `@vitest/coverage-v8` before coverage comparisons.
- Probe classes, cheapest-first: jsdom/Node-surface smoke (DOM + fetch/AbortSignal/URL/Blob/WebCrypto/storage + one real Vue mount); pools (2 tiny files under threads AND forks, assert `process.versions.bun`, capture output/unhandled rejection/worker exit); transform server (SFC + CSS + alias + workspace TS + dynamic import); fake-timer leak across 2 files + nextTick ordering; hoisted `vi.mock`/`vi.hoisted`/`resetModules` + one Aztec workspace dep; source-map sentinel throw (assert filename+line); coverage parity (identical shard Node vs Bun, JSON output, identical file sets/locations/totals).
- **Two consecutive greens is smoke, not proof**: retry-0 flake baseline — Node baseline vs Bun candidate, N=30 for small packages; extension: N=10 full runs + N=30 of the concurrency/timer/mock shard with varied seeds. Reject crashes/hangs/unhandled errors or any Bun flake rate above the Node baseline.
- Don't wait for an arbitrary 1.4.x: a failed probe keeps that package on Node and produces a minimal upstream reproducer.

### Still-open dossier questions

- Q3 (dedupe --check blocking vs advisory): **resolved in Arc A's audit — advisory** (see `../../bun-1.4-bump/audit-codex.md`).
- Q5 (transitive min-age verification method): **resolved in Arc A's audit — mock-registry positive-control design**, executed in Arc A Phase 5.
- Q4 (--no-orphans vs multi-agent isolation): open — consult scheduled inside Arc D's blueprint (needs Arc C's outcome to know which processes even run under Bun).
