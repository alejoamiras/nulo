# PV1 — private deposit (lessons)

## 2026-06-09 — codex consult: private-flow design (kicked off)
The seal, the `balance_of_private` utility read, and the private sync-gate are the non-trivial parts of PV1/PV3 — codex'd BEFORE writing them (the loop routes non-trivial calls to codex, and the seal handles a bearer credential so it must not be rushed).

Questions sent (prompt: `/tmp/codex-pv1-design.md`):
1. Seal flow soundness — L1-sig key, non-deterministic-signature risk, plaintext-secret window, extra-signature UX.
2. How the @aztec/wallet-sdk reads a `#[external("utility")]` (`balance_of_private`) — `executeUtility` / `simulateUtility`?
3. Does `claim_private(...).simulate()` behave like `claim_public`'s (revert-until-consumable), so the same sync-gate poll works?
4. `claim_private` arg / note-creation correctness vs `claim_public`.

**Verdict: PENDING** — codex running in the background; the next iteration (its completion notification, or the 20-min cron) reads the RESPONSE_FILE and folds it in.

## Plan once codex responds
Implement in `useDeposit.claimAndConfirm`: `claim_private` branch + `balance_of_private` credit-confirm; wire the seal (recovery-crypto) into the private persist/resume; then the `DepositCard` public/private toggle (ungate private). Keep the private path gated until the seal lands — never persist a plaintext bearer secret.

## Status: in progress (the isPrivate plumbing in useDeposit.deposit landed in b2f6ed2; the rest is gated on this consult).
