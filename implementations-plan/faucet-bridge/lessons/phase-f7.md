# F7 — Gates

## Repo-wide validation ✅
`typecheck:all` green across all 13 `@nulo/*` packages (no cross-package break from the bridge-core `./artifacts` subpath or the faucet's new bridge-core dep), `lint` green (44 pre-existing warnings, exit 0), faucet 128 tests + build, bridge-core 41 tests. Note: `audit:vue`'s `test` step is extension-only (`--cwd packages/extension`); the faucet's tests run via `--cwd packages/faucet test`.

## Codex post-impl audit (session `019ea4fc-5f36-77a2-b1b1-ae5f6cae33fd`) — HIGHs fixed
0 critical, 2 HIGH + 3 MEDIUM. All valid (verified against the code).

- **HIGH 1 — leaf-index strand risk (`787e709`).** `useDeposit` took the L1→L2 leaf index from a preflight `simulateContract` (pre-state) — a concurrent Inbox message before the deposit mines shifts the real index and the claim retries forever against the wrong leaf. A regression of bridge-core's `#2` fix. Now parses the mined deposit receipt's `Inbox MessageSent` event (mirrors `flows.ts`).
- **HIGH 2 — deposit recovery (`24f924e`).** The claim secret had no resume path and was cleared at `PROPOSED` (reorg-able before checkpoint). Now: secret + leaf index persist until the recipient's L2 public balance crosses `preBalance + amount` (the reorg-safe signal), a pending claim auto-resumes when the Aztec wallet reconnects, and `claimAndConfirm` short-circuits if already credited.
- **MEDIUM — stale L1 signer (`787e709`).** `useL1Wallet` rebuilds the walletClient on `accountsChanged` (was updating only the address).
- Codex **confirmed correct:** the withdraw witness path (`getTxEffect → computeL2ToL1MembershipWitness → portal.withdraw`), `exit_to_l1_public` + `_withCaller=false`, and the dual-singleton sessions.

## Deferred (MEDIUM — documented follow-ups, not funds-at-risk)
- **Seal the deposit secret** via bridge-core `recovery-crypto` (`sealSecret`). Plaintext localStorage is acceptable for PUBLIC claims — `claim_public` binds the recipient in the message content, so the secret is not a bearer credential. Becomes required the moment private claims land.
- **Withdraw recovery.** A tab close during the (long) proven-epoch wait loses the local `exitReceipt`, so the L1 consume can't resume. Lower severity — no secret to lose; the L2→L1 message is on-chain and the consume is re-runnable from the node witness given the exit tx hash. Fix: persist the exit tx + resume on reopen.

## Remaining
- `/code-review` (user-triggered / billed — not launchable autonomously).
- Manual deposit + withdraw tests (the user's wallets — the GREEN-through-the-app proof).
- Swap (deferred — no testnet V4 pool for the bridge's USDC).
