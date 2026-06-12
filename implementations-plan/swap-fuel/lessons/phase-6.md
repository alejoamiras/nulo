# swap-fuel — phase 6 lessons (faucet UI)

## 2026-06-12 — wallet-independent core landed first (P2 still blocked on the top-up)

- `lib/fuel-claim-state.ts` — `decideFuelClaim` as the L14 v3 pure ladder. Decision order is most-definitive-first: user override → own-receipt INCLUDED (consumed, even app-reverted — setup phase is non-revertible) → dropped ⇒ retry fjwc → pending/unknown-hash ⇒ wait → fee-insufficiency (received < margin × current min fee) ⇒ sponsored + standalone FJ → default fjwc. The "attempt latched, no hash" crash case waits + offers the manual escape (sponsored is safe whether or not the unknown tx consumed the fuel). A pin asserts the decision surface has NO balance parameter — keeping the withdrawn v2 probe out structurally.
- `lib/bridge-steps.ts` — fueled rails: public `[sign, deposit, fuel, sync, claim, confirm]`, private keeps SEAL first; SIGN replaces APPROVE (the live AZLO pre-approves Permit2 — no allowance leg exists); FUEL latches done with leafIndex (the BridgeWithFuel event delivers received + leafIndex together, so FUEL completes exactly as CROSSING starts); fueled CLAIM copy names the one-tx token+gas confirmation; non-fueled rails byte-identical (pinned).
- `BridgeStep` union gained `"signing"`.
- Replace-tool discipline: a python replace on the activeKey chain MISSED silently (whitespace drift) while its sibling replaces landed — the per-replace `assert a in src` pattern from earlier batches would have caught it; the test suite did instead. Assert every replacement.
- Suites: faucet 301/301, typecheck 0.

REMAINING for P6: bridge-deployments `l1.fuel` exports (guarded - fuel UI renders only when config exists), BridgeForm toggle + debounced quote line + MIN/MAX floor validation, useDeposit fueled branch (journal-first, witness sign, event parse) + claim builder swap (fjwc via decideFuelClaim), receipt/journal-card fuel lines, testids. Form-level work can land pre-P2 behind the config guard; the quote line goes live the moment P2 writes `l1.fuel`.

## 2026-06-13 — P6 closed

- Form: ARRIVE WITH GAS toggle (deposit direction + config-gated), 0.25-AZLO prefill, 500ms-debounced quote line with four states, floor + oversize guards (the 1-AZLO MAX cap from the fork rehearsal's price-impact lesson), submit passes fuelSlice in base units.
- The user asked "how does one bridge private fee juice?" mid-arc — the answer (there is no protocol-private FJ; private fuel = FPC-paid fees, deferred) exposed a REAL copy gap: private+fuel's gas leg writes the recipient's Aztec address on L1, which a pure private deposit never does. Disclosure added to the quote line when both toggles are on, pinned. The linkability fact was implicit in the plan's Security section but absent from user-facing copy - copy IS part of the threat-model surface.
- Journal cards: fuel line (slice → received FJ) + CLAIM WITHOUT FUEL (shown only on stuck fueled claims; routes through overrideFuelClaim → sponsored, non-destructive). Receipt: "+ N FJ landed as gas ⛽" from the snapshot.
- Mock-maintenance lesson again: adding exports to a heavily-mocked module (bridge-deployments) broke 7 test files' mocks at once; two already HAD the key I injected (duplicate-property TS error). The vi.mock factories are closed sets - grep for every mock of a module before extending it.
