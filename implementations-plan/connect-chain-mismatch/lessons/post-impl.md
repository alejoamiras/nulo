# Post-implementation codex loop

Session `01a07294-020b-7c93-9355-7ee3b244428b` (fresh, gpt-5.6-sol xhigh, read-only), net diff from
`91074a74`, with plan.md + recon.md + the adversarial ask + the no-over-engineering and comment-quality
rules. Transcript: `../audit-codex.md` § Post-implementation.

## Round 1 — `not converged` (0 High, 3 Medium, 3 Low)

Adopted:
- M: the invitation rendered before init landed (`payload` null → chain `""` → `0` → a Testnet wallet
  offered "Switch wallet to Local Network" beside a disabled Approve) and stayed on a generic error.
  `dappChain` is now `undefined` without a payload; `chainBannerState` is gated on `initComplete` and
  on `processingError.type !== "error"`; the identity line falls back to the plain label. New component
  case: no banner before init lands.
- L: the stale `noAccountsAvailable` comment (still blamed a chain-info mismatch) and my own inaccurate
  "hidden or imported" wording (a visible imported row IS listed by the first read) — both rewritten;
  plan.md I2 corrected the same way.
- L: comment trims (`useNetworkActivation`, `chain-mismatch`, Banner's `testId`, `DEFAULT_ACCOUNT_NAME`).
- L: the duplicate composable test replaced by the `read → null` reconcile branch.

Declined (pre-existing, not widened by this change — logged as follow-ups):
- M: a network purge (`clearChainState`) landing between derivation's row read and its storage write
  leaves an orphan row. The window exists for every creation path (`createAccount`,
  `ensureDefaultAccount` from the popup); a dApp can trigger a creation but not a purge.
- M: a same-address `importAccount` (locked on the `Imported` tuple) landing inside a `Nulo_v1`
  creation's awaits gets overwritten by the derived row. Same shared window, same trigger asymmetry.
  Both are one fix — a chain-scoped critical section shared by creation, import and purge — and belong
  to their own change.

## Round 2 — `converged`

Codex accepted the two declined races as baseline behaviour ("the new dApp trigger broadens creation
timing, but does not give the dApp control over purge or import"). One Low adopted: the
`chainBannerState` comment no longer claims an absolute ("never beside a disabled Approve") — the
footer's momentary holds are named as the exception.
