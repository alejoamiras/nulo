# Phase 2 — Global-store probes (scratch) + posture memo

All cells run against bun 1.4.0 with isolated scratch projects + isolated `BUN_INSTALL_CACHE_DIR` (never the machine cache, except one read-mostly default-behavior cell).

## Semantics cells (settle the round-1/final-pass unknowns)

| Cell | Result |
|---|---|
| `globalStore` bunfig syntax | **`[install] globalStore = true` is valid** and effective. |
| Default under `linker = "isolated"` | **Global store is OFF by default** — `node_modules/.bun/<pkg@ver>` are REAL directories (hardlinked content), both with a custom cache dir AND with the machine's default cache. The blog's "now uses a shared global virtual store" is the opt-in capability, not the default. |
| `globalStore = true` layout | `node_modules/.bun/<pkg@ver>` become SYMLINKS → `<CACHE>/links/<pkg@ver>-<hash>`. **The global store lives INSIDE the install cache directory.** |
| CI-cache cell (final-pass F-1) | **CONFIRMED**: `actions/cache` restore of `~/.bun/install/cache` restores `links/` — live extracted store state — whenever globalStore is on in CI. |

## Stress cells (sharing mode, `globalStore = true`)

- **Concurrency**: 6-way SIMULTANEOUS installs (overlapping dep sets, shared cold store) × 3 rounds → 18/18 exit 0, then 18/18 `--frozen-lockfile` re-verifications. No corruption observed.
- **Interruption**: SIGKILL at 15ms into a cold-store install → next plain install exit 0, frozen verify exit 0. No poisoned half-state observed.
- **Two DIFFERENT patches of one package** (`ms@2.1.3`, distinct markers) sharing one store: each project sees ITS OWN patched content; zero cross-contamination — the 1.4 SHA-1 patch-key fix works as documented.
- Framing per the audits: this is empirical risk ACCEPTANCE evidence, not an atomicity proof.

## Posture memo (the decisions Phase 3/5 execute)

1. **Committed repo default: `linker = "isolated"` WITHOUT `globalStore`** (hardlink-local store). CI therefore never creates or consumes `links/` — the F-1 exposure is avoided by construction rather than mitigated; no workflow edits needed. Release builds keep today's properties.
2. **The global store becomes a per-machine, user-level opt-in** for worktree-heavy dev boxes (`~/.bunfig.toml` `[install] globalStore = true` — project bunfig wins only on keys it SETS, so leaving the key unset delegates it; Phase 3 verifies the user-level merge empirically before recommending it). Phase 5 measures BOTH modes' timings; if hardlink-local already delivers the win, the opt-in recommendation may be dropped entirely.
3. **Honesty note on the mutation surface**: same-UID shared-content exposure is NOT introduced by the global store — bun's default `--backend hardlink` already shares cache inodes with every project's node_modules TODAY (hoisted included). globalStore changes reach (symlinked farms make cross-project blast radius larger and CI-restorable), not the fundamental boundary. The identity/lockstep tests + wasm-hash comparisons are the standing verification either way.
4. Registry-mutex fallback: NOT needed on this evidence (18/18 + interruption recovery); noted as available if real-world use ever contradicts the probes.
