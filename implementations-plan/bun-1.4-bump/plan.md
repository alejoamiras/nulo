# Plan — bun-1.4-bump (Arc A of the Bun 1.4 adoption goal)

**Tier**: `/blueprint light` · **Worktree/branch**: `worktree-bun-1.4-bump` off dev @ ea9be876 · **eli5_mode**: Artifact
**Parent dossier**: [adoption-map.md](../bun-1.4-adoption/adoption-map.md) · **Recon**: [recon.md](recon.md) · **Codex audit**: [audit-codex.md](audit-codex.md) — conditional approve; all five conditions adopted (see Audit log)

**APPROVED (owner, 2026-08-24)** — conditional approve. Rulings: A1 = merge when green (runtime ≠ npm-dep policy, owner's words); A2 = advisory (default stands after plain-language explanation); A3 = **owner delegated the machine-wide bun upgrade to the agent** — install exactly 1.4.0 over the host binary immediately before merge (added to Delivery step 4b); A4 = accept-and-document (default stands after explanation).

Bump the repo's Bun toolchain 1.3.14 → 1.4.0 and land the Tier-1 wins that need no runtime/topology change: pin-surface dedupe, lockfile-v2 migration, `bun dedupe`, `bun run --parallel` scripts, the renovate `npx`→`bunx` swap, and the pm-workflow documentation. Arcs B–D (isolated linker, vitest-on-bun, Bun-native tooling) are explicitly OUT of scope.

**⚠️ Fleet cutover (empirically verified)**: Bun 1.3.14 CANNOT install against the v2 lockfile this PR produces — frozen installs fail (`Ignoring lockfile … lockfile is frozen`), and unfrozen installs would rewrite the format back down, thrashing between agents. **Merging this PR requires the machine-wide bun (and every live worktree/agent) to be on ≥1.4.0 first.** See Ask A3.

## Scope

**In**: the 7-occurrence pin surface + CLAUDE.md prose; folding pr-quick.yml's inline setup into the composite; `bun.lock` v2; dedupe (4 existing duplicates) + an **advisory** `dedupe --check` CI step; `audit:vue`/`dev:full` parallelization (drop `concurrently`); renovate validator via `bunx` + explicit `permissions: contents: read` on the reusable workflow; #25305 mock-registry verification + bunfig/SECURITY.md doc updates; committing the parent dossier + index entries.
**Out**: any `@aztec/*` change; linker/topology changes; moving Vitest suites to Bun; `Bun.$` migrations; machine-wide bun upgrade mechanics (owner action — but see A3, it is now a merge PREcondition, not optional); repo-wide SHA-pinning of actions (deferred — see Audit log R2).

## Architecture & Implementation (compact, per light tier)

- **Reuse/location**: all changes land in existing files — no new modules. The one structural move is deletion-by-reuse: pr-quick.yml's 3 inline steps → `uses: ./.github/actions/setup-bun` (checkout precedes it at pr-quick.yml:196, satisfying the composite's contract, action.yml:2-7).
- **Touched files**: `package.json` (packageManager, `audit:vue`), `apps/extension/package.json` (`dev:full`, drop `concurrently`), `.github/actions/setup-bun/action.yml` (version + cache keys), `.github/workflows/pr-quick.yml` (fold), `.github/workflows/_lint-and-typecheck.yml` (bunx swap + advisory dedupe step + `permissions: contents: read`), `bun.lock` (3 separately-committed causes: v2 rewrite, dedupe, concurrently removal), `bunfig.toml` (comment truth-update), `CLAUDE.md` (:30 pin prose, :62 drift note), `SECURITY.md` (pm workflow + #25305 outcome), `implementations-plan/` (dossier + this plan + index).
- **Critical flow**: pins first (CI runs 1.4 from the first push), then lockfile, then dedupe, then scripts, then CI extras, then docs — every later phase is validated under the bumped toolchain.
- **Local toolchain**: all local gates run via the isolated `~/.bun-versions/1.4.0/bin/bun` (`$B` below); the machine-wide 1.3.14 is never touched by this arc.
- **Simpler alternative considered**: bump-only PR, defer everything else. Rejected: the Tier-1 items are each ≤20-line diffs that *validate the bump*, and separate PRs re-run the same CI battery per item. One reviewable PR with clean per-cause commits is the better slice. Codex concurred the commit topology is "materially improved reviewability, not ceremony."
- Interfaces/types, data-flow diagrams, algorithms: N/A (config, scripts, docs).

## Phases

### Phase 1 — Pin bump + CI pin dedupe ✓ (gate green 2026-08-24: actionlint 0 · ci-gating 7/7 · grep clean)
Bump `package.json#packageManager` → `bun@1.4.0` (exactly — see A1); `setup-bun/action.yml` version + both cache-key occurrences → `1.4.0`; replace pr-quick.yml:199-209 with `uses: ./.github/actions/setup-bun`; update CLAUDE.md:30 (pin prose) and CLAUDE.md:62 (drift note now lists exactly two pin files). Commit the parent dossier + index entries as a preceding docs commit.
**Validation gate**: `$B run lint:actions` exit 0 · `$B test scripts/ci-cd/` green (behavior-gating still parses the edited workflow) · `grep -rn '1\.3\.14' package.json .github/ CLAUDE.md` returns nothing. Layers: lint(workflows) + unit(ci-gating).

### Phase 2 — Lockfile v2 migration (own commit, no dep changes)
`$B install` (unfrozen) to rewrite `bun.lock` → `lockfileVersion: 2`.
**Semantic lockfile check (codex condition)**: extract the full `name@version + integrity` tuple set pre/post and diff — structural/integrity-field additions and one-time optional-peer placement churn are acceptable; **any resolved-version or integrity change of a real dependency aborts the phase**. Then run `$B install` a second time and assert the lockfile is a fixed point (zero diff), then `$B install --frozen-lockfile`.
**Validation gate**: `head -3 bun.lock` shows `"lockfileVersion": 2` · tuple diff empty (versions/integrity) · second install produces zero lockfile diff · `$B install --frozen-lockfile` exit 0 · `$B test scripts/release/ scripts/ci-cd/` green. Layers: unit + install integrity.

### Phase 3 — Dedupe + advisory CI check (own commit)
`$B dedupe` (collapses the 4 known duplicates). **Downgrade-safety review (codex condition)** — `bun audit` alone is NOT sufficient:
- List all 4 collapsed pairs; for each, read the release delta between the two versions (changelog/commits), classify risk.
- `string_decoder 1.3.0→1.1.1` is **production-bundle-reachable** (verified: `node-stdlib-browser@1.3.1` → `string_decoder ^1.0.0`, via `vite-plugin-node-polyfills` in all three app configs). Build `apps/extension` before and after the dedupe and compare which module versions vite resolves into the bundle (vite build metadata / module list); the delta must be exactly the reviewed pairs. Flag the bundled downgrades explicitly in the PR body.
- Before/after `bun audit --audit-level=low` diff — no new advisories on the collapsed targets.
Add the CI step to `_lint-and-typecheck.yml` as **ADVISORY** (codex ruling — adopted): a named "bun dedupe check (advisory)" step with `continue-on-error: true` that writes the duplicate set to the step summary. NOT blocking: dedupe's range-intersection normalization can oscillate with `bun update` and would red the required quality-status (which release.yml and nightly.yml also consume) on unrelated transitive churn. Promotion to blocking is a future deliberate flip once update→dedupe is stable and a downgrade policy exists.
**Validation gate**: `$B dedupe --check` reports 0 duplicates · pair-review + bundle-resolution comparison documented in `lessons/phase-3.md` · `$B run test` green · `$B run lint` + `$B run lint:actions` exit 0. Layers: lint + unit + build-resolution audit.

### Phase 4 — Script parallelization (own commit; includes `concurrently` removal → small lockfile diff)
`audit:vue` → `bun run --parallel typecheck:all test lint && bun run build`; `apps/extension` `dev:full` → `bun run --parallel dev:chrome dev:firefox`; delete `concurrently` from devDependencies. Watch memory pressure during the parallel legs (three heavy processes; if the host struggles, note it in lessons — correctness is unaffected, and CI runs these as separate jobs regardless).
**Validation gate**: `$B run audit:vue` exit 0 end-to-end (three prefixed legs concurrent, then build) · `timeout 60 $B run dev:full` shows BOTH prefixed startup lines before the kill · `grep -rn concurrently apps/extension/package.json` returns nothing. Layers: typecheck + unit + lint + build (the full audit:vue battery).

### Phase 5 — Renovate bunx swap + workflow permissions + #25305 verification
Swap `_lint-and-typecheck.yml:77` to `bunx --package renovate@43.150.0 renovate-config-validator --strict --no-global renovate.json`; rewrite the step's re2 comment to record the 1.4 retest. Add `permissions: contents: read` at the top of `_lint-and-typecheck.yml` (codex hardening — adopted; currently inherits repo default). Document in the step comment that the validator's transitive closure is dynamically resolved at run time — **exactly as it already was under npx** (the swap is exposure-neutral; see A4).
**Clean-cache probe (codex condition)**: re-run the bunx validator with a fresh, empty Bun cache dir (temp `BUN_INSTALL_CACHE_DIR`) to mimic CI cold start.
**#25305 mock-registry probe (codex design — adopted)**: in the scratchpad, stand up a minimal local npm registry serving 4 packuments: `parent@1.0.0` (old timestamp) / `parent@1.1.0` (young), `child@1.0.0` (old) / `child@1.1.0` (young), both parent versions depending on `child: ^1`. Seed a lockfile WITHOUT the gate proving 1.1/1.1 resolves; clone the seed, enable `minimumReleaseAge = 604800`, run `bun update --latest` under BOTH 1.3.14 and 1.4.0. Parent downgrading = the age-gated update path fired (positive control); child ALSO downgrading under 1.4 but not 1.3 = #25305 fixed. Use explicit `time[version]` fields with wide margins; assert none missing (Bun treats missing time as passing). **Fail-safe**: if the probe is inconclusive within a reasonable time-box, RETAIN the workaround text — never retire it without a positive-control pass. Record the outcome truthfully in `bunfig.toml`'s comment block.
**Validation gate**: bunx step green locally under `$B` warm AND cold cache ("Config validated successfully" both) · `$B run lint:actions` exit 0 · probe outcome + evidence (both runtimes, both controls) in `lessons/phase-5.md`. Layers: lint(workflows) + empirical probe.

### Phase 6 — Docs + dep-review workflow
SECURITY.md "Dependency policy": add the 1.4 pm workflow (`bun pm diff` on every manual bump/Renovate PR review, `bun audit fix --dry-run` for advisory triage, `bun pm licenses --prod --json` on release prep, `bun pm ls --trusted` when touching trustedDependencies) + the #25305 outcome + the fleet-cutover note (repo now requires bun ≥1.4). CLAUDE.md dependency-policy TL;DR updated to match. Final consistency pass over bunfig comments.
**Validation gate**: `./scripts/check-no-brand.sh` exit 0 · full battery: `$B run audit:vue` + `$B run test:all` (codex condition — per-package suites, not just the extension aggregate) + `$B test scripts/release/ scripts/ci-cd/` + `$B run lint:actions` all exit 0. Layers: everything cheap + the full local battery.

## Security & Adversarial Considerations

- **Toolchain supply chain**: Bun 1.4.0 released 2026-08-20 — 4 days old at planning. Our 7-day `minimumReleaseAge` governs npm deps, not the runtime, but the spirit applies → Ask A1. The pin is EXACT (`bun@1.4.0`, the artifact all local+CI validation ran on); any later re-pin restarts validation — "newest 1.4.x at merge" is explicitly rejected (codex: it resets the soak window). CI installs via `oven-sh/setup-bun@v2`; **the v2 tag is mutable** — SHA-pinning is the stronger boundary but is a repo-wide convention change (every action here is tag-pinned), deferred to a dedicated hardening pass rather than done inconsistently for one action (Audit log R2).
- **Dynamically resolved CI executable (A4)**: the renovate-config-validator step resolves `renovate@43.150.0`'s transitive closure fresh at run time — under bunx exactly as under today's npx; NEITHER applies bunfig's min-age gate (bunx bunfig coverage is not documented and an open Bun issue reports its age flag as a no-op). The swap is exposure-neutral; the alternatives are vendoring renovate as a devDependency (rejected: enormous tree entering our lockfile/audit surface for one config check) or removing the check. Accepted + documented in-workflow; owner sign-off via A4.
- **`bun dedupe` downgrades**: range-intersection collapses can LOWER transitives, and `string_decoder` is production-bundle-reachable — hence Phase 3's pair-by-pair release review + pre/post bundle-resolution comparison + audit diff, and the PR body flags the bundled downgrades. The CI check is advisory precisely so a required check never pressures anyone into accepting unreviewed downgrades.
- **Workflow edits**: `pr-quick.yml` produces the required `quality-status` check — the fold must not alter job topology, filters, or check names (behavior-gating test + actionlint gate this). `_lint-and-typecheck.yml` gains explicit `permissions: contents: read` (least privilege; it also runs under release.yml and nightly.yml). The advisory dedupe step cannot red any consumer.
- **Lockfile v2**: adds integrity requirements for off-registry tarballs + git-entry path-traversal validation — a strict hardening. The compat break is availability, not integrity (A3 cutover).
- **Injection/validation, crypto, authn**: N/A — no runtime code paths change. The extension bundle changes ONLY via the reviewed dedupe pairs (Phase 3 verifies exactly that).
- **1.4's inherited hardening**: credentials never cross-origin/downgraded; tarball extraction + bin-link escape hardening; full-byte trustedDependencies matching; workspace-wide audit scanning.

## Assumptions

**Facts (verified)**
1. Pin surface = exactly 7 occurrences across 3 files + CLAUDE.md prose (recon table, file:line, re-verified at base ea9be876).
2. `bun.lock` is `lockfileVersion: 1, configVersion: 1` (head read).
3. `bun:test` usage is confined to `scripts/release/` + `scripts/ci-cd/`; zero `resetAllMocks`; every `toContain` operates on arrays of strings (string elements ⇒ `===` vs `Object.is` indistinguishable) — and empirically: 94/94 tests pass under Bun 1.4.0 unmodified.
4. `bun run --parallel/--sequential/--no-exit-on-error` exist in 1.4.0 (`--help` probe).
5. Current lockfile has 4 duplicate versions; `dedupe --check` exits non-zero today (probe).
6. `bunx --package renovate@43.150.0 renovate-config-validator` succeeds under 1.4.0 — re2 loads (probe; warm cache — Phase 5 adds the cold-cache control).
7. `concurrently`'s only LIVE references are `apps/extension/package.json` (script + devDependency); `bun.lock` entries disappear with the removal install.
8. The commitlint job checks out before its inline setup steps; the composite requires a prior checkout (both read).
9. **Bun 1.3.14 cannot install against a 1.4-written v2 lockfile** — verified in a scratch project: frozen install errors (`Ignoring lockfile … lockfile is frozen`); unfrozen would rewrite the format down.
10. `string_decoder` is reachable from `node-stdlib-browser@1.3.1` (direct dep, `^1.0.0`), which `vite-plugin-node-polyfills` (all three app vite configs) wraps — the dedupe target is production-bundle-relevant (bun.lock:1812).
11. `_lint-and-typecheck.yml` has no `permissions` block today (grep).

**Inferences (attackable)**
1. The Bun bump does not change how Vitest/Puppeteer suites EXECUTE (node shebang → Node runtime either way) — but Bun still owns install/resolution beneath them, so "unaffected" holds only through the install-integrity gates (Phase 2 tuple diff, Phase 3 pair review) plus the full battery under `$B`.
2. The lockfile v2 rewrite is resolution-neutral for this dependency set (changelog claim; Phase 2's tuple-diff abort guards it).
3. `audit:vue`'s three first legs are concurrency-safe (tsc/vue-tsc read-only, vitest writes only its own cache, biome read-only); contention is a slowdown/memory risk, not correctness — watched in Phase 4.
4. CI cache behavior after the bump: the `-bun-` fallback restore key can restore a 1.3-era download cache — harmless (content-addressed tarball cache; integrity is checked per install), so no cold-start cliff either way.

**Asks (explicit, none silent)**
- **A1 — merge timing + exact pin**: 1.4.0 is 4 days old. Pin is exactly `bun@1.4.0` (the validated artifact). Options: merge when green (recommended — runtime ≠ npm-dep policy; full local battery + CI validate it), or wait until 2026-08-27 for 7-day parity. A later 1.4.x re-pin = a fresh validation pass, never a silent swap. Owner decides at the gate.
- **A2 — dedupe --check mode**: codex ruled ADVISORY; adopted as the plan default. Owner may override to blocking at the gate (not recommended until update→dedupe is oscillation-stable).
- **A3 — fleet cutover (MERGE PRECONDITION) — RESOLVED: delegated to the agent** (owner, 2026-08-24: "Add to your plan for upgrading my local bun to 1.4"). The agent installs exactly 1.4.0 over the machine-wide binary (official install script, `BUN_VERSION=1.4.0`, default `~/.bun` prefix) when the PR is green and ready to merge — as late as possible to minimize the window in which a 1.4 plain `bun install` in another v1-lockfile worktree would rewrite that lockfile to v2. This PR must NOT merge before that upgrade has run.
- **A4 — dynamically resolved CI executables**: the renovate validator's transitive closure floats at run time (status quo under npx, unchanged under bunx). Accept-and-document (recommended), vendor renovate (rejected — see Security), or drop the check. Owner confirms at the gate.

## Delivery

**Single arc → single PR** to dev via `gh pr create` (no stack ceremony). Branch `worktree-bun-1.4-bump`. Commits, in order: docs(plan) dossier+plan artifacts · chore(deps) pin bump + CI fold · chore(deps) lockfile v2 · chore(deps) dedupe + advisory CI check · feat(scripts) parallel audit:vue/dev:full · chore(ci) bunx renovate + permissions + #25305 outcome · docs(security) pm workflow. PR title (≤93 chars): `chore(deps): bump bun to 1.4.0 (pin dedupe, lockfile v2, parallel scripts, pm workflow)`. PR body MUST carry: the A3 fleet-cutover precondition, the A1 timing note, the dedupe downgrade pairs (incl. the bundle-reachable `string_decoder`), and the local `>=1.4` requirement.

## Post-implementation (self-contained — the implementing session executes THIS, not the skill)

1. Run `/code-review max --fix` on the full implementation diff → skim applied fixes → commit them separately from implementation commits.
2. Codex post-impl audit (`/codex xhigh`): send the net diff from base ea9be876, a summary of the code-review commits, this plan.md + the Audit log, an explicit adversarial/security ask, and this rule verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. Iterative fix loop: verify codex's factual claims against the repo first; apply accepted fixes; commit; log the round in `lessons/`; RESUME the same codex session with the fix diff for re-review. Repeat until a round yields no new material findings; still churning after 3 rounds → stop and surface.
4. Delivery: `gh pr create` against dev with the title/body above; `gh pr checks --watch`; red required check → flake re-run or real fix, never neutralize.
4b. **Machine-bun upgrade (owner-delegated A3)**: once the PR is green and ready, install exactly 1.4.0 over the machine-wide binary (official install script with `BUN_VERSION=1.4.0` into the default prefix), verify `bun --version` = 1.4.0, and note it in the PR. Only then is the PR mergeable. Merge is squash, owner-triggered.
5. Wrap-up: mark phases ✓ here, update `implementations-plan/index.md` (bun-1.4-bump → completed), `agent-worktree status bun-1.4-bump "done: PR #N"`.

## Audit log (adopted vs rejected)

Codex round 1 (session `01a03421-a1cb-7882-8a89-a2c47923e700`, xhigh, fresh): **conditional approve** — full transcript in [audit-codex.md](audit-codex.md).

| # | Finding | Disposition |
|---|---|---|
| C1 | `dedupe --check` must be advisory, not blocking (oscillation risk; reusable workflow feeds release/nightly) | **Adopted** — Phase 3, A2 |
| C2 | Lockfile v2 = fleet cutover; 1.3.14 breaks on the merged lockfile | **Adopted + independently verified** (Fact 9) — A3 upgraded to merge precondition |
| C3 | bunx transitive closure floats, unprotected by bunfig min-age | **Adopted with correction**: npx has the identical exposure — the swap is exposure-neutral. Documented in-workflow + Ask A4 (accept / vendor / drop) |
| C4 | #25305 live-dep probe can pass without exercising the bug → mock-registry positive-control design | **Adopted** — Phase 5, with retain-workaround fail-safe |
| C5 | Semantic lockfile gates: tuple diff, double-install fixed point; `test:all` in final battery; cold-cache bunx probe; audit-diff on dedupe | **Adopted** — Phases 2/3/5/6 gates |
| C6 | `string_decoder` downgrade is production-bundle-reachable; "byte-identical bundle" claim false | **Adopted + independently verified** (Fact 10) — Phase 3 bundle-resolution comparison + PR-body flag |
| C7 | Facts 3/7 imprecise; Vitest-"unaffected" + cold-cache inferences wrong | **Adopted** — reworded (Facts 3/7, Inferences 1/4) |
| C8 | `permissions: contents: read` on `_lint-and-typecheck.yml` | **Adopted** — Phase 5 (Fact 11) |
| C9 | SHA-pin `oven-sh/setup-bun` instead of the mutable v2 tag | **Deferred with reason** (R2): every action in this repo is tag-pinned; one-off SHA-pinning is inconsistent security theater. Queued for a dedicated repo-wide actions-hardening pass. |
| C10 | "Newest 1.4.x at merge" resets the soak window | **Adopted** — A1 pins exactly 1.4.0; re-pin = fresh validation |

Unresolved disagreements: none. R2 (C9) is a deliberate deferral, not a dispute.

## Seeds

Finalized post-approval; drafts live in the ELI5 companion.
**ELI5 Artifact**: https://claude.ai/code/artifact/8a1060e1-0286-4c33-8a27-29b21fdcf379 · source: `implementations-plan/bun-1.4-bump/eli5.html` (redeploying that file updates the same URL).
