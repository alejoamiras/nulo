# Phase 5 — Renovate bunx swap + workflow permissions + #25305 verification

## bunx swap + permissions

- `_lint-and-typecheck.yml`: top-level `permissions: contents: read` added (was inheriting repo default); validator step swapped `npx --yes --package renovate@43.150.0 --` → `bunx --package renovate@43.150.0`, comment rewritten to record the retest and the A4 acceptance (floating transitive closure — identical exposure to the npx incumbent).
- Probes: WARM cache — "Config validated successfully". COLD cache (fresh `BUN_INSTALL_CACHE_DIR`, full 1703-package re-download) — "Config validated successfully". The re2 native binding that segfaulted under Bun 1.3.x loads cleanly on 1.4's Node-26 addon line.

## #25305 mock-registry probe (positive-control design per the codex audit)

Setup: local `Bun.serve` registry (ephemeral port) serving `nulo-probe-parent-25305` + `nulo-probe-child-25305`, each with 1.0.0 (timestamped now−30d) and 1.1.0 (now−1d); both parent versions depend on `child: ^1`; packuments carry full `time` fields; tarballs integrity-hashed; per-runtime isolated `BUN_INSTALL_CACHE_DIR` (never the real cache — fake names kept out of it anyway).

| Cell | 1.3.14 | 1.4.0 |
|---|---|---|
| Seed install, NO gate | parent 1.1.0 / child 1.1.0 | parent 1.1.0 / child 1.1.0 |
| Gated `update --latest` on that (already-latest) lock | parent **downgraded** to 1.0.0, child stays 1.1.0 → **the #25305 asymmetry reproduced** (directs re-gated, transitives not) | both stay 1.1.0 → 1.4 never re-gates existing lock entries (docs-consistent; no surprise downgrades) |
| FRESH gated install (new resolution) | 1.0.0 / 1.0.0 ✅ | 1.0.0 / 1.0.0 ✅ |
| **Gated `update --latest` FROM the old (1.0.0/1.0.0) lock — the decisive cell** | 1.0.0 / 1.0.0 (but 1.3 update didn't move transitives at all — vacuous) | **1.0.0 / 1.0.0 — the gate blocks BOTH direct and transitive from moving to the young 1.1.0** |

Verdict: **#25305 is closed on 1.4.0** — when a gated update actually re-resolves, transitives go through the gate. The "delete bun.lock first" workaround is retired from bunfig.toml. Documented nuance (by design, not a bug): update never re-gates versions already present in the lockfile, so evicting an already-locked too-young version still requires a deliberate regeneration.

Probe engineering note: first driver version deadlocked — `Bun.spawnSync` blocks the event loop that `Bun.serve` (the registry) runs on; the child's registry requests waited on ourselves. Fixed with async `Bun.spawn` + `await exited`. Filed in memory for future in-process-server + subprocess probes.

## Bonus retest: the Bun 1.3.1 frozen-lockfile gate anomaly

`minimumReleaseAge = 1209600` (14d) + `bun install --frozen-lockfile` under 1.4.0 against this repo's real lockfile: **"no changes", exit 0** — the anomaly that forced the 7d ceiling is gone. bunfig comment updated: widening to 14d is now viable as a deliberate owner policy change (NOT done in this arc).

## Gate

bunfig parses (strict-TOML 1.4) + frozen install green · `bun run lint:actions` exit 0 · warm+cold validator green · full probe matrix above.
