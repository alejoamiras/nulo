# P2 — takeover stepper + receipt (lessons)

## 2026-06-10 — P2 COMPLETE (`e738dab`)
- `BridgeStepper.vue` (phase rail from the P1 mapper: glyph states ▢●✓⊘✕, pulsing active, SKIPPED badge, per-phase RETRY routing — engine phases only — and RUN IN BACKGROUND) + `BridgeReceipt.vue` (snapshot-driven headline, validated dual links, NEW BRIDGE).
- `BridgeForm` takeover machine: `formStage` form|stepper|receipt — ALL gating off it (`submitting` covers only the submit→onRecord window, so a backgrounded flow's still-true `busy` can never re-lock the form — the S7 pin); `onRecord` claims foreground + flips to stepper; the receipt transition keys off the RECORD's `completedAt` (survives the flow promise settling mid-bridge); clean-reject detection post-await (record gone ⇒ release + back to form); an orphaned stepper (cross-tab discard) fails open to the form.
- Pins: takeover one-surface xor (stepper up ⇒ card suppressed; background ⇒ card visible + submit ENABLED — asserted on the disabled attr), receipt snapshot survives `__reset` (cross-tab vanish), stepper rail/data-attrs, skipped badge, RETRY routing honesty, receipt link validation.
- Gotchas: TS keeps `.value` narrowing across `await` (read through a typed local); `vi.mock("@nulo/bridge-core")` starves the REAL engine import — partial-mock with `importOriginal`; mocked flow signatures must accept the `opts` third arg or `toHaveBeenCalledWith` breaks.
- Suites: faucet 228 ✓ · smoke 9 ✓ · typecheck ✓.

LESSONS_FILE=implementations-plan/bridge-form-stepper/lessons/phase-2.md
