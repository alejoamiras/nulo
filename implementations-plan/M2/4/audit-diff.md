# M2.4 plan — audit diff

What changed in `plan.md` after the codex + agent audits.

## Changes

1. **`BackgroundTickerPort` contract strengthened to serialized/coalescing** (codex). Was mostly a renamed `ClockPort.setInterval`. New contract: at most 1 tick in flight, missed intervals collapse to 1 pending, `cancel()` prevents future delivery. Without this stronger contract, the port adds ceremony without justification.

2. **`BackgroundTickerPort` JSDoc honesty fix** (agent). Dropped the misleading "future chrome.alarms swap-in" promise. chrome.alarms has a 30-s floor; balance cadence is 1-s — swap is NOT callsite-compatible at current cadence. New JSDoc states plainly: "ticks pause during SW suspension; caller semantics are best-effort periodic".

3. **Fix to plan's TokenBalanceService profile-switch misstatement** (codex). Plan claimed `onActiveProfileChanged` "clears cache, re-enqueues all balances" — real code at service.ts:148 ONLY swaps `this.profile` + reloads token metadata. Plan now preserves this verbatim; NO deliberate semantic change on profile switch.

4. **WindowManager demoted from `Service<Methods>` to plain injectable class** (agent). No popup-side or content-script client needs RPC access. Full Service ceremony unjustified. Removed client.ts + spec.ts from the plan. `settle` / `cancel` are plain class methods (not RPC-addressable).

5. **WindowManager handle identity**: explicit invariant added (codex Q6) — handles keyed by `handleId`, NEVER by `kind`. Multiple concurrent windows of same kind are supported.

6. **NodeFactory scope caveat** (agent). `pxe/service.ts:398` also has inline `createAztecNodeClient`; M2.4-b targets only NetworkService. Plan now documents this as deferred (handled via M2.3-a's PxeFactory).

7. **wallet-sdk 3rd window call site: lint-guard required** (agent + codex Q9). Without enforcement, invariant erodes. Plan now requires eslint `no-restricted-syntax` against `chrome.windows.create` outside approved paths when M2.4-c lands.

8. **Subscribe-pin timing test** (codex Q2): `BalanceJobQueue.start()` must fire AFTER trigger handlers register. Pin in a unit test.

## Still open / decisions at execution time

- Whether to keep `BackgroundTickerPort` at all OR replace with a `subscribePeriodic(clock, ms, fn)` helper over `ClockPort`. Plan picks "keep + strong contract"; agent argued for the helper. Decision deferred to implementation — the 3-file port overhead is real, and the coalescing logic could live in the helper too.
- BalanceProjector error granularity — per-balance vs per-batch failure.
- WindowManager logging verbosity.

## Verdict flip

Codex: Go with 2 medium fixes → Go.
Agent: Go with 4 fixes → Go.

All findings incorporated except the "drop BackgroundTickerPort" suggestion (kept with corrected contract + JSDoc).
