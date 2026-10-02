# Decision — indexing public transfers where WE are the `from` (our own outgoing sends)

**Status: RESEARCHED → DEFERRED (not built).** 2026-07-23. Two sonnet-5 agents investigated the send
flow (codebase) and the aztec-standards `Token` public-event behavior (grounded in the v5.0.1 Noir
source `.../token_contract/src/main.nr`, cross-checked against the compiled artifact + the ABI our
runtime imports). Conclusion: feasible for only half the matrix, niche value, real UX risk — not worth
building now.

## The matrix — what `from` carries per rail (contract-confirmed)

| Rail | Emitting fn | public `Transfer`? | `from` | Observable as OUR send (`from == account`)? |
|---|---|---|---|---|
| pub→pub | `transfer_public_to_public` (direct emit) | yes | **real sender** | ✅ yes |
| pub→priv | `transfer_public_to_private` → `decrease_public_balance_internal` | yes | **real sender** | ✅ yes |
| priv→pub | `transfer_private_to_public` → `increase_public_balance_internal` | yes | `PRIVATE_ADDRESS_MAGIC_VALUE` | ❌ no |
| priv→priv | `transfer_private_to_private` — no emit, no enqueued public leg | **no event** | — | ❌ no |

The real sender lands in `from` **only when the source balance is debited in a public function**. Private
-source sends emit their public leg from an enqueued fn that was never given the sender's address — a
protocol privacy guarantee, not a scan gap. `Transfer` eventSelector `0x70a1894e`; the log tag is
event-type-scoped (hashes only the selector), so a `from == account` filter reuses the SAME scanned pages
as the existing `to == account` incoming scan — no new node call.

## Why deferred (feasibility ≠ worth)

1. **Redundant for single-device users.** We already record + render our own sends locally
   (`TransactionService.addTransaction` ← `TransferExecutor`, shown via `TransactionCard` + `tx/[id].vue`).
   The ONLY additive value is the same-seed-on-another-device case — mirror of why `incomingTransfersVisible`
   exists.
2. **Semantic asymmetry = a UX trap.** A multi-device user would see ONLY their public-source sends from
   other devices, NEVER private-source ones (invisible by construction). A partial, lopsided send history
   is arguably worse than nothing in a privacy wallet — a user could think a private send "didn't happen."
   The honest complete answer to "unified send history across devices" is cross-device tx-record sync — a
   different architecture.
3. **Non-trivial cost:** a new record kind + card/detail (indexed sends lack local fee/origin/nonce), a
   mirror dedup (this device's own sends must not double-count against its local `Tx` rows — inverse of
   `collectOutgoingTxHashes` + the in-flight journal-hash suppression), and a settings toggle.

## If revisited

Gate behind a toggle, framed honestly ("public sends from your other devices; private sends stay
device-local"). The scan seam is ready (add a `filterFromSenders` pass on the existing decoded stream);
the work is the record kind, dedup, card/detail, and the toggle — not the discovery.
