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

## Flip (the LAST sub-step) — pending user
The flip (add `Network e2e / Status` to dev branch-protection required checks) + the
`measure-f1 → dev` landing are outward-facing/shared-branch admin actions — left to the user.
