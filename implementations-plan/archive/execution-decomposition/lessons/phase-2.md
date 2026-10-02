# Phase 2 — Q18 internal objectification

## Landed
- `BuiltStandardTx` / `BuiltNoFromTx` (tx-request-builder) + `FeeEstimate` (fee-strategy) replace the 7/6/8-tuples; every `built[N]` + `_`-placeholder destructure converted (service ×11 sites, 4 strategies, fjwc's builder consumption).
- fpc-strategy two-pass preserved statement-for-statement via `built` rebinding; pass-2 gasSettings still reads pass-1's sim (byte-parity constraint) — parity-verified.
- `TransferRequest` value object below the RPC seam (operation-planner); executeTransfer/estimateTransferFee/tryConsume take it; `spec.ts`/`client.ts` zero diff (wire frozen per ledger D5).
- `strategies-structural.test.ts`: per-strategy sentinel fixtures (passthrough identities, gas/fee shape, FPC two-pass choreography incl. unshift→splice action sequence, embedded 1× multiplier, frozen error message).

## Gates
- lint 0 errors · typecheck clean · unit 2,288 → (2,300 by P5).
- Codex parity (P2+P3 combined, fresh session): **parity confirmed** — named-field consumers verified at all sites, FPC pin intact, wire untouched. One nit (stale 8-tuple docblock) fixed in P5's commit.
- e2e:agent (purged state, ×10): 64/69 + 2 skip. `concurrent-sendtx-confirm` PASSED (phase-1 purge policy vindicated). Sole failing file `fee-methods` (3 tests, one `beforeAll`): "L1→L2 message not yet ingested for PrivateFPC deposit" — bridge-funding fixture timing under machine load (P3-P5 implementation ran concurrently). **Isolated idle re-run: 5/5 PASS.** Gate closed.

## Lesson
- Gate runs and heavy implementation work must not share the machine: two consecutive investigations (concurrent-confirm in P1, fee-methods here) were load artifacts. Adopted: e2e gates run with the machine otherwise idle from P6 onward.

LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-2.md
