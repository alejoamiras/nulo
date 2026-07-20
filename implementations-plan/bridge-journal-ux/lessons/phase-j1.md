# J1 — persisted failure facts (lessons)

Gate run 2026-07-20: bridge-core 165 (24 files, incl. the new `journal-failure.test.ts` 5 pins) ·
faucet 448 (new approve-onSubmitted pin) · faucet vue-tsc 0 · lint 0 · faucet build green.

- **classifyDepositFailure lives in bridge-core** (pure, next to the record types) — the flows
  persist from it, J3's card narrates from it; one table, both sides.
- **The clear patch works through JSON key-dropping**: `patchRecord` spread-merges and `write`
  JSON.stringifies, so `{ failedLeg: undefined, … }` genuinely removes fields — pinned, since the
  whole clear-on-reentry contract hangs on that serialization detail.
- **approve() exposes the hash via onSubmitted, not a return value** — the composable swallows
  failures into `error.value`, so a return dies on exactly the timeout path we're fixing. The pin
  also caught a bonus behavior: with the resilient wait, the mocked timeout RECOVERED via the
  direct receipt read (order: submitted → wait → direct-read success) — asserted as such.
- **Leg-evidence lives in flow locals** (`leg`, `depositPromptIssued`), classified only in the
  catch. `depositPromptIssued` is set BEFORE the writeContract dispatch — a throw inside the
  wallet prompt must classify as unknown-outcome, not no-funds-moved.
- Engine recovery (`recoverDepositLeg` dep) clears failure facts on every recovered variant —
  wiring-only (the mechanics pin is the bridge-core CLEAR_FAILURE_FACTS test).
