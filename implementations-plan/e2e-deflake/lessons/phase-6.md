# Phase 6 lessons — certification protocol (PR #356)

## Run matrix (qualifying rules in plan.md Phase 6)

| # | Trigger | Head SHA | quality | smoke | network | Verdict |
|---|---|---|---|---|---|---|
| — | PR open + labels (2026-08-11 ~21:30Z) | `67cc674` | ✅ pass | ✅ pass | ❌ **shard 3/5 red** | RED — count stays 0 |

## Run-1 red: root-caused (census diagnostics fired exactly as designed)

Shard 3 (`backup-restore-sw-restart.test.ts`, job 93935522515):

```
waitForFreshBalanceRow: no row ... after 5 refresh(es); rows: [];
census: {"tokenRows":0,"balanceRows":[],"accountRows":2}
```

**The recovered wallet has accounts but ZERO token rows** — the token/balance slices
never landed. Mechanism (from the test's own kill sequence, `test:147-170`): the test
kills the SW as soon as the profile ROW appears, then IMMEDIATELY closes the import
page. But the ROLLED-BACK outcome depends on the import page's catch running
`deleteProfile` (the page's rejected in-flight RPC triggers it; the call wakes the
restarted SW). `page2.close()` RACES that reject — when close wins, the rollback never
dispatches: profile+account rows survive un-finalized, tokens/balances absent, and the
reopened popup masquerades as the RECOVERED leg while the balance convergence
structurally cannot succeed. A THIRD state the test's two-outcome model never covered,
manufactured by two adjacent lines in the test.

- Hit rate: 2/2 in loaded contexts today (local full-suite + CI shard 3), 0/9 solo —
  under load the restore stretches (kill lands pre-finalize more often) AND the close
  wins the reject race more often. This also explains the file's historic ~292s CI
  parks (ledger entry 3): the old text-scan waited on a balance that could never exist.
- **Product finding (for the owner)**: the equivalent state is reachable in production
  via a browser crash mid-restore (page and SW die together — no catch, no rollback).
  There is no boot-time integrity check for a non-finalized restore; the user gets a
  silently partial wallet (accounts without tokens). Out of this arc's scope (product
  source frozen); reported in the final report.

## Fix direction (codex consult in flight)

Option A: after `stopServiceWorker`, do NOT close the page until the post-kill fork is
OBSERVABLE from the still-open page: nav-to-general (post-finalize recovery) OR
tombstone-prefix present / profile rows zero (rollback dispatched — the SW-side cascade
then survives page close). Then close + reopen exactly as today. Both designed legs
become deterministic; the manufactured browser-crash state leaves the gate and becomes
the ledgered product ask.

**Consult record (AFK protocol)**: TWO codex resume attempts died on "model at
capacity" (2026-08-11 ~22:0xZ) — logged here per the standing AFK rules; proceeded on
own judgment with option A (rationale: re-sequences only the kill; changes no
assertions; removes a test-manufactured race; the dropped browser-crash state was never
modeled, always flaked, and is reported to the owner as the product ask). Codex should
re-review this decision in the post-impl audit when capacity returns.

**Fix applied** (`71c8678`): post-kill fork wait (30s bound, fail-loud with a storage
dump on an unknown third state). **Validation**: 3 consecutive confirmed greens solo
with retries off (runs 2/3/4; run 1 also exited green) — run WITH another agent's
bb-prover load on the box, closer to the CI-load condition than the earlier idle runs.
Local full-suite load-repro skipped deliberately: another agent's live sandbox makes a
concurrent full run mass-fail-prone in both directions (run-solo memory); the
certification shards themselves are the loaded-context empirical test.
