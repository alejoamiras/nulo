# Phase 1 — dependencies, gate exemptions, aliases (2026-09-15)

## What landed

- `@alejoamiras/presto@5.2.0-revision.2` added next to the accelerator pin in `packages/aztec-runtime` and `apps/extension`; `@alejoamiras/presto-core@1.0.1` + `@alejoamiras/presto-banners@1.0.0` in `apps/extension`. The accelerator pin stays until P2 removes its imports.
- `bunfig.toml`: the expired accelerator exclude (2026-09-02) replaced by three dated Presto excludes, remove on/after **2026-09-16T14:49Z**.
- `renovate.json` Aztec-line rule: accelerator → presto. `scripts/aztec-hold-residue-check.ts`: `SINGLE_GENERATION_ROOTS = ["@alejoamiras/presto"]`.
- `apps/extension/src/presto/presto-core-deps.test.ts` (A8): presto-core declares no `@aztec/*`.
- Lockfile: +14 lines, only the three packages and their `@logtape/logtape@2.3.3` / `ms` nesting; `@alejoamiras/presto`'s own `@aztec/*@5.2.0` deps dedupe onto the workspace line (residue check: every `presto → @aztec/*` edge resolves 5.2.0).

## Min-age window (re-read at install time, 2026-09-15T13:33Z)

| package | published | clears the 7-day gate |
|---|---|---|
| presto-core@1.0.1 | 2026-09-08T21:27:53Z | 2026-09-15T21:28Z |
| presto@5.2.0-revision.2 | 2026-09-08T22:57:18Z | 2026-09-15T22:58Z |
| presto-banners@1.0.0 | 2026-09-09T14:48:42Z | 2026-09-16T14:49Z |

All three were inside the window at install time, so all three are exempted (F16 predicted only banners; it estimated a later install).

## npm provenance (isolated fixture, before exempting)

Fixture: an empty `package.json`, `npm install --ignore-scripts` of the three exact versions, then `npm audit signatures --json --include-attestations` → `invalid: []`, `missing: []`; all three verified with a registry signature **and** a SLSA v1 provenance statement. Decoded DSSE payloads:

| package | tarball integrity (lock) | publishing workflow | source commit |
|---|---|---|---|
| presto@5.2.0-revision.2 | `sha512-z1mpWZ6bIWKchrZHN2b0LavhW7w5837NLUkjcpn2oqNPVrBx9pTTZgwhj7MKAQjq761PacN/JoW10rHOo5FvNg==` | `alejoamiras/presto` `.github/workflows/release-sdk.yml` @ `refs/heads/main` | `f025d7802a297a2c3e578856b3102f1d539de615` |
| presto-core@1.0.1 | `sha512-9WCqrEzpS7B5CNFDese3tBLk6+gf3GHmtb+rZqLWvoLY5IIGvbWV2btqeMYL0kgClqDTJ1rry+Ev8wD/lqoE4A==` | same | `eaa62889c5b84cc474fbc493989055d09f845f24` |
| presto-banners@1.0.0 | `sha512-0igchxgggtYb1NBEtYV/epOsNLKBQ5WlInHj21kC9drrjZnzaMyvFApxSdgF3ZXovXb8VxSI13LvcR4OzP9nLg==` | same | `24bebcb0004c8b1bb11b718e9bce2bb3020160ba` |

The plan named `_publish-npm.yml` as the workflow (F25); the statements name `release-sdk.yml`, which calls it. Provenance proves origin only.

## I2 — vite alias

All three packages publish `exports["."] = { types: ./dist/index.d.ts, default: ./dist/index.js }` (`type: module`; banners also exports `./register`), so the existing `resolvePackageFile(..., "dist/index.js")` alias is not needed for Presto. The accelerator alias is deleted with the accelerator in P2; no Presto alias is added.

## Gate

| layer | command | result |
|---|---|---|
| install | `bun install --frozen-lockfile` | exit 0 |
| residue | `bun scripts/aztec-hold-residue-check.ts` | 152 `presto` edges all `ok`; **exit 1 on 2 pre-existing failures** (below) |
| lint | `bun run lint` | exit 0 (32 warnings, 5 infos — pre-existing) |
| typecheck | `bun run typecheck:all` | exit 0 |
| unit | `bun run test` | exit 0 — 471 files / 5764 tests passed (2 skipped, 7 todo), `presto-core-deps.test.ts` included |

### Pre-existing residue failure (not this plan's)

`apps/playground → @alejoamiras/private-fee-juice → @aztec/protocol-contracts` resolves 5.0.1 (two physical copies). The playground declares `private-fee-juice` but not `@aztec/protocol-contracts`, so the held package's exact peer nests the old line — exactly the case the script's header describes. Verified pre-existing: the nested lock entry `"@alejoamiras/private-fee-juice/@aztec/protocol-contracts"` is present in `origin/dev`'s `bun.lock` unchanged, the playground's lock rows are untouched by this branch, and the script is not wired into CI (no workflow references it). The migration's own closure (`SINGLE_GENERATION_ROOTS`) is clean. Fix is one declared dependency in `apps/playground/package.json` — out of this plan's scope (the dApps are "Out"); reported as an open item for the owner.
