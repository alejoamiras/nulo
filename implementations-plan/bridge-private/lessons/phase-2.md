# PV2 — private withdraw (lessons)

## 2026-06-09 — codex consult: private-withdraw design (kicked off)
The private burn auth-wit (OFF-chain `createAuthWit` vs the public ON-chain `SetPublicAuthwit`) is the non-trivial part of PV2 — codex'd before writing it (the loop routes non-trivial calls to codex).

Questions sent (prompt: `/tmp/codex-pv2-design.md`):
1. Private auth-wit for `burn_private` (`createAuthWit` + how to attach to the exit tx) vs the public `SetPublicAuthwit`.
2. `exit_to_l1_private` args/behavior vs `exit_to_l1_public`.
3. The proving→consume tail — identical to public?
4. Does the private withdraw need a bearer seal? (Believed NO — the exit recipient is L1-bound.)
5. Attacker surface (auth-wit nonce/replay, burn-vs-exit atomicity, consume front-running).

**Verdict: PENDING** — codex running in the background; the next iteration reads the RESPONSE_FILE and folds it in.

## Public withdraw structure (reuse — packages/faucet/src/composables/useWithdraw.ts)
`withdraw(amount)`: `SetPublicAuthwit(burn_public)` → `exit_to_l1_public` → persist `{exitTxHash, recipientL1, amount, exitBlock}` → `consumeExit` (proven-epoch wait → L1 outbox consume, with `consumeTxHash` recovery). The consume tail + recovery are flow-agnostic; PV2 changes only the burn auth-wit + the exit call (and likely needs `isPrivate` threaded like `useDeposit`).
