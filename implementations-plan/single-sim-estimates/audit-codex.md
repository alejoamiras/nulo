# audit-codex.md — single-sim-estimates

## Round 1 — fresh session, xhigh, read-only

- **Verdict**: `reject (with blocking findings: stub-derived PrivateFPC sizing precedes its mandatory live gate, and the measurement plan does not exercise the resulting on-chain failure mode)`
- **Packet**: plan.md (outline A + B) + recon.md + binding fee-estimation-speedup precedent; adversarial/assumption/implementation asks with the Sponsored identity argument flagged hostile.
- **Verbatim**: [audit-codex-r1-response.md](audit-codex-r1-response.md)

### Dispositions (ALL adopted → rev 2)

| Finding | Disposition |
|---|---|
| C1 sequencing: A2's stub ships before B1's measurement; Inference 1 source-resolved (private execution precedes `skipTxValidation`; unstubbed fallback impossible — abandon, don't tweak) | **Adopted** — measure-first resequencing (C1→A1→B1→gate→A2→B2→B3); PR2 merge-gated on the checkpoint; fallback deleted; stub-or-abandon in ledger #5 |
| C2 measurement misses the PrivateFPC danger (P2 envelope consequences; funded PrivateFPC canary needs Sepolia key — Fact-7 "zero-env" overstated) | **Adopted** — P2-envelope-sim comparison shape added; funding surfaced as Ask 4 with a proceed-without fallback; recon corrected |
| H1 dApp `fj` fold 2→1 omitted ("narrowing lazy, not sound") | **Adopted** — fj fold in scope, B1-gated, payload-free |
| H2 Ask 1's validation backstop false (reuse-miss runs the same pipeline) | **Adopted** — Ask 1 rewritten (with fable F-5's reuse-hit amplification) |
| H3 probe repeats the ledger-#11 pure-extractor trap; dApp-only injection needs an explicit two-instance story | **Adopted** — chain-bound probe + constructor injection + structural pin |
| M1 clamp mis-specified (node `txsLimits` + throw semantics; customLimits; global blast radius) | **Adopted** — full upstream semantics, own commit, per-path pins, Ask 2 line-item |
| M2 measurement shapes (real private delegated-call, undeployed account, per-dimension deltas, repeats, diagnostics) | **Adopted** — B1 spec expanded |
| L runner formal marker not prose-scan | **Adopted** |
| A-vs-B: B's measure-first ordering, A1 retained as inert checkpoint | **Adopted** verbatim |
| Positive: Sponsored identity pin survived attack ("no non-canonical payload route found"); add service-level reset/restore tests | **Adopted** into fixtures |

## Final fresh-context pass — new session, xhigh, on REVISION 2 + ledger + both r1 transcripts

- **Verdict**: `reject (with blocking findings: PrivateFPC cannot pass the proposed unfunded gate, and silent inner-hash authorization remains misclassified)`
- **Verbatim**: [audit-codex-final-response.md](audit-codex-final-response.md)

### Dispositions (ALL adopted → rev 3)

| Finding | Disposition |
|---|---|
| Critical: Ask-4(b) "free envelope-sim comparison" non-executable — P2 executes `pay_fee`, which asserts private-FJ balance in-circuit (`skipFeeEnforcement` doesn't bypass Noir asserts); funding = the L1 Sepolia route; r1's fragmented-note inclusion canary requirement silently dropped | **Adopted** — Ask 4 rewritten as a real fork: key ⇒ funded full measurement + fragmented-note canary ⇒ A2 eligible; no key ⇒ A2 DEFERRED (B2 proceeds independently — its shapes are genuinely free). Ledger #11 |
| H1: standalone `assert_inner_hash_valid_authwit` WITHOUT any attached witness action emits nothing — folded sim reports no-effects, sizes from stub, failure surfaces as loud pre-submit prove error (today it fails at estimate). F-4's pre-attached rule can't catch it (nothing to detect) | **Adopted** — named explicitly in Ask 1 with the honest failure-mode delta + a dedicated adversarial fixture. Ledger #12 |
| H2: probe ownership unpinned — the shared `buildAndEstimate` dep serves probe-forbidden `executeSendTransaction` too; two-instance ownership alone doesn't close the route | **Adopted** — split distinctly-typed deps (`buildAndEstimateValidated` vs `estimateWithDiscovery`); zero-probe/zero-stub OPTION pins (not just counts) on Transfer/send_transaction/embedded/NO_FROM; A1 gate pins sim options. Ledger #13 |
| M1: clamp blast radius understated (embedded + NO_FROM also served by `finalizeGasLimits`); live `txsLimits` fetch would negate the −1 RPC win | **Adopted** — full per-path enumeration in Ask 2; `BuiltStandardTx` retains `txsLimits` (zero new RPCs). Ledger #14 |
| Holds: e2e root cause, Inference-1 resolution, Sponsored identity fence, three-PR ordering | — |

## Re-verdict on revision 3 — resumed final-pass session

_Recorded below when it lands._
