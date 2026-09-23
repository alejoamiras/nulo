# Phase 4 — network e2e

Status: ✓ (2026-09-05)

## What landed
- `tests/e2e/network/cap-chain-mismatch.test.ts`: two tests on `registeredExtensionPerTest` (wallet on
  the e2e-seeded Testnet, playground on Local Network via its default `Fr.ZERO` chainInfo):
  approve-as-is (strip still "Testnet", read before the window closes; the app receives the one
  provisioned account) and switch-then-approve (banner `switched`, strip "Local Network", same account).
- The `dappConnectedExtension` fixture comment rewritten: the switch stays because sendTx/sim tests
  need the ACTIVE network on the sandbox, not because the picker would be empty.

## Gate
- `bun run e2e:agent tests/e2e/network/cap-chain-mismatch.test.ts tests/e2e/network/cap-request-accounts.test.ts`
  → 2 files, 3 tests passed (11.0 s + 9.6 s), sandbox owned and torn down by the runner. Exit 0.

## Notes
- Run detached in tmux (`ccm-e2e-p4`) with a `Monitor` on the log — the tool's 10-minute cap would have
  killed a foreground run during the wallet build + sandbox boot.
- `[aztec-node] Error: Address already in use (os error 98)` appears once during boot and the node
  continues to "Setting up Aztec local network" — a sub-service retry, not a failure.
