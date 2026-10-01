# Certification — smoke backup-roundtrip product fix (e2e-deflake Phase 6 rules)

Vehicle: PR #358 (`docs/bootstrap-close-out`, labels `e2e:smoke` + `e2e:network`), tree frozen
after the content commit (skill lessons + index flip; run 0 on the content push went fully
green but is NOT counted). Three EMPTY-commit triggers, each fired only after the prior run
completed. Product fix under certification: #357 (bounded import chain-sync tail; the 90s
`backup-roundtrip` bound UNCHANGED).

**Qualifying criteria verified per trigger** (scripted, not eyeballed): all three statuses
green; `run_attempt == 1` on every workflow; zero non-success jobs; zero `(retry xN)` markers
in every green job's runtime logs (fetched via the jobs API, not `gh run view --log`); zero
exit-86 / infra-reboot `##[warning]` annotations; ≥8/8 network agent jobs ran green (no
wrongly-skipped matrix).

## Matrix

| Trigger | Commit | Quality run | Smoke run | Network run | Verdict |
|---|---|---|---|---|---|
| (void) 1 | `97044ae` | 31647444829 ✅ a1 | 31647444690 ✅ a1 | 31647444567 ✅ a1 | green — VOIDED by the trigger-3 reset |
| (void) 2 | `13828c4` | 31648196684 ✅ a1 | 31648196718 ✅ a1 | 31648196675 ✅ a1 | green — VOIDED by the trigger-3 reset |
| (reset) | `b067871` | ✅ | ✅ (backup-roundtrip green) | ❌ 31648924385 | RED — count reset, root-caused below |
| (void) 1 | `2b2b413` | 31649720190 ✅ a1 | 31649720059 ✅ a1 | 31649720109 ✅ a1 | green — VOIDED by the retry-reset below |
| (void) 2 | `ed49c61` | 31650411707 ✅ a1 | 31650411676 ✅ a1 | 31650411701 ✅ a1 | green — VOIDED by the retry-reset below |
| (reset) | `d89dda9` | 31651093844 ✅ a1 | 31651093810 ✅* | 31651093823 ✅ a1 | all green BUT smoke used one inner retry → NOT qualifying |
| (content) | `035902e` | ✅ a1 | ✅ a1 | ✅ a1 | merged-tree content run (not counted) |
| (reset) | `29f5660` | 31654380750 ✅ a1 | 31654380755 ✅* | 31654380829 ✅ a1 | smoke used one inner retry (`appearance` theme-cycle) → NOT qualifying |
| **1/3** | `5104e0b` | 31655044111 ✅ a1 | 31655044112 ✅ a1 | 31655044134 ✅ a1 | **QUALIFYING GREEN** |
| **2/3** | `6e41cb6` | 31655673282 ✅ a1 | 31655673292 ✅ a1 | 31655673301 ✅ a1 | **QUALIFYING GREEN** |
| **3/3** | `eefad05` | 31656260077 ✅ a1 | 31656260017 ✅ a1 | 31656259976 ✅ a1 | **QUALIFYING GREEN** |

**CERTIFIED 2026-08-13**: three consecutive qualifying greens on the frozen merged tree
(post-#359), zero resets within the counted sequence. `backup-roundtrip` itself was green
attempt-1 with zero retries in EVERY run of the certification campaign (15 consecutive CI
passes including the resets), with the 90s bound unchanged.

**Second reset, root-caused:** `d89dda9`'s smoke run passed but `appearance.test.ts >
"animations toggle persists across navigation"` needed `(retry x1)` — criterion (iii) says a
green that USED a retry does not qualify. Unrelated to the file under certification
(`backup-roundtrip` green attempt-1 in the same run); logged as its own candidate flake-ledger
follow-up.

**The reset red, root-caused (checkpoint per the 2-of-3 rule):** the prover-ON canary job
failed two files while its sibling prover-ON test passed: `frozen-account-canary` got a FAST
(~9s) `status:"error"` from the playground on the `grantPublicAuthwit` leg (payload not
dumped — the ledger's already-tracked observability gap), and `transfers` timed out its FIRST
`sendTransfer` confirm toast at 300s. Both signatures sit in the flake-ledger's pre-existing
OPEN classes (entry 4/5 `approveExecute` family + the post-cert "canary prove-duration
variance" class), in files this arc never touched, on a tree with five all-green network runs
that day (canary green in four). Not related to the change under certification —
`backup-roundtrip` itself was green in the failing run.

## Mid-certification fork: the torn-leg test fix (PR #359)

The first-restart red (shard 3) was the DESIGNED torn-import refusal meeting an outdated test
expectation — `backup-restore-sw-restart.test.ts` accepted two designed outcomes; #357
deliberately added a third. Fixed test-side on its own PR (#359, codex-consulted): the 240s
loop treats `auth-restore-torn` as terminal-designed with marker↔row identity provenance
(profileId + pxeGeneration), a withheld-session pin, and a dispatch-window masking guard
(torn only qualifies when the page closed before the 60s popup→SW transport timeout — past
it a live rollback dispatcher would have fired, so torn would mean a broken dispatch).
Codex consult: iterate (strengthen provenance; gate on fork-unobserved) → provenance folded,
the fork-unobserved gate REBUTTED (45s fork window < 60s transport timeout makes it invalid)
and replaced with the close-timing guard → **approve** ("Your rebuttal is correct").
