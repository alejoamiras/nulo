# Audit — "fable" seat (substituted)

**Fable 5 unavailable** → the fable seat is filled by a top-tier Claude `Plan` subagent (skill-sanctioned: "capability over the literal name"), briefed identically to codex (scope + prior-art constraints + the rollback-first/adversarial asks). It produced an **independent** 6-phase plan, not a review of mine.

## Verdict

> **"Plan it as deep — the v4 auto-unstick is the one phase to gate behind a kill-switch, not the reason to stay manual. Everything in scope 1–4 is high-value, low-risk surgery provable without real releases. The auto-unstick is worth automating because the race is tameable; ship it LAST, behind `vars.AUTO_UNSTICK_ENABLED`, with the 45s manual unstick staying documented as fallback."**

→ **conditional approve** (condition: kill-switch + auto-unstick-last). **Adopted.**

## Findings folded into the consolidated plan

- **🔫 `packages/faucet/.env.example:32` ships the stale `VITE_CHAIN_VERSION=4127419662`** — the literal seed of tonight's prod bug. The build-guard's real job is making that example value un-shippable. → F6 + Phase 3 (drop the env path + fix `.env.example`).
- **Concurrency groups differ** (`release` vs `release-prerelease`) → they can overlap → the auto-unstick race spans both workflows. → F10 + reinforced codex's in-run design (single `release` group).
- **Shellcheck covers only `.githooks` + `packages/extension/scripts`**, not root `scripts/`. → F11 + Phase 1 sub-fix.
- **Inline polyfill is redundant AND already CSP-blocked in prod** (nodePolyfills configured) → safe to delete, no hash. **Landing has no inline script; playground isn't in the release pipeline** (cosmetic). → F7 + Phase 2.
- **Commitlint** `config-conventional` `header-max-length:100`; promote-PR range-lint trips on 104/102-char historical subjects. → F4 + Phase 2 (title-lint).
- **Manifests already `0.23.0`** (re-baselined tonight) → the old "stale 0.20.2" is resolved; auto-sync targets the *next* drift. → F9.
- **Test-repo fidelity gaps named** (App-token signing, real CF Git-integration, branch rulesets, CDN propagation; GitHub Releases-API IS faithful). → I1.
- **Asks surfaced:** auto-unstick rollout (kill-switch — A7); drop-env vs guard (drop — A4); confirm CF production-branch wiring + double-deploy (A5); shared concurrency group.

Full reasoning is reproduced in the **Decision ledger** + **Assumptions** of [`plan.md`](plan.md). No verbatim file persisted (the subagent returned its findings in-message).
