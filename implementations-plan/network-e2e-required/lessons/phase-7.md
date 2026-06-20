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

## Revealed flake during re-prove — contacts-sender (run 3/5 on 3ef52a3)
The re-prove did its job: it SURFACED a latent flake the original `1394574` 5× got lucky on.
Runs 1+2 green; run 3 shard 2/5 failed (everything else green) —
`contacts-sender.test.ts > "edit contact address with sender ON migrates the sender registration"`,
`clickByTestId(edit-contact-submit)` TimeoutError 10000ms (line 171). Root cause: `EditContactPopup`
submit is `:submitDisabled` on `isLoadingSenderState`, which `loadSenderState()` holds true while
awaiting `accountStateService.getSenders()` (PXE init + read). The test clicked submit before that
load settled; 10s was too tight under 2-core CI load right after a sender-registration tx.

CODEX CONSULT (xhigh, session 019edc78): VERDICT **slow-not-hang** — transport is deadline-bounded
end-to-end (SW RPC 60s, offscreen RPC 90s, node HTTP AbortController), so `getSenders` always
settles via `loadSenderState`'s `finally`. FIX = patch the TEST, wait on the real readiness
contract. REJECTED: app-side timeout on `loadSenderState` (would submit with wrong/default sender
state = masking) and a bare `clickByTestId` timeout bump (derivative symptom). Codex strengthened
my draft — also assert `data-toggle-active=true`, proving the scenario is still genuinely sender-ON
rather than a load that defaulted false. Acted on codex's stronger argument.

FIX (`contacts-sender.test.ts:171`): before clicking submit, `page.waitForFunction` for
`[data-testid=edit-contact-sender-toggle]` `data-toggle-disabled=false` AND `data-toggle-active=true`
(30s, mirrors the readiness wait already used later in the file). NOT a retry/skip — an explicit
wait on the app's own load-gate signal. lint + typecheck exit 0. New sha → **restart 5× from
scratch** (run-3 failure broke the consecutive streak).

## GATE MET — 5/5 green on 169ae05 + flipped (Phase 7 DONE)
Fresh 5× on `169ae05` (contacts-sender fix included): runs `27788434322` (synchronize),
`27788849626`, `27789198484`, `27789535309`, `27789918867` — **all success**, including the heavy
concurrent jobs + all 5 shards. The previously-flaky run-3 position passed clean. Quality / Status
green on the sha; dev drift 0 at merge time.

Landed: `gh pr merge 115 --squash --admin --delete-branch` → dev squash `e344435`
("feat(auth-registry): build-pure trust-point cutover + network-e2e de-flake (#115)"). `--admin`
because the AFK commits were unsigned (gpgsign=false) and dev enforces signed commits — the
documented CLI path (CLAUDE.md). **Signature backfill on the AFK commits is a return-time decision.**

Flipped: `POST .../branches/dev/protection/required_status_checks/contexts` +`Network e2e / Status`.
Verified `{contexts:[Quality / Status, Network e2e / Status], strict:false}`. Additive (Quality +
strict untouched). The `status` aggregate context is pass-when-skipped, so doc-only PRs still pass.

Hard limits honored: flipped only after 5 green on one SHA; the revealed flake was FIXED not
.skip/quarantined; no in-test retry re-added; merged to dev (NOT main); no CI token/secret scope change.
