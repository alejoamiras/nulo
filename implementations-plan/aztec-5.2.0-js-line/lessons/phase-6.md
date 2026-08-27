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

### Diagnosis so far (local repro, 2 runs)

Reproduced locally with `NULO_E2E_PROVERLESS=1 bun run e2e:agent
tests/e2e/network/backup-restore-integrity.test.ts` — same failure as CI, so it is deterministic
and not host contention.

The Continue gate is driven by `restoreErrorLog`, and `collectRestoreErrors`
(`utils/full-backup-helpers.ts:159`) builds entries for **`account-state`** from per-item
`restoreError`s — i.e. `AccountStateService.restore`'s `pxeService.registerSender` /
`registerContract` calls are throwing for at least one item. That matches the trajectory's
`restoring:account-state` hint.

**Strong candidate — the 5.1.0 canonical HandshakeRegistry re-pin** (dossier §13; upstream
"registry moves to a new address; handshakes established with the previous registry instance are
not visible to the new one"). The SW log trail from the failing import registers the SAME
contract under TWO class ids in one restore:
- `HandshakeRegistry ... 0x2e04c07c83ee8107e921c3ae4ade010ee183860a89b7534ea3367efb561d2c3b`
- `HandshakeRegistry ... 0x020ec1998d06036ddab4ba170e9b0d9b96e52beb58aa5ea83d72b22f589cbe6c`

Not yet nailed: the actual `restoreError` string. It never reaches the DOM (the UI only gates on
it), and the SW log ring (80 entries) is flooded by PXE contract-class registrations before the
post-finalize account-state leg runs. Getting it needs one of: a bigger/filtered ring at that
moment, a temporary log line in the account-state catch, or a probe that reads the restore RPC
result directly — a source change, so it waits for the owner.

Test-infra improvement kept: `importFullBackup`'s timeout diagnostic now appends the SW log
trail (filtered to restore/import/account-state/register/error). "IMPORT DEGRADED" with no
reason is a weak diagnostic; this is how the two class ids surfaced at all.

### ROOT CAUSE FOUND

```
"restoreError":"account-state slice too large (33652642 code units)"
```

`ACCOUNT_STATE_CAPS.maxSliceCodeUnits` is 32 MiB (33,554,432). The exported slice is
**33,652,642 — over by 98,210 code units, 0.29%.** `normalizeAccountStateSlice` returns
`{ items: [], violations: [...] }` on that check, so the restore short-circuits: no sender or
contract registration is attempted (which is why neither the `classify()` nor the
`skippedByDeadline` instrumentation fired), and the single violation becomes the one restore
error that gates the import behind Continue.

Why the bump pushed it over: the account-state slice embeds full contract ARTIFACTS. 5.2.0
recompiled every app artifact (Noir beta.22 → beta.25) and the PXE preloads more standard
contracts — the SW trail shows TWO `HandshakeRegistry` class generations registered in one
restore (`0x2e04c07c…` and `0x020ec199…`, the 5.1.0 canonical re-pin). An already-near-the-line
payload crossed a hard cap.

It is a CAP, not a protocol limit — chosen as "a cheap, still-hard bound" against hostile
backups. The margin was simply too thin to survive an upstream artifact-size change.

Owner decision (unchanged shape, now with a precise cause):
1. **Raise the cap** (e.g. 32 → 64 MiB). One-line, restores clean imports, keeps a hard bound.
   The DoS reasoning is unaffected at 64 MiB — it is still a fixed ceiling on attacker input.
2. **Shrink what the slice carries** (e.g. omit artifacts the wallet can re-fetch by class id,
   or skip canonical/standard contracts the PXE preloads anyway). Better long-term, bigger
   change, and it alters what a restore can recover offline.
3. Hold the bump.

Diagnosis cost 5 local runs; each new instrumentation line narrowed it. Kept as permanent
observability (all three were genuinely missing):
- `AccountStateService`: warn on per-item registration failure and on budget expiry.
- `useFullBackupImport.recordRestoreErrors`: warn naming the service that gates the screen.
- `importFullBackup`: append the SW log trail to the timeout diagnostic.
Without these the failure reads only as "IMPORT DEGRADED", with the reason stranded in an RPC
result that nothing renders or logs.

## Resolution — option 1 (raise the cap)

Owner picked the cap raise on 2026-08-27, with the reasoning that option 2 (shrink the slice)
"needs a lot more research (for example: handshake registries tracking on our application,
authregistries, etc.)" and that there are **no user backups in the wild yet**, so no
compatibility argument constrains the number.

`ACCOUNT_STATE_CAPS.maxSliceCodeUnits` 32 MiB → 64 MiB, with the measured cause (per-network
artifact duplication) written into the comment so the next person sizing it knows what actually
fills the slice, and knows that deduplication is the deferred alternative rather than an
oversight. The security property is unchanged: it is still a fixed hard ceiling applied to
attacker-controlled backup content before any parsing work.

**Durable lesson: a "cheap, still-hard bound" needs headroom proportional to what it bounds, not
to what it currently measures.** This cap was sized at roughly 1.005× the real payload. Any cap
whose margin is thinner than one upstream artifact-set change WILL fire on a dependency bump, and
it fires as a functional degradation far from the bump, not as a build error. The export-time
80%-of-cap warning added during the diagnosis is the cheap version of the fix — it turns the next
occurrence into a log line at export instead of a mystery at import.
