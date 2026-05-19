# Dependency hardening + supply-chain age gate (v4 — locked-in)

Consolidated plan covering: (1) `bun.lockb` → `bun.lock` migration; (2) supply-chain defense via `minimumReleaseAge` + `bun audit`; (3) bringing the outdated tree current in risk-tiered phases.

Drafted from two independent plans (mine + a parallel Opus 4.7 draft), reviewed by two independent auditors (a second Opus 4.7 + Codex CLI), reconciled. **v4 — user-locked decisions:**
- All `@aztec/*` updates descoped (v3 — fixture + 4.2.0 → 4.2.1 patch deferred to a future Aztec milestone).
- Age gate set to **14 days** (`1209600` seconds).
- Renovate dropped from this milestone (config draft preserved in §13 for later use).
- `@types/node` stays on `^24.x` (matches CI runtime; pin to Node 24 LTS lifecycle).
- `bun audit` is advisory.
- Bun pinned exact to `1.3.13`.
- Vite 8 (Phase 5b) carries an explicit fallback path — if `vite-plugin-node-polyfills` chokes, revert and stay on Vite 7; downstream polyfill plugin bump (7e) holds until 5b is proven.

---

## 0. Audit deltas applied (history)

1. **`bun audit --prod` does NOT exist** in bun 1.3.1 (`bun audit --help` confirms). Dropped from CI invocation.
2. **`bun audit` CI shell was masking real failures.** `> audit.json || true` + `continue-on-error: true` swallowed everything. Fixed: capture exit 1 (findings) explicitly; fail on other exit codes.
3. **`key-vectors.test.ts` does NOT lock the Aztec account class-id or address** (v2 finding from Codex). Resolved in v3 by descoping Aztec entirely — fixture not needed until Aztec re-enters scope.
4. **Network e2e baseline is 46/66 passing** (`packages/extension/tests/e2e/README.md:109`). Still relevant context: any phase that touches PXE-adjacent code uses network e2e as advisory, not required.
5. **vitest 4 does NOT require vite 8** (vitest 4 needs Vite ≥6). **Phase 5 SPLIT** into 5a (vitest 4 + landing alignment) and 5b (vite 8).
6. **`_lint-and-typecheck.yml:32`** has a second `bun.lockb` cache-key reference (tsbuildinfo). Phase 0 now lists it explicitly. Confirmed total = 6 references across 4 files.
7. **Excludes list reduced and Aztec-related entries removed** (v3 directive). With Aztec descoped, the Aztec-line packages are exact-pinned and not being bumped, so the age gate is moot for them — no exclude needed.
8. **Renovate config rewritten:** `matchPackageNames` regex (`/^@aztec/`) instead of deprecated `matchPackagePatterns`; `rangeStrategy: in-range` (was `bump`, too churny); `prConcurrentLimit: 3`; routing-plugin group includes `vite-plugin-pages` (was missed). **`@aztec/*` disabled in Renovate so no automated PRs land for Aztec.**
9. **Phase 2 (Renovate config) deferred until after Phase 3** (patch sweep). Renovate JSON sitting on disk does nothing until the App is enabled; the patch sweep proves test gates first.
10. **Bun pin: 1.3.13** (current as of 2026-04-20 per [Bun blog](https://bun.com/blog/bun-v1.3.13)), not 1.3.1.
11. **`bun ci`** replaces `bun install --frozen-lockfile` in CI after Phase 0 (clearer intent).
12. **Bun cache key now includes bun-version** so a Bun upgrade doesn't reuse stale cache.
13. **landing + playground gates** added explicitly. Root `audit:vue` only builds the extension; vite/vitest/TS phases must run `bun run --cwd packages/landing build` and `bun run --cwd packages/playground typecheck` + build.
14. **Out-of-scope follow-ups** section added for full-pipeline supply-chain risks the audits surfaced (`release-it@latest` in release.yml:228, `curl | bash` Aztec installer + actionlint download).
15. **PR map**: 10 PRs base, +1 conditional on Zod 4 inclusion (was 11 in v3; 13 in v2; 18 in v1).

---

## 1. Goals & non-goals

**Goals**
1. Shrink the window between a malicious npm publish and our install footprint via `minimumReleaseAge` + `bun audit` + `bun pm scan` in CI.
2. Migrate to text `bun.lock` so every dep PR is diff-reviewable.
3. Replace `bun-version: latest` with a concrete pin so Bun regressions don't break every PR overnight.
4. Take all safe within-range bumps, then knock out single-major bumps in order of blast radius. Defer the two genuine rewrites (Zod 4, vue-router 5).
5. Stand up Renovate with the same gate + sensible groups + Aztec disabled.

**Non-goals**
- **Bumping any `@aztec/*` package** (including the 4.2.0 → 4.2.1 patch). User-directed descope. Aztec gets its own milestone when it re-enters scope, with the class-id/address fixture as a prerequisite.
- Adding the `SchnorrAccountContractArtifact` class-id + `NuloAccount.address` invariant fixture. It's a prerequisite for Aztec bumps and follows Aztec back into scope.
- **Renovate automation.** User-directed descope. Config draft preserved in §13 for re-introduction when wanted.
- **Bumping `@types/node` past 24.** User-directed; matches Aztec's Node 24 baseline.
- Replacing `@wonderland/aztec-fee-payment` GitHub tarball or `@alejoamiras/aztec-accelerator` fork.
- Removing `release-it@latest`, `curl | bash` Aztec installer, or `actionlint` curl-download. (Tracked as follow-up §11.)
- Network-test-triage backlog. Used as advisory gate here; the suite itself is a separate effort.
- Branch protection changes (repo private per stored memory).

---

## 2. Recon summary (audited and verified)

- **Bun 1.3.1 local; CI uses `bun-version: latest`** at two sites: `.github/actions/setup-bun/action.yml:12-14` (composite) + `.github/workflows/pr-quick.yml:128-130` (inline, commitlint job only).
- **Bun 1.3.13 is current** (April 2026). Plan pins to 1.3.13.
- **Lockfile is `bun.lockb` (binary).** 6 references in CI:
  - `setup-bun/action.yml:19` (main cache key)
  - `pr-quick.yml:68` (paths-filter root-config)
  - `pr-quick.yml:82` (paths-filter firefox-touching)
  - `pr-quick.yml:134` (commitlint cache key)
  - `pr-smoke-e2e.yml:77` (paths-filter smoke-surface)
  - `_lint-and-typecheck.yml:32` (tsbuildinfo cache key)
- **`bunfig.toml` does not exist.**
- **`bun audit`** flags: `--json`, `--audit-level=<low|moderate|high|critical>`, `--ignore=<CVE>`. **No `--prod` flag.**
- **`bun pm scan`** exists, separate from `bun audit` — scans the entire installed lockfile for known-bad packages.
- **`key-vectors.test.ts` deferred vectors** (`:53-62`): V4/V7b/V10/P2 require BB.js WASM, crash in jsdom. **The unit-level test does NOT lock account class-id or address.** This is what audit caught.
- **Network e2e baseline: 46/66** (`tests/e2e/README.md:109`). 18 known failures predating this work (importToken 14, contacts-sender 3, data-registerSender 1). Cannot be a required gate yet.
- **Out-of-scope supply-chain surfaces (flagged for §11 follow-up):**
  - `release.yml:228, 241` — `bunx --bun release-it@latest`
  - `actionlint.yml:62` — `bash <(curl -fsSL …actionlint.bash)`
  - `setup-aztec/action.yml:40` — `curl -fsSL https://install.aztec.network/$AZTEC_VERSION/install | bash`
- **Workspaces (8):** wallet-core, wallet-crypto, extension-messaging, aztec-runtime, wallet-bridge, extension, playground, landing.
- **`zod` is a `peerDependency` (optional)** in `extension-messaging/package.json:24-31` at `^3.23.8`. Zod 4 transition requires `^3 || ^4` range first.
- **vitest divergence**: landing `^2.1.9`; all others `^3.2.4`.
- **TypeScript range mix**: `~5.9.2` in 5 packages; `^5.9.2` in 3.
- **Special deps NOT auto-bumped**: `@alejoamiras/aztec-accelerator`, `@defi-wonderland/aztec-standards@4.2.0-aztecnr-rc.2`, `@wonderland/aztec-fee-payment` (tarball URL), `@aztec/viem@2.38.2` (separate line).
- **Routing-plugin coexistence**: `vue-router ^4.5.1`, `unplugin-vue-router ^0.15.0`, AND `vite-plugin-pages ^0.33.1` are all in `extension/package.json`. The active router path uses `vue-router + vite-plugin-pages` (per `popup/index.ts:21`).

---

## 3. Risk register (post-audit)

| Area | Risk | Mitigation |
|---|---|---|
| Phase 0 lockfile migration | Cache keys silently miss → cold installs every PR. The `--save-text-lockfile` flag is mutating despite `--frozen-lockfile`. | Single dedicated PR. Update all 6 references. Sequence validation explicitly: convert → delete `bun.lockb` → fresh `bun install --frozen-lockfile` → `audit:vue`. Use `bun pm ls --all` before/after diff to prove zero behavior change (lockfile hashes differ by format, not informative). |
| `minimumReleaseAge` syntax unverified | bunfig camelCase mapping of `--minimum-release-age` CLI flag is plausible but not proven. Wildcard support unverified. | Phase 1 includes a smoke-prove: `bun add some-old-package@some-fresh-version` should fail. Bunfig file commented with docs link. If wildcards don't work, fall back to explicit names. |
| `bun audit` masking failures | `> audit.json \|\| true` + `continue-on-error` hides legit command failures. | Explicit exit-code dispatch: exit 0 → no findings; exit 1 → findings (advisory at first); any other exit → fail loud. |
| Network e2e baseline is noisy | 46/66 passing (18 known failures predating this work). | This plan doesn't trigger network e2e on any phase. If a phase touches PXE-adjacent code in future, network e2e is **advisory**, not required. |
| Zod 4 transition | 10 source files; `extension-messaging` peerDep optional at `^3.23.8`. | DEFER. If revisited: bump peerDep to `^3 \|\| ^4` first in its own PR. |
| vue-router 5 | Active path is vue-router + vite-plugin-pages (NOT unplugin-vue-router). Navigation is central. | DEFER. Wait for forcing function. Justification corrected per Codex. |
| vite 8 + vitest 4 | Independent (vitest 4 needs Vite ≥6). | Split into two PRs. vitest 4 + landing align first (5a); vite 8 second (5b). |
| `setup-bun: latest` | Bun release lands a regression → every PR fails. | Pin to 1.3.13. Renovate's github-actions manager bumps it later. Both call sites. |
| Cache key omits bun-version | After a Bun bump, stale install cache is reused. | Add `${{ inputs.bun_version }}` to cache keys (composite + commitlint inline). |
| Renovate PR swamp | Unbounded PRs crush single-reviewer bandwidth. | `prConcurrentLimit: 3`. Off-hours schedule. No auto-merge. |
| Test gates miss landing/playground | Root `audit:vue` only builds extension. | Phases 5/6 add explicit `bun run --cwd packages/landing build` + `bun run --cwd packages/playground build` + their typechecks. |
| Out-of-scope supply chain | `release-it@latest`, curl-download installs in CI. | Flagged in §11; separate hardening topic. |

---

## 4. Phased plan

Each phase = one PR into `dev`. PRs 0→3 are sequential; PRs 4+ parallelizable but serial for review bandwidth.

### Phase 0 — Lockfile migration + pin Bun + cleanup

**Scope**
- Migrate: `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`. Delete `bun.lockb`.
- Update all 6 CI references `bun.lockb` → `bun.lock`:
  - `.github/actions/setup-bun/action.yml:19` (main cache key)
  - `.github/workflows/pr-quick.yml:68, 82, 134`
  - `.github/workflows/pr-smoke-e2e.yml:77`
  - `.github/workflows/_lint-and-typecheck.yml:32` (tsbuildinfo cache)
- Pin Bun in both `setup-bun` sites:
  - `setup-bun/action.yml`: `bun-version: 1.3.13`
  - `pr-quick.yml` commitlint inline: `bun-version: 1.3.13`
- Add bun-version to cache keys so a Bun bump invalidates: `key: ${{ runner.os }}-bun-1.3.13-${{ hashFiles('bun.lock') }}`.
- Replace `bun install --frozen-lockfile` → `bun ci` in CI (clearer intent; same semantics).
- Add to root `package.json`: `"packageManager": "bun@1.3.13"`. Drop `patchedDependencies: {}` empty leftover (already touching the file).

**Validation**
- `bun pm ls --all > /tmp/before.txt` (before migration).
- After migration: `bun pm ls --all > /tmp/after.txt`. `diff /tmp/before.txt /tmp/after.txt` must be empty.
- `bun ci` → succeeds.
- `bun run audit:vue` → green.
- CI dry-run: cache restores on second PR push (proves new key).

**Blast radius:** zero behavior change.

---

### Phase 1 — `bunfig.toml` + `bun audit` advisory gate

**Scope**

Create `bunfig.toml` at root:
```toml
[install]
# Block packages published in the last 14 days. See SECURITY.md
# "Dependency policy" for rationale and CVE-bypass workflow.
# CLI equivalent: --minimum-release-age=1209600
minimumReleaseAge = 1209600

# No excludes today. Aztec-line packages are exact-pinned and out of scope
# for this milestone, so the gate is moot for them. If/when Aztec re-enters
# scope, add the relevant package names here.
minimumReleaseAgeExcludes = []
```

Notes:
- `@nulo/*` not listed (workspace deps don't fetch from npm).
- `@aztec/*` not listed (exact-pinned, not bumping in this milestone — gate is moot).
- `@wonderland/aztec-fee-payment` not listed (resolves from GitHub URL, not npm — gate is moot).
- `@defi-wonderland/aztec-standards` and `@alejoamiras/aztec-accelerator` not listed (exact-pinned).
- `@types/*` and `chrome-types` not listed (no carve-out today; can revisit if `@types/node` patches get blocked at install time).

Add `bun audit` step to `_lint-and-typecheck.yml`:
```yaml
- name: bun audit (advisory)
  run: |
    set +e
    bun audit --audit-level=moderate --json > audit.json
    code=$?
    set -e
    if [ "$code" -eq 0 ]; then
      echo "No advisories ≥ moderate."
    elif [ "$code" -eq 1 ]; then
      echo "::warning::Advisories found (advisory gate)"
      jq -r '...' audit.json || cat audit.json
    else
      echo "::error::bun audit failed unexpectedly (exit $code)"
      exit "$code"
    fi
  continue-on-error: false  # advisory via warning, not via swallowing failures
- uses: actions/upload-artifact@v5
  if: always()
  with:
    name: bun-audit
    path: audit.json
```

Update `SECURITY.md` with a "Dependency policy" section:
- Why the gate exists.
- CVE-on-Friday runbook: temporarily add to `minimumReleaseAgeExcludes`, install the patched version, open follow-up PR removing the exclude after window. Pair with Renovate's `vulnerabilityAlerts.minimumReleaseAge: "0 days"` (Phase 2).
- Bun #25305 workaround (`bun update --latest` doesn't apply gate to transitives; delete `bun.lock` for full re-resolves).

**Validation**
- `bun ci` → unchanged (existing lockfile pre-dates gate).
- Smoke-prove gate fires: `bun add some-package@some-very-fresh-version` (a real fresh package) → install rejects with age error. Verify and revert.
- `bun audit --audit-level=moderate --json` → record output, annotate PR with findings + which later phases resolve each.
- `bun run audit:vue` → green.

---

### Phase 2 — In-range patch sweep

**Scope**
One PR. `bun update` (no `--latest`). Lockfile-only diff.

Expected bumps (subject to age-gate filtering on the day):
- `@codemirror/{autocomplete,search,view}`
- `vue`, `@vue/compiler-sfc`, `@vue/test-utils`, `@vitejs/plugin-vue`
- `vite` (7.3.2 → 7.3.3 within caret)
- `vue-tsc`, `vite-plugin-vue-devtools`
- `@storybook/*` 10.3.5 → 10.4.0
- `postcss`, `puppeteer` (within caret), `chrome-types`, `@types/node` (stay on 24 major)
- `@biomejs/biome` (resolved 2.4.11 → 2.4.15; manifest range unchanged)
- `@commitlint/*` (within caret)

Annotate PR description: "Manifest ranges unchanged; only resolved versions move."

**Validation**
- `bun run audit:vue`.
- `bun run test:e2e` (smoke — Vue/CodeMirror could regress popup rendering).
- Network e2e skipped (no Aztec/RPC change).

---

### Phase 3 — [DESCOPED]

User-deferred. Renovate config draft preserved in §13 for later use.

---

### Phase 4 — [DESCOPED]

Originally planned: Aztec invariant fixture (4a) + `@aztec/*` 4.2.0 → 4.2.1 patch bump (4b). **Removed per user directive — Aztec is out of scope for this milestone.** Both pieces stay together: the fixture is a prerequisite for the bump, not a standalone deliverable. When Aztec re-enters scope, this phase comes back as the entry point.

---

### Phase 5 — Vitest 4 + landing alignment, then Vite 8 (split into 5a + 5b)

#### Phase 5a — Vitest 4 across the monorepo + landing alignment

**Scope**
- `vitest ^3.2.4 → ^4.x` in: extension, wallet-core, wallet-crypto, wallet-bridge, aztec-runtime, extension-messaging.
- `landing`: `vitest ^2.1.9 → ^4.x` (two majors of catch-up; same PR).
- Walk each `vitest.config.ts` (5 files) + `vitest.e2e.config.ts` + `vitest.e2e.network.config.ts` + `vitest.e2e.all.config.ts` for legacy options.

**Validation**
- `bun run typecheck:all`.
- `bun run test:all` (every workspace runs its own vitest).
- `bun run test:components`.
- `bun run --cwd packages/landing test`.
- Smoke e2e (uses vitest-as-runner): `bun run test:e2e`.

#### Phase 5b — Vite 8 across the monorepo

**Known concern (user-flagged):** prior trouble with `vite-plugin-node-polyfills` against a Vite 8-ish stack. Plan handles this with an explicit fallback path; **if the polyfill plugin breaks, this PR reverts and we stay on Vite 7 for now.**

**Scope**
- `vite ^7.x → ^8.x` in: extension, playground, landing.
- Verify plugin-stack compat in `packages/extension/vite.config.ts`. Vite 8 plugin-API changes potentially affect: `@vitejs/plugin-vue`, `unplugin-*`, `vite-plugin-pages`, `vite-plugin-static-copy`, `vite-plugin-node-polyfills`, `@crxjs/vite-plugin`.
- **Compat-check sequence before merging:**
  1. Bump only Vite. Keep plugin versions.
  2. Build all three workspaces (extension, landing, playground).
  3. Run smoke e2e against the built extension.
  4. If `vite-plugin-node-polyfills` errors during build OR popup boot OR e2e: **revert this PR**. Stay on Vite 7. Open a follow-up issue tracking the upstream plugin's Vite 8 support. Phase 7e (polyfill major bump) auto-holds.

**Validation**
- `bun run audit:vue`.
- `bun run --cwd packages/playground build` + `typecheck`.
- `bun run --cwd packages/landing build`.
- `bun run build:firefox` (verifies the Firefox manifest variant builds — Firefox uses a different plugin invocation).
- Smoke e2e (`bun run test:e2e`).
- Manual: load `dist/chrome/` as an unpacked extension; popup opens; no console errors.

**Fallback if 5b fails:** revert. Phase 7e (`vite-plugin-static-copy` + `vite-plugin-node-polyfills` bump) is then on hold pending upstream plugin compatibility. Plan continues from Phase 6.

---

### Phase 6 — TypeScript range alignment + (conditional) TS 6

**6a — Range alignment.** Unify to `^5.9.3` everywhere (tilde-pinned packages get caret). Lockfile-only result (no version moves).

**6b — TS 6 bump (conditional).** Verify `vue-tsc` 4.x supports TS 6 first. If yes: `^5.9.3 → ^6.x` across all workspaces. If `vue-tsc` lags, DEFER.

**Validation**
- `bun run typecheck:all`.
- `bun run --cwd packages/landing typecheck`, `bun run --cwd packages/playground typecheck` (root `typecheck:all` runs `--filter '@nulo/*' typecheck` — confirm it covers landing+playground via their own scripts).
- `bun run audit:vue`.

---

### Phase 7 — Single-major bumps, one PR each (consolidated)

| PR | Bumps | Gate |
|---|---|---|
| 7a | `jsdom ^26 → ^29` | `bun run test:all` |
| 7b | `globals ^16 → ^17` + `@commitlint/cli ^20 → ^21` (small tooling, bundled) | `bun run lint`; trial PR with test commits for commitlint |
| 7c | `puppeteer ^24 → ^25` | `bun run test:e2e` + `bun run e2e:agent` (advisory) |
| 7d | `focus-trap ^7 → ^8` | `bun run test:components` + smoke + manual click-through (Popup, FormPopup, DropdownRoot) |
| 7e | `vite-plugin-static-copy ^3 → ^4` + `vite-plugin-node-polyfills ^0.24 → ^0.27` (**polyfills bump conditional on 5b not reverting**) | build + smoke + `dist/chrome/` listing diff; if 5b reverted, this PR ships static-copy only |
| 7f | `unplugin-auto-import ^20 → ^21` + `unplugin-vue-components ^29 → ^32` | typecheck (catches auto-import drift) + smoke |

`vite-plugin-pages` and `unplugin-vue-router` deliberately omitted from 7f — they pair with vue-router 5 (deferred); kept current via Renovate's routing group.

---

### Phase 8 — Breakers (DEFER candidates)

| PR | Bump | Status |
|---|---|---|
| 8a | `zod 3 → 4` | DEFER (no security/feature win; 10 files of schema rewrite + peerDep transition). |
| 8b | `vue-router 4 → 5` | DEFER. Active path uses `vue-router + vite-plugin-pages` (per `popup/index.ts:21`); navigation is central. Wait for forcing function. |

If user pulls into scope: Zod first requires bumping `extension-messaging/package.json:24-31` peerDep to `^3 \|\| ^4` in a precursor PR.

---

### Phase 9 — Docs (folded into final behavior PR)

- Update `CLAUDE.md` with "Dependency policy" subsection (gate, excludes, CVE-runbook, bun #25305 workaround, `bun audit` advisory).
- Plan archive: this file.

---

## 5. Test gating per phase

Goal: every gate justified; no blanket "run everything."

| Phase | typecheck | units | lint | build | smoke e2e | network e2e | extra |
|---|---|---|---|---|---|---|---|
| 0 lockfile | – | – | – | – | – | – | `bun pm ls --all` diff (must be empty); `bun ci` |
| 1 bunfig + audit | – | – | – | – | – | – | smoke-prove gate fires; record `bun audit` output |
| 2 patch sweep | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| 3 [DESCOPED] | — | — | — | — | — | — | — |
| 4 [DESCOPED] | — | — | — | — | — | — | — |
| 5a vitest 4 + landing | ✓ (all) | ✓ (all) | – | – | ✓ | – | `test:components`; `landing` test |
| 5b vite 8 | – | – | – | ✓ | ✓ | – | `landing build`, `playground build`, `build:firefox`, manual extension load. **Revert if `vite-plugin-node-polyfills` breaks.** |
| 6a TS range align | ✓ (all) | – | – | – | – | – | – |
| 6b TS 6 (conditional) | ✓ (all) | ✓ | ✓ | ✓ | – | – | – |
| 7a jsdom | – | ✓ (all) | – | – | – | – | `test:components` |
| 7b globals + commitlint | – | – | ✓ | – | – | – | trial PR for commitlint |
| 7c puppeteer | – | – | – | – | ✓ | advisory | – |
| 7d focus-trap | – | ✓ | – | ✓ | ✓ | – | manual modal click-through |
| 7e vite-plugin-* | – | – | – | ✓ | ✓ | – | `dist/chrome/` listing diff |
| 7f unplugin-* | ✓ | – | – | ✓ | ✓ | – | – |

---

## 6. Supply-chain hardening summary

- **`minimumReleaseAge: 1209600` (14 days)** — conservative posture, user-chosen.
- **Excludes: empty list.** With Aztec descoped, no carve-outs needed.
- **`bun audit`**: advisory in CI with proper exit-code handling. `--audit-level=moderate`.
- **`bun pm scan`**: separate tool. Open question Q8: add as a second gate, or just `bun audit`?
- **`bun.lock` text**: Phase 0. Reviewable diffs ARE a security control.
- **Bun version pinned**: 1.3.13 both call sites + `packageManager` in root.
- **Cache keys include bun-version**: invalidate stale state on Bun bumps.
- **`bun ci`** (not `bun install --frozen-lockfile`) post-migration.
- **Renovate descoped** — config draft preserved in §13 for later.

---

## 7. Open questions for user

**Locked (recorded for reference):**
- ~~Q1 age gate~~ → **14 days** (`1209600`).
- ~~Q4 `@types/node` 25~~ → **defer** (stay on 24, matches Aztec/CI Node 24).
- ~~Q5 `bun audit` severity~~ → **advisory** `--audit-level=moderate`.
- ~~Q6 Renovate auto-merge~~ → **N/A — Renovate dropped from this milestone.**
- ~~Q7 Bun pin~~ → **`1.3.13` exact.**

**Still open:**
1. **Zod 4 in scope?** User asked "doesn't sound that risky?" — my recommendation is **YES, pull in as the last major bump.** ~10 files (schema layer only); peerDep transition handled in a precursor commit; smoke + typecheck catch real regressions. Awaiting final confirmation.
2. **TS 6 (Phase 6b)**: bump if `vue-tsc` supports; defer otherwise. Recommendation = conditional.
3. **`bun pm scan` in addition to `bun audit`**: yes (belt-and-suspenders), or just one? Recommendation = add.
4. **CVE-on-Friday runbook in `SECURITY.md`**: write it during Phase 1 (recommended), or wait? Recommendation = write now.
5. **Out-of-scope follow-ups (§11)**: do those next, or park for now? Recommendation = park. (See §11 for what these are — `release-it@latest`, `curl | bash` installers in CI.)

---

## 8. PR map (10 PRs base, +1 if Zod 4 in scope)

1. `chore(infra): migrate to text bun.lock + pin Bun 1.3.13 + cleanup` (Phase 0)
2. `chore(security): add bunfig.toml minimumReleaseAge + bun audit advisory` (Phase 1)
3. `chore(deps): in-range patch sweep` (Phase 2)
4. `chore(deps): bump vitest to 4 + align landing` (Phase 5a)
5. `chore(deps): bump vite to 8` (Phase 5b) — **revert-on-polyfill-break path**
6. `chore(deps): align TypeScript ranges` (Phase 6a)
7. `chore(deps): bump TypeScript to 6` [conditional on `vue-tsc`] (Phase 6b)
8. `chore(deps): bump jsdom to 29 + globals to 17 + @commitlint/cli to 21` (Phase 7a+7b folded)
9. `chore(deps): bump puppeteer to 25` (Phase 7c)
10. `chore(deps): bump focus-trap to 8 + vite-plugin-static-copy (+ node-polyfills if 5b stuck) + unplugin-auto-import/vue-components` (Phase 7d+7e+7f folded) + docs

**Conditional +1 PR:**
- `chore(deps): bump zod to 4` — if user confirms Zod 4 in scope. Lands LAST (after PR 10) so the base is stable when we touch the RPC schema layer. Precursor commit (same PR): bump `extension-messaging/package.json` peerDep range from `^3.23.8` → `^3 || ^4`.

Phase 3 (Renovate) descoped — comes back later. Phase 4 (Aztec) descoped — comes back as future Aztec milestone. Phase 9 docs folded into PR 10.

Commit message convention: `chore(deps): ...` lowercase subject per `.commitlintrc.json`.

---

## 9. What I'd defer

- **All `@aztec/*` updates** including 4.2.0 → 4.2.1 — user directive; separate Aztec milestone.
- **Renovate automation** — user directive; config draft in §13.
- **`@types/node` 24 → 25** — user directive; stays on 24 (Aztec/CI alignment).
- `vue-router 4 → 5` — user directive; navigation is central; wait for forcing function.
- `@wonderland/aztec-fee-payment` npm migration — upstream concern.
- `@alejoamiras/aztec-accelerator` upstream merge — orthogonal.
- SLSA provenance, lockfile attestation — separate "release-pipeline-hardening" topic.
- `engines.bun`/`engines.node` — small follow-up after Phase 0.
- `SchnorrAccountContractArtifact` class-id + `NuloAccount.address` invariant fixture — follows Aztec back into scope.

*Pending user say-so:* `zod 3 → 4` (recommendation = include).

---

## 10. Notable gaps + flags

- **landing/playground not auto-covered** by root `audit:vue` — explicit per-workspace gates added to Phases 5/6.
- **Bun `bun audit` exit-code semantics on `--audit-level=moderate`**: needs empirical confirmation in Phase 1 — if low-sev findings still exit 1 despite `--audit-level=moderate`, we need `jq` filtering.
- **Routing-plugin coexistence**: `vue-router + vite-plugin-pages` is the active path; `unplugin-vue-router` is also installed but not the primary router. With Renovate out of scope, drift between these is now a manual concern — flag during dep PRs.
- **Vite 8 + `vite-plugin-node-polyfills` history** (user-flagged): prior incompatibility. Phase 5b has the explicit revert path documented; Phase 7e polyfills bump auto-holds if 5b is stuck.

---

## 11. Out-of-scope follow-ups (full-pipeline supply-chain)

Flagged by Codex audit; not in scope for this milestone but worth a follow-up plan:

| Surface | File:line | Risk | Suggested fix |
|---|---|---|---|
| `release-it@latest` | `release.yml:228, 241` | `bunx --bun release-it@latest` pulls newest at release time → supply-chain via release tooling. | Pin to a major.minor; bump via Renovate `github-actions` manager. |
| Aztec installer | `setup-aztec/action.yml:40` | `curl -fsSL https://install.aztec.network/$VER/install \| bash` — no checksum, no provenance. | Pin SHA256 of the installer or vendor it under `.github/scripts/`. |
| actionlint download | `actionlint.yml:62` | `bash <(curl -fsSL …actionlint.bash)` — same shape. | Replace with `reviewdog/action-actionlint@v1` (the Marketplace action). |

---

## 12. CVE-on-Friday runbook (drafted for SECURITY.md)

When a CVE drops for a package within the 14-day age-gate window:

1. **Identify the patched version** from the advisory.
2. **Confirm `bun audit` flags it** (it should — that's the canary).
3. **Open a hand PR:**
   - Edit `bunfig.toml`: temporarily add the package name to `minimumReleaseAgeExcludes`.
   - Run `bun update <pkg>` (or `bun add <pkg>@<version>`).
   - Run full `audit:vue` + smoke e2e.
   - Commit the lockfile change.
   - Open follow-up PR after the window passes: remove the temp exclude.
4. **Communicate.** PR description must cite the CVE and link the advisory.

---

## 13. Renovate config draft (deferred from this milestone)

Saved for when automation is wanted. Mirrors `bunfig.toml`'s age gate, disables Aztec line, groups coupled packages.

```jsonc
{
  "extends": ["config:recommended", ":semanticCommits"],
  "rangeStrategy": "in-range",
  "minimumReleaseAge": "14 days",
  "vulnerabilityAlerts": {
    "enabled": true,
    "minimumReleaseAge": "0 days"
  },
  "prConcurrentLimit": 3,
  "dependencyDashboard": true,
  "labels": ["dependencies"],
  "schedule": ["before 6am on monday"],
  "commitMessagePrefix": "chore(deps):",
  "commitMessageAction": "bump",
  "packageRules": [
    {
      "matchPackageNames": ["/^@aztec/", "@alejoamiras/aztec-accelerator", "@defi-wonderland/aztec-standards", "@wonderland/aztec-fee-payment"],
      "enabled": false,
      "description": "Aztec line: bumped manually with class-id checks (SECURITY.md)."
    },
    { "matchPackageNames": ["vite", "@vitejs/plugin-vue"], "groupName": "vite" },
    { "matchPackageNames": ["vitest", "@vitest/coverage-v8", "@vue/test-utils", "jsdom"], "groupName": "test runner" },
    {
      "matchPackageNames": ["vue-router", "vite-plugin-pages", "unplugin-vue-router"],
      "groupName": "routing",
      "description": "Coupled plugins — bump together to avoid drift."
    },
    { "matchPackageNames": ["/^unplugin-/"], "groupName": "unplugin-*" },
    { "matchPackageNames": ["/^@codemirror/"], "groupName": "codemirror" },
    { "matchPackageNames": ["/^@commitlint/"], "groupName": "commitlint" },
    { "matchPackageNames": ["typescript", "vue-tsc"], "groupName": "typescript" },
    { "matchPackageNames": ["/^@storybook/", "storybook"], "groupName": "storybook" },
    { "matchPackageNames": ["webextension-polyfill", "@types/webextension-polyfill"], "groupName": "webextension-polyfill" },
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": false,
      "description": "Manual review — wallet is security-sensitive."
    }
  ]
}
```

Validation when adopted: `bunx --bun renovate-config-validator renovate.json`, then enable the Renovate App and watch the Dependency Dashboard issue before letting PRs auto-open.

---

*Audited by: Opus 4.7 reviewer + Codex CLI (read-only, xhigh reasoning).*

---

## 14. Actual outcomes (implementation log)

What actually shipped vs what was planned. Per user directive: "Test each commit/phase to understand if they are in or out."

### IN (12 commits, including post-Codex fix-ups)

| Phase | Commit | Notes |
|---|---|---|
| Plan archive | `7b71ac36` | Plan + ELI5 HTML committed first for archive. |
| Phase 0 (slimmed) | `a7e62466` | Bun pinned to 1.3.13 + `packageManager` + bunfig paths-filter. **Lockfile migration DROPPED** — Bun 1.3.1 text-lockfile + `bun ci` materializes duplicate peer-resolved vite copies, breaking vue-tsc. Stay on `bun.lockb`. |
| Phase 1 (revised) | `7551c49d` (originally 3d) → widened to 7d (post-review) | `bunfig.toml` with **7-day gate** (was planned 14 days). Bun 1.3.x applies the gate during `bun install --frozen-lockfile`, blocking installs of currently-pinned-fresh lockfile entries. 7 days is the widest setting that passes against the current lockfile while still catching publish-and-pull-within-hours attacks. Plus `bun audit` advisory step + SECURITY.md "Dependency policy" + CVE runbook. |
| Phase 2 | `b46f83ca` | `bun update` in-range patch sweep: biome 2.4.11→2.4.15, commitlint 20.5.0→20.5.3, plus transitives. |
| Phase 6a | `f97801ae` | TS ranges unified to `^5.9.2` across all 8 workspaces (was tilde mix). |
| Phase 6b | `79d2c91d` | TypeScript 5.9 → 6.0 across all workspaces. vue-tsc 3.2.9 peer accepts TS >=5.0.0; no code changes needed. |
| Phase 7a+b | `86d5dcda` | jsdom 26→29, globals 16→17, @commitlint/cli 20→21 (bundled). |
| Phase 7d+e+f | `052b496c` | focus-trap 7→8 (resolved 8.2.0; 8.2.1 was within gate), vite-plugin-static-copy 3→4, unplugin-auto-import 20→21, unplugin-vue-components 29→32. **vite-plugin-node-polyfills NOT bumped** — paired with descoped Vite 8. |
| Phase 11 (partial) | `5b48f3e9` | Pinned `release-it@latest` → `release-it@20.0.1`. Replaced actionlint `bash <(curl ...)` with SHA-pinned `reviewdog/action-actionlint@v1.72.0`. setup-aztec curl-pipe-bash deliberately untouched per user scope. |
| Phase 9 | `7cd8736f` | CLAUDE.md "Dependency policy" subsection added. |

### OUT (dropped)

| Phase | Reason |
|---|---|
| Phase 0 — `bun.lockb` → `bun.lock` migration | Bun 1.3.1 bug: `bun install --frozen-lockfile` against text lockfile materializes duplicate peer-resolved vite copies, breaking vue-tsc with "two unrelated `Plugin` types." Reverted. Re-evaluate after Bun 1.3.13 lands in CI and Bun's upstream issue is confirmed fixed. |
| Phase 3 — Renovate config | User-deferred. Config draft preserved in §13. |
| Phase 4 — Aztec invariant fixture + `@aztec/*` 4.2.1 | User-deferred (all Aztec out of scope). |
| Phase 5a — vitest 4 | Vitest 4 requires test mock pattern update — `vi.fn(() => mock)` arrow-fn no longer usable as constructor; needs `vi.fn(function () { return mock })`. ~3 test files affected. Not a clean version-only bump. Deferred. |
| Phase 5b — Vite 8 | Coupled with vitest. Vitest 3 (kept) requires Vite 5/6/7 only, NOT 8. Deferred until vitest 4 lands. |
| Phase 7c — puppeteer 25 | All 25.x versions fail to resolve under the 7-day gate: 25.0.2 within gate window, 25.0.0/25.0.1 hit a "but package exists" resolver quirk in Bun 1.3.1. Stays on 24.43.x. |
| Phase 8a — Zod 4 | 55 type errors across 7 source files (pxe schemas, zod-helpers, execution service/authwit-discoverer). Real schema-layer rewrite for `ZodType<X, Y, Z>` → new shape, `_zod` internal marker, ZodIssue path types. Deferred as its own focused PR. |

### Follow-ups recorded

1. **Vitest 4 + Vite 8** — needs test mock pattern updates first. Dedicated PR.
2. **Zod 4** — schema-layer rewrite; ~55 typecheck errors. Dedicated PR.
3. **Puppeteer 25** — wait for 25.0.x to age past gate window OR resolve the bun "but package exists" resolver quirk.
4. **Lockfile text migration** — wait for Bun fix on `bun ci` peer-dup behavior.
5. **`bun audit` exit-code gating** — Bun 1.3.x exits 0 regardless of findings; tune `--audit-level` + JSON parsing once we have signal.
6. **`bun pm scan` scanner choice** — pick a third-party scanner if/when desired.
7. **setup-aztec curl-pipe-bash** — out of scope per user; revisit when Aztec re-enters.
8. **Renovate** — config draft in §13, ready when user wants it.

### Headline

**8 of 13 planned phases shipped (13+ commits total).** Wins: supply-chain age gate (7d) + advisory `bun audit` in CI, Bun version pinned, TypeScript 6, plugin major sweep (focus-trap 8, vite-plugin-static-copy 4, unplugin-auto-import 21, unplugin-vue-components 32, jsdom 29, globals 17, commitlint 21), partial CI pipeline hardening (release-it pin, actionlint Marketplace action).

What didn't land was always a real cost-not-clean-bump signal: zod/vitest/vite all need real code or test-pattern changes; puppeteer hit a bun resolver quirk; lockfile migration hit a bun peer-dup bug.

### Codex implementation review findings (applied)

After the initial 11 commits, sent the implementation to Codex for review. Five substantive issues raised; all addressed:

1. **Gate-window justification challenged.** Codex argued Bun's docs say the gate is resolution-only and shouldn't block frozen-lockfile installs of existing pins. Empirically re-tested — Bun 1.3.1 DOES gate frozen-lockfile installs (`bun install --frozen-lockfile` errors with "blocked by minimum-release-age" on lockfile-pinned puppeteer 24.43.1 when gate is 14d). Bunfig.toml comment updated to cite the empirical repro alongside Bun's contradictory docs. Per user follow-up, widened the gate from 3d to 7d (puppeteer 24.43.1 is ~6.6d old and squeaks through; rest of lockfile is well-aged).
2. **bunfig.toml paths-filter gaps.** Added to `firefox-touching` filter in pr-quick.yml + to pr-network-e2e.yml (was missing entirely).
3. **`bun audit` shell masked tool failures.** Rewrote with explicit exit-code capture; unexpected exit codes emit `::warning::` instead of being silently swallowed.
4. **Commit count off-by-one.** Plan said 10; was 11; with these post-review fix-ups it'll be 12.
5. **actionlint action's Docker tag still mutable.** The SHA pin we did locks the action's `action.yml`, but `action.yml` resolves a Docker image by tag (`v1.72.0`), not by digest. Full image-digest pinning is a follow-up; documented below.

### Follow-ups recorded (updated)

1. Vitest 4 + Vite 8 — coupled, needs test mock pattern updates first. Dedicated PR.
2. Zod 4 — schema-layer rewrite; ~55 typecheck errors. Dedicated PR.
3. Puppeteer 25 — wait for age + Bun resolver quirk fix.
4. Lockfile text migration — wait for Bun fix on `bun ci` peer-dup behavior.
5. `bun audit` exit-code gating — tune once we have signal data.
6. `bun pm scan` scanner choice — pick a third-party scanner if/when desired.
7. setup-aztec curl-pipe-bash — out of scope per user; revisit when Aztec re-enters.
8. Renovate — config draft in §13.
9. **NEW:** actionlint full image-digest pinning — the action pulls `docker://ghcr.io/reviewdog/action-actionlint:v1.72.0` which is still a mutable tag. Fork or vendor a workflow that pins the GHCR digest, or switch to a manual SHA-pinned download with checksum verification.
10. **NEW:** Bun frozen-lockfile gate behavior is undocumented/buggy — file upstream issue and re-test 14d window after a fix.
