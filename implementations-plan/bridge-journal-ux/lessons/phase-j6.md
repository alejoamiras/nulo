# J6 — rig-smoke findings (user, 2026-07-20)

Two bugs surfaced on the live rig, BOTH from one root cause: RESUME + the honest-narration
affordances live on the journal CARD, but right after a failure the user is looking at the in-flow
STEPPER takeover (FuelForm/BridgeForm formStage="stepper"), which has neither.

1. **"Can't click Get Gas again after rejecting the approval"** — the form stayed hidden behind the
   failed stepper; there was no path back to the form except the non-obvious stepper "background".
2. **"Never saw RESUME, even after approve-death — just 'no funds deposited'"** — the failed record
   was shown in the stepper (which DOES narrate honestly via the shared stepperPhases mapper — J3
   works there), but the stepper has no RESUME button; that's card-only, and the card was suppressed
   because the record was the foreground flow (activeFlowId).

**Fix**: a failed pre-completion attempt now RELEASES the stepper takeover (releaseForeground +
formStage="form"). Both bugs close at once — the form + Get Gas return, and the failed record drops
into the journal list below where RESUME (proven-safe pre-deposit), CLAIM (stranded deposit), and
paste-hash (unknown-outcome) live. Applied to FuelForm.onSubmit AND BridgeForm.onSubmit (the latter
already handled the DISCARDED case; extended to failed-but-kept). Covers both the kept-record and
clean-discard shapes. Pinned in FuelForm.test (approve-death → form returns; discard → form returns;
completed → stepper kept for the receipt).

Lesson: recovery affordances must live on the surface the user is ACTUALLY looking at post-failure.
The in-flow takeover is that surface, not the journal card. Rather than duplicate the buttons into
the stepper, we route failed records OUT of the takeover and INTO the card that already has them.

Gate after fix: faucet 519 · vue-tsc 0 · lint 0 · build green.
STILL PENDING: the user re-runs the J6 checklist on the rebuilt rig.
