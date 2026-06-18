# Phase 7 — Prove stability + flip required (LESSONS)

## 5/5 GREEN on one SHA (1394574)
Real `pr-network-e2e.yml` ×5 on SHA 1394574: runs 27775893971, 27776262246, 27776722898,
27777086996, 27777444247 — ALL `success`, all `headSha 13945746`, including the heavy
`concurrent-confirm`/`concurrent-approve` jobs + all 5 shards. Hard limit ("5 green real runs on
one SHA before flip") satisfied.

## The fee-spike that broke the FIRST 5× attempt (the key Phase-7 lesson)
The first attempt got 4/5 green on 003ff063, then run 5's HEAVY `concurrent-confirm` job (which the
proverless full-suite soak does NOT exercise) hit a node gas-fee spike at the mint's balance-verify
`.simulate()` (maxFeesPerGas=6.8e7 < gasFees=1.4e8). The earlier "10/10 + 3/3 + 4/5 green" were all
SPIKE-FREE LUCK on an INCOMPLETE fee fix (only `.send()` had the maxFeesPerGas ceiling; the
`.simulate()` reads + multi-line sponsored sends did not). LESSON: (1) a fee ceiling must cover
EVERY direct-SDK fee-checking call (send AND simulate), not just sends; (2) "green" on a
spike-intermittent flake is NOT proof unless a spike actually occurred during the run; (3) the
heavy concurrent jobs are only exercised by the real pr-network-e2e, not the proverless soak — so
Phase 7's real 5× is load-bearing, not redundant with Phase 6's soak.

## Post-impl (after 5× green)
audit:vue exit 0 (2423 tests). codex post-impl audit + narrow /harden security + /code-review:
NO Critical/High. opts.from authz triple-confirmed solid. 7 Medium/Low/quality findings (M1-M5 +
Q1-Q2) → FOLLOWUP-authregistry-persistence.md for a dedicated follow-up PR (behavior-neutral /
rare-edge; not flip-blockers).

## Re-prove on the MERGED SHA (dev moved → 1394574 proof stale)
PR #115 (measure-f1 → dev) came back CONFLICTING: dev advanced 10 commits / 87 extension files
(the `design-system-externalization` + `quality-dedup-quick-wins` + `profile-flow-dedup-q2` arcs)
since the branch was cut. That invalidates the `1394574` 5× for dev's actual HEAD, so the gate must
be re-proven on the post-merge SHA. **User authorized the FULL autonomous landing** (resolve +
re-prove + --admin merge + flip), accepting the moving-target risk (re-merge if dev moves again
before the flip).

Merged dev → measure-f1 = **`9be2eff`**. 7 conflicts resolved:
- `auth-registry.ts` + `.test.ts`: comment-only — dev INDEPENDENTLY fixed the same F1 slot-swap
  (`REJECT_ALL=1`/`APPROVED_ACTIONS=2`); kept ours (more precise consume-race comment).
- `incoming-transfers.test.ts`: kept ours — dev also un-quarantined C2 + added the same token-row
  seed, but kept the BUGGY first-key network resolver; our active-network-pointer fix supersedes it.
- `authwit-lifecycle.test.ts`: comment-only convergent; kept ours.
- `index.md`: kept theirs (dev's 2 new plan entries). `plan.md` + `phase-2.md`: kept ours (superset).
Both e2e files resolve to == HEAD (verified: no dev-unique loss beyond the buggy resolver).
`bun run audit:vue` exit 0 on the merged tree (2400+ tests + build).

**Re-prove: 5× green real pr-network-e2e on `9be2eff` (sequential — concurrency cancels parallel).**
Run 1 = `27786314393` (pull_request synchronize). Runs 2–5 via `gh workflow run pr-network-e2e.yml
--ref fix/measure-f1-authwits`, one at a time. After 5/5 green: `--admin` squash-merge PR #115 →
dev, then POST `Network e2e / Status` to dev `required_status_checks/contexts` + verify.
