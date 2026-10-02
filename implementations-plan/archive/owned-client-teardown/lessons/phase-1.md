# Phase 1 — prove the leak

Baseline: `c543c18d` (dev), plan artifacts committed on top as `0e857f4f`; no source change.

## Red run (2026-09-17)

Command, from `apps/extension`:
`bun run test src/wallet/services/logger/client.ports.test.ts`

Result: 2 failed / 2 total, both on the port-count assertion only — every delivery, envelope and
settlement assertion before it passed (five and one hundred lines delivered and answered).

```
FAIL S1: five service clients share one logger port
AssertionError: expected { live: 5, opened: 5, …(1) } to deeply equal { live: 1, opened: 1, …(1) }
-   "live": 1,      +   "live": 5,
    "localDisconnects": 0,
-   "opened": 1,    +   "opened": 5,

FAIL S2: fifty connect/disconnect cycles leave one logger port and no service port
AssertionError: expected { live: 50, opened: 50, …(1) } to deeply equal { live: 1, opened: 1, …(1) }
-   "live": 1,      +   "live": 50,
    "localDisconnects": 0,
-   "opened": 1,    +   "opened": 50,
```

S2 also confirmed the service side: 50 `config` ports opened and 50 closed locally, 0 live.

`bun run lint`: 0 errors (after `biome check --write` reformatted one multi-line object).

The test is **uncommitted** at this point by design (a red test never lands in history); Phase 2
commits it together with the fix.
