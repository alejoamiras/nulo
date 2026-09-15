# Post-implementation — the codex loop

Codex at xhigh, launched through tmux (`nulo-acd-codex`), never concurrent with a gate. Session
`01a0a6de-a94d-7f13-b99f-8c25f9a62f17`.

## Round 1 — reject, 8 findings (all verified against the code, all folded)

| # | Sev | Claim | Verified | Fix |
|---|---|---|---|---|
| 1 | high | The vocabulary applied to any contract by name: `transfer(admin, role)` rendered as a payment | yes (`callSurface` had no token check) | `callSurface(…, tokenKnown)`: vocabulary only on a contract the wallet registered as a token (`tokenAt`); the card passes `isToken(call.to)` / `isToken(consumer)` |
| 2 | high | The ABI, not the argument count, bounds `decodeFromAbi`: an array of 10 000 empty structs decodes from zero fields | yes | `abiNodes(type)` counts decoded leaves per array slot; > 1024 (or depth > 32) → `unavailable` before decoding; test with a zero-field flood |
| 3 | med | `args: [{ toString: null }]` threw in `String(v)` outside the try → "Reading arguments…" forever | yes | `asText` catches; `displayCallsOf` moved inside the per-operation try |
| 4 | med | Decoded function names reached `humanizeMethodName` unsanitized (bidi, length) | yes | `safeWire(fn, 64)` in `callName` and `authwitFunction` |
| 5 | med | A foreign `claim` decoded as "Claim Fee Juice" | yes (`curatedLabel` is not contract-aware) | `humanizeMethodName(method, contract?)` routes through `getMethodLabel`; the execute window passes the contract everywhere it names a function |
| 6 | med | Every integer named `amount` on a registered token was scaled by that token's decimals, whatever the function | yes | `paramText` removed; a decoded integer reads as the contract gave it, the wallet's units apply to its own vocabulary only |
| 7 | med | A token whose symbol sanitizes to "" printed a scaled number labeled "base units" | yes | `amountLabel` keeps the raw integer when the symbol is empty |
| 8 | med | "+N more in the JSON view" is false for discovered authorizations (the JSON view lists requested operations only) | yes (`json/index.vue` reads `params.operations`) | `CallArguments` `jsonView` prop; discovered authorizations say "+N more not shown". Extending the JSON view to discovered records was rejected as scope |

Assumption attack, folded into plan.md: Fact 5 narrowed (e2e also reads `execute-op-from-account`
and fee badges; untouched here), Fact 7 reworded (the dispatcher validates target + name, not
arguments), the two inferences reworded (an unregistered contract can still decode through the
node / known-bundle cascade; wrong-consumer safety comes from the discoverer's consumer binding, not
selector uniqueness). Two owner asks surfaced (see plan.md § Assumptions → Asks).

Comment audit: all four applied (`decoded-call.ts` narration removed, `CallArguments.vue` CSS
narration removed, the inherited "Phase 2 follow-up" tag dropped, the decoder header no longer says
"ABI truth", the single-type unwrap has its sentence).

Gate after the fixes: typecheck clean; 16 files / 154 tests green (`vitest run` over the execute
window, decoder, tx-enrichment, transfer-intent, vocabulary); biome clean.
