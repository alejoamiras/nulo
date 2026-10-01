# Phase 4 — e2e: doctored keyless-import orphan closure

## Spec

`tests/e2e/network/account-balance-orphans.test.ts` — donor exports an account file → the
token-ready wallet imports it (balance row appears) → full backup exported → doctored
(`imported-account-keys` slice removed, checksum recomputed) → fresh extension imports it →
**Stage 5 pin**: keyless account dropped AND zero balance rows for its scope → re-import the
same key → rows are FRESH (`updatedAt === 0 || ≥ beforeReimport`), never reattached.

No transfers/proofs — the spec exercises import/export/purge only, so it runs prover-free
and fast for a network spec.

## GREEN (fix in place, first try)

```
Test Files  1 passed (1)
Tests  2 passed (2)
```

## RED (pre-fix mutation: the registered-subscriber purge loop skipped in
`reconcileImportedAccounts` — deletion without cascade, byte-reverted after)

```
FAIL … a keyless import's balance rows are purged with the account, and re-importing the key starts fresh
AssertionError: expected [ { …(3) } ] to deeply equal []        ← the orphan row survived (Stage 5)
AssertionError: expected 2 to be 1 / expected 3 to be 1          ← retries ACCUMULATE orphans, one per attempt
Tests  1 failed | 1 passed (2)
```

The retry accumulation is itself evidence of the production defect's compounding shape:
every re-import against an orphaned store adds another stale row at the same scope.

## Notes

- The doctored import completes CLEAN (no finished-with-errors screen): the Account row and
  balance rows restore normally — key-row presence is invisible to the restore pipeline —
  and only the finalize-time reconcile drops the account. Exactly the one-pass reachability
  recon described.
- The actionable-screen settle idiom (general/auth terminal, Continue acknowledged) from
  `backup-imported-account.test.ts` transplanted cleanly; `importFullBackup`'s driver was
  avoided because it cannot acknowledge a Continue screen.
- The spec's freshness assert deliberately accepts `updatedAt === 0` OR `≥ beforeReimport`:
  the projection may or may not have completed by read time; a reattached stale row fails
  both arms.
