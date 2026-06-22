# Plan — Quality-arc DEFERRED findings on `dev-quality` (meta-orchestration, batch 2)

**STATUS: SCAFFOLDED — awaiting `/goal`+`/loop` kickoff.** Branch `dev-quality` re-cut off dev `b068393` (= dev after batch-1's 8 contained dedups landed via #148). This is the second tranche of the `/harden quality` arc: the 6 **architectural / authz / concurrency** findings that batch 1 explicitly deferred as "supervised later."

**Batch 1 (DONE, on dev):** Q6/Q8/Q9/Q12/Q13/Q15/Q17/Q18 — 8 contained dedups, merged to dev via #148.

## In scope (6 deferred findings)
- **Q4** `ExecutionService` multi-responsibility hotspot (Large Class). architectural, widest blast radius.
- **Q5** four journaled execution pipelines share a duplicated lifecycle tail. structural.
- **Q10** shared infra wiring half-migrated out of the composition root (browserApi/storage/PXE). architectural.
- **Q11** `WalletSdkDispatcher` hotspot + duplicated session-account projection (3 sites). structural.
- **Q23** claim/cancel lifecycle = cross-file temporal coupling (claim-helper + execution svc + journal `_transitionLocked` + execution-mutex). **concurrency-critical.**
- **Q19** active-profile guards duplicated with drifted error strings (~75 `getActiveProfile()` sites). **authz-critical.**

## ⚠ Why re-verification is STEP 1 (the codebase moved a lot since the audit)
The audit snapshot (`2026-06-11-ultra-50b45d`) predates: **#83 execution-decomposition** (ExecutionService 2,302 → 746 lines + 3 executors + lane), aztec 5.0, Q1/Q3, design rounds, AND batch 1. So:
- **Q4 is very likely MOOT or heavily shrunk** — #83 already did the "one cohesive extraction at a time" the finding asked for. Re-verify before assuming any work.
- **Q5 is likely addressed** — #83 extracted the shared lifecycle tail into the lane/executors. Re-verify.
- Q10/Q11/Q19/Q23 sit outside the execution facade and are more likely still live, but re-scope each against current dev.

If a finding is moot → mark `✓-moot` + evidence + advance. If shrunk → re-scope to the residual.

## Methodology (UPGRADED from batch 1 — per user, 2026-06-22)
1. **RE-VERIFY FIRST** against current `dev-quality`: grep the cited sites in `audit/quality/2026-06-11-ultra-50b45d/findings/verified.md` + check the constraints registry. Moot → `✓-moot`. Shrunk → re-scope.
2. **`/blueprint deep`** per live finding (these are architectural / authz / concurrency — `deep` is the floor; drop to `mid` only if re-verify shrinks it to a contained change). Each blueprint produces clarifying answers, a competing outline, a decision ledger, the Security & Adversarial + Assumptions sections, and per-phase validation gates.
3. **DUAL-MODEL final decisions (codex AND claude).** Every open question + the blueprint's audit rounds go to BOTH: codex via `/codex xhigh` AND a top-tier claude subagent via the `Agent` tool. Reconcile into a decision ledger. **They AGREE → proceed. They DISAGREE on an authz- or concurrency-critical call → SURFACE to the user** (the single exception to full autonomy — silent authz/concurrency weakening is not an autonomously-acceptable risk). Non-critical disagreement → take the stronger argument + log it.
4. **Implement inline**, preserving every constraints-registry invariant **verbatim**; BUG-PIN surprising preserved behavior. Tests inline + **DETERMINISTIC (never introduce a flake)**.
5. **Per-arc audit tail:** `/code-review max --fix` → fix → **codex post-impl audit** (xhigh) → fix loop. For Q19/Q23 add a **fresh claude hostile audit** too (the batch-1 confidence pass proved a second model family catches what codex's family misses).
6. **Gate:** `bun run lint` + `typecheck:all` + units + smoke + **full network e2e** — all green, every network job **confirmed RUN** (not skipped/green-when-skipped), on a base synced to latest `dev-quality`.
7. **Merge** squash `--admin` into `dev-quality`; mark `✓` + SHA + network run-id here; file `lessons/<arc>.md`; print `LESSONS_FILE=…`; advance.

## Red policy (NON-NEGOTIABLE, same as batch 1)
Suite is reliable → a red is a real signal, most likely YOUR change. Re-run the failed job ONCE; green → proceed; STILL red → it's REAL → root-cause + FIX (reproduce locally, `/codex xhigh` + claude if stuck), re-validate to green. **FORBIDDEN:** retry-until-green, skip/quarantine/`.skip`/disable a test, weaken an assertion, merge over red, or paper over a flake. Any test you add/touch must be deterministic.

## CI mechanics on `dev-quality` (carried from batch 1)
PRs *based on* `dev-quality` trigger NO CI (the `pull_request` filter is `[main, dev]`). Run gates via `workflow_dispatch`: `gh workflow run pr-network-e2e.yml --ref <arc-branch> -f disable_accelerator=false` (+ `pr-quick.yml` + `pr-smoke-e2e.yml`), read conclusions with `gh run view <id>`. Dispatch bypasses the paths-filter → every shard runs. Unsigned commits: `git -c commit.gpgsign=false`; push via `git -c credential.helper='!gh auth git-credential' push https://github.com/alejoamiras/nulo.git <b>:<b>`.

## Ordered arcs (re-verify-cheap first → most dangerous last)

| # | Finding | Tier | Re-verify note / key constraints (verbatim invariants) |
|---|---------|------|--------------------------------------------------------|
| 1 | **Q4** ExecutionService hotspot | re-verify → likely `✓-moot` | #83 decomposed the 2,302-line class to 746 + 3 executors + lane. Expect moot/tiny residual. |
| 2 | **Q5** duplicated lifecycle tail | re-verify → likely `✓-moot`/shrunk | #83 extracted the prove→submit→persist tail into the lane/executors. Re-verify the 4 pipelines. |
| 3 | **Q11** WalletSdkDispatcher | deep | Extract the account-resolution collaborator (route the 3 inline `formatSessionAccounts` reimpls at dispatcher `494-497/721-747/989-997` through one helper). **CONSTRAINTS: `formatSessionAccounts` wire-format parity is pinned by dispatcher unit tests; the 3-copy `nulo-schema-patch` shape is pinned by `dispatcher.test.ts` — preserve both.** |
| 4 | **Q10** composition-root migration | deep | Per-collaborator factory/port injection from `runtime.ts` (storage first OR PXE first), centralize the `browserApi` fallback seam once. Wide but incremental; NOT a broad rewrite. |
| 5 | **Q23** claim/cancel temporal coupling | deep | **CONCURRENCY-CRITICAL.** Narrow abstraction around the controller/journal handshake; must own `operation-journal _transitionLocked` semantics + `execution-mutex` FIFO-enqueue-before-baton ordering. **Preserve the no-await microtask-interleaving invariant verbatim (`claim-helper.ts:144-163`).** Gate = the existing race tests + the `heavy/concurrent-confirm` network shard, both green. |
| 6 | **Q19** active-profile guards | deep | **AUTHZ-CRITICAL, LAST.** Extract `requireActiveProfile()` across ~75 sites. **MUST NOT absorb the load-bearing `"Unauthorized"` site (`operation-planner.ts:80-82`); MUST preserve the deliberate silent-`undefined` non-thrower (`dapp-session/service.ts:87-90`).** Negative-test pin EVERY thrower string variant ("Profile locked"×34 / "Wallet locked"×12 / "Wallet is locked"×2) AND the non-throwers — a mis-sweep silently weakens a lock gate. |

The loop may re-order/re-tier on re-verification; record any change here.

## Security & Adversarial Considerations
- **Q19 is the highest-risk item in the whole quality arc:** a mis-applied `requireActiveProfile()` sweep can silently turn a non-throwing read into a throw (breaking a dApp contract) or, worse, drop a guard so a locked-wallet path proceeds. Mitigation: behavior-preservation by negative tests on BOTH throwers and non-throwers; dual-model + fresh-claude audit; the two named exclusions preserved verbatim.
- **Q23 is correctness-by-interleaving:** the cancel/claim race window is real money + real privacy (a dropped cancel can submit a tx the user cancelled). Mitigation: preserve the documented no-await invariant verbatim, gate on the race tests + concurrent-confirm shard, dual-model review of any reordering.
- No new deps, no crypto, no new privilege surface in any arc. Wire-format pins (Q11 `formatSessionAccounts`, the 3-copy schema patch) preserved verbatim.

## Hard limits
- Only the 6 deferred (Q4/Q5/Q10/Q11/Q19/Q23). The 8 batch-1 findings are DONE (on dev) — don't reopen.
- Never merge `dev-quality → dev`/`main` (user's call — open a promote PR when all ✓). Never publish.
- App + ALL tests stay green. Never weaken/skip/quarantine. Never introduce a flake.
- Q19/Q23 dual-model DISAGREEMENT on a critical call → SURFACE to user (don't autonomously decide).

## Definition of done
All live deferred findings `✓` (moot ones marked with evidence) → final full-network sweep on `dev-quality` HEAD green → confidence pass (codex + claude over the integrated diff) → open the `dev-quality → dev` promote PR (user merges). Then stop.
