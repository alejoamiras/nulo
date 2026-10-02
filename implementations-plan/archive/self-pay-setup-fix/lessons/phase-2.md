# Phase 2 — diagnosis

**No red cells.** Every cell of `selfpay-phase.test.ts` is green after Phase 0 (two consecutive
runs, `lessons/phase-1.md`), including the deployed PrivateFPC-credit cells — the shape of
production's `unknown nullifier` attempt (I3): with the wallet running as the account the dApp
named, the FPC's `pay_fee` reads the right account's credit and the claim's nullifier resolves.
Nothing in the interventions table needs to run; H6 is not exercised by this gate and stays a
candidate only for a production recurrence, which the negative control and the matrix would
now distinguish from H5.

`LESSONS_FILE=implementations-plan/self-pay-setup-fix/lessons/phase-2.md`
