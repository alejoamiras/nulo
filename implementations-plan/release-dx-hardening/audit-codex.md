# Codex audit transcript — release-DX hardening

Two codex passes at `xhigh`, read-only sandbox. Full responses live in this session's `CODEX_DIR`s (machine-local scratch, not committed); verdicts + findings reproduced here.

---

## Pass 1 — independent plan + adversarial review (session `019ef00a-8dc8-7782-b55e-f7b06bd6788e`)

One of the three parallel drafts (with main + the Plan subagent), briefed with the scope + prior-art constraints.

**Verdict:** *"Deep is the right tier, scope sound, but the auto-unstick is only worth shipping if idempotent and preferably INSIDE the existing `release.yml` run; a second-run/dispatch is where the real release-bricking race lives."* → **conditional approve**.

**Findings folded:**
- **Keep the auto-unstick IN `release.yml`** (after release-please aborts → idempotent in-run step → continue the same publish DAG) — avoids the cross-run race a separate workflow/dispatch creates (the `release` vs `release-prerelease` concurrency-group split, F10). **Adopted as the core design.**
- **Emit authoritative build metadata** — neither site exposes live release metadata today → the verifier can false-pass. Faucet `build.json` + landing meta. **Adopted (Phase 3 + 5).**
- **Auto-sync: open the PR, let GitHub compute mergeability** (branch from origin/main; never a local merge). **Adopted.**
- **Commitlint: lint the PR title on `base==main`**, keep range on dev. **Adopted (refined to merge-subject in Pass 2).**
- **Faucet: prefer dropping the `VITE_CHAIN_*` env path** (single-source the identity). **Adopted (A4).**
- **Critical (ops):** a faucet deploy hook does NOT fix the early/double deploy if the CF dashboard Git-integration stays live. → **A5.**
- Asks: faucet dashboard auto-deploy disposition; prerelease semantics mirror; test-Pages-vs-mock.

---

## Pass 2 — final fresh-context hostile review of the consolidated plan (session `019ef0..` fresh)

Read the consolidated `plan.md`; attacked the synthesis.

**Verdict:** **`reject`** — *"generic sync trigger is unsafe, faucet live-verify can still false-pass, rollout/acceptance semantics contradict."*

**All findings folded (none rejected):**
- **C1 — Phase sync trigger too generic** (a `workflow_dispatch` republish of an old tag could re-touch the sync flow) → reorder auto-unstick before sync; `sync_eligible` = push-only + `sha == Release-PR merge commit` + false on dispatch.
- **C2 — verifier still false-passes on a split CDN cache** (fresh `build.json`, stale HTML) → one buildId in BOTH `index.html` + `build.json`, exact HTML↔JSON match.
- **H1 — kill-switch rollout contradicts the acceptance gate** → explicit two-release rollout (N off/manual, N+1 on/acceptance).
- **H2 — I1 missing a 5th fidelity gap** (`environment: production` protection + secret scope; `release.yml:210,298`) → added.
- **H3 — prerelease proof too weak** (one dry-run ≠ the stateful rc cases) → two stateful rc fixtures.
- **M — commitlint merge-subject headroom** (GitHub appends `(#n)`) → lint `title + (#n)`.
- **Assumption fixes:** F5 (landing HAS build-time release data via `fetch-latest-release.ts`, just not surfaced live); the unstick guard must be an explicit PR-attached-to-`github.sha` check, NOT a title heuristic.

**"Synthesis holds up":** in-run auto-unstick (right core move — really removes the concurrency-group race); dropping faucet `VITE_CHAIN_*` (the stale seed at `.env.example:32` is real); replacing the `base==main` range-lint (directionally correct).

Not re-submitted — the fixes were codex's own prescribed edits, applied verbatim + repo-verified. Re-confirm available on request before implementation.
