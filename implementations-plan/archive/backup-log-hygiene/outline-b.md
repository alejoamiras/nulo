# Competing outline B — shrink the sink instead of filtering it

The main plan ([`plan.md`](plan.md)) accepts today's capture surface and filters it: harden
`trim()`, allowlist the envelopes, fix ~20 call sites, enforce the rule. Outline B attacks the
premise instead.

## The argument

Every finding in [`recon.md`](recon.md) is only a finding because the data **persists**. A
`console.warn` that dies with the service worker is a developer convenience; the same line
flushed to `chrome.storage.session["nulo:logs"]` every 2 seconds and exportable as CSV is a
data-retention decision nobody consciously made.

So: stop retaining, and most of the plan evaporates.

1. **Gate persistence behind Developer Mode.** The ring buffer stays (it powers the live viewer
   and the failure-indicator dot), but `scheduleFlush` (`store.ts:81-92`) only runs when the same
   flag that already gates the viewer is on. A normal user's logs then live in memory, die with
   the SW, and never touch disk.
2. **Gate capture level harder.** Raise the non-debug threshold from `Info` to `Warn`, or drop
   non-debug capture to a small error-only ring.
3. **Delete or dev-gate the CSV export** (`LogsViewer.vue:141-153`). The owner has never used it;
   it is already dev-gated. Removing it removes the only egress that leaves the machine.
4. **Then** do a much smaller version of arc 1 — the `Error` fix and `trim()`'s missing tests —
   because those are correctness bugs regardless of retention.

## What this buys

- Kills Tier 0 and Tier 1 for every non-developer **without touching a single call site**. The
  79% bucket-B problem stops mattering, because nothing is retained to leak.
- Roughly one arc of work instead of five.
- No over-redaction risk: developers debugging keep full-fidelity logs, which is the actual use case.

## What this costs, and why the main plan still wins

- **Field diagnosis dies.** Today a user hitting a bug can flip Developer Mode and export logs
  covering what already happened, because the buffer was rehydrated from session storage
  (`store.ts:65-78`). Under B, enabling the flag only captures from that moment on — the crash you
  wanted is gone. That is a real support regression, and it is why the current design exists.
- **Developers are exactly who handle real key material.** A dev-only retention policy concentrates
  retained data on the machines with production secrets and mainnet accounts.
- **It does not fix the transport envelopes.** `base-client.ts:196` logging
  `exportMnemonic`'s result still prints to a live console and still crosses the RPC boundary
  untrimmed — for developers, on their real wallets.
- **It leaves the restore-error path fully intact** — `restoreErrorLog` → `JsonViewer` → clipboard
  never goes through `LoggerStore` at all, so no amount of sink-shrinking touches it.
- **Removing a shipped feature is an owner decision**, not a plan's to assume.

## Synthesis (what the main plan should steal)

B is wrong as a *replacement* and right as an *addition*. Two of its ideas are strictly better
than the main plan's equivalents and should be folded in:

- **Gating the session flush behind Developer Mode** is a bigger risk reduction per line changed
  than anything in arc 3, and it composes with redaction rather than competing. Offer it at the
  gate alongside the support-diagnosis trade-off, so the owner decides retention knowingly.
- **The CSV export question** belongs in front of the owner regardless of which plan runs.

Its core claim — that filtering is unnecessary — fails on the two paths that bypass `LoggerStore`
entirely (restore-error log, live console) and on the developer-concentration argument.
