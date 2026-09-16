# Post-implementation — final cross-arc codex pass

Codex (GPT-6 Astra, `high`, read-only) over the WHOLE two-arc stack as one system —
`git diff e01e416e..HEAD` (23 commits, 73 files, +4448/-222) — after both per-arc loops had already
converged. Session `01a0a85f-baf6-7a32-8fd8-895b03114573`. The prompt gave the arc map, the shared
envelope contract (extension throws `JSON.stringify(envelope)` = one level; the wallet-sdk iframe
transport reduces to the message string then JSON-encodes again = two levels; tools must parse both
and never a third), the two codes (`PXE_STALE_ANCHOR` -> chain-desync, `CONTRACT_NOT_REGISTERED` ->
contract-not-registered), and asked specifically for cross-arc envelope/code drift, the two-products
independence rule, hostile payloads, unbounded/replaying retries, and wallet-swap fence bypass.

## Round 1 — converged
**Verdict, quoted:** "**No new material HIGH/MED findings across the whole stack. Confidence:
moderate, static review only.**"

Codex's checked-and-fine list:
- Envelope shape and both codes agree; decoding accepts one/two JSON levels, never three.
- Product independence is preserved (no arc-2 reach into `apps/extension/**` or the wallet packages;
  no arc-1 reach into `apps/tools/**`).
- Unknown/non-string codes degrade gracefully; prototype-style names cannot select categories.
- Retries remain bounded, with no identified transaction replay or wallet-swap fence bypass.

Confidence is "moderate" only because it is a static review (it ran nothing) — the executable
evidence for the whole stack is in the phase gates (`lessons/phase-*.md`): the real-PXE stale-anchor
test (phase 2), `audit:vue` + `test:all` + smoke + the network canary + one solo network e2e
(phase 4), and `e2e:tools` (phase 6).

**All three codex loops now converged** — arc 1 (`post-impl-arc-1.md`), arc 2
(`post-impl-arc-2.md`), and this final cross-arc pass. Delivery follows.
