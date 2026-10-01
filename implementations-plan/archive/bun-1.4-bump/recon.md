# Recon — bun-1.4-bump (Arc A of the Bun 1.4 adoption goal)

Consolidated from four parallel read-only explorers (config/scripts, test landscape, CI, build/runtime) run against dev, re-verified at this worktree's base (dev @ ea9be876), plus empirical probes with an isolated Bun 1.4.0 binary. Parent dossier: [adoption-map.md](../bun-1.4-adoption/adoption-map.md).

## The pin surface (verified at base)

| Site | Content |
|---|---|
| `package.json:44` | `"packageManager": "bun@1.3.14"` |
| `.github/actions/setup-bun/action.yml:17` | `bun-version: 1.3.14` |
| `.github/actions/setup-bun/action.yml:22,24` | cache key/restore-key embed `bun-1.3.14` |
| `.github/workflows/pr-quick.yml:201,205,207` | **duplicated inline pin** in the `commitlint` job (same three occurrences) |
| `CLAUDE.md:30` | prose "Pinned to `1.3.14` …" |
| `CLAUDE.md:62` | Renovate drift note — lists only 2 of the 3 pin files (misses pr-quick.yml) |

**Fold safety**: the commitlint job runs `actions/checkout@v7` (fetch-depth 0) at `pr-quick.yml:196-198` *before* its inline setup block, and the composite (`action.yml:2-7`) requires exactly that — callers checkout first. Replacing the three inline steps (`oven-sh/setup-bun`, `actions/cache`, `bun install --frozen-lockfile`) with `uses: ./.github/actions/setup-bun` is behavior-identical.

## Reuse-as-is

- `.github/actions/setup-bun` composite — the canonical bootstrap; the fold *increases* its reuse. Cache keys embed the version by design (bump invalidates stale state).
- `bun run --filter '@nulo/*'` fan-outs (`typecheck:all`, `test:all`) — already the workspace mechanism `--parallel` composes with.
- `scripts/ci-cd/behavior-gating.test.ts` — parses workflow YAML via `Bun.YAML.parse`; YAML-1.2 semantics landed in Bun 1.3.5, already live. Guards the paths-filter ↔ dependency-graph mapping; must stay green after workflow edits.
- `bun run lint:actions` (actionlint) — the local gate for any workflow change.

## Adapt-with-changes

- `package.json:35` `audit:vue` = `typecheck:all && test && lint && build` — first three legs are mutually independent (per-package tsc/vue-tsc; extension vitest; biome). Parallelize legs 1–3, keep `build` after.
- `apps/extension/package.json:14` `dev:full` = `concurrently "bun run dev:chrome" "bun run dev:firefox"`; `concurrently@^10.0.3` at line 93 is used **nowhere else** → replace + drop the dep.
- `.github/workflows/_lint-and-typecheck.yml:76-77` — `npx --yes --package renovate@43.150.0 -- renovate-config-validator …` with an in-file comment citing the re2-under-bun segfault (Bun 1.3.x).
- `bunfig.toml:37-42` — the #25305 comment block + `minimumReleaseAge = 604800`.
- `SECURITY.md` "Dependency policy" — home for the #25305 outcome + the new pm-command review workflow.

## Empirical probes (isolated Bun 1.4.0 at `~/.bun-versions/1.4.0/bin/bun`; machine-wide bun untouched at 1.3.14)

1. `bun run --help` confirms `--parallel`, `--sequential`, `--no-exit-on-error`.
2. `bun dedupe --check` on the current lockfile: **4 duplicate versions exist** (incl. `mime-db 1.54.0 → 1.52.0`, `string_decoder 1.3.0 → 1.1.1`) — a blocking CI check requires a prior `bun dedupe` run, and dedupe resolves to the range-intersection version, which here means *downgrades*.
3. `bun test scripts/release/ scripts/ci-cd/` under 1.4.0: **94 pass / 0 fail** with zero edits — empirically clears the `resetAllMocks` (0 uses) / `toContain` (strings only) / `Bun.$` / `Bun.YAML` behavior-change surface.
4. `bunx --package renovate@43.150.0 renovate-config-validator --strict --no-global renovate.json` under 1.4.0: **"Config validated successfully"** — the re2 native addon loads; the npx holdout can be retired.
5. `bun.lock` head: `lockfileVersion: 1, configVersion: 1` — the v2 rewrite happens on first 1.4 install.

## Collision / dedup risks

- **Do not** touch `@aztec/*` pins, `patchedDependencies`, or `minimumReleaseAgeExcludes` — Arc A is version-neutral for all deps except removing `concurrently`.
- The lockfile is written by three distinct causes in this arc (v2 migration, `bun dedupe`, `concurrently` removal) — keep them in **separate commits** so each diff is auditable.
- `.github/workflows/pr-quick.yml` is also the Quality required-check workflow — edits must keep `bun run lint:actions` + `behavior-gating.test.ts` green (paths-filters untouched by this arc).
- CI cache keys change with the version string — first post-merge runs repopulate caches (expected, by design).
- Local dev machines keep bun 1.3.14 globally; `bun run --parallel` scripts require ≥1.4 locally. Machine-wide upgrade is deliberately out of scope (shared multi-agent binary) — surfaced in the plan's Asks.
