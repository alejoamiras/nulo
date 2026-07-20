# J2 — resume safety substrate (lessons)

Gate run 2026-07-20: faucet 475 (validator fuzz 22 + origin-lock 3 + latch pins) · bridge-core
165 · vue-tsc 0 · lint 0 · build green. No UI in this phase by design (final-pass PHASE-HIGH).

- **The validator's hashers are injected** so the fuzz table stays bb-free (poseidon via bb.js
  dies in vitest with `std::bad_cast`); production wires real aztec.js crypto in J4. Watch the
  fake-hasher hex discipline: the first fakes appended "hash" (non-hex) and tripped the
  validator's own id-hex gate — hex-preserving fakes ("…beef") or the table tests the wrong gate.
- **Verdict affordances are the card's contract**: "redo" ONLY on proven no-funds-moved,
  "review-only" for anything unknowable (incl. an existing resumeAttemptAt), "none" where another
  path owns the record (hash ⇒ recovery) or nothing is provable (legacy).
- **latchResumeAttempt is deliberately dumb**: read → refuse-if-present → write. Its guarantee is
  the WRITE-ONCE journal fact, not atomicity — the origin lock provides serialization; the latch
  makes ambiguity durable across reloads.
- **Permit2 nonce/deadline persist journal-first BEFORE the first signature** (fueled flow) — J5's
  nonce-reuse state machine reads them; without this, resume of any record signed today would be
  impossible-safe.
