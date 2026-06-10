# Codex audit transcript — bridge-ux-feedback

## Round 1 — dual audit + D5 arbitration (new session, xhigh)

Verdict: **conditional approve** — all conditions folded (F6, F7, F8, F9). D5: **(a) stacked dual**. Outline: engine-narration.

**Outline pick**

Pick the primary engine-narration outline. The current truth already lives in the engine: `busy`, `attention`, `claimable`, `proven`, receipt waiting, and tx-identity gating are all in [useBridgeJournal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:38), while the card is intentionally dumb in [BridgeJournalCard.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/components/BridgeJournalCard.vue:24). Card-first would duplicate receipt polling, still miss unseal/sync internals, and can drift into a false “done” display.

**D5 arbitration**

Pick **(a) stacked dual balance**. It fixes the exact complaint against the current single derived `l2Balance` view in [BridgeForm.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/components/BridgeForm.vue:51) without changing the shipped toggle model in [BridgeForm.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/components/BridgeForm.vue:165). Two mono rows with active emphasis fit the existing brutalist panel and scan better than an inline hint.

**Findings**

- **High**: D3 overstates auto-clear safety. Deposit “verification” currently depends on `recordMessageConsumed()`, but that treats the whole `isMsgNotReady()` family as “consumed” in [useBridgeJournal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:438); that is a heuristic, not a proof, and a forged `claimTxHash` on a public/not-yet-synced record can still false-complete. Fix: do **not** auto-clear deposit records until consumed-vs-not-synced is distinguishable, or scope auto-clear to withdraws first; this also means the parent retention dispute in [bridge-ux-trust/plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-trust/plan.md:82) is not actually resolved yet.

- **Medium**: D2’s 30-minute story is too confident. `claimReceiptStatus()` maps all lookup exceptions to `pending` in [useDeposit.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:103), and `withRecordLock()` drops duplicate retries while busy in [useBridgeJournal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:287), so “RETRY forces a check now” is false unless the long wait is made abortable/backgrounded. Fix: separate transport failure from real pending, and only promise background checking/retry-now if the engine can cancel or yield.

- **Medium**: D6/D7 need harder boundaries. Explorer helpers currently interpolate any non-empty string in [explorer.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/lib/explorer.ts:18), and the proposed “funds are safe” copy in [bridge-ux-feedback/plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:41) is too absolute for `unknown-outcome`/`tampered` states. Fix: link only strict hex hashes, enforce `https`, and phrase reassurance per state-specific guarantee.

Assumption attack: “verified-only completion” in [bridge-ux-feedback/plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:95) is directionally true but stronger than the current verifier warrants; the “176 tests green” claim was not verifiable here because local Bun runs failed before assertions.

conditional approve (with conditions: no deposit auto-clear until completion proof is stronger or scoped away from deposits; classify receipt transport failure separately from pending and make long waits/retry copy truthful; validate tx hashes and narrow reassurance copy to provable states)

## Round 2 — FINAL fresh-context pass (new session)

Verdict: **conditional approve** — all three conditions folded same-round (F12 provenance bit, F11 generation token, hide-only text sweep).

- High: F9’s trust boundary is still underspecified. The plan says “in-session ordering is forge-resistant” for deposit auto-hide ([plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:26)), but the only concrete primitive in live code is `sessionLive`, a broad in-memory set populated at flow start and preserved across withdraw rekeys ([useBridgeJournal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:165), [useDeposit.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:196), [useWithdraw.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useWithdraw.ts:182)). That is not the same thing as “this process observed claimable → sent claim → saw post-receipt disappearance.” Keep F9, but scope it to a narrower runtime provenance bit set only by the local claim-send path.

- High: chunked re-entry needs explicit ownership/cancellation. Releasing `withRecordLock` between rounds ([useBridgeJournal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:288)) invites races between self-reentry, `resumeSessionWork`, and manual `RETRY`. Without a per-record generation token/abort flag, duplicate waiters can race `claimTxHash` clearing vs `completedAt`, double-toast, or resurrect runtime after discard. This is the main missing hardening in F8.

- Medium: the plan still contradicts itself on the core security fold. D3/F3 say hide-only retention ([plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:24), [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:89)), but P1/P2/manual-test text still says `auto-clear` / `discard` after grace ([plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:60), [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:66), [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:77), [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/bridge-ux-feedback/plan.md:99)). That is implementation-dangerous, not cosmetic.

- Medium: Assumptions still overstate what is “verified”: the “176-test suite is green” claim was not re-verified here, and the real attackable assumption is missing entirely: that the future auto-hide predicate is stronger than `sessionLive`.

No F1-F8/F10 reversal otherwise. Three phases are fine, but keep toast/filter UI in P2; P1 should stay engine/runtime/provenance only.

conditional approve (with conditions: narrow F9 to a local claim-send provenance bit rather than `sessionLive`; add per-record generation/cancellation for chunked receipt rounds; rewrite all leftover `auto-clear`/`discard` phase, test, and security text to match hide-only retention)