# PV1 — private deposit (lessons)

## 2026-06-09 — codex consult: private-flow design (kicked off)
The seal, the `balance_of_private` utility read, and the private sync-gate are the non-trivial parts of PV1/PV3 — codex'd BEFORE writing them (the loop routes non-trivial calls to codex, and the seal handles a bearer credential so it must not be rushed).

Questions sent (prompt: `/tmp/codex-pv1-design.md`):
1. Seal flow soundness — L1-sig key, non-deterministic-signature risk, plaintext-secret window, extra-signature UX.
2. How the @aztec/wallet-sdk reads a `#[external("utility")]` (`balance_of_private`) — `executeUtility` / `simulateUtility`?
3. Does `claim_private(...).simulate()` behave like `claim_public`'s (revert-until-consumable), so the same sync-gate poll works?
4. `claim_private` arg / note-creation correctness vs `claim_public`.

**Verdict (codex `019eac7a`):**
- **CRITICAL** — static `RECOVERY_KEY_MESSAGE` ⇒ ONE decrypt-all key for every sealed blob (raw signature is the KDF input). FIX: bind the signed message PER-RECORD (chainId + portal + bridge + `secretHashHex`); never put the raw secret in the message.
- **CRITICAL** — never auto-resume a private claim to the ACTIVE account (`claim_private` picks the recipient; the deposit message doesn't bind it). FIX: persist the intended recipient; on resume require exact-match or an explicit "different address" confirm; confirm credit via `balance_of_private(storedRecipient)`, not the active account.
- **HIGH** — raw-sig-as-password is brittle ⇒ stranded funds. FIX: normalize the sig encoding before the KDF; pre-broadcast seal self-test (sign→seal→re-sign→`openSecret`, ABORT before the L1 tx on mismatch); cache "private recovery unsupported for this wallet" + warn hard.
- **HIGH** — `claim_private.simulate()` IS a valid sync-gate (it consumes the L1→L2 msg in the private body via `wallet.simulateTx`), but the revert wording differs ("Message not in state", not `l1_to_l2_msg_exists`). FIX: widen the `isMsgNotReady` classifier.
- **MEDIUM** — minimize plaintext lifetime: derive/verify the key FIRST, then `Fr.random`→`secretHash`→seal→persist blob; never plaintext in reactive state / logs / thrown errors.
- **MEDIUM** — `balance_of_private` is a utility read: `wallet.executeUtility(...)` + the `simulation.utilities` scope (follow `useTokenBalance.ts:123`). No separate `simulateUtility` API.
- **Looks fine** — the bearer-credential model, mined-`MessageSent.index` leaf, one extra L1 sig per private deposit.

Implementation order (folded): PV3-seal (per-record key + self-test) → PV1 `claim_private` + `balance_of_private` (executeUtility) + widened classifier + recipient persist/confirm → DepositCard toggle + bearer warning.

## Plan once codex responds
Implement in `useDeposit.claimAndConfirm`: `claim_private` branch + `balance_of_private` credit-confirm; wire the seal (recovery-crypto) into the private persist/resume; then the `DepositCard` public/private toggle (ungate private). Keep the private path gated until the seal lands — never persist a plaintext bearer secret.

## Status: in progress (the isPrivate plumbing in useDeposit.deposit landed in b2f6ed2; the rest is gated on this consult).
