# Phase 5 — Payoff measurement + full validation + keep/abort

## Payoff, measured (fresh-checkout cold installs, Linux ext4, warm download cache)

| Mode | Wall |
|---|---|
| hoisted (`--linker=hoisted`) | 1.17s |
| **isolated, per-project store — the COMMITTED default** | **1.22s** (a wash) |
| isolated + `globalStore = true` (per-machine opt-in), populated | **0.36s** (≈4× hoisted) |

The blog's headline (7×) is a macOS `clonefileat` + global-store number. On this host the committed default buys **no install speed**; the speed exists only in the opt-in global-store mode, which the Phase 2 posture keeps OFF the committed config (so CI never creates/restores a shared symlink store).

## What the arc actually delivers (the honest keep case)

1. **Phantom dependencies eliminated**: `@aztec/sqlite3mc-wasm` (a production-bundle asset source located by hoisting luck) and `zod` (on bridge-core's barrel export) are now declared; the isolated linker makes any future phantom a hard install-time failure instead of a latent CI/prod hazard.
2. **Layout-agnostic tooling**: six drifted root-walking resolvers → one `@nulo/resolve-asset` (search-path scan over documented Node semantics, root-containment guard, exports-map-independent); `noirAliases`, the foundry remap (generated + `forge remappings`-asserted), and a renamed-package dead path in `fuel-testnet.ts` fixed.
3. **Executable identity guarantees**: `layout-identity.test.ts` (6 assertions incl. patch markers on the patched noir packages and the sqlite3mc↔kv-store lockstep) runs in the aggregated suite forever, under either linker.
4. **The lockfile regeneration Arc A deferred, done wallet-grade**: v2 lock; exemption-free 7d gate (youngest move 7.4d; 0 unprovenanced); 0 frozen-scope changes; advisories 40 → 23 (22 → 10 high).
5. One genuine layout consumer the inventory missed (`observability.test.ts`'s hardcoded root `.bin/vitest`) — caught by the Phase 3 gate, fixed; proof the gates work.

## Costs / residual risks (the honest abort case)

- Local minimum bun stays 1.4 (already true since Arc A); `bun.lock` v2 is now unreadable by Bun ≤1.3 — the fleet is already on 1.4.0.
- Symlinked `node_modules` is a layout every dev tool must tolerate: vite 8/rolldown + @crxjs builds, vite dev (`/@fs/` serving), vitest jsdom + forks pools, storybook, forge — all exercised green in Phases 3–5.
- The global store, if a developer opts in, is a same-UID shared surface (Phase 2 memo: empirical acceptance, not proof; 18/18 stress + interruption + patch-isolation held).

## Storybook build smoke
_(appended below when run)_

## Network shard (solo)
_(appended below when run)_

## Decision
_(recorded after the codex convergence gate)_

## Storybook build smoke — DONE
`bun run --cwd apps/extension build-storybook` exit 0 under the isolated layout (Vite ✓ built in 2.29s). The "ESM syntax in a file loaded as CommonJS (retry-error-reporter.ts)" line is storybook's pre-existing warning about that reporter file — present on hoisted too, not a regression.

## Review tooling persisted
`tools/lock-records.ts` (full-record extractor + class comparator), `tools/reachability.ts` (prod-bundle closure walk from apps/extension over the lock graph), `tools/provenance.ts` (npm publish-time + attestation lookup per moved package), `tools/consumers.ts` (reverse-dependency lookup) + the review outputs (`regen-diff.txt`, `provenance.txt`). All repo-relative; usable for the next regeneration.
