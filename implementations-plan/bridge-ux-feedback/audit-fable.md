# Fable audit transcript — bridge-ux-feedback

## Round 1 — dual audit (Plan subagent, model fable, max effort)

Verdict: **conditional approve** — all conditions folded (F3 auto-hide, F8 chunked rounds, F7 copy table, F10 hygiene pins). Outline: engine-narration (reject card-first). Balance dissent recorded FOR (a); (c) ruled semantically wrong (the toggle governs flow privacy in both directions, not Aztec-panel display). Verbatim findings below (file links repo-relative).

---

**Outline position: engine-narration (primary).** The runtime map already streams engine progress to dumb cards — `deps.consume(rec, (p) => setRuntime(id, p))` (`useBridgeJournal.ts:489`), rendered at `BridgeJournalCard.vue:60-63`. `step` generalizes an established pattern. Card-first would add a second view-layer receipt poll that can contradict the engine's verified-only verdict (false "✓") and cannot see the unseal/sync-gate loops (`useBridgeJournal.ts:251,366-377`). Reject card-first.

**HIGH-1 — auto-clear (D3) can destroy a live blob; the "insurance is mooted" claim is false.** The probe equates "message not found" with "consumed" (`recordMessageConsumed`, `useBridgeJournal.ts:448`). A localStorage attacker who tampers `leafIndex` + forges `claimTxHash` to any successful Aztec tx reaches probe===true → `completedAt`: same-session, `secretCache` short-circuits `envelopeMatchesRecord` entirely (`:232-233`); rediscovered, the envelope-leafIndex check has the crash-before-reseal window (parent D2). Parent L2 kept the blob on exactly this false-done class; D3's `discard` repeals the suspenders. **Fix:** auto-HIDE — filter `completedAt` cards from the list after the ~8s grace, retain data for the existing 7-day `pruneCompleted` (`useBridgeJournal.ts:28,141`). Same UX, no `discard` call, and reload-mid-grace works for free.

**MEDIUM-1 — the ~30-min poll holds the record lock; `busy` disables both RETRY and DISCARD** (`BridgeJournalCard.vue:131,159`) for the full window — the plan's own "RETRY forces a check now" copy is unreachable mid-poll, and a 30-min un-discardable card regresses today's 3-min hold. **Fix:** chunked rounds (lock released between ~3-min slices, engine self-re-enters, `step` preserved). No cross-record pile-up otherwise: polls are per-record, `inFlight`-deduped.

**MEDIUM-2 — blanket "every attention note gains a funds-safety line" overpromises:** `stale` (no secret, `:354`) and withdraw no-`exitTxHash` (`:462-467`) cannot truthfully promise safety; "deposit untouched" on unseal-failed shouldn't imply recoverability. **Fix:** per-state copy table with a truth pin per state.

**LOW:** (a) `explorerTxUrl` does no shape validation today (`lib/explorer.ts`) — pin `/^0x[0-9a-f]{64}$/i`, non-hex ⇒ no anchor; (b) make `step` clearing structural in `withRecordLock`'s `finally` (`:297-300`) + an error-path pin; (c) `discard` leaves stale `runtime` entries (`:200-206`).

**Assumptions.** Facts: all verified — 45×4s loop (`useBridgeJournal.ts:392,430`); single Aztec balance off `isPrivate` (`BridgeForm.vue:51-55,126`); CLEAR-until-cleared (`BridgeJournalCard.vue:147-154`); explorer helper exists (aztecscan uses `/tx-effects/`); verified-only completion (`:399-410`; the engine's `verifyConsumeIdentity ?? true` default at `:471` is test-surface only). Inferences: the cross-tab discard race holds (`patchRecord` no-ops on a gone id); the load-bearing hidden inference "verified done ⇒ secret worthless" is attackable (HIGH-1) and must be listed. Asks: "no open asks" overstated — F5 open until codex arbitrates (delegation documented; not blocking).

**Plan quality.** Phase split sound; gates adequate; missing pins = the fixes above.
