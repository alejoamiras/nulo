# mac-identity-binding — F-1/F-2 fixes for the key-model-v2 stack

Fixes the two findings from the adversarial review of #417..#429
(`implementations-plan/adversarial-key-model-review/findings.md` in the
key-model-v2 worktree). Branches off `feat/kdf-v2-assurance` (#429) so it
stacks behind the crypto work.

## Commits

| Commit | What |
|---|---|
| `c63fde9a` | MAC v3: envelope MAC binds the row's own storage id + the plaintext wallet fingerprint; retired v2 grammar deleted outright. |
| `c29873aa` | Embedded-id bypass closure: opt-in EntityStorage `requireKeyIdentityMatch` guard (profile root) + every MAC verify site uses the REQUESTED id; passkey fingerprint binding at unlock/export. |
| `d25f87b7` | Strict guard semantics (missing/non-string ids rejected); numeric mode for the authwit journal (id-aliasing closed). |
| `a55d4fe1` | Passkey finalize consistency snapshot (type/credentialId/dekSealed/pxeGeneration/fingerprint vs restore-time stash); positive-safe-integer numeric mode. |
| `fb77354d` | Explicit passkey-type requirement at finalize; test-precision fixes (`1e+21` suffix pins safeInteger; aliasing test copies genuine row 5). |

## Codex loop (gpt-5.6-sol xhigh, 5 rounds)

r1 BREAKS (4 findings incl. critical embedded-id bypass) → r2 BREAKS
(3 findings incl. authwit aliasing) → r3 HOLDS-with-concerns → r4
HOLDS-with-one-low → r5 **APPROVE, no remaining blockers**. Full transcripts:
`audit-codex-r{1..5}.md`.

## Accepted residuals (documented, owner-adjudicated lineage)

- A detected whole-envelope swap still opens DERIVED-ONLY (loud, non-persistent,
  laundering refused) rather than hard-refusing unlock — hard refusal hands a storage
  writer a one-field DoS lever over derived funds.
- Backup export under an uncovered MAC remains the deliberate non-destructive repair hatch.

## Gates

`audit:vue` green on HEAD (4562 tests / typecheck / lint / build). No UI or dApp-surface
changes; e2e fixtures reference no changed API — CI's required smoke + network gates
verify the PR.

## Phase 2 — the red smoke gate (post-unlock navigation races)

The required `smoke-e2e-status` gate red 6/7 runs on wait-budget overruns over visibly
healthy wallet states. Attributed to dev (a plain-dev probe PR failed identically), then
root-caused to four pre-existing post-unlock navigation races whose window widens from
~100ms to seconds on starved CI runners — real user-facing bugs on any slow machine, fixed
in this arc because the gate blocks it:

1. Router guard bounced auth-required navigations while `isLogined` lagged the accepted
   unlock → new `authRequiredGate` decision core consults the authoritative
   `getActiveProfile()` (unit-tested, incl. SW-respawn backoff + degrade-to-pass).
2. A stale lock event resuming after its own unlock ejected the fresh session →
   sequence-token fence in `app.vue`'s profile-event handler.
3. Export deep-link preselect raced the bootstrap's store refill → re-apply preselect when
   account rows arrive (never overriding a manual pick).
4. `auth.vue` navigated only after a seconds-long warm-up, then late-pushed
   `/popup/general` over wherever the user had gone → navigate first, warm-up
   fire-and-forget, watcher advances only while still on the auth screen.

Full mechanism writeups, attribution technique (router-wrap probes), validation
methodology, and known residuals: `lessons/phase-2-smoke-deflake.md`.

## Codex loop, phase 2 (gpt-5.6-sol xhigh, 3 rounds over the full PR + nav fixes)

r7 BREAKS (1 confirmed High — lock cleanup skippable by a transport rejection; 1 confirmed
Medium — the single-push fix was not atomic and substring-matched `?from=/popup/auth`
routes; 1 Low; 1 Critical re-opening the adjudicated derived-only residual) → r8 HOLDS (the
residual REJECTED with a written rebuttal codex accepted point-by-point: "the accepted
residual stands"; High/Low verified fixed; Medium fix ruled incomplete) → r9 **APPROVE**
(atomic claim election + exact-path gate verified; no two-push interleaving, no strand).
Transcripts: `audit-codex-r{7..9}.md`. Reported for a separate fix, out of this PR's scope:
`utils/core.ts` `refreshBalances` fires `refreshTokenBalance()` unawaited and then
disconnects the client in `finally`, cancelling its own refresh RPCs (pre-existing on dev).
