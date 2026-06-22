# Phase 1 — Execution follow-ups batch (front-loaded)

All three items in one commit (PR-splittable as designed):

1. **cancelJob ownership (ledger D6)**: `ExecutionLane.cancelJob` now
   loads the record first; missing record / foreign profile / locked
   wallet all silently drop — indistinguishable from unknown id
   (existence non-disclosure). TOCTOU note in-code: the FSM transition
   stays the arbiter of WHETHER, the gate only decides WHO. The Phase-0
   `(BUG PIN)` was REPLACED by four ownership pins (match cancels /
   foreign drops / absent drops / locked drops); the two retargeted
   characterization pins and the acquireSlot cancel-during-wait test
   gained `getOperation` mocks returning owner-matching records.
2. **`dapp_execute` start-path unification**: `beginDappExecuteJournal`
   moved INTO the lane as `beginJournal` (verbatim body;
   `pickPrimaryMethod` import moved). The claim wrapper now self-wires
   (`createFreshRecord: this.beginJournal`); the lane dep
   `createFreshRecord` was deleted; the executor's `beginJournal`
   wiring points at the lane. ONE start path remains.
3. **Setup-gate hardening**: BOTH ungated soft-skip paths in
   `global-setup.ts` (anvil-health, node-health) now throw under
   `E2E_REQUIRE_SETUP=1` — a dead sandbox can no longer masquerade as a
   green skipped run (the bb-SIGILL docker incident class).

## Gate (as written in plan.md)

`bun run lint` exit 0 ✓ · `bun run test` 2,354 passed ✓ (incl. the four
new ownership pins) · tsc exit 0 ✓

Gotcha logged: gnu-sed is in PATH on this machine — BSD `sed -i ''`
treats `''` as a filename; use python for in-place edits.
