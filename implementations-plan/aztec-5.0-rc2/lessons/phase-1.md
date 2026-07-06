# Phase 1 ✓ — bump + install + typecheck

## What shipped
- ~20 `@aztec/*` pins → `5.0.0-rc.2` across the 7 package.json; `@alejoamiras/aztec-accelerator` → rc.2 (kills the mixed-set transitive drag); the 8 Wonderland pins → `@alejoamiras/{aztec-standards,aztec-fee-payment}@5.0.0-rc.2` (npm takeover scope) + import-specifier rename across the 16 TS files + the `fuel-testnet.ts` node_modules path segments. `@aztec/viem` untouched.
- Both patches re-keyed (`@5.0.0-rc.1` → `@5.0.0-rc.2`, file renames + `patchedDependencies` keys); applied cleanly on install.
- `bunfig.toml`: `minimumReleaseAgeExcludes` = the enumerated 30-name `@aztec/*` set (transitives included — the gate bites any fresh resolution) + the 3 `@alejoamiras/*`; dated, removal-follow-up noted.
- `bun.lock` delete + re-resolve. **Allowlist verified:** all non-Aztec moves are in-range `^` refreshes (the known Bun #25305 tradeoff; precedent PR #178); apparent "majors/downgrades" were multi-copy pairing artifacts. Odd new transitives traced benign (`anynum`/`is-unsafe`/`@nodable/entities` ← fast-xml-parser 5.9; `hash-base` ← crypto-browserify). **Zero `5.0.0-rc.1` entries remain.** `--frozen-lockfile` re-install green (CI equivalence).

## The two real findings

### 1. Bun 1.3.13 fresh-lockfile → ISOLATED linker (footgun)
A deleted lockfile made `bun install` default the workspace to the **isolated** linker (`.bun` store + per-workspace symlink trees): root `node_modules/@aztec` empty, phantom deps broken (`@aztec/standard-contracts` imports in aztec-runtime), and the repo's hoisting assumptions dead (the foundry `@aztec/` remap, `resolvePackageFile` walkers, deploy-script `node_modules/...` joins). **Fix: `linker = "hoisted"` pinned in `bunfig.toml`** + clean reinstall. Anyone deleting bun.lock hits this.

### 2. The actual rc.2 API churn (all mechanical, behavior-identical)
- `AztecAddress.{fromString,fromNumber,fromBigInt,fromField}` → `…Unsafe` variants (~146 call sites; upstream naming-honesty rename — the old ones never validated curve membership either; validation remains the separate async `isValid()`). Class-qualified perl rename; zero leftovers.
- PXE senders folded into **tagging-secret sources**: `registerSender(a)` → `registerTaggingSecretSource({kind:"address-derived", sender:a})`, `getSenders()` → `getTaggingSecretSources({kind:"address-derived"}).map(s=>s.sender)`, `removeSender(a)` → `removeTaggingSecretSource(…)`. Ported inside `PxeService` only — our service's own RPC surface unchanged, no consumer ripple.

## Gates (green)
`bun install` 0 (patches applied, min-age holds on non-excluded) · lockfile allowlist + `rg -c '5\.0\.0-rc\.1' bun.lock` = 0 · `bun run typecheck:all` **exit 0**.
