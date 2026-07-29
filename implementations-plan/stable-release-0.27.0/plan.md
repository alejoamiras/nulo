# stable-release-0.27.0 — promote dev → main + publish the frontend release

Tier: **light** (user-invoked; see rubric note below). `eli5_mode: artifact`.

Ship the next stable: promote `dev` (head `c00598aee7a69a4e75382a9c83a9d4cb6188f0ed`, hereafter `RELEASE_SHA`) to `main`, let release-please + auto-unstick cut **v0.27.0**, publish the extension zips + SHASUMS to the GitHub Release, redeploy landing + tools (frontend only — **no smart-contract redeployment**), and close the loop with the merge-committed `main → dev` sync. Owner decisions (Phase 0): full runbook close; publish-chain network e2e **OFF** (promote gates already ran it on this exact code); `publish_marketplaces=false`; no `/harden` pass this cut.

**Tier rubric note:** irreversibility is arguably HIGH (public tag + release), which the rubric maps to `mid` — but the pipeline is twice-proven (`stable-release-0.26.0` ran fully green), the plan is ~90% reuse of that blueprint, and every byte of content was per-PR gated (including a dedicated codex audit of the fee-cap change on #335). `light` honored as invoked; a single codex audit (reject → conditions folded, see § Audit) pressure-tested it.

## Architecture & Implementation (compact — process orchestration, not code)

- **Shape**: this plan drives the existing `release.yml` job graph (`release-please → auto-unstick → resolve → gates → build → smoke-against-artifact → attach-assets → refresh-landing / deploy-faucet → verify-live → sync-main-to-dev`) through its happy path with human-verified gates between the three merges. No workflow edits; no code changes. Reuse map in `recon.md`.
- **Touched files**: docs only — `implementations-plan/stable-release-0.27.0/{plan.md,recon.md,audit-codex.md,eli5.html,lessons/}` + an `implementations-plan/index.md` entry, landing on `dev` via a wrap-up docs PR **only after Phase 5** (dev is #337's HEAD branch, so any dev push emits `synchronize` and re-triggers its gates; after the promote, dev movement can still invalidate/conflict the sync PR — dev stays frozen until the sync merges).
- **Critical flow**: merge #337 (`--match-head-commit $RELEASE_SHA`) → release-please opens `chore(main): release 0.27.0` → merge it (merge SHA = `TAG_SHA`) → auto-unstick tags `v0.27.0` @ `TAG_SHA` + same-run publish chain attaches assets + fires deploy hooks → merge-commit the `chore: sync main → dev` PR → verify live by SHA/buildId.
- **Key identifiers**: `RELEASE_SHA = c00598aee7a69a4e75382a9c83a9d4cb6188f0ed` (pinned promote head), `TAG_SHA` = Release-PR merge commit (recorded in Phase 3). The tag is **annotated** — always resolve it via `git rev-list -n1 v0.27.0` (the peeled commit), never `git rev-parse v0.27.0` (the tag object).
- **Deploy provenance (stated precisely)**: `refresh-landing`/`deploy-faucet` POST Cloudflare deploy hooks; CF Pages then **rebuilds from Git itself** at the pushed main SHA — CI does not upload the site bundle. Freshness is therefore verified by build-stamped SHA (`build.json` buildId suffix), not assumed from a green hook job.
- **Alternative not taken**: manual unstick + `workflow_dispatch` publish as the primary path. Rejected: `AUTO_UNSTICK_ENABLED=on` (verified live) and automation is proven. It remains the fallback — with the codex-supplied caveat that **any dispatch-path recovery cannot fire `sync-main-to-dev` (push-only), so Phase 5 switches to the runbook's manual sync procedure in that case**.

## Phases

### Phase 1 — JIT pre-flight (state verification only)

Re-verify live state immediately before acting (never trust prior snapshots):

All checks are **fail-closed assertions** (non-zero exit = stop), not printed values:

```
test "$(gh variable get AUTO_UNSTICK_ENABLED)" = "on"
git fetch origin --tags
test "$(git rev-list -n1 v0.26.0)" = "$(git rev-parse origin/main)"      # main tip == peeled last tag
! git rev-parse -q --verify refs/tags/v0.27.0                             # no pre-existing tag
! gh release view v0.27.0 >/dev/null 2>&1                                 # no pre-existing release
prot=$(gh api repos/alejoamiras/nulo/branches/main/protection)
test "$(jq -r '.required_status_checks.strict' <<<"$prot")" = "true"
test "$(jq -r '.required_signatures.enabled' <<<"$prot")" = "true"
for c in quality-status smoke-e2e-status network-e2e-status; do
  jq -e --arg c "$c" '.required_status_checks.checks[] | select(.context==$c and .app_id==15368)' <<<"$prot" >/dev/null
done                                                                      # contexts present + app_id-pinned to Actions
test "$(gh pr view 337 --json headRefOid -q .headRefOid)" = "c00598aee7a69a4e75382a9c83a9d4cb6188f0ed"
test "$(gh pr view 337 --json mergeStateStatus -q .mergeStateStatus)" = "CLEAN"
test "$(gh pr view 337 --json statusCheckRollup -q '[.statusCheckRollup[] | select(.name=="quality-status" or .name=="smoke-e2e-status" or .name=="network-e2e-status") | .conclusion] | sort | unique | join(",")')" = "SUCCESS"
test "$(gh pr list --base main --state open --json number -q 'length')" = "1"
```

**Validation gate** — the assertion block exits 0 end to end. Layers: none (state checks). Any non-zero → stop, diagnose, do not proceed. (Codex condition: `CLEAN` alone can't detect weakened live protection — hence the explicit strict/signatures/context+app_id assertions.) **Phase 2 may not start until the approval gate's two owner Asks are explicitly resolved.**

### Phase 2 — Merge promote PR #337 (dev → main)

Server-side head pin is the real guard (closes the TOCTOU window; the fetch is advisory):

```
gh pr merge 337 --merge --match-head-commit c00598aee7a69a4e75382a9c83a9d4cb6188f0ed
```

**Validation gate** — `git fetch origin && git log origin/main -1 --format='%H %p %s'`: pass = a TRUE 2-parent merge commit whose second parent is `c00598ae…`; #337 state MERGED. Layers: none new (the PR's three required gates are already green and are the content gate).

### Phase 3 — Merge the release-please Release PR

release-please opens `chore(main): release 0.27.0` within ~1 min of the push to main. Review the `CHANGELOG.md` diff + version. **The authorized release is 0.27.0 — if release-please computes ANY other number, STOP and diagnose (manifest drift, ancestry break); do not ship an unapproved version.** Wait for full required CI (~30–45 min). **Batch discipline is the gate, not "3 non-pending"** (0.26.0 lesson: a superseded CI batch on the same head reports FAILURE after cancellation):

```
RPR=<releasePR#>; HEAD=$(gh pr view $RPR --json headRefOid -q .headRefOid)
for wf in "Quality" "Smoke e2e" "Network e2e"; do
  test "$(gh run list --workflow "$wf" --commit "$HEAD" --json status,conclusion \
    -q 'map(select(.status=="completed")) | .[0].conclusion')" = "success"   # fail-closed per workflow
done
test "$(gh pr view $RPR --json mergeStateStatus -q .mergeStateStatus)" = "CLEAN"
gh pr merge $RPR --merge --match-head-commit "$HEAD"
TAG_SHA=$(gh pr view $RPR --json mergeCommit -q .mergeCommit.oid)   # record in lessons
```

Flake → re-run that check; cancellation artifacts (superseded batch) are not failures. **Validation gate** — the three per-SHA latest-completed runs each `success`, `mergeStateStatus=CLEAN`, merged as a 2-parent merge commit, `TAG_SHA` recorded. Layers: full CI on the release content (server-side).

### Phase 4 — Auto-unstick + publish chain (hands-off, watched)

The post-merge `push:main` run: release-please aborts (v4 bug — expected), `auto-unstick` tags `v0.27.0` @ `TAG_SHA`, creates the Release, relabels; the SAME run continues: gates → build chrome+firefox → smoke-against-artifact → attach-assets → refresh-landing + deploy-faucet → verify-live (advisory). Watch; intervene only per the recovery table.

**Validation gate**:

```
git fetch origin --tags
test "$(git rev-list -n1 v0.27.0)" = "$TAG_SHA"                    # peeled commit, annotated-tag-safe
rel=$(gh release view v0.27.0 --json isPrerelease,isDraft,body,assets)
test "$(jq -r .isPrerelease <<<"$rel")" = "false"
test "$(jq -r .isDraft <<<"$rel")" = "false"
test "$(jq -r '[.assets[].name] | sort | join(",")' <<<"$rel")" = "SHASUMS256.txt,nulo-chrome-0.27.0.zip,nulo-firefox-0.27.0.zip"
jq -e '.body | (length > 200) and (. != "Filled by publish run.")' <<<"$rel" >/dev/null
cd <scratchpad> && gh release download v0.27.0 -p '*' && sha256sum -c SHASUMS256.txt   # hashes verify
```

Layers: smoke e2e against the real built artifact (in-chain) + local hash verification.

**State-based recovery (replaces a linear fallback ladder):**

| Observed state | Action |
|---|---|
| Tag exists at a DIFFERENT SHA than `TAG_SHA` | **STOP.** Fail-closed by design (auto-unstick refuses re-point). Investigate before anything else. |
| No tag, chain skipped (`unstuck=false`, flag was off / no-op) | Manual unstick (runbook § Stable 5) → `gh workflow run release.yml --ref main -f tag=v0.27.0 -f dry_run=false` → **dispatch-recovery: Phase 5 switches to MANUAL sync** |
| Correct tag + release exist but chain skipped (partial prior run healed by auto-unstick's `skip` path — it emits `unstuck=false`, so `resolve` never advances) | Dispatch directly: `gh workflow run release.yml --ref main -f tag=v0.27.0 -f dry_run=false` → **dispatch-recovery: Phase 5 switches to MANUAL sync** |
| Release exists, assets missing or body still placeholder, `attach-assets` red or skipped | Re-run the failed jobs of that run, or dispatch as above → same manual-sync consequence if dispatched |

**Any dispatch-path recovery means `sync-main-to-dev` will NOT fire (push-only job)** — Phase 5 then uses the runbook's manual two-step (merge main→dev, then the prerelease-manifest re-baseline PR).

### Phase 5 — Merge the sync-back PR (main → dev, MERGE COMMIT)

Happy path: `sync-main-to-dev` opens `chore: sync main → dev`. **`dev` stays frozen (no pushes, no docs PR) until this merges** — loose protection on dev means base movement doesn't force re-runs, so movement here is silent risk. Wait for dev's required gates (~30–45 min), then:

```
SPR=<syncPR#>; SHEAD=$(gh pr view $SPR --json headRefOid -q .headRefOid)
gh pr merge $SPR --merge --match-head-commit "$SHEAD"     # NEVER squash — ancestry feeds the next rc cut
```

If labeled `needs-manual-resolution`: resolve on the sync branch, then merge-commit. If Phase 4 took a dispatch recovery: manual sync per runbook § "After a stable cut" (order matters: merge main→dev first, then re-baseline the prerelease manifest). **Validation gate** — true 2-parent merge on dev; `dev:package.json` version == 0.27.0; `.release-please-prerelease-manifest.json` == `{".": "0.27.0"}`; and after `git fetch origin dev --tags` + re-confirming `git rev-list -n1 v0.27.0 == $TAG_SHA`: `git merge-base --is-ancestor v0.27.0 origin/dev` exits 0. Layers: full CI on dev.

### Phase 6 — Live verification + wrap-up

- **Tools testnet host** (automated, unauthenticated): `verify-live` covers `testnet.tools.nulo.sh`; independently re-check `/build.json` buildId SHA-suffix == first 8 of `TAG_SHA` AND `index.html` `nulo-build` meta == buildId.
- **Tools mainnet host** (`tools.nulo.sh` is Access-gated — NOT reachable by automation): **owner-verified** in the browser — same buildId/meta check + the FROM chip reads "ETHEREUM". This is an explicit Ask resolved at approval (owner does the authenticated check).
- **Landing**: `nulo.sh` proves **release selection** (serves/links v0.27.0 assets) — that is what its build does; do not over-claim source-SHA freshness.
- Release page re-check (assets + hashes already verified in Phase 4).
- Wrap-up: lessons filed per phase; `implementations-plan/index.md` entry; **docs PR** with this plan dir → `dev` (squash); suggest `agent-worktree done stable-release-0.27.0` after it merges.

**Validation gate** — testnet-host buildId checks pass; owner confirms the mainnet host; landing serves 0.27.0; docs PR open with `quality-status` green. Stale site → `gh workflow run refresh-landing.yml [-f target=landing|faucet|both]`, re-verify. Layers: live verification (read-only) + owner check.

## Security & Adversarial Considerations

- **Artifact integrity**: assets built in-chain from the tag; Phase 4 downloads them and verifies `sha256sum -c SHASUMS256.txt` locally. Tag fail-closed (no re-point). **Accepted residual risk this cut (explicit owner Ask at approval)**: SHASUMS proves self-consistency not independent provenance; Actions pinned by mutable major tags; **no protected-tag/immutable-release rule** (a later actor with repo write could re-cut assets); App tokens are minted without permission narrowing, inheriting the App's full grant. All recorded as follow-ups, out of this plan's scope.
- **Least privilege in-plan**: no `--admin` anywhere; every merge passes real gates with server-side head pins; no static CF tokens handled locally.
- **Zero-asset window**: a Release without assets breaks landing builds (0.24.0 lesson). Auto-unstick publishes in the same run; Phase 4 gates on assets before Phase 5.
- **Deploy freshness**: CF rebuilds from Git on hook fire; a green hook job proves the POST, not the deploy — hence the SHA/buildId verification in Phase 6, per host, with the Access-gated mainnet host owner-verified.
- **Content risk of this cut**: fee-cap basis change carries a dedicated adversarial codex audit (#335 comment; follow-ups #336). Mainnet swap-fuel + two-network tools shipped through audited arcs. No storage-shape migrations ride this cut.

## Assumptions

**Facts (verified live this session):**
1. `AUTO_UNSTICK_ENABLED` = `on` (`gh variable get`, 2026-07-28).
2. Stable + prerelease manifests both `{".": "0.26.0"}` (files read on `dev`).
3. `origin/main` tip `bffaad26…` == `git rev-list -n1 v0.26.0` (peeled annotated tag — verified equal), i.e. main == last release.
4. PR #337 head is `c00598aee7a69a4e75382a9c83a9d4cb6188f0ed`, all required checks green, `mergeStateStatus: CLEAN` (after one smoke-flake re-run).
5. The back-sync must be a merge commit — a squash drops main's release commit from dev's ancestry and breaks release-please's next-cut version detection (`implementations-plan/release-prerelease-fix/plan.md`).
6. The promote head passed the full network suite incl. the prover-ON frozen-account canary (PR #337 checks).
7. `refresh-landing`/`deploy-faucet` fire on any publish path (`always() && !cancelled()` guards) — but they only POST deploy hooks; **CF rebuilds from Git independently**, so deploy freshness must be verified, not inferred from job green (`release.yml`, verified by codex + spot-read).
8. `v0.26.0` is an **annotated** tag: `git rev-parse` returns the tag object (`cf012d…`), `git rev-list -n1` the commit (`bffaad…`) — Phase 4's gate uses the peeled form.
9. auto-unstick's `skip` path (tag already correct) heals release+label but emits `unstuck=false`, leaving the publish chain skipped (`scripts/release/auto-unstick-run.ts`) — hence the dispatch row in the recovery table.
10. `verify-live` checks only `testnet.tools.nulo.sh`; the mainnet tools host is Access-gated (`scripts/release/verify-live-run.ts`).

**Inferences (unverified — attackable):**
- Release-please will compute 0.27.0. If it doesn't, Phase 3 STOPS (no unapproved version ships).
- Release PR + sync PR CI will pass — same content already green on #337; CI weather differs; mitigation = re-runs, never gate changes.
- GitHub/CF availability through the ~2h window; the sync PR merges clean if dev stays frozen.

**Asks (to resolve AT the approval gate, not silently):**
1. Owner performs the authenticated mainnet-tools-host verification in Phase 6 (automation cannot cross Cloudflare Access).
2. Owner accepts, for this cut, the recorded supply-chain residuals: mutable-major-tag Actions, no protected-tag/immutable-release rule, broad App-token permissions. (Tightening them = follow-up work items, not this release.)

## Post-implementation hardening

Declined for this cut (Phase 0). Standing follow-ups: recon.md list + the § Security accepted residuals + #336.

## Timing

~1.5–2.5 h wall clock, dominated by two full network-e2e cycles (Release PR, sync PR). Phase 2 is instant (gates already green).

## Audit

- `audit-codex.md` — single codex audit (light tier), session `019fae11-53b3-7e61-b850-0e0513e58df7`.
- **Round 1 verdict (draft): `reject`** — six findings, ALL adopted (annotated-tag peeling + body/draft/hash gate; state-based recovery table + dispatch⇒manual-sync rule; per-host freshness with owner-verified mainnet host; executable batch-discipline gate; full-OID head pins; dev freeze; accepted-risk Asks surfaced). Adopted/rejected log in `audit-codex.md`.
- **Round 2 verdict (revised plan, resumed session): `conditional approve (with conditions: add fail-closed JIT rules/check assertions and explicitly resolve owner Asks 1–2 before execution)`** — both conditions folded: Phases 1/3/4 gates are now fail-closed `test`/`jq -e` assertions (incl. branch-protection strict/signatures/context+app_id verification and the #337 rollup assertion), and the two Asks are resolved AT the approval gate before Phase 2 can start.

## Approval

**APPROVED** by the owner at the gate (2026-07-29), verdict `approve`, with both Asks explicitly confirmed: (1) owner performs the authenticated mainnet-tools spot-check in Phase 6; (2) the recorded supply-chain residuals are accepted for this cut. Scope unchanged from the audited revision — draft seeds promoted to final verbatim.

## Seeds (FINAL — post-approval)

ELI5 Artifact: https://claude.ai/code/artifact/af831909-632a-4b67-82c8-151190a9f4db (source: `eli5.html` in this dir — republish the same path to update the same URL). Recommended seed: `/goal` (completion fully transcript-observable); `/loop 15m` alternative embedded alongside it in the ELI5. Both must run inside this worktree (`agent-worktree resume stable-release-0.27.0`).
