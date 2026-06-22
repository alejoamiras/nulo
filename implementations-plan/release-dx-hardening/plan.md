# Release-DX hardening — make dev → main near one-click

**Tier:** `/blueprint deep` · **Status:** ✅ **APPROVED 2026-06-22 (staged rollout)** — implementing

## Approved decisions (2026-06-22)

- **A3** — test repo OK; treat it **best-effort** with **dummy secrets only** (webhook.site hooks + a disposable scratch token). If standing it up yak-shaves, **fall back to unit-tested scripts + `dry_run` + the staged rollout** rather than block — the test repo is never on the critical path for phases 1–3.
- **A5** — accept the brief **double-deploy** window; disabling the faucet's CF dashboard auto-deploy is a **deferred ops task** (the user's, later — documented, not blocking).
- **A6** — **mirror** `bump-minor-pre-major` to the prerelease line (both lines stay 0.x; proven via `release-please --dry-run` on both configs).
- **A7** — **staged rollout**: ship `AUTO_UNSTICK_ENABLED=off` (release **N** = manual unstick, proves the new code is inert) → flip → release **N+1** = first auto-unstick run = acceptance gate. Manual unstick stays the permanent fallback.
- **📘 DOC PRIORITY (user-emphasized, load-bearing)** — the release docs MUST become **teachable**: a future agent/human reads the runbook and can execute the release **cold**, no prior context. Docs update **per-phase as behavior changes** (never drift from shipped state); Phase 8 produces the authoritative teachable runbook + a cold-read self-containment check.

## Summary

Turn the dev→main release from a babysat ~90-minute operation (≈10 manual CLI steps, 3 `--admin` bypasses, a hand-built promote branch, a manual re-baseline PR, a manual Cloudflare redeploy, and a prod faucet bug from a stale env) into a **near one-click** release: merge the promote PR → version, tag, publish, all three deploys, and verification happen automatically, and a stale/misconfigured site **cannot ship silently**. Scope is the reliability set (NOT marketplace publishing). The hard part — validating release automation without cutting real releases — is solved by pulling logic into `bun:test`-able scripts + `dry_run` + a disposable **test GitHub repo**, with the next real release as the closing acceptance gate.

### Target state
1. Promote PR merges → release-please opens the Release PR with the **correct version** (no 1.0.0 surprise).
2. Merge the Release PR → tag + GitHub Release + publish + all deploys happen **automatically, in one `release.yml` run** (no manual unstick).
3. A **fail-closed post-deploy gate** blocks the release if any of the 3 surfaces is stale/misconfigured (would've caught tonight's faucet bug).
4. dev is **auto-re-synced** so the next promote doesn't conflict.

---

## Why this tier (deep)

Blast radius HIGH (a wrong change breaks *every* release) · irreversibility HIGH (auto-unstick creates real tags/releases) · external coupling HIGH (Cloudflare ×2, GitHub Releases API, release-please-action, the test repo, the App token) · security MODERATE-HIGH (release = supply-chain trust boundary; auto-unstick + auto-sync wield `contents:write` + the App key) · novelty MODERATE (release-automation surgery + a test-repo harness + an auto-unstick mirroring an upstream-bug workaround). → **deep**. **Post-impl: recommend `/harden security`** at the end (release pipeline = supply-chain boundary).

---

## Assumptions

### Facts (verified — repo + tonight's release + two research sweeps)

