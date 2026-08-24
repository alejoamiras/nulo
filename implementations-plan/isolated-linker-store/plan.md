# Plan — isolated-linker-store (Arc B of the Bun 1.4 adoption goal)

**Tier**: `/blueprint mid` · **Worktree/branch**: `worktree-isolated-linker-store` off dev @ 27935013 (post Arc A merge) · **eli5_mode**: Artifact
**Gate protocol**: codex-convergence (owner's standing decision protocol; owner reserved lines unchanged) · **Recon**: [recon.md](recon.md) (part 1 semantics + part 2 consumer inventory) · **Pre-consult**: [pre-arc-consults.md](../bun-1.4-adoption/lessons/pre-arc-consults.md)

Adopt Bun's isolated linker + global virtual store for install speed across ~30 worktrees, WITHOUT breaking the repo's layout-sensitive tooling — by making every consumer layout-agnostic FIRST (on hoisted, zero-risk), then flipping, then measuring. Abort path ships value anyway (the hardening PR stands alone).

## Scope

**In**: a shared exports-map-safe package-asset resolver; refactor of all 6 walker copies + `noirAliases` + the sqlite3mc emission; fixing 2 phantom deps (`@aztec/sqlite3mc-wasm` declared at its existing 5.0.1 pin, `zod` in bridge-core) + the dead `fuel-testnet.ts` path (pre-existing bug); a generated foundry remappings mechanism; the linker flip + deliberate lockfile regeneration (inherits Arc A's deferred v2 + tuple-diff gate); global-store probes (syntax, concurrency, timings); identity-assertion tests; full validation battery + one solo network shard.
**Out**: `hoist = false` (documented follow-up after soak — unknown phantom requires inside the `@aztec` transitive graph would hard-fail at runtime; needs its own gate); any `@aztec/*` VERSION change (exact pins are untouched — regen cannot move them); vitest-on-bun (Arc C); CI cache-topology changes (CI caches no node_modules — verified).

## Architecture & Implementation

- **Proposed architecture**: a new source-first workspace package **`@nulo/resolve-asset`** (packages/resolve-asset; one concern: locate a declared package's root/assets from a caller anchor, layout-agnostically). API: `resolvePackageRoot(pkg, { from })` — `createRequire(from).resolve(pkg + "/package.json")`, falling back (exports-blocked packages) to resolving an exported entry then walking UP to the `package.json` whose `name` matches; `resolvePackageAsset(pkg, assetPath, { from })` = root + join. `from` is the caller's `import.meta.url`, anchoring resolution at the DECLARING workspace — the property the audits' identity gates check. Layer position: below everything (no deps); importable by apps AND packages (bridge-core/aztec-runtime importing from apps/extension is layer-banned, which is why the canonical `vite.shared.ts` copy cannot simply be shared).
- **Key interfaces**: the two functions above, precise types, plus `assertPackageIdentity(pkg, { from, expectVersion?, mustContain? })` used by the identity tests (realpath + package.json name/version + optional content marker, e.g. the noir patch marker).
- **Data & control flow**: build-time only — vite configs/plugins, scripts, and tests call the resolver at startup; no runtime (extension) code path changes; emitted assets are byte-identical (same source files, found by a different route).
- **File-level change map**: NEW `packages/resolve-asset/{package.json,src/index.ts,src/index.test.ts}`; MODIFIED `apps/extension/vite.shared.ts` (walker + noirAliases → resolver), `apps/extension/vite.config.ts` (sqlite3mc emission + accelerator/polyfill call sites → resolver), `apps/extension/scripts/extract-bb-wasm.ts`, `packages/bridge-core/scripts/{check-fpc-version.ts,fuel-testnet.ts}`, `packages/bridge-core/src/private-fuel.test.ts`, `packages/aztec-runtime/src/pxe/opfs-store.test.ts`, `apps/extension/package.json` (+`@aztec/sqlite3mc-wasm": "5.0.1"`, +`@nulo/resolve-asset`), `packages/bridge-core/package.json` (+`zod`, +`@nulo/resolve-asset`), `packages/aztec-runtime/package.json` (+`@nulo/resolve-asset` dev), `bunfig.toml` (Phase 3: linker flip + comment), `bun.lock` (Phase 3 regen — own commit), NEW `packages/bridge-core/scripts/gen-remappings.ts` + gitignored `contracts/bridge/evm/remappings.txt` (foundry.toml keeps its static remap for the hoisted era; remappings.txt overrides when generated), NEW identity test `apps/extension/tests/layout-identity.test.ts` (vitest, node env, runs under BOTH linkers).
- **Algorithms / non-obvious mechanics**: exports-map fallback (sqlite3mc-wasm blocks `./package.json` — its own comment says so) = resolve the package's MAIN export, then ascend `dirname` until a `package.json` with `name === pkg`; symlink-aware because Node/Bun resolution is. Foundry: remappings.txt takes precedence over foundry.toml remappings — generation happens inside `forgeBin()`-adjacent setup in both forge-invoking scripts + standalone `gen-remappings.ts` for manual runs.
- **Trade-offs & alternatives not taken**: (1) publicHoistPattern bridge instead of refactors — see Competing Outline B; (2) fixing the 6 walker copies in place without a shared package — preserves the drift that produced this bug class (rejected; the repo's own modularize-relentlessly rule); (3) repathing foundry.toml to `packages/bridge-core/node_modules/...` — breaks under TODAY'S hoisted layout (bridge-core's node_modules lacks l1-artifacts when hoisted), so it can't precede the flip; generation works under both.

## Phases

### Phase 1 — `@nulo/resolve-asset` + consumer hardening (on HOISTED; zero-risk; ships value even on abort)
Build the package (≥10 unit cases incl. exports-blocked fallback, missing-package error, symlinked root); refactor the 6 walker copies + `noirAliases` + sqlite3mc emission; declare `@aztec/sqlite3mc-wasm: "5.0.1"` (apps/extension) + `zod` (bridge-core); fix `fuel-testnet.ts` (renamed package + resolver — pre-existing bug); add `gen-remappings.ts` + wire `verify-l1.ts`/`portal-artifact.ts` to generate before forge; add the layout-identity test (asserts every special asset's realpath/package identity — passes under hoisted now, unchanged under isolated later).
**Validation gate**: `bun run audit:vue` exit 0 · `bun run test:all` exit 0 · identity test green · `bun test scripts/release/ scripts/ci-cd/` green · `bun run lint:actions` exit 0 · `bun scripts/gen-remappings.ts && forge build` smoke in contracts/bridge/evm (manual, logged — forge is not in CI) · `bun scripts/check-fpc-version.ts` exit 0. Layers: typecheck+unit+lint+build (+manual forge).

### Phase 2 — Flip: `linker = "isolated"` + lockfile regeneration (own commits)
bunfig `linker = "isolated"` (comment rewritten to the new reality); DELETE `bun.lock` + `bun install` — the deliberate re-resolve Arc A deferred. Expect `lockfileVersion: 2` + `configVersion: 1`. **Regen review gate (inherits Arc A's tuple-diff, adapted for a legitimate re-resolve)**: extract pre/post `name@version` tuples; `@aztec/*`, `@aztec-foundation/*`, `@alejoamiras/*` MUST be byte-identical (exact pins); every other version move is listed and classified (patch/minor within range; anything crossing a major or landing younger than 7d → investigate; min-age + excludes behavior verified on the regen). Then double-install fixed point + frozen install.
**Validation gate**: layout-identity test green under isolated (realpaths + patch markers on `@aztec/noir-*`) · regen review documented in lessons · `bun install --frozen-lockfile` exit 0 · `bun run audit:vue` exit 0 · `bun run test:all` exit 0 · `bun run test:e2e` (smoke, local build) exit 0 · cold+warm install timings recorded (hoisted baseline from Phase 1 vs isolated). Layers: everything except network.

### Phase 3 — Global store: syntax discovery, concurrency smoke, worktree timings
Discover `install.globalStore` empirically (undocumented — probe the bunfig key against 1.4.0; determine whether isolated defaults to the global store as the blog implies); run the three-step matrix cells that the syntax supports (isolated/local vs isolated/global — if not separable, document the collapse); **concurrency smoke** (two scratch projects, simultaneous installs of overlapping deps into the shared store — no doc guarantee exists; assert both complete + spot-check store integrity); measure the real payoff: fresh-worktree install time (cold node_modules, warm store) vs the hoisted baseline.
**Validation gate**: probe results + timings table in lessons (the 7× claim confronted with local numbers) · concurrency smoke evidence · repo frozen install still green after all probes. Layers: empirical.

### Phase 4 — Full validation + keep/abort decision
`bun run audit:vue` + `bun run test:all` + `bun run test:e2e` + ONE network shard SOLO (`bun run e2e:agent --shard=1/5`; host quiet per the run-isolation rule) + `bun run --cwd apps/extension build-storybook` smoke. Then the decision, via the codex-convergence gate: **KEEP** (numbers justify, all green) → Delivery; **ABORT** → revert Phases 2–3 commits (Phase 1 stands), close "rejected with evidence" with the timings/breakage documented.
**Validation gate**: the full battery above, every command exit 0, network shard green on first solo run (a flake gets ONE clean re-run per repo policy; persistent red = abort evidence). Layers: all, incl. network e2e.

## Competing Outline B — "bridge-first" (the genuine alternative; audits must weigh it)

Flip `linker = "isolated"` immediately with `publicHoistPattern = ["@aztec/*", "@aztec-foundation/*", "@alejoamiras/*"]` + declare `zod`; defer all consumer refactors. The root hoist keeps every walker's last-level hit, the foundry remap, and the sqlite3mc walker working unmodified; day-one payoff; ~10-line diff.
**Why the main plan rejects it**: recreates the phantom-dependency API the isolated linker exists to kill (pre-consult ruling: "emergency compatibility bridge, not the target architecture"); wrong-copy selection risk when workspaces diverge; hoist-pattern corners are the least-documented part of the feature; the end-state (`hoist = false`) becomes unreachable without doing the refactors anyway — it defers the same work and adds a bridge to unwind. Kept on the table for the audits as the fallback if Phase 2 uncovers a blocker the refactors can't fix.

## Security & Adversarial Considerations

- **Global store = a machine-shared trust surface**: same-user only on this host; integrity is checked at extraction (changelog-documented fail-fast) but concurrency/atomicity is UNdocumented → Phase 3's smoke; never multi-UID/NFS; `bun pm cache rm` while installs run is operator error to avoid (noted in lessons).
- **Lockfile regeneration is the arc's supply-chain moment**: full re-resolve under the 7d min-age gate + excludes; the regen review gate lists every move; `@aztec/*` exact pins CANNOT move (verified property of exact pins); `bun pm diff <pkg>@<old> <new>` on any surprising move per SECURITY.md's workflow.
- **`@aztec/sqlite3mc-wasm: "5.0.1"` explicit declaration**: judged a manifest edit, NOT an @aztec version-line change (same pin already in-tree via kv-store@5.0.1; UPDATE.md pin-surface note added so aztec-update bumps see it). Flagged to the owner (objection window in status) + to the codex gate. The alternative (hoist-pattern bridge just for it) is Outline B's world.
- **Phantom-dep elimination is hardening**: two phantoms fixed; the identity test turns layout assumptions into executable assertions.
- **No new CI permissions/secrets**; `remappings.txt` is generated + gitignored (no committed machine paths); emitted extension assets byte-identical (Phase 2's build + smoke prove behavior).

## Assumptions

**Facts (verified)**
1. The full consumer inventory with file:line (recon part 2; explorer + spot-verified). 2. `bun.lock` already `configVersion: 1`; linker pinned hoisted in bunfig with the three named risk classes (bunfig:1-8). 3. Machine bun = CI pin = 1.4.0 (Arc A merged, 27935013). 4. `@aztec/*` deps are exact-pinned repo-wide → regen cannot move them. 5. `@aztec/kv-store@5.0.1 → @aztec/sqlite3mc-wasm@5.0.1` edge (kv-store package.json:43); no workspace declares sqlite3mc-wasm. 6. Global-store/hoist semantics + doc gaps per recon part 1 (changelog-quoted). 7. Forge runs only manually; CI caches no workspace node_modules. 8. `remappings.txt` overrides `foundry.toml` remappings (foundry's documented precedence).
**Inferences (attackable)**
1. Vite 8/rolldown + crx handle symlinked node_modules (default `preserveSymlinks: false` = realpath-based) — Phase 2's build+smoke is the check. 2. Isolated default includes the global store (blog phrasing) — Phase 3 verifies. 3. `install.globalStore` is togglable (exists only via a bug-fix mention) — Phase 3 probes. 4. Forge resolves remapped sources through symlinks — Phase 1's manual forge smoke checks under hoisted, Phase 2 re-checks. 5. Same-user concurrent installs are safe — UNdocumented; Phase 3 smoke is the only evidence we'll have.
**Asks** — none routed to the owner (codex-convergence per the active goal). Owner objection window flagged in chat for: the `@aztec/sqlite3mc-wasm` explicit declaration (reserved-line-adjacent judgment).

## Delivery

**Two stacked PRs via `gh stack`** (each independently revertable): **B1 "layout-agnostic asset resolution"** = Phase 1 (valuable regardless of the flip's fate) → PR to dev; **B2 "isolated linker + global store"** = Phases 2–4 stacked on B1. `gh stack init --adopt worktree-isolated-linker-store` at B1's boundary, `gh stack add` for B2, `gh stack submit --draft --auto` early, sync as dev moves. PR titles ≤93 chars; lockfile regen its own commit; merges owner-reserved. On ABORT: B1 alone goes to ready; B2 closes with the evidence.

## Post-implementation (self-contained — the implementing session executes THIS)

1. `/code-review max --fix` on the net diff → skim → commit separately. 2. Codex post-impl audit (`/codex xhigh`, fresh): net diff from 27935013 + code-review summary + this plan + ledger + adversarial ask + verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."* 3. Fix loop: verify claims → fix → commit → RESUME same session; converge (no new material findings); >3 churning rounds → stop and surface. 4. Delivery per above (`gh stack submit`/`sync`, mark ready when converged). 5. Wrap-up: phases ✓ here, index updated, `agent-worktree status` refreshed; ping owner for merges.

## Decision ledger

| Decision | Chosen | Rejected | Status |
|---|---|---|---|
| Migration strategy | Consumers-first (refactor on hoisted, then flip) | Bridge-first hoist patterns (Outline B — kept as fallback) | pre-consult + this draft; audits to pressure-test |
| Shared resolver home | New `@nulo/resolve-asset` workspace package | In-place fixes ×6 (drift); sharing vite.shared.ts (layer-banned upward import) | draft |
| Foundry remap | Generated `remappings.txt` (works under both layouts) | Repath foundry.toml (breaks under hoisted NOW); hoist-pattern bridge | draft |
| sqlite3mc-wasm phantom | Explicit dep at existing 5.0.1 pin (flag to owner+gate) | publicHoistPattern bridge | draft |
| `hoist = false` | OUT of arc (follow-up after soak) | In-arc end-state | pre-consult + draft |
| Unresolved | — | — | audits pending (codex + fable) |

## Seeds

Drafted post-audit with the ELI5; finalized at the codex-convergence gate.
