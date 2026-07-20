# J4 — RESUME runner: direct fuel (public + private) (lessons)

Gate 2026-07-20: faucet 504 (resume-runner 8 orchestration pins + card RESUME 6 + eligible-shape 8)
· bridge-core 165 · vue-tsc 0 · lint 0 · build green.

- **The runner is extracted pure + dependency-injected** (`resume-runner.ts`) so the
  security-critical ORDERING is unit-tested without a wallet: validate → origin-lock →
  allowance(pre-latch) → re-read → WRITE-ONCE latch (immediately before the deposit prompt) →
  deposit → release → claim. Pinned: the claim hands off only AFTER lock release (nesting
  runDepositClaim under the same record lock no-ops); the latch is AFTER the allowance leg (an
  approve death must not burn the one attempt); a cross-tab hash appearing pre-latch aborts to
  claim without depositing; a deposit-prompt throw reclassifies unknown-outcome (latched →
  permanent review-only).
- **Private-fuel secret binding**: `privateFuelSecretHash(salt, claimer) === computeSecretHash(
  deriveBridgeSecret(salt, claimer))` — equivalent, so the validator uses a single
  `privateFuelSecretHashHex` hasher. The hashers are injected; production wires bb-backed crypto,
  the fuzz table stays bb-free.
- **Card gates the button on a SYNC predicate** (`resumeEligibleShape`) — the click runs the full
  async `validateResume` inside `resume()`, so visibility never authorizes a spend. Review-consent
  is a two-click arm (RESUME → CONFIRM RESUME) with the amount+recipient review line.
- **captured `portal` local**: TS drops the `FUEL_PORTAL` non-undefined narrowing inside the
  resume closures — capture it after the guard.
- **SCOPE carried to J5**: plain-token resume (`useDepositFlow.resume`) + the paste-hash
  unknown-outcome affordance ship with J5's fueled work (they share the runner + an engine
  paste-hash handler). Direct-fuel — the user's actual failure surface — is fully wired here.