- **F1** — `release.yml`'s `resolve` job already accepts an explicit `tag` on `workflow_dispatch` + bypasses release-please (`release.yml:81-127`). The auto-unstick escape-hatch is **half-built**; today it's manual.
- **F2** — The **v4 abort is an upstream bug in ALL versions** (v3/v4/v5, source-verified — `CLAUDE.md`). Not fixable; only the manual unstick can be **automated**.
- **F3** — `release-please-config.json` lacks `bump-minor-pre-major` → breaking `feat!` → **major (1.0.0)**. CI.md §"Forcing the next-version" documents "breaking → major"; the `release-dev-to-main` ledger chose per-release `Release-As`. **User has now re-approved flipping the config.**
- **F4** — `pr-quick.yml`'s commitlint job lints **only** `base.sha..head.sha` (`:158-162`) — **no PR-title lint at all** (CI.md falsely claims title+commits). On a `base==main` promote PR that range = every dev squash subject not on main, incl. 104-char (#127) / 102-char (#91) → spurious required-`Quality` red. `.commitlintrc.json` uses `config-conventional`'s default `header-max-length: 100`.
- **F5** — `refresh-landing` (`release.yml:289-316`) fires **only on `push:main` + stable + non-dry-run**; skips `workflow_dispatch`. The faucet deploys **dashboard-side** (CF Git-integration) — **no CI job/secret/hook**. **No post-deploy live verification exists**; the landing fetches authoritative release data at BUILD time (`packages/landing/scripts/fetch-latest-release.ts`) but **neither site surfaces it LIVE in the served HTML** for a verifier to read → a naive verifier can false-pass (esp. via a split CDN cache: fresh `build.json` but stale `index.html`/JS).
- **F6** — **🔫 `packages/faucet/.env.example:32` ships the stale `VITE_CHAIN_VERSION=4127419662`** — the literal seed of tonight's prod bug. `chain-info.ts` precedence is URL → `VITE_CHAIN_*` env → testnet default (`4239416255`). Wallet DEFAULT_SEEDS testnet chainId = `4229590296 = 11155111 ^ 4239416255` (`service.ts:77-79`). Stale env → `11155111 ^ 4127419662 = 4138294185` = the exact "No network configured" error. No build-guard exists.
- **F7** — `vite-plugin-node-polyfills` IS configured (faucet + playground `vite.config.ts`), so the inline `process/global/Buffer` stub in `faucet/index.html:9` (+ playground) is **redundant AND already CSP-blocked in prod** (strict `script-src`) → removing it is strictly safe, no hash needed. **Landing has no inline script. Playground is NOT in the release pipeline** (e2e/dev surface) → its removal is cosmetic.
- **F8** — `main` = merge-commit + signed + required `Quality`/`Network e2e`; `dev` = squash-only + PR-required (so `main→dev` can't land a merge commit via PR → ancestry never established → promotes re-diverge unless dev's release-file *content* is kept == main's). Post-release sync is manual (`CLAUDE.md`); skipping it caused tonight's conflict.
- **F9** — **Manifests are BOTH already `0.23.0`** (re-baselined tonight) — the old "stale 0.20.2" is RESOLVED; the auto-sync targets the *next* drift.
- **F10** — `release.yml` (`group: release`) and `release-prerelease.yml` (`group: release-prerelease`) are **different concurrency groups → they can overlap** — central to the auto-unstick race.
- **F11** — `actionlint.yml` shellchecks **only `.githooks` + `packages/extension/scripts`** (`:72`) — not root `scripts/`. New release scripts need coverage (they'll be `.ts`/`bun:test`, but note it).

### Inferences (unverified — attack these)

- **I1 — The test repo rehearses CONTROL FLOW, not PROTECTION-RULE interaction.** Named fidelity gaps it will NOT catch: (1) App-token *signed-commit* enforcement vs `main`'s ruleset (we relax signing in the test repo); (2) real Cloudflare Git-integration / production-branch wiring; (3) `main`/`dev` branch rulesets + required `Network e2e`; (4) real CDN propagation timing. and (5) the real `environment: production` protection rules + secret scope/availability (`release.yml:210,298` gate `attach-assets`/`refresh-landing` on the `production` environment — a relaxed scratch repo won't prove the real repo won't block on env approvals or a missing secret). GitHub Releases-API edge semantics (`--verify-tag`, `target_commitish`-ignored-when-tag-exists) ARE faithful. → the closing **real-release gate (the first AUTO_UNSTICK_ENABLED=true run) is the only true proof** for those five.
- **I2 — `bump-minor-pre-major` × the prerelease line is the fragile compose.** With `versioning: "prerelease"`, a breaking commit might emit `1.0.0-rc` (split semantics) or a malformed bump. MUST be proven by `release-please --dry-run` on **both** configs (Phase 2 gate), never assumed.
- **I3 — Faucet auto-deploys from `main`** (CF Git-integration) — dashboard-side, repo-unverifiable. Adding a CI deploy hook WITHOUT disabling the dashboard integration → **double-deploy** + the cross-fork window persists (codex Critical). Needs an ops change (A5).
- **I4 — A post-deploy verifier can read authoritative live state.** Only true if we **emit build metadata** (faucet `build.json` with release+chainId; landing release-tag meta) — else it false-passes on a stale CDN cache. Fetch must be cache-busted + bounded-retry + fail-closed.

### Asks (decisions for the user)

- **A1 (resolved)** — Scope = cheap-config + chain-guard + faucet/landing-pipeline+smoke + auto-sync + v4-auto-unstick + `bump-minor-pre-major:true`; NOT marketplace. Validation = dry_run + unit-tested scripts + throwaway test repo.
- **A2 (resolved)** — v4 unstick: **automate**, race-guarded.
- **A3 (gate)** — OK for me to **create + delete a disposable test repo** (`alejoamiras/nulo-release-rehearsal`) using **dummy secrets only** (webhook.site hooks, a scratch token; never prod creds)?
- **A4 (resolved → DROP)** — Faucet chain-version: both codex + Plan-sub prefer **dropping the `VITE_CHAIN_*` env path** (faucet is testnet-only; single-source the identity from a shared constant; keep URL query for tests). Stronger than guard-and-keep. Default: drop + fix `.env.example`.
- **A5 (gate, codex Critical)** — The faucet's **CF dashboard auto-deploy**: disable/redirect it when we add the CI deploy job (clean cutover), or accept double-deploy until that ops change lands? Needs your CF dashboard.
- **A6 (gate, recommend mirror)** — Prerelease semantics: mirror `bump-minor-pre-major` to the prerelease config (rc stays 0.x), or accept a possible `1.0.0-rc`? Default: mirror + prove via dry-run. NOTE: flipping the flag means a real **1.0.0 now requires an explicit `Release-As: 1.0.0`** — documented, intended.
- **A7 (gate, recommend behind-flag — two-release rollout)** — Auto-unstick lands behind `vars.AUTO_UNSTICK_ENABLED` (default off). **Release N** = the plan ships, flag OFF, release uses the documented **manual** unstick (proves the new code is inert + nothing else broke). Then **flip the flag**. **Release N+1** = first run that actually exercises the auto-unstick = the closing acceptance gate (Phase 8). N and N+1 are DISTINCT releases — the plan must not conflate them (codex). Manual unstick stays documented as the permanent fallback.
- **A8 (gate)** — Test-repo deploy rehearsal: real throwaway CF Pages projects + hooks (higher fidelity for Phase 5), or mocked endpoints (webhook.site)? Default: mocked (cheaper; the real CF wiring is an I1 gap proven only by the real-release gate).

---

## Security & Adversarial Considerations

- **Threat model.** The release pipeline is the **supply-chain trust boundary**. New automation wields `contents:write` + `RELEASE_PLEASE_APP_PRIVATE_KEY`. Every new job gets **minimal `permissions:`** (`contents:write` only where it tags; `pull-requests:write` only for the sync PR); never widen the default token.
- **Auto-unstick race = top risk.** Mitigated by codex's design: **keep the unstick INSIDE the existing `release.yml` run** (after release-please aborts, an idempotent in-run step → continue the same publish DAG), so it stays in the single `concurrency: release` group — no cross-run writer race. Plus: **idempotent check-then-create** (tolerate "already exists"), **hard-fail if an existing tag points at the wrong SHA**, and the `vars.AUTO_UNSTICK_ENABLED` kill-switch (A7). F10's cross-group overlap (`release` vs `release-prerelease`) is closed by NOT spawning a second workflow.
- **Test-repo hygiene.** Dummy secrets ONLY (webhook.site / scratch token); deleted after; never mirror prod secrets.
- **Post-deploy false-pass** — verify against **authoritative emitted metadata** (faucet `build.json`, landing meta) with cache-buster + `no-cache` + bounded retry; "can't determine" = FAIL (fail-closed).
- **Faucet double-deploy** (I3/A5) — adding a CI hook without disabling the dashboard integration is itself a risk (two deploys racing); resolve as an ops cutover.
- **Supply chain.** No new runtime deps; new logic is first-party `bun:test`-ed scripts; `actionlint`/`shellcheck` gate every workflow edit (extend shellcheck coverage to `scripts/release/**`, F11).

---

## Phases

> Each phase ends with a **Validation gate** (real commands + pass criteria + how it's dry-run/unit/test-repo-proven — never "cut a real release"). Order: harness → cheap config → code → test-repo → surgery (deploys → auto-unstick → sync). Logic lives in `bun:test`-ed `scripts/release/*.ts`, not YAML. **DOC PRIORITY:** every phase that changes release behavior updates its `CLAUDE.md`/`CI.md` section **in the same change** (docs never drift from shipped state); Phase 8 consolidates into the teachable cold-readable runbook.

### Phase 1 — Extraction harness (infra; no behavior change) — ✓ DONE

Pull the fragile release logic out of YAML into `scripts/release/*.ts` (`bun:test`-able): `resolve-tag.ts` (the `release.yml:103-126` tag/version/is_prerelease parser), `verify-live.ts` (post-deploy assert), `chain-guard.ts` (faucet build assert), `open-sync-pr.ts`, `auto-unstick.ts`. Workflows call `bun scripts/release/X.ts`. Extend `actionlint.yml`'s shellcheck `find` to include `scripts/release/**` (F11).

**Validation gate** — `bun test scripts/release/` green (≥10 cases each: empty-tag, prerelease suffix, missing-asset, wrong-SHA…); `bun run lint:actions` (actionlint) + shellcheck clean. **No behavior change, no test repo.** Layers: unit · actionlint.

### Phase 2 — Cheap config wins (cheap-config) — ✓ DONE (bump-minor empirical → Phase 4)

(a) `bump-minor-pre-major: true` in `release-please-config.json` **+ the prerelease config** (A6 mirror); (b) commitlint: **add a merge-subject lint** (currently missing entirely, F4) — on `base==main`, lint the **synthetic merge subject** `<PR title> (#n)` (NOT just the title: GitHub appends `(#n)` to the merge commit, which can push an otherwise-fine title past the 100-char header cap, codex Medium), and drop the historical range; keep range-lint for dev PRs; (c) remove the inline polyfill from `faucet/index.html` + `playground/index.html` (F7); (d) fix `CI.md` doc-drift (prerelease built, not deferred; commitlint actually lints range not title).

**Validation gate** — `bunx release-please ... --dry-run` on a synthetic `feat!` history against **both** configs → stable `0.(x+1).0` NOT `1.0.0`, prerelease the mirrored `0.(x+1).0-rc`; PLUS two **stateful** prerelease rehearsals (codex — `versioning:"prerelease"` is stateful): (1) first rc *after* a stable re-baseline, (2) next rc on the same line → both compute sane rc counters (I2); a simulated `base==main` PR whose `title + " (#n)"` exceeds 100 chars → **caught** (not false-green), and a 104-char historical subject no longer fails; `bun run --cwd packages/faucet build` + headless boot with **no CSP violation** + no inline `<script>` in `dist/index.html`; `bun run lint:actions`. Layers: dry-run (incl. stateful rc) · build · smoke · actionlint. **No test repo.**

### Phase 3 — Faucet chain-identity hardening + build metadata (code) — ✓ DONE

**Drop** the `VITE_CHAIN_ID`/`VITE_CHAIN_VERSION` env path (A4); single-source the testnet identity from a shared constant derived from the wallet seed (faucet + wallet can't drift); keep URL query overrides for tests. Fix `.env.example:32` (F6). Emit **one build ID** from the actual faucet build into **BOTH** `index.html` (a `<meta name="nulo-build">`) **and** `dist/build.json` (release + chainId + buildId) — so Phase 5's verifier can require an EXACT HTML↔JSON match, defeating a split-CDN-cache false-pass (codex Critical-2; F5).

**Validation gate** — `bun test` for the chain-identity module (resolves to `4229590296`/testnet; URL override works; no env path); `bun run --cwd packages/faucet build` emits `dist/build.json` AND an `index.html` meta tag carrying the **same** buildId + the correct chainId; `bun run --cwd packages/faucet test:e2e`. Layers: unit · build · smoke. **No test repo.**

### Phase 4 — Test-repo rehearsal harness (infra — gates the surgery phases)

Create `alejoamiras/nulo-release-rehearsal` (disposable; relaxed signing; dummy secrets — A3/A8) mirroring `release.yml` + configs. **Baseline-rehearse the CURRENT (unchanged) pipeline** to reproduce the v4 abort → confirms fidelity for the path we're about to automate. Document the I1 gaps it canNOT prove.

**Validation gate** — a full rehearsal of the current `release.yml` in the test repo reaches the v4 abort + manual-unstick state (proving the harness mirrors prod control-flow); the I1 gap list is recorded in `lessons/phase-4.md`. Layers: live-CI (disposable repo).

### Phase 5 — Deploys + live smoke (surgery — the safety net) — ✓ DONE (via fallback; verify-live advisory; test-repo rehearsal skipped)

(a) `refresh-landing` also fires on `workflow_dispatch` (keep `needs: attach-assets` — the fail-loud-on-missing-zip ordering, F5); (b) add `CLOUDFLARE_FAUCET_DEPLOY_HOOK` + a `deploy-faucet` job after `attach-assets`; (c) landing emits a **release-tag `<meta>`** into its served HTML; (d) a **`verify-live` job** (after deploys; bounded retry + cache-bust headers): for the faucet, fetch BOTH `/` and `/build.json` and require the **buildId to match EXACTLY** (kills the split-CDN-cache false-pass — fresh JSON + stale HTML — codex Critical-2) + chainId == the wallet's testnet + COOP/COEP; for the landing, assert the served HTML meta == `v$VERSION`. **Fail-closed** (can't determine → fail). Surface A5 (disable the dashboard auto-deploy, or accept double-deploy).

**Validation gate** — `bun test scripts/release/verify-live.test.ts` (HTML↔JSON buildId mismatch → fail; match → pass; unreachable → retry-then-fail-closed; **fresh-json-but-stale-html → fail**); a `describe.skipIf(!LIVE)` integration test against the real sites; `bun run lint:actions`. **Test repo:** rehearse deploy-hook ordering + `verify-live` PASS (matched) AND intentional FAIL (forced split-cache/stale) against throwaway sites/mocks. Layers: unit · live-skipIf · actionlint · test-repo.

### Phase 6 — Auto-unstick the v4 abort (surgery — in-run, guarded; built before the sync that depends on it) — ✓ DONE (flag OFF; test-repo rehearsal → staged flag-off release; verify §lessons/phase-6.md)

**Inside `release.yml`** (codex — no second workflow → stays in the single `concurrency: release` group, closing the cross-group race, F10): after `release-please`, **only when** `release_created != true` AND `github.event_name == 'push'` AND **the PR attached to `github.sha` is a merged `autorelease: pending` Release PR with base `main`** (an explicit PR-to-SHA check — **NOT** a title/heuristic guard, which would be unsafe — assumption-attack), run an idempotent `auto-unstick.ts` (create tag if-not-exists, asserting **tag SHA == that merge SHA**; create release if-not-exists; relabel) → continue the **same** publish DAG, which emits the publish-complete signal Phase 7 keys off. Behind `vars.AUTO_UNSTICK_ENABLED` (default off — A7); manual unstick stays the documented fallback.

**Validation gate** — `bun test scripts/release/auto-unstick.test.ts` (tag-missing→create; tag-exists→no-op; wrong-SHA→abort; re-invoke→idempotent, never a 2nd tag; **ordinary non-Release-PR push → no-op**); **test repo (mandatory):** full `push:main → merge Release PR → in-run auto-unstick → publish → deploys → verify-live` rehearsal incl. a forced re-run (idempotency) AND an **ordinary docs-push proving no misfire**; **real-repo `dry_run` pre-flight** (publish chain `dry_run=true` on an existing tag). Layers: unit · test-repo full-path · real-repo dry_run · actionlint.

### Phase 7 — Auto main→dev sync + prerelease re-baseline (surgery — after publish completes) — ✓ DONE (advisory, push-only; test-repo rehearsal → first stable real release; verify §lessons/phase-7.md)

Post-publish job: create the sync branch **from `origin/main`** (no local merge — codex), add the prerelease-manifest bump, open the `chore: sync main → dev` PR (App token → signed), and **let GitHub compute mergeability**. Conflicted → `needs-manual-resolution` label + comment; clean → mergeable. Never silent-fail (F8). **Trigger only when `sync_eligible`** = `event=='push'` AND a stable tag AND `github.sha` == the just-merged Release-PR merge commit — explicitly **`false` on every `workflow_dispatch`**, so a manual republish of an OLD tag (e.g. `v0.20.0`) can NOT re-touch the sync flow (codex Critical-1). Runs after Phase 6's publish-complete signal.

**Validation gate** — `bun test scripts/release/open-sync-pr.test.ts` (clean→mergeable PR; idempotent if one's open; **`sync_eligible=false` on workflow_dispatch / old-tag republish → no-op**); **test repo:** happy-path opens the PR; an induced CHANGELOG/`bun.lock` conflict opens a *labeled* PR (not silent); a simulated `workflow_dispatch` republish → sync does NOT fire. Layers: unit · test-repo · actionlint.

### Phase 8 — Docs + closing acceptance gate

**Produce the teachable release runbook (DOC PRIORITY).** Rewrite `CLAUDE.md` §Release runbook + `CI.md` into a doc a future agent/human can execute **cold**, structured as: (1) the **one-click happy path** (merge promote PR → review+merge the Release PR → done) in numbered plain steps; (2) **what each automated piece does** under the hood — auto-unstick, `verify-live`, auto-sync, the version policy — in plain language with the "why"; (3) the **manual fallbacks** (the 45s unstick, the manual main→dev sync) for when `AUTO_UNSTICK_ENABLED` is off or something breaks; (4) the **staged-rollout** + the switch; (5) a "what to do when X fails" troubleshooting table. NOTE: phases 1–7 each already updated their own doc section as they landed (per the universal-workflow "docs in the same PR" rule) — Phase 8 is the consolidation + cold-read pass, not a from-scratch write. Tear down the test repo; run `/code-review max --fix` + codex post-impl audit + `/harden security`.

**Validation gate** — docs updated + match the shipped workflows; **cold-read check: a fresh `Explore`/agent pass (no prior context) can follow the runbook end-to-end + answer "how do I cut a release? what if the auto-unstick fails?" purely from the doc** (the user's explicit bar — the next agent learns the release from here); test repo deleted; `/code-review` + codex audit high/critical addressed; `/harden security` run. **Closing acceptance gate (deferred, tracked — TWO-release rollout, A7):** release **N** ships with `AUTO_UNSTICK_ENABLED=off` + uses the manual unstick (proves the new code is inert + nothing regressed); **flip the flag**; release **N+1** runs `AUTO_UNSTICK_ENABLED=true` **push-button** (zero `--admin`, zero manual unstick, `verify-live` green, auto-sync PR opened) = the true acceptance gate + the only proof of the five I1 fidelity gaps. Layers: docs · code-review · harden · (deferred) two real releases.

---

## Decision ledger

Three independent plans — **main** (this agent), **codex** (`019ef00a-8dc8-7782-b55e-f7b06bd6788e`), **Plan-sub** (fable unavailable → top-tier Claude `Plan`, per skill guidance). Strong convergence; what each contributed + disputes resolved:

| Decision | Source | Resolution |
|---|---|---|
| **Tier = deep, auto-unstick LAST** | all three | Adopted. |
| **Auto-unstick: in-run vs separate workflow** | codex (in-run) vs main/Plan-sub (post-merge job) | **Adopted codex's IN-`release.yml` design** — keeps the single `concurrency: release` group, eliminating the cross-run/cross-group (F10) race that a second workflow/dispatch introduces. |
| **Auto-unstick rollout** | Plan-sub (kill-switch) | **Adopted** `vars.AUTO_UNSTICK_ENABLED` default-off, flip after one real release; manual unstick stays documented. (A7) |
| **Faucet env path: guard vs drop** | codex + Plan-sub (drop) vs main (offered both) | **Adopted DROP** + single-source from a shared constant + fix `.env.example`. Stronger; kills the drift class. (A4) |
| **Post-deploy verifier needs authoritative metadata** | codex | **Adopted** — emit faucet `build.json` (Phase 3) + landing meta (Phase 5); verify against it, not a guessed substring (else false-pass). |
| **Commitlint fix: skip vs title-lint** | codex + Plan-sub (title-lint) | **Adopted** — ADD the missing PR-title lint (F4) + drop the range on `base==main`; keep range on dev. |
| **Auto-sync conflict detection** | codex (open PR, let GitHub compute) vs main (detect locally) | **Adopted codex's** — branch from origin/main, open PR, GitHub computes mergeability; never a local merge. |
| **Extraction harness FIRST** | codex + Plan-sub | **Adopted** as Phase 1 (de-risks all surgery; + shellcheck-coverage fix F11). |
| **`.env.example` smoking gun** | Plan-sub | **Adopted** — `.env.example:32` is the literal bug seed; fixing it + dropping the env path is the durable fix. |
| **bump-minor-pre-major mirrored to prerelease** | codex + Plan-sub | **Adopted** (A6) + prove via dry-run on both configs (I2); document that real 1.0.0 now needs explicit `Release-As`. |
| **Faucet dashboard double-deploy** | codex Critical | **Surfaced as A5** (ops change, not YAML). |

**Unresolved disputes:** none material — divergences were design-refinements (all resolved in codex's/Plan-sub's favor where stronger) or surfaced as Asks (A3, A5–A8).

## Audit verdicts

- **Independent draft — codex** (`019ef00a`): *"Deep is the right tier, scope sound, but the auto-unstick is only worth shipping if idempotent and preferably INSIDE the existing `release.yml` run; a second-run/dispatch is where the real release-bricking race lives."* → **conditional approve**; condition (in-run auto-unstick design) **adopted**.
- **Independent draft — Plan-sub**: *"Plan it as deep — the auto-unstick is the one phase to gate behind a kill-switch, not the reason to stay manual; ship it LAST, behind `AUTO_UNSTICK_ENABLED`, manual unstick as fallback."* → **conditional approve**; condition (kill-switch) **adopted**.
- **Final fresh-context codex pass** (`019ef0..`, fresh session — read the consolidated plan): the three drafts converged with no material dispute, so the contradiction-check + double-audit + final-pass were compressed into this one hostile pass on the synthesis (fable unavailable). Verdict: **`reject`** — *"generic sync trigger is unsafe, faucet live-verify can still false-pass, rollout/acceptance semantics contradict."* It validated the core synthesis (in-run auto-unstick, drop-env-path, commitlint replacement) and **all 6 findings + 3 assumption-corrections are folded** (none rejected):
  - **C1 — sync misfires on a `workflow_dispatch` republish of an old tag** → reordered (auto-unstick = Phase 6, sync = Phase 7) + `sync_eligible` is push-only + `sha == Release-PR merge commit` + false on every dispatch.
  - **C2 — verifier false-passes on a split CDN cache** → emit ONE buildId into both `index.html` + `build.json`; `verify-live` requires an exact HTML↔JSON match.
  - **H1 — rollout↔acceptance contradiction** → explicit two-release rollout (N off/manual, N+1 on/acceptance) in A7 + Phase 8.
  - **H2 — I1 missing the `environment: production` + secret-scope fidelity gap** → added as gap #5; tied to the first enabled run.
  - **H3 — prerelease proof too weak** → two **stateful** rc fixtures (first rc after re-baseline; next rc same line) in the Phase 2 gate.
  - **M — commitlint** must lint the merge subject `title + (#n)` (the `(#n)` suffix can breach the 100-char cap).
  - Assumption fixes: F5 (landing HAS authoritative build-time data, just not surfaced live in HTML); the auto-unstick guard is an explicit **PR-attached-to-`github.sha`** check, NOT a title heuristic.

  Not re-submitted for a further pass — the fixes were codex's own prescribed edits, applied verbatim + repo-verified. A re-confirm can run on request before implementation.

---

## Seeds

Mostly autonomous-implementable, with human-gated bits (create/delete test repo, wire `CLOUDFLARE_FAUCET_DEPLOY_HOOK`, the faucet-dashboard ops cutover A5, the closing real release). `/loop` fits the build-out.

### Recommended: `/loop`

```
/loop 15m Drive implementations-plan/release-dx-hardening forward. Never idle. Each firing: read plan.md + lessons/ (authoritative); git status; gh pr/run status (no --watch). Take the next pending phase; logic goes into bun:test-ed scripts/release/*.ts not YAML; after each edit run `bun run lint:actions` + `bun test <touched>` + the phase's gate; commit→push. DOC PRIORITY: every phase that changes release behavior updates its CLAUDE.md/CI.md section in the SAME change (docs never drift); Phase 8 = the teachable cold-readable runbook (a future agent must be able to run a release from it). Phases 4-7 rehearse in the disposable test repo before any real-repo change — best-effort: if the test repo yak-shaves, fall back to unit + dry_run + the staged rollout, log it, don't block. The auto-unstick (Phase 6) lives IN release.yml behind vars.AUTO_UNSTICK_ENABLED (default OFF — staged rollout; the real-release flip is the human's). Stuck or a real decision (auto-unstick idempotency/SHA-guard, bump-minor×prerelease compose, verify-live HTML↔JSON match)? `/codex xhigh`, decide, log it. Hard limits: NO real release; test repo uses DUMMY secrets only (never prod creds); never force-push/rewrite main; never widen a workflow token's permissions; PAUSE for my ok before creating/deleting the test repo or wiring CLOUDFLARE_FAUCET_DEPLOY_HOOK. (A5 CF-dashboard cutover is the human's deferred task — accept the double-deploy + document it, don't block.) Phase green = its plan.md Validation gate passes; mark ✓ + print LESSONS_FILE=…/lessons/phase-N.md. All phases ✓ → /code-review max --fix → codex post-impl audit → /harden security → wrap-up + stop.
```

### Alternative: `/goal`

```
/goal All phases ✓ in implementations-plan/release-dx-hardening/plan.md, each backed by its Validation gate in the transcript (incl. the test-repo rehearsals for phases 4-7 + the real-repo dry_run pre-flight for phase 7); release logic lives in bun:test-ed scripts/release/; `bun run lint:actions` + `bun test` exit 0; `/code-review max --fix` applied+committed; codex post-impl audit high/critical addressed; `/harden security` run. PAUSE before creating/deleting the test repo, wiring the faucet hook, the CF-dashboard cutover, or any real release. Hard limits: no real release, dummy secrets only in the test repo, no token-permission widening, auto-unstick stays behind AUTO_UNSTICK_ENABLED.
```
