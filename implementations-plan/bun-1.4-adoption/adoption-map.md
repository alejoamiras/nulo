# Bun 1.4 adoption map (dossier — pre-plan)

Analyzed 2026-08-24 against Bun 1.3.14. Source of truth: the [Bun 1.4 changelog](https://bun.com/blog/bun-v1.4.md) — re-fetch it rather than trusting this summary for exact flag semantics. This dossier is the standing reference for four `/blueprint` arcs (A–D below); each arc runs its own blueprint at the stated tier and supersedes this file's detail with its own `plan.md`.

## Verdict

The bump is low-risk (Bun-API surface is tooling-only) and the wins are in the package manager, the test-runner story, and CI mechanics — not the flashy runtime APIs. Headliners: the isolated-linker **global virtual store** (up to 7× faster warm installs; CI never caches `node_modules` and this machine runs many worktrees), **Vitest officially running under the Bun runtime**, and new `bun pm` commands that slot into the existing supply-chain posture.

## Repo facts that shape the work

- Vitest 4.1.9 owns every workspace test suite and currently runs under **Node** (the `vitest` bin's shebang; `bun run` respects it). `bun:test` exists only in `scripts/release/` + `scripts/ci-cd/`.
- E2E is Vitest + Puppeteer (never Playwright); the network-suite supervisor `apps/extension/tests/e2e/global-setup.ts` runs *inside* Vitest → under Node → cannot use `Bun.*` APIs until the e2e configs move runtimes.
- All app builds are Vite 8 (crxjs MV3, bespoke WASM-emit plugins). Vite is **not** replaceable by `bun build` — no Vue SFC support, no MV3 pipeline. Out of scope permanently.
- `bunfig.toml` pins `linker = "hoisted"` (isolated broke the `@aztec/*` remap, the `resolvePackageFile` walker in `apps/extension/vite.shared.ts`, and bridge-core deploy paths) and `minimumReleaseAge = 604800`.
- `bun.lock` is text, `lockfileVersion: 1`, `configVersion: 1`.
- Bun version pin surface: `package.json#packageManager`, `.github/actions/setup-bun/action.yml` (version + 2 cache-key occurrences), a **duplicated inline pin** in `.github/workflows/pr-quick.yml`'s commitlint job (version + 2 cache keys), plus CLAUDE.md prose.
- Already Bun-native today: `scripts/release/{auto-unstick-run,open-sync-pr-run}.ts` (`Bun.$`), `packages/design/scripts/gen-tokens.ts` (`Bun.write`), `scripts/lockfile-exception-diff.ts` (`Bun.file`), `Bun.YAML` in `scripts/ci-cd/behavior-gating.test.ts`.

## Pre-flight checks already cleared (2026-08-24 read of the breaking changes)

- `Bun.YAML` YAML-1.2 semantics (`on:` → string key) shipped in 1.3.5 — already live on 1.3.14; `behavior-gating.test.ts` is unaffected.
- Strict-TOML `bunfig.toml` parsing: our values are quoted/typed correctly.
- Isolated-linker default flip: only affects new lockfiles; ours pins hoisted explicitly.
- Node 26 / `NODE_MODULE_VERSION 147`: only bites native addons loaded under Bun; Vitest/Puppeteer run under Node today.
- `bun update` breaking changes (errors on unknown names; overrides/catalog edits fail frozen installs): compatible with current workflow.

## Arc A — `/blueprint light` — `bun-1.4-bump` (Tier 0 + Tier 1)

1. Bump 1.3.14 → latest 1.4.x across the full pin surface; **fold pr-quick.yml's inline setup-bun copy into the composite action** (also fixes CLAUDE.md's incomplete drift warning).
2. `lockfileVersion: 2` rewrite isolated in its own commit. (Nested overrides/catalogs would make it v3, unreadable by older Bun — avoid until wanted.)
3. Grep the `bun:test` suites for `resetAllMocks` (now also resets implementations) and `toContain` (`===` instead of `Object.is`) assumptions.
4. Expect `bun audit` to surface **new** findings — 1.4 scans all workspace packages, not just root. Triage; never silence.
5. Verify whether 1.4's `bun update` applies the `minimumReleaseAge` gate to transitives → if yes, retire the Bun-bug-#25305 workaround from `bunfig.toml` comments + `SECURITY.md`.
6. Cheap wins in the same arc: `bun run --parallel` for `audit:vue` (`typecheck:all`/`test`/`lint` concurrent, `build` after) and `dev:full` (drop the `concurrently` dep); `bun dedupe --check` in `_lint-and-typecheck.yml`; retest the renovate-config-validator `npx` hold-out as `bunx` (`re2` native binding segfaulted under 1.3's loader; 1.4 rewrote the loader + N-API); document `bun pm diff` / `bun audit fix --dry-run` / `bun pm licenses` / `bun pm ls --trusted` in the dep-review workflow.
7. **MUST NOT touch any `@aztec/*` pin** — no frozen-account surface in play.

## Arc B — `/blueprint mid` — `isolated-linker-store`

Branch experiment: `linker = "isolated"` + global virtual store. 1.4 changes the old blockers' math: `hoistPattern`/`publicHoistPattern` per-pattern hoisting, 8× faster peer resolution under isolated, self-link/duplicate-optional-peer/patch-reapplication fixes, and the `patchedDependencies` cache now keyed by full-file SHA-1 (we patch two `@aztec/noir-*` packages).

- Use a hoist pattern for `@aztec/*`; adapt `resolvePackageFile` to the `node_modules/.bun` layout; validate bridge-core deploy scripts.
- **Gate**: `audit:vue` + `test:e2e` + one network-e2e shard green, plus before/after cold+warm install timings (root and one worktree).
- **Abort criterion**: if `@aztec` resolution can't be made sound with hoist patterns, keep hoisted and close the arc as *rejected with evidence* in lessons.

## Arc C — `/blueprint mid` — `vitest-on-bun`

Move Vitest suites to `bun --bun vitest run`, package by package, in the codex-corrected order (`wallet-crypto` is jsdom, not pure-node — see lessons/pre-arc-consults.md): `landing` (tiny node control) → low-complexity node packages → `bridge-core` (node, heavy Aztec/WASM graph) → leaf jsdom packages → Vue suites → extension aggregate. E2E configs stay on Node in this arc. 1.4 claims Vitest works including `--coverage` (V8 provider via `node:inspector`) and both pools; the Vite-8-under-Bun blockers (`dns.promises` exports, `pipe()` drain) are fixed.

- Watch: bb.js-WASM exclusions, coverage parity, and 1.4's bun-as-node **no longer auto-loading `.env`**.
- A package flips only after two consecutive green runs; any flake delta → investigate before proceeding.

## Arc D — `/blueprint light` — `bun-native-tooling` (after C; bridge-core parts anytime)

- `node:child_process` → `Bun.$`/`Bun.spawn` in `packages/bridge-core/scripts/*` (`live-intent.ts`, `portal-artifact.ts`, `verify-l1.ts`, deploy scripts). `Bun.$` interpolation is literal-by-default — a security upgrade over the `execFileSync` pattern, but verify `cast`/`forge` invocations keep non-shell argument passing.
- The e2e supervisor (`global-setup.ts`, `lockfile.ts`, `reap.ts`) migrates **only** if Arc C moved the e2e configs to Bun. Then adopt: `spawnSync({ detached })` (now actually forwarded), live `process.ppid` getter, `child.kill()` false-on-dead, and evaluate `--no-orphans` — it SIGKILLs all descendants on parent death; confirm it cannot kill another agent's processes before enabling (run-isolation ownership rules).

## Open questions → resolve via codex (`/codex` at xhigh), log consults in the owning arc's `lessons/`

1. ~~hoistPattern strategy for `@aztec/*` under the isolated linker (Arc B)~~ **RESOLVED** ([lessons/pre-arc-consults.md](lessons/pre-arc-consults.md)): make consumers layout-agnostic FIRST on hoisted, then flip; hoist patterns are an emergency bridge only. **Arc B correction**: the consumer list is wider than bunfig's three (also sqlite3mc emission, `extract-bb-wasm.ts`, `opfs-store.test.ts`, bridge-core artifact walkers); patched noir packages stay project-local by design.
2. ~~jsdom suites on the Bun runtime (Arc C)~~ **RESOLVED** (same file): probe now, promote package-by-package with a retry-0 flake baseline (N=30 small / N=10+30 extension) — two greens is smoke, not proof. **Arc C correction (verified)**: `wallet-crypto` is a jsdom suite, NOT pure-node; corrected order: `landing` (node control) → low-complexity node → `bridge-core` → leaf jsdom → Vue suites → extension aggregate.
3. ~~`bun dedupe --check` blocking vs advisory (Arc A)~~ **RESOLVED**: advisory (Arc A audit, `../bun-1.4-bump/audit-codex.md`).
4. `--no-orphans` compatibility with multi-agent run isolation (Arc D) — consult inside Arc D's blueprint.
5. ~~Transitive `minimumReleaseAge` verification method (Arc A)~~ **RESOLVED**: mock-registry positive-control probe (Arc A audit; executed in Arc A Phase 5).

## Explicitly NOT moving

Vite (all apps), Puppeteer (e2e), the extension's OPFS `sqlite3mc` WASM store (browser-side by necessity), `Bun.Image`/`Bun.markdown`/`Bun.cron`/`Bun.Terminal`/`Bun.WebView` (no matching surface; WebView cannot load MV3 extensions), `bun test --changed` for required CI gates (local convenience only).

## Hard limits (all arcs)

Never weaken quality gates; no linker change merges to dev without Arc B's gate fully green; no `@aztec/*` version changes; network e2e runs solo on this host + clean re-run before triage; PR titles ≤93 chars; lockfile churn always its own commit; conventional commits + stacked PRs per each plan's Delivery section; keep `implementations-plan/index.md` current.

## Goal seed

The `/goal` seed string that drives this dossier is embedded below for re-use.

```
/goal Bun 1.4 adoption across nulo — plan and ship it arc by arc.

READ FIRST: implementations-plan/bun-1.4-adoption/adoption-map.md (full dossier: repo facts, per-arc scope, open questions, gates). If it is missing on your branch it lives uncommitted in the canonical clone — read it there and commit it with Arc A. Changelog source of truth: https://bun.com/blog/bun-v1.4.md. Current pin: bun@1.3.14.

MISSION — four arcs, each homed via its own /blueprint at the stated tier, in order (B ∥ C after A):

ARC A — /blueprint light — "bun-1.4-bump": bump to latest 1.4.x across the 4-file pin surface (package.json#packageManager, setup-bun action version+cache keys, pr-quick.yml's duplicated inline pin — fold into the composite, CLAUDE.md prose); lockfileVersion-2 rewrite as its own commit; grep bun:test suites for resetAllMocks/toContain assumptions; triage (never silence) new bun audit findings — it now scans all workspaces; verify whether bun update now applies the min-age gate to transitives → retire the #25305 workaround from bunfig.toml + SECURITY.md if so. Same arc: bun run --parallel for audit:vue + dev:full (drop concurrently); bun dedupe --check in _lint-and-typecheck.yml; retest renovate npx→bunx (re2 loader segfault); document bun pm diff / bun audit fix --dry-run / bun pm ls --trusted in the dep-review workflow. MUST NOT touch any @aztec/* pin.

ARC B — /blueprint mid — "isolated-linker-store": branch experiment, linker="isolated" + global virtual store (7× warm installs). hoistPattern for @aztec/*; adapt resolvePackageFile (apps/extension/vite.shared.ts) to the node_modules/.bun layout; validate bridge-core deploy scripts. Gate: audit:vue + test:e2e + one network shard green + before/after install timings. Abort: if @aztec resolution can't be made sound, keep hoisted and close as "rejected with evidence" in lessons.

ARC C — /blueprint mid — "vitest-on-bun": move Vitest suites to bun --bun, package by package: pure-node (wallet-crypto, bridge-core) → jsdom → extension unit suite; e2e configs stay on Node this arc. Watch bb.js-WASM exclusions, coverage parity, bun-as-node no longer loading .env. Flip a package only after two consecutive green runs; any flake delta → investigate first.

ARC D — /blueprint light — "bun-native-tooling": node:child_process → Bun.$/Bun.spawn in packages/bridge-core/scripts/* (keep non-shell arg passing for cast/forge). The e2e supervisor migrates ONLY if Arc C moved e2e configs to Bun; then adopt spawnSync{detached} + live ppid, and evaluate --no-orphans (confirm it can't kill other agents' processes first).

CODEX: resolve the dossier's open questions independently via /codex at xhigh (min set: @aztec hoistPattern strategy; jsdom-on-Bun readiness; dedupe --check blocking vs advisory; --no-orphans vs multi-agent isolation; transitive min-age verification method). Advisory only; log every consult + verdict in implementations-plan/<plan>/lessons/. Pre-flight codex login status; surface logouts immediately.

HARD LIMITS: never weaken quality gates; no linker merge to dev without Arc B's gate fully green; no @aztec/* changes; network e2e runs solo + clean re-run before triage; PR titles ≤93 chars; lockfile churn its own commit; conventional commits + stacked PRs per plan Delivery; keep implementations-plan/index.md current.
```
