# Phase 7 — candidate canaries → (held) promotion

Status: ◑ IN PROGRESS. Public + private canaries PASSED live on the candidate. Promotion HELD on the
user gate. Fuel/swap/relayer canaries pending a decision (real dust money + FJ each).

## Candidate under test (Phase 6 deploy)

Portal `0xbd07…bd8b`, L2 proxy `0x2da8…62dd` / token `0x2dcb…b31c` / bridge `0x0f13…e98e`, reusing live
AZLO `0x457f…d389`. Manifest: `apps/faucet/public/testnet-bridge.candidate.json` (`privateClaimMode: salt-v2`).

## Canary results (live testnet, real proofs, dust AZLO)

| # | Canary | Command | Result |
|---|---|---|---|
| 1 | public bridge → `claim_public` | `smoke-existing-testnet.ts --config <candidate>` | ✅ PASS (2.9m, 100 AZLO, `balance_of_public` verified) |
| 2 | **PRIVATE bridge → `claim_private`** (strand-risk gate) | `… --config <candidate> --private` | ✅ PASS (4.4m, `balance_of_private` verified — recipient-commitment works LIVE) |

Canary 1 also confirmed the shared SponsoredFPC has FJ (post user top-up) + the candidate wiring is
sound. Canary 2 is the load-bearing one: the recipient-committed `claim_private` (deposit commits to
`H(deriveTokenClaimSecret(salt, recipient))`, circuit re-derives) settles + mints to the recipient on
the DEPLOYED candidate — not just the sandbox. The circuit artifact is byte-identical to Phase 2/4
(keystone-pinned), so the redirect-proof + relayer behavior is guaranteed identical; canary 2 proves the
deployment + live network handle it.

## Remaining canaries (pending)

- **3 — relayer redirect-proof** (`relay-claim-testnet.ts --wrong-recipient`, mode coded): submits
  `claim_private(WRONG, salt)` directly → MUST revert. Needs a descriptor-emitting private deposit
  (deposit + skip self-claim) to leave a message for the relayer. Security-critical but circuit-proven
  in Phase 4 (byte-identical artifact).
- **4-6 — swap public / fuel private / fuel-only**: exercise parts (a)/(b) — the fueled-bridge + fuel-only
  Permit2 paths (`smoke-swap-existing-testnet.ts`, `fuel-testnet.ts` private leg, fuel-only canaries).
  Separate from the recipient-commitment core.

## Promotion — HELD

Per the standing user gate + the WIPE plan: promotion = `cp candidate → testnet-bridge.json` (carrying
`privateClaimMode: salt-v2`) + `audit:faucet` + ship faucet+code as ONE release. NOT run without an
explicit second go.
