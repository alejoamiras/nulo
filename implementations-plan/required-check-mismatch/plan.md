# Required-check name mismatch — the fix

**Status:** ✅ COMPLETE (2026-06-24) — approved + executed. dev (#170 rename, #171 re-point/positive, #172 negative) and main (#173 rename + re-point) both re-pointed to the bare names; a self-authored signed PR now merges with a plain `gh pr merge` (no `--admin`), and a deliberate red check is correctly blocked. Audit trail: codex + opus-Plan (both conditional-approve) + final fresh-context codex (`reject` → all 5 findings folded). See `lessons/phase-{1,2,3,4}.md`.
**Tier:** `mid` (rubric: blast-radius HIGH, external-coupling HIGH → normally `deep`; held at `mid` because the fix is bounded CI config, fully and instantly reversible, and the residual risk is retired by empirical live-PR verification — sacrificial-PR name-read + union-first re-point + positive AND negative acceptance — not by more planning ceremony).

## The problem (diagnosis), with hard proofs

Branch protection on `dev` + `main` requires three status-check **contexts**, but the GitHub Actions workflows produce check-runs with **different names**, so those required checks are **never satisfied** → they sit `Expected — Waiting for status to be reported` forever → the PR shows orange → **every merge needs `--admin`**. This has silently forced `--admin` on every PR repo-wide.

**Proofs (live, verified this session AND independently re-verified by both auditors against PR #169; protection re-confirmed this turn):**
- **PROOF 1 — required contexts** (`gh api .../branches/{dev,main}/protection/required_status_checks`): `dev` and `main` both require exactly `Quality / Status`, `Network e2e / Status`, `Smoke e2e / Status` — as both legacy `contexts` AND the current `checks` (each `{context, app_id: null}` → unpinned). `main` is `strict: true`; `dev` is `strict: false`.
- **PROOF 2 — produced check-run names** (`gh api .../commits/{head}/check-runs`): on PR **#169** (head `6a6607cc`), **#160** (`aa77f6c6`), **#137** (`ea9e431e`) — identical — the produced check-runs include **`Status` ×4** (the aggregator jobs of the Quality, Network e2e, Smoke e2e, and Lint workflows). No workflow-name prefix on any of them.
- **PROOF 3 — zero matches**: on #169, the number of produced check-runs whose name equals any required context is **0**.
- **PROOF 4 — corroboration**: every merge this session (#149, #165, #168) required `--admin` or the raw merge API; plain `gh pr merge` + `--auto` were refused even when the underlying runs were green and signed.
- **PROOF 5 — no merge queue** (`gh api repos/.../rules/branches/{main,dev}`): both branches carry only `["pull_request"]` rules. No `merge_group` path exists today (relevant to the final-pass merge-queue finding — see Security).

### The matching rule (the crux both auditors fixed)

GitHub branch protection matches a required check by **exact string** against the produced **check-run name**. For GitHub Actions:
- a **normal job** produces a check-run named exactly its job `name:` (**bare**, no workflow prefix);
- a **`uses:` reusable-workflow job** produces `{caller-job-name} / {inner-job-name}`.

The workflow-level `name:` (`Quality`, `Network e2e`, `Smoke e2e`) appears in **no** check-run name. Settled by the repo's own controls in the live #169 data: every normal job — `Status`, `Decide`, `Commitlint`, `Actionlint`, `Shellcheck`, `Detect changes` — produces a **bare** name; only `uses:` jobs (`Lint + Typecheck / Biome + vue-tsc`, `Run / shard 1/5 / …`) carry a `/`. So **`Quality / Status` was never a producible check-run** — a phantom typed into branch protection by hand. The three aggregator jobs are all `name: Status` (`if: always()`): `pr-quick.yml` (workflow `Quality`), `pr-network-e2e.yml:225` (workflow `Network e2e`), `pr-smoke-e2e.yml:145` (workflow `Smoke e2e`).

## Two gates, one verified cause (the honest `--admin` story)

`dev` + `main` carry **two independent** merge gates: the required status checks **and** `required_signatures=true`. The **verified** cause of the orange-hang + forced `--admin` is the **status-check name mismatch** (PROOF 1–4); `--admin` bypasses *both* gates at once (`enforce_admins=false`), which is exactly why the forced-`--admin` symptom could not, by itself, tell them apart — and why this explanation has been wrong twice (commit #165: "it's signing"; an earlier draft: "it was never signing").

The signature interaction is now **partly determinable**, not a blanket "settle empirically" (final codex pass): GitHub allows a squash-merge on a signed-commits branch via the web/API **only when the merger is the PR author** (GitHub signs the generated squash on the author's behalf). So for a **self-authored** PR — the overwhelming majority of this repo's PRs — `required_signatures` does **not** independently block the squash, meaning the orange-hang was **purely** the name mismatch. For **bot-/collaborator-authored** PRs (e.g. release-please) and `main`'s **merge-commit** path, signatures can still gate. **Phase 3 proves only the self-authored `dev` squash case; the docs scope the claim there** and do not generalize to bot/collaborator/main-merge-commit paths.

## Resolved: the raw-merge-API question

The **raw merge API** (`gh api -X PUT .../pulls/168/merge`) merged #168 **despite** the unmatched required checks. Both auditors resolve it the same way: the REST endpoint enforces only "the merge *can* be performed" (`405` otherwise), but **a repo admin bypasses branch protection by default** (`enforce_admins=false`) → the raw API is an **admin-bypass path**, ≈ `--admin`. **Retraction:** my earlier "raw API is a safe clean merge path" claim is **withdrawn** — documented emergency/admin-only, never as a clean merge.

## The fix — chosen approach (Outline A: "rename + empirically re-point")

Give each **required** aggregator job a **unique** check-name so its produced check-run is unambiguous, then re-point branch protection's required checks to the **exact produced bare names** — verified empirically on a real PR, never assumed.

### Phase 1 — Rename the three required aggregator jobs to unique check-names
Rename only the `name:` of the `Status` aggregator job in the **three workflows whose `Status` is in the required set**: `pr-quick.yml` (→ `quality-status`), `pr-network-e2e.yml` (→ `network-e2e-status`), `pr-smoke-e2e.yml` (→ `smoke-e2e-status`). **Do not** touch the gate logic (`if: always()`, the `needs:` aggregation) — only the `name:`.
- **Out of scope (both auditors):** `release.yml` (job `name: status` lowercase, `push:main`/`workflow_dispatch` only, never on `pull_request` — causally irrelevant) and the Lint workflow's `Status` (produced but **not required** — harmless). Cosmetic-only, kept off the critical path.
- **Validation gate** — `bun run lint:actions` exit 0; each of the three workflows still parses; the aggregator's `if`/`needs` byte-identical except `name:`. Layers: workflow-lint.

### Phase 2 — Land + re-point on `dev` first (union-first, read-modify-write)
**`dev` is done end-to-end before `main` is touched** (final codex pass — `dev` is `strict:false`, isolating the fix from `main`'s `strict:true`).
1. Merge the Phase-1 rename into **`dev`** (one final `--admin`; commits **signed** so `required_signatures` is satisfied and doesn't confound Phase 3).
2. **Observe** — read the produced names on the rename PR head (or a fresh `dev` PR): `gh api .../commits/{head}/check-runs --jq '[.check_runs[] | {name, app_id}]'`. Confirm the new **bare** names (`quality-status`, `network-e2e-status`, `smoke-e2e-status`) appear green, and capture each **live `app_id`** (expected `15368`; observed-at-write-time, NOT hard-coded).
3. **Read-modify-write PATCH (never a blind overwrite — final codex pass).** `GET` `dev`'s `required_status_checks`; PATCH `{ strict: <live.strict = false>, checks: union(existing phantoms, new pinned names) }`, preserving `strict` and any non-target checks. **Union-first**: phantoms stay required (still unsatisfiable) → the gate **never opens**; the new names now match-green.
4. **Verify** the new contexts show **matched-green** on a fresh `dev` PR while the phantoms still (harmlessly) block.
5. **Remove** the phantoms from `dev`'s `checks` (same read-modify-write, preserve `strict:false`). `dev` is now genuinely satisfiable.
- **Validation gate** — `check-runs` shows the unique bare names; `dev` `required_status_checks.checks` == the three pinned new names (set equality, asserted in transcript); a fresh `dev` PR shows the three gates **matched**, not `Expected`. Layers: live-CI + branch-protection.

### Phase 3 — Acceptance test on a real `dev` PR (positive AND negative)
- **Positive** — a **self-authored, signed** `dev` PR ends genuinely green (3 required gates green-matched, `mergeStateStatus == CLEAN`) and merges with a **plain `gh pr merge --squash` (NO `--admin`, no raw-API)**. Signed + self-authored holds `required_signatures` constant so the only variable is the status-check match. **Claim scope: self-authored squash only** — not bot/collaborator PRs or `main`'s merge-commit path (see Two-gates).
- **Negative (hard gate)** — push a commit that makes a **required** job **actually run and FAIL**: break a Biome rule so `lint-and-typecheck` (always runs on PRs) fails → its failure propagates through `needs:` to the `quality-status` aggregator (`if: always()` + the `result == failure` loop → exit 1), turning it red (mechanism confirmed by the final codex pass against `pr-quick.yml`). A *skipped* required check reports success, so the failing job must genuinely run. Assert `mergeStateStatus != CLEAN` **and** plain `gh pr merge --squash` (no `--admin`) is **refused**.
- **Validation gate** — positive: 3 green-matched, `CLEAN`, plain squash merges without `--admin`, squash `verified=true`. Negative: forced-red required job → non-`CLEAN` + refused non-admin merge. Layers: live-CI + branch-protection.

### Phase 4 — Promote the rename to `main`, then re-point `main`
**`main` cannot be re-pointed until the rename is actually on `main` (final codex pass — blocking).** A PR into `main` branched from *pre-rename* `main` runs the OLD workflow → emits bare `Status`; if `main` already required the new names, that PR re-hangs.
1. Promote the rename to `main` via the normal merge-commit PR (`release: promote dev → main (CI: rename required-check aggregators)`).
2. **Observe** the new bare names on a `main`-targeted PR head (same `check-runs` read).
3. **Read-modify-write PATCH `main`**, preserving **`strict: true`** (PROOF 1 — must not be clobbered), union-first then remove phantoms — same sequence as Phase 2, on `main`.
- **Validation gate** — `main` `required_status_checks.checks` == the three pinned new names with `strict:true` preserved; a `main`-targeted PR shows the three gates matched. Layers: live-CI + branch-protection.

### Phase 5 — Docs + correct the record
Update the required-check tables in `CLAUDE.md` + `CI.md` to the new bare names. **Correct the `--admin` explanation to the verified two-gates truth** (status-name mismatch = verified orange-hang cause; `required_signatures` = separate gate, author-only-squash rule stated, Phase-3 self-authored result recorded — do **not** assert "it was never signatures"). Fix the **Smoke advisory/required drift** (`CLAUDE.md` L337 says advisory; Smoke is **required** — the user's decision this session). Document the invariant: *a required check must exactly equal a produced **bare** check-run name; renaming a `Status` job means a read-modify-write re-point of `required_status_checks.checks` to the new bare name (app_id-pinned, `strict` preserved), and `main` is re-pointed only after the rename is promoted to it.*
- **Validation gate** — `bash scripts/check-no-brand.sh` clean; doc tables match the live `checks` on both branches; the §Branching `--admin` note reflects the verified cause + scoped Phase-3 result; Smoke row says required. Layers: docs + brand/path guard.

## Competing approach (Outline B: "require the bare `Status`, no rename") — rejected
Set the required checks to the bare produced name `Status`. **Rejected; both auditors confirm it's impossible:** four check-runs are named `Status` (Quality, Network, Smoke, Lint) and branch protection has **no selector to distinguish them** — the only discriminator is `app_id`, but all four come from the **same** GitHub Actions app (`15368`), so a pin can't disambiguate; there is no workflow-name or check-suite discriminator. Requiring `Status` is ambiguous and silently couples the advisory Lint gate. Renaming (Outline A) is the only way to three independent gates.

## Security & Adversarial Considerations
- **Threat model**: the change edits the *merge gate*. A wrong move leaves it OPEN (mergeable without checks) or permanently BLOCKED. Mitigations: **union-first** re-point (never weaker than today's fully-blocked state); **read-modify-write** preserving `strict` + non-target checks (no accidental clobber — `main`'s `strict:true` is a real footgun); the **negative test** proves a failing check still blocks; **re-verify live state** immediately before each PATCH; **`dev`-before-`main`** staging.
- **Merge queue (verified absent — PROOF 5)**: both branches are `pull_request`-only rules today, so no `merge_group` reporting path is required. **If a merge queue is ever enabled on `main`, add `merge_group: { types: [checks_requested] }` to all three workflows BEFORE re-pointing**, or queued merges will never report the required checks and re-hang the gate.
- **`app_id` pin as defense-in-depth**: pinning each required check to the **live-observed** GitHub Actions `app_id` blocks a third-party app from satisfying the gate with a same-named spoofed check-run. It does **not** solve the rename problem (same-app ambiguity). The id is observed at write time, never hard-coded as an invariant (final codex pass).
- **Least privilege**: no token/permission changes; workflow `name:` + branch-protection `checks` only. `required_signatures`, `enforce_admins`, `strict`, and `contents: read` defaults are preserved. The PATCH uses an existing admin path (no new credential).
- **Never weaken the gate** (hard constraint): the three quality checks stay BLOCKING throughout; Smoke stays **required**. Phase 3's negative test is the proof.
- **Supply chain / crypto / IaC**: out of scope; no deps, no secrets, no signing-config changes.

## Assumptions
**Facts (verified):**
- Required contexts on dev+main = the three phantoms, as both `contexts` AND `checks` (`app_id: null`); `main` `strict:true`, `dev` `strict:false` (PROOF 1, re-confirmed this turn).
- Produced check-runs include `Status` ×4, **zero** matching the required names, across #169/#160/#137 (PROOF 2/3).
- No merge queue on either branch — rules are `pull_request`-only (PROOF 5).
- The three aggregator jobs are `name: Status`, `if: always()`: `pr-quick.yml`, `pr-network-e2e.yml:225`, `pr-smoke-e2e.yml:145`. Breaking Biome reddens `quality-status` via `needs:` failure-propagation (final codex pass traced `pr-quick.yml`).
- GitHub Actions normal-job check-run name = bare job `name:`; only `uses:` jobs get `{caller}/{inner}` (live #169 controls).
- `release.yml`'s job is `name: status` (lowercase), `push:main`/`workflow_dispatch` only — not a PR check-run, not required.
- `required_status_checks.contexts` is deprecated; `checks` (`{context, app_id}`) is the current write field; the update endpoint is read-modify-write over `{strict, checks}`.
- GitHub allows a signed-branch squash-merge via web/API only when the merger is the PR author (final codex pass; moderate confidence — the *scoping* of the Phase-3 claim is robust regardless).
**Inferences (unverified — Phase 2/3 settle them):**
- The new bare names will be produced exactly as written. *Settled by Phase 2 step 2 (observe before writing).*
- The live `app_id` is `15368`. *Captured live in Phase 2 step 2 before pinning.*
- A `pull_request` run uses the head's workflow file (so the rename PR may self-verify). *If false, names are read off the next PR — no dependency.*
**Asks (resolved):** scope = the **three required** PR aggregators only (release.yml + Lint = optional cosmetic); rollout = **`dev` fully, then promote to `main`, then re-point `main`** (final codex pass); drift-guard = no; Smoke = **required** (user's decision; stale "advisory" doc corrected in Phase 5). *(No open Asks.)*

## Post-implementation hardening
Not a `/harden` pass — contained CI-config fix, no new trust boundary/secret/dep. The `app_id` pin (Phase 2/4) + the §Branching doc correction (Phase 5) are the relevant hardening of the gate + the record.

## Decision ledger
- **Outline A (rename + re-point), not Outline B (bare `Status`).** Both auditors: 4 same-app `Status` checks, no branch-protection selector → renaming is necessary.
- **CRUX — required string = bare `quality-status`, NOT `Quality / quality-status`.** Both auditors; settled by live controls. Phase 2 still observes-before-writing.
- **Write via `required_status_checks.checks`, read-modify-write, `strict` preserved, app_id observed-not-hardcoded.** Codex (initial: use `checks`; final: read-modify-write preserving `strict` — validated by `main` `strict:true`).
- **Raw merge API RETRACTED** as a clean path (admin-bypass).
- **`--admin` docs = verified two-gates framing, signatures scoped to the determinable rule.** Status-name mismatch = verified cause; author-only-squash rule stated; Phase-3 proves only self-authored `dev` squash (final codex pass tightened "settle empirically" into a scoped, partly-determinable claim).
- **Scope = 3 required PR aggregators.** release.yml (lowercase, push-only) + Lint (`Status` unrequired) out of critical path.
- **Rollout split `dev` → promote → `main` (final codex pass, blocking).** `main` re-pointed only after the rename is on `main`, else pre-rename `main` PRs re-hang. `dev` first isolates from `main`'s `strict:true`.
- **Ordering = union-first + observe-first + re-verify + read-modify-write**, per branch.
- **Negative test = HARD gate that must actually run** (skipped = success). Breaking Biome reddens `quality-status` (final codex traced the propagation).
- **Merge queue verified absent (PROOF 5)** → no `merge_group` triggers needed now; documented as a future-enable prerequisite.
- **Smoke = required** (resolved, not re-asked); stale doc corrected in Phase 5.

## Audit verdicts
- **Codex (initial, session `019efa7f`):** _conditional approve_ — re-verify live before changing; write via `checks` using bare names; retract raw-merge-as-safe; add a negative blocking test that actually runs; narrow scope. **All adopted.**
- **Opus-Plan (adversarial, repo-verified):** _conditional approve_ — bare name not `Quality/<new>`; drop the false "never signatures" claim (two-gates); union-first; negative test as hard gate; correct release.yml facts; account for `strict:true` on main. **All adopted.**
- **Codex (final fresh-context pass, session `019efa8f`):** _**reject**_ on the first consolidated draft — (1) `main` rollout misordered (pre-rename `main` PRs re-hang); (2) PATCH must be read-modify-write preserving `strict`/other checks; (3) merge-queue `merge_group` hazard; (4) signatures partly determinable (author-only squash) — scope the claim; (5) `app_id` observed-not-hardcoded. **All 5 adopted**; (3) verified absent (PROOF 5) and downgraded to a future-enable note; (1) split into Phases 2/4; (2) read-modify-write in Phases 2/4; (4) two-gates section + Phase 3 scope; (5) Phase 2 step 2.

## Seeds
*(Finalized after approval — see eli5.html for the drafts.)*
