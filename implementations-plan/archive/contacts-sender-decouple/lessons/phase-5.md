# Phase 5 — Behavioral pin: receive from an UNREGISTERED sender

## What shipped
- `tests/e2e/fixtures/aztec.ts`: new `transferPrivateTokens` helper (private→private transfer via
  the embedded node-side wallet; same contract-registration + `wait` traps as `mintPrivateTokens`,
  documented in place).
- `tests/e2e/network/receive-unregistered.test.ts` — THE ship gate. Flow (audit-hardened design):
  1. Pre-assert exact ZERO senders on the Advanced surface, immediately before the transfer.
  2. Baseline: private balance exactly 0 on the token detail breakdown (fixture mints public only).
  3. Node-side external account (the minter — never a contact, never registered):
     `mint_to_private` to itself, then `transfer_private_to_private` of 25 tokens to the
     extension account. Two REAL proven, mined txs.
  4. Wallet discovers the note with zero registrations (refresh-driven PXE sync; total balance
     1,025 appears).
  5. Exact deltas on the token detail page: private 0 → 25, public unchanged at 1,000.
  6. Post-assert senders STILL zero — discovery neither required nor created a registration.
- Reused the suite's deployed token (audit condition: no second deployment) — the bundled
  `@aztec-foundation/aztec-standards` token, whose private delivery is `onchain_constrained`
  (handshake-backed by construction).

## Result
**GREEN on the first live run** (77.9s wall, 33.9s test): 1 file / 1 test passed, all assertions
held. The plan's enabling claim — handshake delivery makes sender registration unnecessary for
the bundled token's receives — is now a live-network invariant, not a source-reading.

The in-phase stretch (cold-PXE fresh-device re-discovery) was not implemented — it was explicitly
non-blocking in the plan; noting it here as a candidate follow-up alongside the cross-network
import fan-out.

## Validation gate (plan Phase 5)
- `bun run e2e:agent tests/e2e/network/receive-unregistered.test.ts` → 1 passed against a live
  local node with native proving (accelerator-required build). No `.todo`, no fallback used.
