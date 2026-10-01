# Recon — stable-release-0.27.0 (Phase 0.4)

Base: `origin/dev` @ `c00598a` (the promote PR #337 head). No `implementations-plan/*0.27*` dir existed — no collision.

## Prior art (reuse map)

**Reuse as-is** (proven by `stable-release-0.26.0` — fully green run — and hardened by `release-pipeline-hardening`):

- The 6-phase skeleton: pre-flight → promote merge → Release PR merge → auto-unstick/publish → sync-back merge → live verification. Gate shapes are real `gh`/`git` commands, no local build on the critical path.
- `RELEASE_SHA` (pinned dev head) vs `TAG_SHA` (Release-PR merge commit) distinction; head-not-moved guard + atomic `gh pr merge --match-head-commit` promote.
- All three merges are TRUE merge commits (2 parents); the sync-back especially must never be squashed — a squash drops main's release commit from dev's ancestry and breaks release-please's version detection on the next cut (`release-prerelease-fix`).
- Flake discipline: red required check → re-run that check; never neutralize a gate.
- Phase-4 stranded-release guard: verify tag SHA == Release-PR merge SHA; auto-unstick fails closed on a wrong-SHA tag.
- Phase-6 freshness checks by SHA/buildId, never by version string (faucet is independently versioned).
- `release.yml` automation reused verbatim: `auto-unstick` (var ON since 2026-07-03), `refresh-landing` + `deploy-faucet` (`always() && !cancelled()` guards — deploys fire on ANY publish path), `sync-main-to-dev` (App-signed manifest re-baseline), `verify-live` (advisory).

**Adapt for this cut:**

- Promote PR **#337 already exists and is fully green/CLEAN** (unusual — 0.26.0 opened it as a phase). Phase 1 collapses to JIT pre-flight verification; Phase 2 to the guarded merge.
- Content risk differs: this cut carries the fee-cap basis change (dedicated codex audit on #335, owner accepted ship-as-is, follow-ups in #336), activity siloing, two-network tools, mainnet swap-fuel. All content was per-PR gated including the full network suite + prover-ON canary on the exact promote head.
- The recurring "extra canary / harden before promoting?" ask was answered in Phase 0: no — per-PR gating + the dedicated fee audit stand in.
- Plan artifacts must NOT touch `dev` until after the promote merges (any dev push re-triggers #337's 45-min gate cycle) — docs PR lands at wrap-up.

## Execution lessons carried forward

- 0.26.0: a Release-PR "all 3 aggregators failed" scare was two CI batches on one head SHA (first batch cancelled reports FAILURE) — diagnose per-SHA run completion before acting.
- 0.24.0: `dev` behind `main` breaks the promote under `strict: true` (not the case now: main has nothing dev lacks); zero-asset Release window breaks landing builds until `attach-assets` finishes (auto-unstick same-run publish avoids the dispatch gap).
- Still-open follow-ups (NOT this plan's scope): `fetch-latest-release.ts` tolerance of asset-less releases; SHA-pinning GitHub Actions; independent artifact provenance.

## Live machinery state (verified this session, 2026-07-28/29)

- `gh variable get AUTO_UNSTICK_ENABLED` → `on`.
- `.release-please-manifest.json` + `.release-please-prerelease-manifest.json` both `{".": "0.26.0"}`.
- `git log origin/main --first-parent`: `bffaad2 chore(main): release 0.26.0 (#321)` is the tip — main == last release.
- PR #337 (`dev → main`): all required checks pass (one smoke flake, `backup-roundtrip.test.ts` 90s timeout, cleared on re-run), `mergeStateStatus: CLEAN`.

## index.md line format

`- [plan-name](plan-name/plan.md) — status — one-line hook` (see 0.26.0's shipped line for the convention).
