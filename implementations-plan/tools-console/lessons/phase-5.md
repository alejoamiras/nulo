# Phase 5 — preview walk + docs

2026-09-05.

## Gate

`bun run audit:vue` exit 0 (typecheck ∥ 432 unit files / 5390 tests ∥ lint, then the extension build) · `bun run --cwd apps/tools build:testnet` exit 0 · branch pushed; the Cloudflare Pages preview built on every push.

**Preview:** `https://worktree-tools-console.nulo-faucet.pages.dev` (the `nulo-tools-testnet` project's branch alias; `/build.json` names the commit it serves).

## Docs

`apps/tools/README.md` — the intro names the three sections and the dock, "The Send section" replaces "The Send tab", the journal paragraph states the one-surface rule and the shared policy, the tests paragraph covers the shell smoke and the shared fixture, the file map lists the shell components and composables. `implementations-plan/index.md` — status updated.

## The agent's own walk (before the owner's)

Screenshots at 1280, 1000 and 700px with a seeded journal (a claimable deposit, a done one), on the round-1 build. Rail, header chips, wizard card with the vertical step rail, Activity's first-visit tiles, the dock auto-opening on the needs-you record with one CLAIM and `Bridged ✓` on the done row, the rail count, the 1000px overlay beside its strip, the 700px top-row rail with the header wrapped and the step rail stacked — all as the mock. Two defects found and fixed on the spot (`a688e1f9`): the shell's scoped `.rail` rule leaking onto `RailNav`'s root, and the dock row's meta line truncating at 300px.

## Owner's walk

What to check on the preview (from plan.md): one send to the first claim, one faucet drip, dock hide / show / auto-open, the 1100 and 760 boundaries, keyboard-only rail + dock, both themes.

Two things to look at on purpose:
- The Activity page's first-visit statement sits inside the journal's dashed empty box, centred. The mock had it left-aligned with no box. One rule change either way.
- Needs-you rows in the dock drop the age (the mock's rule; the button takes that room). Running and done rows carry it.

## Owner's walk — round 1 (2026-09-05)

Feedback, and what was done with it:

1. **Land on Bridge, and call it Bridge, not Send.** Done: the shell starts on the bridge section (the `bridge.*` host special-case is gone); the rail entry, the header title and Activity's first-visit tile say Bridge. Internal keys (`section: "send"`, the `tl-send-*` testids, `SendView`, `SendWizard`) are unchanged.
2. **The wizard could use more width.** The card's cap went from the mock's 760px to 900px, the width the Activity list and the faucet already use.
3. **Footer text flush against the rail.** The footers now sit inside the body's horizontal padding (36px; 16px under 760px).
4. **The private bridge failed on the Aztec claim.** Not a shell defect: the log is the engine's private first claim (`Token:mint_to_private` + `HandshakeRegistry:non_interactive_handshake`) failing `simulateTx` with `Nullifier read request at index 0 is reading an unknown nullifier`. That error class is documented in `implementations-plan/single-sim-estimates/lessons/phase-B1.md`: the PXE has not synced the nullifier the private function reads (an account whose first outgoing tx needs its init wrap, or a message/handshake nullifier not yet in the PXE's tree). The record persists; CLAIM re-runs from the card or the dock once the PXE has caught up. Reported to the owner as a separate engine issue, outside this plan's scope (the journal engine's behaviour is "Out").
5. **A dashed border on Activity after RUN IN BACKGROUND.** Reproduced with a seeded backgrounded record: the list renders the card, not the empty state. What showed was the card's own error note for the failed run, styled as a dashed yellow box, which reads like an empty state. The note is now a yellow left rule on a tinted background.
6. **Multicall for the bridge's balances?** Already the case: `readErc20Balances` in bridge-core is one viem `multicall` (`allowFailure`) over the rows on screen, read as rows come into view and remembered.

## Owner's walk — round 2 (2026-09-05)

The bridge failed again, on a different record: `Setup function not on allow list` from the node's validator inside `simulateTx`, after `TokenBridgeHub:claim_private → Token:mint_to_private → HandshakeRegistry:non_interactive_handshake` ran straight after `entrypoint`. The claim paid from the account's own public Fee Juice (`own-gas source: public`, `publicAllowed: true`), the route #544 added: the wallet advertises `dapp-self-pay`, the app sends the claim with the account as payer and no fee call, and the wallet built it with the dApp's calls in the setup phase. `requestedPayment: "fj"` is set by the planner and read by nothing but the fingerprint. The network e2e runs against a sandbox whose setup allow-list is permissive, so CI could not see it. This PR touches no wallet or engine file.

**Owner's decision:** fix #544 first, with an e2e that exercises the real allow-list semantics so a wallet-side fee-path change cannot ship green again. The shell sign-off waits for that arc; PR #546 stays open.

**Sign-off:** _pending — after the self-pay fix arc._
