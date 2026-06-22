# Plan — Quality-arc completion on `dev-quality` (meta-orchestration)

**STATUS: ✅ COMPLETE.** All 8 in-scope arcs + the codex-found Q8 fix merged into `dev-quality` and validated by a green capstone full-network sweep on dev-quality HEAD. Branch `dev-quality` off dev `65961f1` (post-Q3 + aztec 5.0 + design round 2). Promotion `dev-quality → dev` is the user's call (never auto-merged, per hard limits).

**Synced to latest dev (2026-06-22):** merged `origin/dev` @ `4ad1b45` (+5: design round-3 #127 [retire AppButton/SFC shadows/dark color], faucet Fuel #104, passkey rebrand #138, frontend-UX #140, Q1 doc #119) into dev-quality (merge `1b29881`). Only textual overlap was `contact/service.ts` — git auto-merged it (kept BOTH the Q15 `purgeRows` adoption AND dev's `getInitials` swap); `index.md` resolved by hand. No semantic breakage from #127's deletions (typecheck:all green across all 12 packages). Re-validated post-merge: full gate GREEN — Quality 27944086316 · Network 27944084992 (8/8 jobs RUN) · Smoke 27944087726.

**Arc progress:** Q12 ✓ · Q15 ✓ · Q17 ✓ · Q6 ✓ · Q13 ✓ · Q8 ✓ · Q9 ✓ · Q18 ✓ merged (squash `16c5e6e`, PR #135; net 27916454771 = 8/8 green, quality 27916455252 green, smoke 27916455796 green on 1 sanctioned re-run that cleared the recurring accounts SW-restart flake). **ALL 8 IN-SCOPE ARCS MERGED (8 of 8).** Final integration sweep on dev-quality HEAD (`3d0624d`): Quality ✓ (27917057135) · Network ✓ 8/8 jobs RUN (27917056616) · Smoke ✓ (27917057676, 1 sanctioned re-run cleared a lockWallet→auth 60s timing flake — path not touched by any arc).

**Post-integration confidence pass (2 codex audits over `65961f1..3d0624d`):** both converged on ONE real finding — Q8 `BalanceView.onBalanceDeleted` reordered the row-filter ahead of the selected-token guard, so deleting the displayed token left `displayOption` stale (home balance stuck at $0.00). Everything else cleared by both (Q15 purge order/authz, Q9 no-cycle, Q18 feePaymentMethod mapping + error strings, Q6 listener teardown, Q12/Q13/Q17). Codex behavior `019eebfa-df96-7db1-8379-1fa22af12688`; adversarial `019eebfa-e322-7281-becf-c1bfbfd2089d`. **Q8-fix follow-up: PR #136 MERGED (squash `c41a2928`)** — capture-before-filter + new `BalanceView.test.ts` (2 cases, proven to fail vs the old ordering). Full sweep on the fix GREEN first-try: net 27917781709 (8/8 jobs RUN) · quality 27917782283 · smoke 27917782821. dev-quality HEAD now `64e57a4` (all 8 arcs + the Q8 fix + docs). **Capstone full-network sweep on dev-quality HEAD GREEN first-try: Network 27918108499 (8/8 jobs RUN, none skipped) · Quality 27918109324 · Smoke 27918109874.**

---

## WRAP-UP — quality-arc COMPLETE on `dev-quality`

All 8 in-scope `/harden quality` findings implemented behavior-preserving, validated (units + smoke + full network e2e, every job confirmed RUN), and squash-merged into `dev-quality`. Two independent post-integration codex audits caught one regression (Q8 display-reset), fixed + tested + re-validated. Capstone sweep on dev-quality HEAD green.

### The 8 arcs (each: lint + typecheck + units + smoke + network 8/8, then squash-merge)
| Arc | Squash | Net run | Shipped |
|-----|--------|---------|---------|
| Q12 e2e fixture dedup | `6a8f673` | 27911369853 | `phase`/`setupConnectedPlayground`/`grantCapBundle` + single `TEST_PASSWORD`. Test-infra only. |
| Q15 lifecycle purge cascade | `a20f8fd` | 27911901417 | `purgeRows(rows, remove, emitDeleted)` at 12 sites / 8 services; lock + emit-order preserved. |
| Q17 ContractResolver | `54d0b39` | 27913404523 | single-contract `ensureRegistered`; 4 token/fpc prologues migrated. |
| Q6 activity-feed | `d519b33` | 27914290541 | `useIncomingTransfers` composable (13 tests). #2/#3/#4 deferred (codex). |
| Q13 PXE subset | `a7d0c6f` | 27914901918 | `PXE_SUBSET_METHODS` + IPXE/PXEProxy↔Methods assertions; drift-guard proven (TS2344). Type-only. |
| Q8 popup forms | `5de5f0a` (+fix `c41a2928`) | 27915441247 | `useFormState.rebase()`/`isDirty` + 2 adopters + 2 drift fixes. Audit-found display-reset regression fixed. 1b/EditContact/useEntityCrud deferred. |
| Q9 transport readiness | `5b5f34e` | 27916092215 | declared `TokenBalanceService` startup deps. Central gate deferred (base-class behaviour change). |
| Q18 execution tuples | `16c5e6e` | 27916454771 | `processAztecJsPayload` → named `ProcessedAztecJsPayload`; 4 consumers. Big tuples already done by #83. |

### Confidence pass — 4 audits, 2 model families, all converged
- **#1 codex behavior** (`019eebfa-df96-7db1-8379-1fa22af12688`) → fix-first: Q8 `BalanceView` regression.
- **#2 codex adversarial** (`019eebfa-e322-7281-becf-c1bfbfd2089d`) → fix-first: same Q8 regression.
- **#3 codex gaps** (`019eee12-ecf7-7920-801c-07ec65dac72a`, run AFTER the fix) → **ship**: Q8 fix correct + test non-tautological; no cross-arc interaction hazard (Q9+Q15 / Q6+Q8 / Q18+Q17); Q6/Q8/Q9 deferrals are clean stopping points (Q9 dep IS enforced by `ServiceCollection.start()`).
- **#4 Claude hostile** (different family, opus, run AFTER the fix) → **ship**: no second bug; independently re-verified Q18 (all 4 consumers read the correct field, no fee-method/gas transposition) + Q15 (all 12 sites byte-identical, delete-before-emit + lock + stop-on-first-rejection preserved) + Q12/Q13/Q17/Q6/Q9.

The ONLY real finding across all four was the Q8 regression (fixed `c41a2928`, pinned by `BalanceView.test.ts`). The Claude pass raised 2 NITs, both dead-path, **not fixed** (no behavior change in real flows): `EditNetworkPopup` dirty-check snapshot-vs-live (diverges only if a network is renamed elsewhere while the modal is open — cosmetic), and `EditEndpointPopup` `rpcUrl ?? ""` (unreachable; `rpcUrl` always required). Codex #3's follow-up suggestion (a `ServiceCollection` + `purgeChain` integration test) was evaluated and **narrowed**: the literal form was low-ROI (heavy/mock-laden; the `purgeChain` coordinator + `purgeRows` helper are already unit-tested), but it pointed at one genuinely untested load-bearing hop — `TokenBalanceService.onTokenDeleted` (delete a token → purge its balance rows). Implemented as a focused real-handler/real-repo test: **PR #139 (squash `da4b51e`)**, `token-balance/service.test.ts` (3 cases, proven to fail if `repo.delete` is removed). Test-only (no production diff) → gated on Quality + Smoke (both green); network e2e justifiably skipped.

### Honest scope note
Q6/Q8/Q9 shipped the safe sliver of their finding (rest deferred, documented in lessons + the `verified.md` resolution table). Q12/Q13/Q15/Q17/Q18 fully resolved. These are contained dedups — the architectural findings that drive the audit's quality verdict (Q4 `ExecutionService`, Q5, Q10, Q11) are **deferred, never touched**, along with Q19 (authz) and Q23.

### Deferred (out of scope, untouched)
Q4, Q5, Q10, Q11, Q19, Q23.

### Notes
- No new flakes introduced: the three smoke reds during the marathon (accounts SW-restart ×2, lockWallet→auth ×1) were all pre-existing timing flakes on paths no arc touched; each cleared on the single sanctioned re-run. Both `c41a2928` and `64e57a4` capstone sweeps were green first-try.
- `verified.md` marked: resolution-status table (all 23) + inline status on the 8 in-scope headers.
- **`dev-quality → dev` promotion is the user's call** — not auto-merged (hard limit).

**Origin:** finish the remaining `/harden quality` arc (run `2026-06-11-ultra-50b45d`, `audit/quality/.../findings/verified.md`, 23 findings) on an isolated integration branch `dev-quality`. This is a META-blueprint: it sequences the arc; each finding gets its OWN `/blueprint` (light/mid) when the loop reaches it.

## Arc status (23 findings)
- **Done/merged/dropped (9):** Q1 (#91), Q2 (PR), Q3 (#121 ✓), Q7/Q14/Q16/Q20/Q22 (quick-wins), Q21 (dropped — mooted by #91).
- **IN SCOPE here (8, contained):** Q6, Q8, Q9, Q12, Q13, Q15, Q17, Q18.
- **DEFERRED (6, supervised later — DO NOT TOUCH):** Q4 (ExecutionService decomp), Q5 (send-pipeline tail), Q10 (composition-root), Q11 (WalletSdkDispatcher), Q19 (active-profile guards — authz), Q23 (claim/cancel coupling).

## Decisions (user, this session)
- **Scope:** contained dedups only (the 8 above). The 6 architectural/authz findings are explicitly out of scope here.
- **Validation:** **FULL network e2e on EVERY arc** (units + smoke + network), all green AND every network job confirmed RUN (not skipped — the reducer reports green-when-skipped), on a base synced to latest `dev-quality`.
- **Engine:** **inline** in the driving session (max control); read-only sub-agents allowed for re-verification only.
- **Merge model:** one arc per branch off latest `dev-quality` → PR (base `dev-quality`) → CI → squash-merge `--admin` into `dev-quality`. No back-compat / state-migration required (no production users) **as long as the app + ALL tests stay green.**

## Autonomy & network-red policy (NON-NEGOTIABLE)
- **FULLY AUTONOMOUS — NEVER pause for the user's judgment.** There is no "stop and surface for a human call." Every decision is resolved by `/codex xhigh` + your own judgment. The ONLY stop is completion (all 8 ✓ + final sweep green) or a true external blocker you cannot act on (e.g. credentials).
- **Network e2e is reliable now (the suite was hardened).** A red is therefore a SIGNAL, not noise — treat it as **most likely a real break your change introduced**, not a flake.
- **Red handling:** re-run the failed job(s) **ONCE** (a genuine one-off flake clears on a single re-run — "at most it fails once"). Green on the re-run → proceed. **Still red after that one re-run → it is REAL → root-cause and FIX it yourself** (read the failure, reproduce locally where possible, `/codex xhigh` if stuck), then re-validate to green. Then continue.
- **FORBIDDEN:** retry-until-green (re-running repeatedly to wait out a red), skipping/quarantining/`.skip`/disabling a failing test, weakening an assertion, or merging over a red — all are masking. **Do not introduce flakes:** any test you add/touch must be deterministic; if your change makes a test intermittently red (flaky across re-runs), that is a defect you OWN and fix deterministically, never paper over with retries.
- Same discipline for smoke/unit reds: investigate + fix, never skip.

## Per-arc workflow (every finding)
1. **RE-VERIFY FIRST** against current `dev-quality`: grep the cited symbols/sites from `verified.md` + check the constraints registry. The audit snapshot predates Q1/Q3 + aztec 5.0 — some findings may be partly/fully **moot** (e.g. Q9's `ensureInitialized` was unified for extension-messaging by Q3; Q13/Q17 sit on aztec-runtime which the 5.0 fork churned; Q18 overlaps execution-decomposition #83). If moot → mark `✓-moot` with evidence + advance. If shrunk → re-scope.
2. **Blueprint** at its tier (`/blueprint light|mid`). Open questions → **codex xhigh** (no user gate; codex resolves; log the consult + verdict in lessons).
3. **Implement inline**, preserving every constraints-registry invariant **verbatim**; pin surprising preserved behavior with a BUG-PIN test. Tests inline with the change.
4. **Gate:** `bun run lint` + touched-package typecheck + units + smoke + **full network e2e** — all green, jobs-confirmed-run, latest-`dev-quality` base.
5. **Merge** squash into `dev-quality`; mark `✓` + merge SHA + network run id in this plan; file `lessons/<arc>.md`; print `LESSONS_FILE=…`; advance.

### ⚠ CI mechanics on `dev-quality` (discovered Q12 — applies to EVERY arc)
`pr-quick`/`pr-smoke-e2e`/`pr-network-e2e` filter `pull_request: branches: [main, dev]` → **a PR based on `dev-quality` triggers NO CI** (only Cloudflare). Do NOT wait for PR checks that never appear. **Run the gates via `workflow_dispatch`:** `gh workflow run pr-network-e2e.yml --ref <arc-branch> -f disable_accelerator=false` (+ `pr-quick.yml`), then read the run conclusion with `gh run view <id>`. Dispatch bypasses the `changes` paths-filter, so every network shard runs. `dev-quality` has NO branch protection → merge the arc on validated dispatch results (squash; no `--admin`/required-check needed).

## Ordered arcs (safest/cheapest → most invasive)

| # | Finding | Tier | Key constraints (registry) / re-verify note |
|---|---------|------|----------------------------------------------|
| 1 ✓ | **Q12** e2e fixture dedup (`phase`, connected-playground setup, cap-grant helper, single `TEST_PASSWORD`) | light | **DONE** — squash `6a8f673`, net run 27911369853 (8/8 green). Test-infra only. `lessons/q12.md`. |
| 2 ✓ | **Q15** lifecycle purge-cascade helper | mid | **DONE** — squash `a20f8fd`, net 27911901417 (8/8). `purgeRows` + 12 sites/8 svcs. `lessons/q15.md`. |
| 3 ✓ | **Q17** extend `ContractResolver` | SHRUNK | **DONE** — squash `54d0b39`, net 27913404523 (8/8). Added single-contract `ensureRegistered` + migrated 4 prologue sites (token/fpc). findFunction* were already done by prior work. `lessons/q17.md`. |
| 4 ✓ | **Q6** activity-feed extraction | codex-narrowed | **DONE** — squash `d519b33`, net 27914290541 (8/8 after 1 canary flake re-run). Shipped `useIncomingTransfers` (cross-surface composable dedup, 13 tests). **#2/#3/#4 DEFERRED** per codex 019eeb77 (low-value / hot-widget tie-break + fallback risk — see `lessons/q6.md`). |
| 5 ✓ | **Q13** PXE subset key-list + type assertions | light/mid | **DONE** — squash `a7d0c6f`, net 27914901918 (8/8). Type-only `PXE_SUBSET_METHODS` + IPXE/PXEProxy↔Methods assertions; drift-guard proven (TS2344). `lessons/q13.md`. |
| 6 ✓ | **Q8** popup form abstractions | codex-narrowed | **DONE** — squash `5de5f0a`. useFormState rebase + field.isDirty (5 tests) + EditEndpoint/EditNetwork adopt + SelectToken/BalanceView drift fixes. #18 FormPopup-Enter + EditContact + broad useEntityCrud deferred. `lessons/q8.md`. |
| 7 ✓ | **Q9** centralize transport-side readiness | codex-narrowed | **DONE** — squash `5b5f34e`. Shipped the safe deps lever (declared `TokenBalanceService` deps — the only init-time peer-awaiter missing one); KEPT preambles; DEFERRED the transport gate (base-class behaviour change + breaks 14 base-service tests for non-bug drift). `lessons/q9.md`. |
| 8 ✓ | **Q18** internal execution tuples → named result objects | mid → **SHRUNK** | **DONE** — squash `16c5e6e`, net 27916454771 (8/8; smoke green on 1 sanctioned re-run). Shipped `ProcessedAztecJsPayload` named object for `processAztecJsPayload`; migrated 4 consumers (dapp-send-executor×2, view-executor×2) + test mocks. #83 + aztec 5.0 had already named the big tuples; #3 FpcStrategy untouched (already named). Behaviour-preserving (281 execution units green). `lessons/q18.md`. |

The loop may re-order/re-tier on re-verification; record any change here.

## Security & Adversarial Considerations
- The arc's biggest authz risk (**Q19**, ~90 active-profile guards, ~37 deliberate non-throwers — a mis-sweep silently weakens a lock gate / changes a dApp error contract) is **DEFERRED**, not in this loop. Same for the hotspot decompositions (Q4/Q10/Q11) where blast radius is highest.
- Each in-scope arc is behavior-preserving (constraints registry pinned). No new deps, no crypto, no privilege surface. Wire-format/parity pins (Q17 error strings, Q13 zod, Q18 fpc byte-parity) preserved verbatim.

## Done definition
All 8 arcs `✓` (or `✓-moot` with evidence) merged to `dev-quality`; each gate (units+smoke+network, jobs-run) reported passing; lessons filed; a **final full-network sweep on `dev-quality` HEAD** green; `bun run lint` + all package test suites exit 0. `dev-quality` = dev + the 8 contained quality arcs, validated. (PR `dev-quality → dev` is the user's call, later.)

## Seeds
_(below; finalized at kickoff)_
