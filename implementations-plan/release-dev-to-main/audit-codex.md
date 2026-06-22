# Codex audit transcript — release dev → main

Two codex passes at `xhigh`, read-only sandbox. Full responses live in this session's `CODEX_DIR`s (paths are machine-local scratch, not committed); verdicts + findings reproduced here.

---

## Pass 1 — independent runbook + adversarial review (session `019eeeae-75fc-78e2-baa4-761a93dd3611`)

Briefed with the verified facts + hard constraints; asked to *independently draft* the release runbook and attack it. One of the three parallel drafts (with main + the Plan subagent).

**Verdict:** *"Not yet sound: executable, but blocking gaps around version acceptance, release-path recovery after the manual unstick, and unverified Cloudflare-side behavior."* → **conditional approve** (conditions: A1 version, A7 flake policy, verify I1/I2 CF behavior).

**Findings folded:**
- **CRITICAL — version.** `bump-minor-pre-major` unset → breaking commit → **`1.0.0`**, permanent once tagged. Treat Release-PR review as a hard go/no-go. (3rd independent confirmation.)
- **CRITICAL — landing race.** `gh release create` publishes a "latest" release before assets exist; `fetch-latest-release.ts` *hard-fails* if `releases/latest` has no `nulo-chrome-*.zip`. Never trigger landing until `attach-assets` succeeded.
- **CRITICAL — accelerator kill-switch not wired into stable `release.yml`** (only `pr-network-e2e`). Flake after tag → half-published. → A7.
- **HIGH — faucet CTA** defaults to a Chrome Web Store URL (conflicts with "GitHub-Release-only"); verify the Pages env. → A4.
- **HIGH — `verify:deployments` covers only the token `deployments.json`** — the **bridge** addresses live separately (`bridge-deployments.ts` / `testnet-bridge.json`), not drift-gated. → A5/F7.
- **Fact corrections:** tokens are **NULO/OLUN**, not USDC/ETH (verified); landing links the release **page**, not the zip (verified `release-resolver.test.ts`). Commit count: codex said **74** — **rejected**, its local `main` was 24 commits stale; `origin/main..origin/dev = 64` (verified).

---

## Pass 2 — final fresh-context hostile review of the consolidated plan (session `019eeeb8-f102-7322-b9d5-776ffd915836`)

Fresh session; read the *consolidated* `plan.md`; asked to attack the **synthesis** + the converged "faucet auto-deploys from main" assumption.

**Verdict:** **`reject`** — *"landing Pages wiring still unverified, A6/A7 not executable in the phases, and key gates can pass without proving the right prod state."*

**All 5 findings verified + folded (none rejected):**
- **C1** — landing CF *wiring* is the blind spot (hostname `nulo.sh` already in `index.html`); A3 reframed to a Phase-0 landing-CF dashboard check + rollback operator (A8).
- **C2** — A6/A7 were nominal Asks → wired into Phase 1/6 (faucet pause/resume) + Phase 4 recovery (flake policy branch).
- **H1** — A1/Phase-0 contradicted the ledger on the override mechanism → standardized on `Release-As`.
- **H2** — Phase 0/1 gates not falsifiable → SHA-pinned dev HEAD + faucet-deploy-commit == promote SHA.
- **H3** — Phase 3 had no partial-failure branch → added idempotent mid-unstick resume.
- **M1** — SHASUMS over-claimed as provenance → softened to corruption-detection. **M2** — DAG text wrong (network-e2e is parallel to builds, gates `attach-assets`) → F1 fixed (verified `release.yml:171,181,199`).

**Codex "sound here":** tag-SHA==merge-SHA guard; landing fail-loud inference; post-stable re-baseline.

Not re-submitted for a 4th pass — the reject's items were codex's own prescribed edits, applied verbatim + repo-verified. A re-confirm can run on request before execution.
