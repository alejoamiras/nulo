# Fable/Opus plan audit (v1) — verdict: conditional approve

Conditions (all folded into plan v2):
1. P1 must thread `profileId` from build-time-captured `network.profileId`, NOT active-profile lookup — MOOT in v2 (the profileId-field approach was dropped entirely; P1 now removes the redundant subscriber).
2. Keep the `profileId` remap ALL-ROWS (S2) — a crafted row with a foreign profileId escapes normalization if scoped; only `networkId` needs old→new scoping. FOLDED.
3. Inference #2 ("deleteNetwork doesn't cascade-delete accounts") is FALSE — AccountService IS a chain-purge subscriber (`account/service.ts:48`) that deletes accounts + emits onAccountDeleted. FOLDED (and it became the basis for the v2 fix).
4. P3 must source `chainId` from the OLD token (token-balance rows lack it). FOLDED.
5. Stale line cites (:189/:313, :98, :497). FIXED.

Also raised (folded/noted): restore trusts tx fields verbatim (S3 — now moot for provenance since no profileId field); TxSchema-required-field invisible-row impact; add the execution suite to Phase 1's gate (moot — no executor changes in v2); P7 line off-by-6.

Full transcript: this session's fable subagent (opus 4.8, 1M ctx) run — 25 tool uses, verified every cited file:line against source, enumerated all txs.set + addTransaction sites, traced the purgeChain cascade for both triggers.
