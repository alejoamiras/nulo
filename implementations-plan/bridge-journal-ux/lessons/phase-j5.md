# J5 — plain-token resume + paste-hash recovery (lessons)

Scope (user-decided at the J4→J5 gate): plain-token resume + the paste-hash unknown-outcome
affordance NOW; fueled-public (Permit2 nonce reuse) + fueled-private DEFERRED to a follow-up.

Gate 2026-07-20: faucet 516 (paste-hash 9 + card plain-token/paste-hash 3) · bridge-core 165 ·
vue-tsc 0 · lint 0 · build green.

- **Plain-token resume reuses the runResume orchestrator** (same safety ordering as fuel);
  useDepositFlow.resume wires the token-portal deposit (`depositToAztecPrivate/Public`) + the
  USDC→portal allowance leg. enabledVariants = {plain-token} in the token context.
- **Paste-hash is a pure validator** (`validatePastedDepositHash`, injectable receipt-fetcher →
  bb-free, 9 pins): valid-shape + mined-success + to==portal + secretHash-in-logs (best-effort,
  empty-logs tolerated). A wrong hash can never redirect funds (content hash is
  recipient+amount-bound) — worst case it just doesn't match. Engine handler
  `attachDepositHash` re-reads the receipt, attaches on pass, hands to runDepositClaim.
- **Card routes RESUME by variant** (resumeVariantOf): direct-fuel → fuelFlow.resume, plain-token
  → depositFlow.resume; fueled variants are NOT in DRIVEABLE_RESUME so no button shows.
  Unknown-outcome shows the paste-hash input instead of RESUME.
- **Deferred (follow-up #TBD)**: fueled-public resume (Permit2 nonce state machine — used→recover,
  unused+expired→same-nonce re-sign, unused+live→wait) and fueled-private resume (seal gap). The
  nonce/deadline are ALREADY persisted (J2) so the follow-up has its inputs.
