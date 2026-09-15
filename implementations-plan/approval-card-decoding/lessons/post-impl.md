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
window, decoder, tx-enrichment, transfer-intent, vocabulary); biome clean. Commit `ec6089dd`.

## Round 2 — reject, 3 findings (all verified, all folded)

| # | Sev | Claim | Verified | Fix |
|---|---|---|---|---|
| 1 | high | Registration still let the vocabulary read by position: a registered token with `transfer(amount, to)` showed amount 2 / recipient 1 | yes (reproduced with the decoder) | `corroborates(decoded)`: the vocabulary applies only when the decode's parameters are the signature's roles, in order, with the expected kinds (`from`/`to` address, `amount` integer, `nonce` field); the vocabulary entry is picked by the decoded function name, not the app's. The vocabulary therefore waits for the decode (no more instant reading). Tests: swapped roles, wrong kind, app-name vs ABI-name |
| 2 | med | Discovered-authorization tails (raw rows past 32, array items past 8) had no disclosure at all | yes | `callSurface(…, maxRows)`: the discovered host lists every raw row; the decoder no longer truncates arrays (the 1024-leaf bound already limits them) and the popup summarizes at 8 inline with the full list in the row's `title` (`valueTitle`) |
| 3 | low | plan.md still described decoded `amount` scaling | yes | Architecture rewritten |

Comment audit: three applied ("never renders as a payment" replaced by the corroboration
constraint; the token-load comment in `index.vue` says the vocabulary is lost too; the `tokenAt`
comment deleted).

Round-1 status per codex: #2–#7 closed; #1 and #8 closed by this round's fixes. Commit `b0fba3aa`.

## Round 3 — reject, 2 findings (the three-round stop)

| # | Sev | Claim | Verified | Fix |
|---|---|---|---|---|
| 1 | high | `{ ...call, name: decoded.fn }` kept a wire `method` alias, which `parseTransferIntent` prefers over `name`: a decoded `transfer(to, amount)` with `method: "mint_to_public"` read as a mint | yes | the corroborated reading is built from `{ name: decoded.fn, args, hideMsgSender }` only; test with the alias |
| 2 | med | `valueText(v, true)` still trimmed addresses/fields and capped strings, so a title could collapse distinct addresses and small arrays had no title | yes | `full` prints addresses and fields whole and strings up to the sanitizer's 4096; `valueTitle` therefore appears whenever the line trimmed anything; tests: an address pair, a nested field, a long string |

Comment audit: both applied (`ROLE_KIND` comment deleted; the `jsonView` prop comment no longer
claims discovered overflow is "not shown" — those rows are uncapped). plan.md's Input bounds
paragraph updated.

**Stop.** Three rounds, all `reject`, findings 8 → 3 → 2 with the last two folded as ten-line
fixes. The plan's post-implementation rule stops the loop here: the round-3 fixes are unreviewed by
codex. Surfaced to the owner with the two open asks; a fourth round is the owner's call.
