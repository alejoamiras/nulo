# Phase 1 — the trigger fix

## What landed

`TokenService.init()` now subscribes a third seed trigger, inside the same
`seederOverrides?.enabled !== false` guard as the other two:

```ts
this.accounts.onAccountAdded.add(this.onAccountAddedSeed)
```

Unguarded handler, matching the existing two — `doRun()` re-derives the active
profile/network and re-checks the purge epoch before every write, and `run()`
single-flights.

## Test-harness fallout (expected, worth recording)

`TokenService.init()` now dereferences `this.accounts.onAccountAdded`, so every
harness that stubs `AccountService` had to supply it. Two stubs were bare `{}`:

- `service.test.ts:64`
- `service.composition.test.ts:83`

Both now pass `{ onAccountAdded: new EventHandler() }`, exactly as the
`ProfileService` / `NetworkService` stubs beside them already did for their own
event handlers. `seedHarness()` (`:200`) gets a real `EventHandler` so the
wiring test can drive it.

Anyone adding a fourth event subscription to `TokenService.init()` will hit the
same thing: a bare `svc(X.name, {})` stub is not enough once init touches an
event on that service.

## Red-run verification (not deferred to Phase 3)

The plan only mandates a pre-fix red run for the e2e, but the composition
assertion is cheap to verify the same way, so it was:

```
sed -i 's#this.accounts.onAccountAdded.add(this.onAccountAddedSeed)#// TEMP-REVERT#'
bun run --cwd apps/extension vitest run src/wallet/services/token/service.composition.test.ts -t "all trigger a seed pass"
→ AssertionError: expected "run" to be called 3 times, but got 2 times   (service.composition.test.ts:360)
```

Subscription restored from a backup copy immediately after; the assertion is
proven to bite rather than merely pass.

## Seeder unit pin

Rather than adding a near-duplicate test, the existing
`"zero accounts: skips WITHOUT consuming an attempt; seeds once an account
exists"` case was strengthened with the missing half — after the second pass the
marker must read `{ attempts: 1, outcome: "seeded" }`, proving the zero-accounts
pass left the full 3-attempt budget intact. The comment records that the second
`run()` stands in for the production account-added trigger.

## Validation gate — PASS

```
bun run lint        → exit 0
bun run typecheck   → clean (no diagnostics)
bun run --cwd apps/extension vitest run src/wallet/services/token/
                    → Test Files 5 passed (5) · Tests 78 passed (78)
```
