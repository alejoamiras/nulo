# Recon — isolated-linker-store (Arc B, in progress)

Blueprint mid. Base: stacked on `worktree-bun-1.4-bump` @ b6e5920e (PR #452, green). Machine bun: 1.4.0. Parent dossier: [adoption-map.md](../bun-1.4-adoption/adoption-map.md); strategy pre-consult: [pre-arc-consults.md](../bun-1.4-adoption/lessons/pre-arc-consults.md).

## Part 1 — Isolated-linker / global-store semantics (changelog-verified reference, agent-extracted; quotes verified against the 1.4 release text)

- **Layout**: isolated = symlinked per-workspace `node_modules` + a `node_modules/.bun/` store; with the global virtual store, packages extract once into Bun's machine cache and are symlinked into each project's `.bun` store (one `symlink()` per package on warm installs). `node_modules/.bun/node_modules` is a documented "hidden fallback directory" for undeclared requires.
- **Hoist controls** (bunfig `[install]` or .npmrc; bunfig wins on key conflict): `publicHoistPattern = [globs]` → matching TRANSITIVES hoisted to the real root `node_modules` (visible to every workspace); `hoistPattern = [globs]` → controls what lands in the `.bun/node_modules` fallback; `hoist = false` → disables the fallback entirely (phantom `require()` = `MODULE_NOT_FOUND`, pnpm parity; 1.4.0-new).
- **configVersion**: our lockfile already records `configVersion: 1`; existing lockfiles never auto-flip linker. Opt-in = `linker = "isolated"` in bunfig (replacing our pinned `"hoisted"`).
- **⚠️ CORRECTION to the pre-arc consult**: the changelog does NOT say patched packages are excluded from the global store. It says the opposite direction: `patchedDependencies` cache entries participate in a SHARED install cache, now keyed by full-file SHA-1 (fixing cross-project patch contamination), and isolated installs no longer re-apply patches per peer-variant. → The plan must NOT rely on "patched noir stays project-local" as a documented guarantee; instead the identity gate verifies empirically WHERE the patched `@aztec/noir-*` files land and that patch markers are present post-install.
- **⚠️ Documentation gaps that become plan-time verification items** (nothing to cite, must be probed): (a) NO documented concurrency/atomicity guarantee for the global store under simultaneous installs (the codex pre-consult's "atomic renames, ignored staging trees" claim traced to uncited docs — treat as unverified); (b) the global store / cache PATH is undocumented (no env var/flag surfaced in the changelog; `install.globalStore` exists as a bunfig key only via a bug-fix mention — syntax/default undocumented); (c) hardlink-vs-symlink split per step is not fully specified (`--backend` default hardlink; global-store fast path documented as symlink).
- Windows junction fallback + cross-filesystem copy fallback + fail-fast on integrity errors are documented. Store dir names sanitize URL query chars.

## Part 2 — Layout-sensitive consumer inventory

_Pending: explorer running (first attempt died on a transient API entitlement error; retried). Will be appended verbatim when it lands._

## Immediate plan-shaping consequences

1. Consumers-first strategy (pre-consult) stands, but the patched-package leg of the identity gate is now EMPIRICAL, not doc-backed.
2. The three-step matrix (hoisted → isolated/local store → isolated/global store) needs an explicit probe for `install.globalStore` on/off syntax (undocumented — discover against the real binary) and a concurrency smoke (two simultaneous installs into the shared store from two scratch projects) since no doc guarantee exists.
3. `hoist = false` is the END-state strictness step, not the first flip (matches pre-consult).
