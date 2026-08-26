# Phase 6 — docs, delivery, and what CI caught

## CI caught what my local gate reported but I misread

`@nulo/resolve-asset`'s own identity tests hardcode the expected `@aztec` version
(`expectVersion: "5.0.1"`, `toBe("5.0.1")`, and a `/5\.0\.1.*9\.9\.9/` throw matcher) — the same
class of literal as `apps/extension/scripts/layout-identity.test.ts`, in a package the pin sweep
never looked at because that sweep was scoped to `apps/extension`.

It failed on my LOCAL `test:all` too. I missed it because I validated with
`rg -c 'Exited with code 0'` and read "12" as success, without comparing against the package
count — two failing packages hid behind twelve passing ones. **A count of successes is not a
pass signal; check the exit code (`rc=$?`) and grep for failures explicitly.** Re-verified
properly afterwards: `rc=0`, 13/13 packages, zero `FAIL`/non-zero exits.

Sweep lesson for the next bump: version literals live in test fixtures across the WHOLE
workspace, not just the app — `rg -l '<old-version>' --glob '!node_modules' --glob '!bun.lock'`
over the repo root, then classify, rather than scoping the grep to one app.

## OPEN BLOCKER — full-backup import goes DEGRADED under 5.2.0

CI (#471) fails two shards on the same mode, and PR-0's network run passed the identical suite on
the 5.0.1 line, so this is bump-caused:

- `shard 1/5` — `backup-restore-integrity.test.ts > import drops a foreign-account tx …`
- `shard 5/5` — `backup-migration-roundtrip.test.ts > a doctored v1 backup migrates, restores …`

Both: `full-backup import did not reach #/popup/general within 300s. Diagnosis: IMPORT DEGRADED
(partial success) — Continue-gated summary screen shown; it never auto-routes.`

Stage trajectory is FAST — `restoring:profile(306ms) → networks(9ms) → tokens(2ms) →
services(12ms) → finalizing(531ms) → chain-sync(2ms) → finished`, then it sits on
`#/popup/import` with `continueScreen=true` for the remaining ~299s (that tail is the test
waiting, not the import working). `restoring:account-state` is reported unobserved.

So the import COMPLETES but reports partial success, which gates it behind a Continue click
instead of auto-routing. `AccountStateService.restore` marks per-sender/contract
`restoreError`s on its unreachable / deadline paths (`ACCOUNT_STATE_SKIP_UNREACHABLE`,
`ACCOUNT_STATE_SKIP_DEADLINE`, budget clamped to ≤30s) — the most likely source, and consistent
with account-state being the `kind: "non-storage"` slice whose wire shape drifts with
`aztec-version` (backup-migration-registry.ts:108-111). NOT yet confirmed which reason fires:
CI logs don't carry the summary screen's contents or the extension console.

Candidate mechanism to test first: 5.1.0's OPFS work (legacy duplicate handles quarantined,
store reopened EMPTY + resync, web-lock-guarded pool creation — upstream #24743/#24740/#24739)
changing what a restored PXE store looks like, and/or 5.1.0 scoping tagging secrets to the
selected explicit sender (#24772), which is exactly what account-state re-registers on restore.

Owner decision needed — this is product behavior, not a test bug:
1. Fix the restore path so a clean backup imports cleanly again (preferred if the cause is ours).
2. Accept degraded-with-Continue as correct for a cross-version restore and update both tests to
   drive the Continue button — only if the cause is genuinely upstream and unavoidable.
3. Hold the bump.
Do NOT simply raise the account-state deadline or relax the tests to green the gate.
