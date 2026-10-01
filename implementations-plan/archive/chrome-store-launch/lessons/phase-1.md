# Phase 1 — Icons and store name

## What changed

- `apps/extension/package.json`: `displayName` → `Nulo V5` (description unchanged, 123 chars, within Chrome's 132).
- `apps/extension/scripts/store-icons.ts` (+ `store-icons.test.ts`): renders `src/assets/icons/{16,32,48,96,128}.png` from `src/assets/logo.png` with `Bun.Image`; `--check` re-renders in memory and fails on a byte difference.
- `apps/extension/manifest/manifest.config.ts`: `icons` → the five generated files (was 16/24/32/128 all pointing at the 512×512 logo). Firefox inherits the map.

## Findings

- **`Bun.Image` cannot pad.** Its prototype has `resize`, `png`, `bytes`, `toBuffer`, `blob`, `write`, `metadata`; no compose or canvas. The 128 icon is therefore a plain resize of the square master, not 96×96 art on a 128 canvas (Chrome's padding guidance is a recommendation). Recorded here as the plan asked.
- **`png()` returns an `Image`, not bytes** — `await img.resize(n, n).png().bytes()` is the call; `new Uint8Array(await img.png())` is silently empty (length 0).
- Rendering is deterministic (two renders of the same size are byte-equal), so the drift check is meaningful.
- Local Bun is 1.4.0 (the repo pins 1.4.2); no behaviour difference seen in this phase.

## Validation gate

Run exactly as written in `plan.md`, in sequence:

| Layer | Command | Result |
|---|---|---|
| typecheck | `bun run --cwd apps/extension typecheck` | exit 0 |
| unit | `bun run --cwd apps/extension test -- scripts/store-icons src/manifest` | 2 files, 15 tests passed |
| lint | `bun run lint` | exit 0 (33 pre-existing warnings, complexity baseline OK) |
| build ×2 | `bun run --cwd apps/extension build:full` | exit 0; both `dist/*/manifest.json` have `name: "Nulo V5"` and `icons` = the five paths; `file` reports 16×16, 32×32, 48×48, 96×96, 128×128 RGBA in both bundles |
| add-on linter | `bunx web-ext@10.6.0 lint --source-dir apps/extension/dist/firefox --self-hosted` | errors 0, notices 0, warnings 10 (3 `DANGEROUS_EVAL`, 3 `UNSAFE_VAR_ASSIGNMENT`, 4 `UNSUPPORTED_API`), **0 `ICON_SIZE_INVALID`** (was 4) |
| smoke e2e | `cd apps/extension && NULO_E2E_ARTIFACT_RUN=1 EXTENSION_PATH="$PWD/dist/chrome" bun run test:e2e` | 32 files passed, 4 skipped; 130 tests passed, 14 skipped; 691 s; exit 0 |

Phase 1 gate: **pass**.
