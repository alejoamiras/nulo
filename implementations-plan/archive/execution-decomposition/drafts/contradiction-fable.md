# Contradiction check — fable

Verdict: **ledger needs fixes** — D1 holds, D3 holds conditionally, but Phase 3's spec contains an unledgered contradiction and several load-bearing fable specifics were dropped without rejection entries.

## 1. Cross-phase contradictions

**P3 owned-sequence vs its own test list (real contradiction).** Phase 3's helper owns `proveTxTask → toTx → sendTxTask → addTransaction → journal(submitted)` yet its test list asserts "NO_WAIT returns txHash vs wait returns receipt". Receipt shaping lives AFTER `markJournal(succeeded)` and only on 2 of 4 paths (`service.ts:2000-2004, 2190-2194`); transfer/sendTransaction return a bare txHash string (`:599, :1203`). The plan adopted codex's coordinator-owned-receipt test while keeping fable's caller-side framing — both at once. Needs a decision (recommend: coordinator returns `{txHash, offchainOutput?}`; receipt wait stays caller-side; move that test to caller level). Also: offchain extraction sits BETWEEN prove and toTx (`:1978-1980, 2168-2170`) on 2 paths — the owned sequence is silent on it, but `provedTx` is coordinator-internal, so callers can't do it. Fable's `wantOffchainOutput` mechanism was dropped without a ledger entry, leaving a genuine spec hole. Minor: "journal(submitted)" misnames the sequence — `submitting` precedes sendTxTask, terminal is `succeeded`.

**P2/FPC byte-parity: no collision** (verified `fpc-strategy.ts:47, 64-74` — re-binding destructure → object rebinding is control-flow identical; `GasSettings` reads `simulatedTx`, not tuple slots). D1 holds; the P2→P3→P6 triple-touch of the same regions is churn volume, not new risk.

**P6 line target:** "relocate read/sim handlers *if still needed*" is false comfort — arithmetic (2,302 −140 −240 −110 −~486 executors) lands ≈1,330; with the hard ≤1,200 gate at P6 (A1 rec), read/sim moves are mandatory, not conditional.

## 2. Dropped fable pieces (no rejected-with-reason entry)

- **Five named P3 bug pins** demoted to "~5 pins to be discovered". They are already discovered. Two are load-bearing downstream: *executeSendTransaction acquires NO execution slot* (`service.ts:1130-1213`, no `acquireExecutionSlot`) — P6 merges it into `dapp-send-executor` beside two slot-acquiring flows, and P7's lane adoption must not "harmonize" it; *addTransaction-before-succeeded* + *markJournal error swallow* pin coordinator ordering.
- **Phase 0 baseline `e2e:agent` run + flake-profile recording** — P0 gate now says "no e2e"; later red gates lose their attribution baseline.
- **tx-request-builder's second prologue (`:412-424`)** missing from P1 cites (only `:113-125` listed; verified two sites exist at `:117` and `:412`). Cited-lines-only execution leaves one copy re-inlined.
- Minor, note only: P1 parameterized-error-text silently overrode fable's no-throw-helpers (both preserve strings); fable Ask 3 (bail pre-authorization) resolved to "fail twice → STOP, surface" without ledger entry.

## 3. D1/D3 re-examination

**D1: sound** (verified, no new problem). **D3: "minor mechanical re-churn" is true ONLY IF** Phase 6 defines the executors' deps as a lane-shaped interface (slot acquire / claim / controller-cleanup grouped as one sub-object). Executors' flows call `acquireExecutionSlot` (`:1894`), `claimOrCreateDappExecuteJournal` (`:1915`), and raw `activeControllers.delete` in finally (`:608, 1211, 2012, 2202`). If P6 passes raw Map/closures, P7 reshapes two new modules' signatures + finally blocks — inside the riskiest semantics. Add the deps-interface constraint to P6; D3 then stands.
