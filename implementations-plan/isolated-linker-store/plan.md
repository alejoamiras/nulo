# Plan — isolated-linker-store (Arc B of the Bun 1.4 adoption goal) — v2, dual-audit-consolidated

**Tier**: `/blueprint mid` · **Worktree/branch**: `worktree-isolated-linker-store` off dev @ 27935013 · **eli5_mode**: Artifact
**Gate protocol**: codex-convergence (owner-delegated) · **Recon**: [recon.md](recon.md) · **Audits**: [audit-codex.md](audit-codex.md) + [audit-fable.md](audit-fable.md) — both conditional-approve round 1; ALL conditions adopted (dispositions in the Audit log)

Adopt Bun's isolated linker + global virtual store for install speed across ~30 worktrees, WITHOUT breaking layout-sensitive tooling: consumers become layout-agnostic first (on hoisted), store semantics get probed in scratch BEFORE the repo ever touches them, the flip happens on the UNCHANGED v1 lockfile (layout-only risk), and the lockfile regeneration is its own wallet-grade-reviewed event. The abort path ships value anyway (B1 stands alone).

## Scope

**In**: `@nulo/resolve-asset` (exports-map-safe, subpath-anchored resolver); refactor of all 6 walker copies + `noirAliases` + sqlite3mc emission; phantom fixes (`@aztec/sqlite3mc-wasm` declared at the existing 5.0.1 pin — judgment codex-approved under the delegated gate — and `zod` in bridge-core); the dead `fuel-testnet.ts` path fix; generated+asserted foundry remappings; scratch-first global-store probes (syntax/default/toggle, N-way concurrency stress, interruption injection, patched-package variants); the flip on the existing v1 lock; aged-out `minimumReleaseAgeExcludes` removal followed by the deliberate lockfile regeneration with a wallet-grade review; identity tests (both linkers, lockstep assertion); dev-server + packaged-output validation; timings; one solo network shard; keep/abort with an explicit posture question.
**Out**: `hoist = false` (follow-up after soak); any `@aztec/*` VERSION change; Arc C/D concerns; CI cache topology (CI installs fresh per job from the verified download cache — which is also the release-build posture answer: CI stores are rebuilt per job, never shared).

## Architecture & Implementation

- **`@nulo/resolve-asset`** (packages/resolve-asset, source-first, no deps, bottom layer — the layer ban makes `vite.shared.ts` unshareable downward, and 6 drifting copies are the disease):
  - `resolvePackageRoot(pkg, { from, entry? })` — try `createRequire(from).resolve(pkg + "/package.json")`; on exports-block, resolve the caller-supplied **`entry` exported subpath** (NOT the main export — audits proved `.` is import-only on sqlite3mc-wasm and ABSENT on `@aztec/pxe`), then ascend to the `package.json` with `name === pkg`.
  - `resolveExportedAsset(pkg, subpath, { from })` — direct exported-subpath resolution for condition-less asset exports (the sqlite3mc `vendor/jswasm/*` case).
  - `assertPackageIdentity(pkg, { from, expectVersion?, mustContain?, lockstepVia? })` — realpath + name/version (+ content marker, e.g. noir patch marker) + **lockstep**: `lockstepVia: "@aztec/kv-store"` asserts realpath(direct resolve) === realpath(resolve through the intermediary) — the anti-skew guard for the sqlite3mc declaration.
  - Unit tests run against the REAL packages in the tree (blocked package.json; absent `.` export; import-only `.`; symlinked roots), not fixtures.
