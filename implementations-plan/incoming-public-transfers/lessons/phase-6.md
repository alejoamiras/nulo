# Phase 6 — Received-detail UX redesign + lazy receipt fee (D5 follow-up)

Post-ship UX iteration after the user manually smoke-tested Phase 1–5 on Alpha. Three asks, all
approved via a design artifact before code (`receive-redesign.html`, published to claude.ai):

1. **§1 — Rebuild the Received detail page on the Transaction-detail design system.** "Receive is
   Send, reversed." The old `received/[id].vue` was a bespoke stripped-down layout; it now mirrors
   `tx/[id].vue` exactly: explorer link + timestamp at the TOP (hero-meta), a mono amount hero, a
   kind chip, side-by-side From/To cards, and a Details box. It also shows MORE: the network fee.
2. **§2 — Dust setting**: trimmed the verbose copy to "Hide receipts below this value. 0 turns it
   off." and swapped the wide `<input type=number>` (spinner arrows) for a compact `$`-prefixed
   `type=text inputmode=decimal` field (72px).
3. **§3 — "Catching up" token indicator**: DEFERRED to its own scope (needs a cold-start-backfill vs
   caught-up signal from the service — real work + its own reorg edge cases). Design approved
   (pulsing dot + "Catching up…", escalate to shimmer when balance unresolved).

## The fee-fetch architecture decision (user consult)

The record stores no fee — it's in the tx receipt (`transactionFee`, by txHash). Three options were
put to the user (fetch-lazily-on-open / eager-during-discovery / lazy+cache). **User chose A (lazy,
cached).** Rationale: eager fetch would pay a node call per receipt during the 30s scan + backfill —
the hot path — for receipts that are mostly never opened, and would bloat storage. Lazy = one call,
only for VIEWED receipts, page never blocked (only the fee row shimmers), nothing persisted.

Implementation: `IncomingTransferService.getReceiptFee(id)` →
`getNetwork(networkId).chainId` → `getNode(chainId).getTxReceipt(TxHash.fromString(txHash))` →
`{ feeJuice }`. In-memory cache keyed `${networkId}|${txHash}` (immutable fee ⟹ cache forever within
SW lifetime; only viewed receipts populate it ⟹ tiny; never persisted).

### Privacy hardening — the id-keyed, server-side gate

Fetching a receipt for a PUBLIC receipt leaks nothing (recipiency is already on-chain — we indexed
the public `Transfer{from,to}` naming us as `to`). But a NOTE (private) receipt's tx hash must NOT be
handed to the active node on view — that would be a fresh deanonymization association. Rather than
gate only in the popup (bypassable by a UI bug), the method takes the record **`id`**, resolves it
`getIncomingTransferById`-scoped-to-the-active-profile, and returns `null` for any non-`public-event`
record **before any `getNode`/`getTxReceipt`**. The popup still gates the row render on kind for UI
honesty, but the node-contact gate is server-side. Pinned by a test asserting a note id → null with
zero node calls.

## Design-token correction (user caught it)

First artifact pass used `--nulo-accent: #a8480c` (burnt orange) for the dark device mockups + a green
`+`. Both wrong: **dark accent is `#f8f1e7` (cream); `#a8480c` is the LIGHT-theme accent**
(`packages/design/src/base.css` — dark `:root` L94 vs `[theme="light"]` L140). The `+` should be
`--txt-primary`, not green (`--good`). Fixed the artifact (device accent pinned to the dark cream
regardless of page theme) and the page (`+` in primary text, no green).

## Codex consult (2 rounds, gpt-5.6-sol xhigh)

**Round 1** flagged real bugs, all fixed with tests:
- **Reorg cache staleness** — fee was cached hash-only, but Aztec derives the fee from the block's gas
  prices, so a re-mine under a new block hash changes it. Fix: key the cache by
  `(networkId, txHash, blockHash)` and only serve a fee when `receipt.blockHash === record.blockHash`.
- **Wrong-network metadata** — the page loaded tokens + built the explorer URL from `appStore.network`,
  not the record's. Fix: resolve the record's own `networkId → chainId` and drive both off that.
- **Node-resolution TOCTOU** — `getNode(chainId)` uses the *active* profile; a profile switch mid-fetch
  could route the hash to another profile's endpoint. Fix: pin to the record's own primary endpoint via
  `getNodeForUrl`.
- **Init-failure suppression** — a token/config RPC failure skipped the fee fetch and escaped `onMounted`
  as an unhandled rejection. Fix: record-first, then `Promise.allSettled` over the aux loads.
- **Permissive dust parse** — `parseFloat("0,5")` → 0 silently disabled the filter. Fix: strict decimal
  regex + snap-back on invalid.

**Round 2** (verifying the fixes) caught follow-ons, also fixed:
- **Mismatch should return null, not just skip caching** — showing a fee from block B next to the
  record's block A is inconsistent. Fix: blockHash mismatch → `null` (show nothing until the reconciler
  catches up).
- **Endpoint fallback re-opened the TOCTOU** — the lax storage codec allows empty endpoints, and the
  `getNode` fallback hit the global node again. Fix: no primary endpoint → fail soft (`null`).
- **Purge race** — an off-lock fetch could repopulate the fee cache *after* a concurrent
  `clearChain`/`clearProfile` wiped it. Fix: capture `serviceEpoch` at entry, skip the cache write if it
  changed (test simulates the race by clearing mid-fetch).
- **Dust save-failure display** — reset the field on a failed RPC save too.
- Doc/comment corrections.

## Deferred — "Privacy maxi" setting (future work)

Codex's strongest remaining point (and the user's call): the public scan is **recipient-blind** — it
pages a contract's whole `Transfer` stream and filters `to == account` locally, deliberately preserving
recipient ambiguity toward the RPC. Two surfaces on this page break that ambiguity:
1. **Explorer links on private (note) receipts** — clicking sends the private-receive tx hash + IP to
   the explorer.
2. **Auto fee-fetch on open** for public receipts — `getTxReceipt(txHash)` narrows the RPC's view to that
   one tx (less sensitive than #1 since the recipient is already on-chain, but still a narrowing query).

Round 1 shipped a fix for #1 (notes copy-only). **User decision (2026-07-23): roll that back** — keep the
richer UX (explorer links everywhere, auto public-fee fetch) and **defer the hardening to a future opt-in
"Privacy maxi" setting** that would, when enabled: strip explorer links on private receipts, and gate the
public-fee fetch behind an explicit tap (or turn it off). Documented in the page header comment. Not built
in this scope by product decision.

## Validation

- `bun run audit:vue` — **exit 0**: typecheck:all (11/11 packages) → 3568 unit tests pass → lint → build.
- `bunx vitest run src/wallet/services/incoming-transfer/` — 127 (incl. 5 `getReceiptFee` tests: happy +
  cache, no-fee/node-throw, note/foreign-id gate, reorg blockHash-mismatch→null, epoch purge-race).
- `apps/extension` typecheck (`vue-tsc`) — clean; biome on all touched files — clean (0 warnings).
- `bun run build:chrome` — built (`apps/extension/dist/chrome`).
