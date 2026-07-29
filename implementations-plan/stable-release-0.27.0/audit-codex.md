# Codex audit — stable-release-0.27.0 (light tier, single audit + re-verdict resume)

Model gpt-5.6-sol @ xhigh, read-only sandbox, run from the plan worktree. Round 1 audited the draft plan; the session was resumed with the revised plan for the mandatory-format re-verdict.

## Round 1 — verdict on the DRAFT: `reject`

> reject (with blocking findings: repair the tag/body gate, close partial-publish/manual-sync recovery, and make both-host freshness/CI gates executable)

Findings (ranked), with adoption status — **all six adopted, none rejected**:

1. **CRITICAL — tag-integrity gate wrong for annotated tags.** `auto-unstick` creates an *annotated* tag, so `git rev-parse v0.27.0` returns the tag object, not the commit. Reproduced locally: `git rev-parse v0.26.0` → `cf012d…` (tag object) vs `git rev-list -n1 v0.26.0` → `bffaad…` (== main tip). Also: the draft's release check omitted `body`/`isDraft` and never verified hashes. **Adopted**: Phase 4 gate peels via `rev-list -n1`, checks `isPrerelease,isDraft,body` non-placeholder + the exact 3-asset list, downloads assets and runs `sha256sum -c SHASUMS256.txt`.
2. **HIGH — fallback ladder could strand release AND sync.** auto-unstick's `skip` path (tag already correct) heals release+label but emits `unstuck=false` (verified in `scripts/release/auto-unstick-run.ts`), so the chain stays skipped; and ANY `workflow_dispatch` recovery cannot fire the push-only `sync-main-to-dev`. **Adopted**: state-based recovery table (wrong-SHA tag → STOP; no tag → manual unstick + dispatch; healed-but-skipped → dispatch; red attach-assets → re-run/dispatch), every dispatch row switching Phase 5 to the manual sync procedure.
3. **HIGH — deploy provenance overstated; only the testnet tools host is auto-verified.** The deploy jobs POST CF hooks; CF rebuilds from Git independently. `verify-live` targets `testnet.tools.nulo.sh` only (verified in `scripts/release/verify-live-run.ts`); the mainnet host sits behind Cloudflare Access. **Adopted**: provenance reworded (Fact 7), per-host Phase 6 checks, mainnet host owner-verified (explicit Ask #1), landing claimed as release-selection only.
4. **HIGH — CI gate needed executable batch discipline.** The 0.26.0 cancelled-batch lesson was prose, not a gate. **Adopted**: Phase 3 gates on the latest COMPLETED run per required workflow for the exact head SHA == success, plus `mergeStateStatus=CLEAN`.
5. **MEDIUM — head-pin hygiene.** Full OID (`c00598aee7a69a4e75382a9c83a9d4cb6188f0ed`) inline; `--match-head-commit` on all three merges; dev frozen until the sync merges; ancestry check preceded by fresh fetch + tag-to-`TAG_SHA` re-confirmation. **Adopted.**
6. **MEDIUM — token/artifact trust understated.** App tokens minted without permission narrowing; no protected-tag/immutable-release rule. **Adopted as explicit accepted-risk Ask #2 + follow-ups** (tightening is release.yml/repo-settings work outside this release).

Assumption attacks folded: Fact 7 reworded; JIT pre-flight extended (no pre-existing v0.27.0 tag/release; peeled-tag == main tip); "continue with release-please's number" flipped to STOP-if-not-0.27.0; both silent Asks surfaced.

## Round 2 — verdict on the REVISED plan (resumed session)

> Fresh verdict: the six original blockers are materially closed. Supply-chain hardening may be deferred for this cut because marketplaces remain off and the residual risk is explicit, but only after owner acceptance.
>
> Two execution conditions remain: (1) Phase 1 still omits JIT rules verification — recheck required contexts and App IDs, `main strict:true`, signatures, permitted merge methods, and assert #337's exact-head rollup contains successful `quality-status` / `smoke-e2e-status` / `network-e2e-status` (`CLEAN` alone cannot detect weakened live protection). (2) Phase 3's "executable" gate only prints values — make each workflow query fail unless the latest authoritative run is completed/success, `test $mergeStateStatus = CLEAN` before merging, and make the Phase 4 metadata gate assertive. Also: explicitly resolve both approval-gate Asks before Phase 2.
>
> The recovery matrix, tag peeling, checksum verification, dispatch-to-manual-sync transition, full head pins, dev freeze, ancestry check, and per-host freshness model are now correct.
>
> **conditional approve (with conditions: add fail-closed JIT rules/check assertions and explicitly resolve owner Asks 1–2 before execution)**

**Both conditions folded into the plan** (same revision cycle, before the approval gate): Phase 1 now asserts branch-protection `strict`/`required_signatures`/the three contexts app_id-pinned to Actions (15368) + the #337 per-check rollup, all via fail-closed `test`/`jq -e`; Phase 3 and Phase 4 gates converted from printed values to assertions; the two owner Asks are resolved explicitly at the approval gate, which precedes Phase 2.
