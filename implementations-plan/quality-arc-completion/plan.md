# Plan — Quality-arc completion on `dev-quality` (meta-orchestration)

**STATUS: IN PROGRESS (`/goal` active, fully autonomous).** Branch `dev-quality` off dev `65961f1` (post-Q3 + aztec 5.0 + design round 2).

**Arc progress:** Q12 ✓ (`6a8f673`) · Q15 ✓ (`a20f8fd`) · Q17 ✓ merged (squash `54d0b39`, PR #130; net 27913404523 = 8/8 green, smoke+quality CI green) · **Q6 in progress** · Q8/Q13/Q9/Q18 pending. **(3 of 8 done; 5 remain: Q6/Q8/Q13/Q9/Q18)**

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
| 4 | **Q6** activity-feed extraction (`useIncomingTransfers`, `buildJournalAwaitingCardProps`, collapse template branches) | mid | Reuse `buildActivityRows` w/ NEW params (limit + tokenId). **RISK (codex it):** widget's `recentlyTerminalJournalOps` + `sortKey: op.terminalAt ?? 0` may include terminalAt-null ops that `buildActivityRows` drops — verify behaviour-preserving. Don't touch the good helpers (`activity-rows.ts:42-76`, `journal-state.ts:324-352`). useIncomingTransfers = C1 composable (≥10 tests). |
| 5 | **Q8** popup form abstractions (`useFormState.rebase()` + `FormPopup` Enter/error ownership; `useEntityCrud` adoption) | mid | #18: `NewContactPopup` Enter double-fire hazard must be handled by any FormPopup-level fix. |
| 6 | **Q13** PXE subset key-list + type-level `IPXE`/`PXEProxy`↔`Methods` assertions | light/mid | #14: derivation drops `network` + promisifies; `client.ts` zod can't be generated. **Re-verify vs aztec 5.0** (Methods unchanged by Q3, but 5.0 churned bodies). |
| 7 | **Q9** centralize transport-side readiness in the base service + expand declared `dependencies` | mid | NOT dispatch-boundary gating (in-process callers). **Re-verify**: Q3 unified extension-messaging `ensureInitialized`→`awaitInitialized`; confirm what's left on the extension service fleet. |
| 8 | **Q18** internal execution tuples → named result objects (step-1 intra-extension only) | mid | #3: `FpcStrategy` byte-parity-sensitive — never normalize into the family. Internal-only (both ends ship together); NOT the public RPC param-object (that's step 2, out of scope). |

The loop may re-order/re-tier on re-verification; record any change here.

## Security & Adversarial Considerations
- The arc's biggest authz risk (**Q19**, ~90 active-profile guards, ~37 deliberate non-throwers — a mis-sweep silently weakens a lock gate / changes a dApp error contract) is **DEFERRED**, not in this loop. Same for the hotspot decompositions (Q4/Q10/Q11) where blast radius is highest.
- Each in-scope arc is behavior-preserving (constraints registry pinned). No new deps, no crypto, no privilege surface. Wire-format/parity pins (Q17 error strings, Q13 zod, Q18 fpc byte-parity) preserved verbatim.

## Done definition
All 8 arcs `✓` (or `✓-moot` with evidence) merged to `dev-quality`; each gate (units+smoke+network, jobs-run) reported passing; lessons filed; a **final full-network sweep on `dev-quality` HEAD** green; `bun run lint` + all package test suites exit 0. `dev-quality` = dev + the 8 contained quality arcs, validated. (PR `dev-quality → dev` is the user's call, later.)

## Seeds
_(below; finalized at kickoff)_