- **Interfaces/flow/files**: as v1 (change map unchanged) PLUS: B1 carries its **own minimal v1-preserving `bun.lock` diff** (new workspace + manifest edges — without it frozen CI fails; Arc A proved 1.4 writes v1 in place), `UPDATE.md` gains the complete new pin-inventory row for sqlite3mc-wasm, `contracts/bridge/evm/README` note (bare `forge build` post-flip requires `bun scripts/gen-remappings.ts` first), and `gen-remappings.ts` records the forge version + asserts the effective `@aztec/` mapping via `forge remappings` output, writes atomically, and rejects stale/unexpected targets. `portal-artifact.ts` is NOT wired to it (it builds inside l1-artifacts' own root — no EVM remap involved).
- **Trade-offs**: ledger below; the audits' one genuine disagreement (flip-first vs regen-first) is resolved there.

## Phases

### Phase 1 — B1: `@nulo/resolve-asset` + consumer hardening (HOISTED; independently shippable)
Everything in Scope's first sentence through the remappings mechanism + the identity test + the minimal lockfile diff. Fix the audit-caught gate bug: `check-fpc-version.ts` requires `--mode` — the gate invokes it with the correct mode for an offline/local check (verified against its own usage before wiring).
**Validation gate**: `bun run audit:vue` 0 · `bun run test:all` 0 · identity test green (incl. lockstep assertion) · resolver unit tests green against real packages · `bun install --frozen-lockfile` 0 (B1's own lock diff proves installable) · `bun test scripts/release/ scripts/ci-cd/` green · `bun run lint:actions` 0 · `bun scripts/gen-remappings.ts` then `forge remappings` shows the expected `@aztec/` target then `forge build` green (manual, logged) · `bun scripts/check-fpc-version.ts --mode <verified>` 0. Layers: typecheck+unit+lint+build+install (+manual forge).

### Phase 2 — Store semantics probes, in SCRATCH, before the repo touches anything (codex High: discovery precedes first real install)
(a) `install.globalStore` syntax/default/toggle against 1.4.0 (undocumented — empirical); (b) concurrency **stress**, not smoke: N-way (5–10) simultaneous installs, repeated, overlapping peer/optional variants, two DIFFERENT patches of one package (the SHA-1-key fix exercised), kill-mid-install interruption injection, post-run whole-store tree-hash + frozen-install verification; (c) patched-package placement probe (where do patched files land; markers present). Fallback control if inconclusive: advisory cross-worktree install mutex via the `~/.agents` registry pattern.
**Validation gate**: probe matrix + a written **posture memo** (empirical risk acceptance, NOT proof — codex's framing; includes the same-UID mutation surface and the CI/release answer: per-job rebuilt stores). Layers: empirical.

### Phase 3 — B2 begins: flip on the EXISTING v1 lockfile (layout-only risk; codex ordering adopted)
`linker = "isolated"` (+ `install.globalStore` per Phase 2 posture); `bun.lock` UNTOUCHED — resolutions identical by construction, so any breakage is attributable to layout alone.
**Validation gate**: identity test green under isolated (realpaths, patch markers, lockstep) · `bun run audit:vue` 0 · `bun run test:all` 0 · `bun run --cwd apps/extension build:full` (chrome+firefox) 0 · **dev-server boot smoke** (fable High: `vite dev` boots and serves a transformed dep module — the `/@fs/` + `server.fs.allow` exposure for out-of-repo store paths) · `bun run test:e2e` smoke 0 · **packaged-output assertions**: dist contains no symlinks, no absolute machine/store paths, no external references; sqlite3/bb WASM output hashes IDENTICAL to the Phase 1 hoisted baseline · install timings (v1 lock, isolated). Layers: everything except network.

### Phase 4 — Lockfile events, separated commits: excludes cleanup THEN regeneration + wallet-grade review
Commit A: remove the aged-out `minimumReleaseAgeExcludes` (bunfig's own recorded TODO; makes the min-age gate REAL for the regen) + frozen-install proof. Commit B: DELETE `bun.lock` + `bun install` (expect v2 + configVersion 1) + the **wallet-grade regen review**: full-record comparison (not name@version): integrity, resolved URL/type, dependency/peer/optional edges, patch bindings, aliases, bins; added/removed names both directions; `@aztec/*`+`@aztec-foundation/*`+`@alejoamiras/*` require **integrity+resolved equality** (byte-identity, not version equality); EVERY bundle-reachable or @aztec-subtree move gets `bun pm diff <pkg>@<old> <new>` review regardless of semver class; `bun pm ls --all` + peer-set + bundle-metadata comparison (Noir duplicate-copy count recorded — vite.config's own documented hazard); advisory delta (`bun audit` pre/post); double-install fixed point; frozen install.
**Validation gate**: the review artifact in lessons (every class above populated) · full battery re-run (`audit:vue` + `test:all` + identity + smoke e2e) green post-regen. Layers: everything except network + the supply-chain review.

### Phase 5 — Payoff measurement + full validation + keep/abort
Fresh-worktree install timings (cold node_modules, warm store) vs the Phase 1 hoisted baseline — the 7× claim confronted. Full battery + `bun run --cwd apps/extension build-storybook` + ONE network shard SOLO (`bun run e2e:agent --shard=1/5`, quiet host; one clean re-run policy). **Keep/abort decision at the convergence gate**, explicitly weighing: the numbers, the posture memo (esp. if `globalStore` proved non-togglable — machine-shared wallet-dep storage becomes unconditional), and green-ness. ABORT → revert Phases 3–4 commits (B1 stands), close "rejected with evidence".
**Validation gate**: full battery green incl. the solo shard · timings table · the decision recorded with reasoning. Layers: all.

## Competing Outline B — "bridge-first" (kept as explicitly temporary, time-bounded fallback)

As v1 (flip + `publicHoistPattern` for the three scopes + declare zod; defer refactors). BOTH audits re-steelmanned it post-recon-corrections (it genuinely rescues sqlite3mc, foundry, and the noir paths) and BOTH ruled it loses: it leaves the dead fuel path, the zod phantom, the 6-copy drift and wrong-copy risk in place, makes the least-documented corner load-bearing, muddies identity semantics (root-hoisted copy vs workspace symlink can disagree), and blocks the `hoist = false` destination — deferring the same work plus a bridge-unwind. Status: fallback only, time-bounded, if Phase 3 uncovers a blocker the refactors cannot fix.

## Security & Adversarial Considerations

- **Shared store trust boundary (codex High, adopted verbatim)**: extraction-time integrity does NOT protect against later same-UID mutation of shared extracted files — one compromised worktree could poison every build following its symlinks. Mitigations: the Phase 2 stress battery + tree-hash snapshots (empirical risk ACCEPTANCE, documented as such); release/CI builds are inherently clean-store (per-job rebuild from the integrity-checked download cache — stated in the posture memo); the identity tests assert the emitted critical inputs (wasm hashes) match hoisted baselines.
- **The regen is the supply-chain moment**: Phase 4's wallet-grade review (integrity/resolved byte-identity for frozen scopes; pm-diff on every sensitive move; "7-day age is delay, not provenance" — hence the review, not the gate alone). Excludes removed FIRST so the min-age verification means something.
- **`@aztec/sqlite3mc-wasm: "5.0.1"` declaration**: codex explicitly approved under the delegated gate ("narrowly sound; a new frozen pin-surface + production-asset ownership decision, not just bookkeeping") with conditions adopted: unchanged lock integrity/closure at declaration time, UPDATE.md complete pin inventory, and the lockstep realpath assertion (fable) closing the future kv-store-skew channel.
- **Generated remappings are compiler input**: forge version recorded; effective mapping asserted via `forge remappings` before builds; atomic overwrite; stale-target rejection; gitignored.
- **Owner reserved lines untouched**: no version-line changes; merges owner's; no gate weakening.

## Assumptions

**Facts (verified)** — as v1 (1–8), PLUS: 9. `@aztec/pxe` exports subpaths only, no `.` (its package.json:14-20 — codex-verified); sqlite3mc-wasm's `.` is import-condition-only with condition-less asset subpath exports (:10-11). 10. `check-fpc-version.ts` requires `--mode` (:51-56). 11. bunfig's excludes block carries its own aged-out-by-~2026-07-22 removal TODO (bunfig.toml:43-91). 12. Foundry's provider gives remappings.txt priority over TOML duplicates (foundry source, codex-cited; additionally asserted at runtime via `forge remappings` per the gate).
**Inferences (attackable)** — 1. vite8/rolldown/crx over symlinks: now backed by the Phase 3 packaged-output assertions + dev smoke rather than assumed. 2/3. global-store default/togglability: moved to Phase 2 SCRATCH discovery before any repo install. 4. forge-through-symlinks: Phase 1 manual smoke + Phase 3 re-check. 5. concurrency: stress battery + interruption injection; result is risk-acceptance evidence, never proof (posture memo).
**Asks** — none routed to the owner beyond the already-flagged sqlite3mc objection window (open; codex approved under the delegated gate). The Phase 5 posture question resolves at the convergence gate unless it crosses a reserved line.

## Delivery

**Two stacked PRs via `gh stack`**: **B1** = Phase 1 (installable alone: carries its minimal v1 lock diff) → PR to dev; **B2** = Phases 3–5 (+Phase 2's probe evidence in lessons) stacked on B1, its lockfile events as separate commits (excludes cleanup · regen). `gh stack init --adopt` at B1, `add` for B2, `submit --draft --auto` early, `sync` as dev moves. Titles ≤93 chars. Merges owner-reserved. ABORT path: B1 → ready alone; B2 closes with evidence.

## Post-implementation (self-contained)

1. `/code-review max --fix` → skim → separate commit. 2. Codex post-impl audit (fresh, xhigh): net diff from 27935013 + code-review summary + this plan + ledger + adversarial ask + the verbatim no-over-engineering rule: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."* 3. Verify-then-fix loop, RESUME same session, converge; >3 churning rounds → surface. 4. Delivery per above; mark ready on convergence; ping owner for merges. 5. Wrap-up: phases ✓, index, manifest status.

## Audit log & decision ledger

Round 1 (parallel, independent): codex session `01a034d9-f58f-79f3-b4e6-cc49afc31adb` conditional approve · fable (Fable-model Plan agent) conditional approve. Transcripts: audit-codex.md / audit-fable.md.

| # | Finding (source) | Disposition |
|---|---|---|
| B-1 | Resolver contract broken for real packages — pxe has no `.`, sqlite3mc `.` is import-only (codex High + fable Med, independent) | **Adopted**: `entry` subpath anchor + `resolveExportedAsset` + real-package unit tests |
| B-2 | B1 not frozen-installable without its own lock diff (codex High) | **Adopted**: B1 carries the minimal v1-preserving lock update + frozen gate |
| B-3 | Flip and regen conflated (both) — codex: flip-first on v1 lock; fable: regen-first on hoisted | **Adopted with codex's ordering**: flip on the unchanged v1 lock isolates LAYOUT (the arc's core question) with zero resolution variables; the regen then isolates RESOLUTION on a proven layout. Fable's underlying demand (one root cause per commit) is fully satisfied; its order was the mirror-image split. Recorded as the round's one genuine disagreement, resolved. |
| B-4 | Store probes must precede the first repo install (codex High) | **Adopted**: Phase 2 is scratch-only discovery |
| B-5 | Two-install smoke ≠ evidence; same-UID mutation surface; release posture (codex High + fable Med) | **Adopted**: N-way stress + interruption + tree-hash; posture memo framed as risk acceptance; CI per-job clean-store stated as the release answer; registry-mutex named as fallback control |
| B-6 | Regen gate not wallet-grade (both, convergent) | **Adopted in full**: full-record diff, added/removed, integrity+resolved byte-identity for frozen scopes, pm-diff regardless of semver class, pm ls --all/peer/bundle-metadata + Noir dup count, advisory delta |
| B-7 | Excludes cleanup BEFORE regen (fable High) | **Adopted**: Phase 4 commit A (supersedes Arc A's P4 deferral — the regen is exactly the event the stale excludes endanger) |
| B-8 | Dev-server blind spot (fable High) | **Adopted**: Phase 3 dev boot smoke |
| B-9 | Vite/CRX validation too indirect (codex Med) | **Adopted**: build:full + firefox + packaged-output assertions + wasm hash cross-linker comparison |
| B-10 | Remappings hardening (codex Med) | **Adopted**: forge version recorded, effective-mapping assertion, atomic write, stale rejection, portal-artifact unwired, README note |
| B-11 | sqlite3mc declaration judgment (both) | **Resolved**: sound; codex approved under the delegated gate; fable's lockstep assertion + UPDATE.md full inventory adopted; owner objection window remains open |
| B-12 | check-fpc-version --mode gate bug (codex Low) | **Adopted**: gate line fixed with verified mode |
| B-13 | globalStore non-togglable posture (fable Low) | **Adopted**: explicit Phase 5 decision input |
| B-14 | Outline B (both re-steelmanned) | **Converged: loses; time-bounded fallback only** |

Unresolved disagreements: none (B-3 resolved with recorded reasoning).

## Seeds

Drafted in the ELI5; finalized at the convergence gate.
**ELI5 Artifact**: https://claude.ai/code/artifact/21293181-3ec0-4afb-9650-8e0398282ddf · source: `implementations-plan/isolated-linker-store/eli5.html` (redeploying that file updates the same URL).
