# Phase 2 · The journal and the log say what happened (G1 sinks, O1)

## Fixtures

- `makeSession`, `makeDeps` and its four stubs moved verbatim into `queued-journal.fixtures.ts`;
  `queued-journal.test.ts` imports them back and still passes 25 of 25.

## Red run on `85c4d20f`'s behaviour

- How: P1's four production files (`errors.ts`, `method-scope-checkers.ts`, `scope-enforcement.ts`,
  `dispatcher.ts`) were swapped for their `85c4d20f` content by a script that kept copies in the
  scratch directory, the rewritten `background.refusal-log.test.ts` ran, and the copies went back;
  `git diff --quiet HEAD` on the four files confirmed them identical to the P1 commit.
- Result: 21 failed, 2 passed (23). Red, as Inference 2 predicted:
  - the four journaled `sendTx` rows: the row is `failed` with kind `popup_bound`, and its message
    carries the sentinel, e.g.
    `Scope violation: sendTx calls [SENTINEL-NAME@SENTINEL-TO], not permitted by granted transaction scope`
    and `Scope violation: sendTx.exec.scopes contains SENTINEL-EXEC-SCOPE, not in session's approved accounts`;
  - every scope refusal's failure line at `Error` (3), not `Debug` (0);
  - the refusal's own text, through the real dispatcher, interpolates for the ten rows of the seven
    interpolating checker refusals, the four `:42` rows and the unauthorized sender (P1's fix, seen
    end to end).
- Green there, the regression controls: no log line and no console line carries a sentinel on any
  row, no response does, nothing reaches execution or a window, the unauthorized sender and every
  non-`sendTx` refusal leave no row, and the journaled rows keep stage `failed` and title
  `SENTINEL-NAME`. The raw-hash row passes whole and says so in its name. No other sink was red, so
  no other sink needs the fix.
- The journaled rows name their call `SENTINEL-NAME` on purpose: the title is the one field that
  keeps the requested function name by design (Outcome 1), and the error field and every logger
  still show no sentinel.

## Red run at the P1 head, before this phase's production change

- `background.refusal-log.test.ts`: 21 failed, 2 passed. The journaled rows are red on the kind
  (`popup_bound`) and the level only; the row's message no longer carries a sentinel (P1). Every
  other scope refusal is red on the level only.
- `queued-journal.test.ts`: the four `failQueuedForError` cases fail with `failQueuedForError is not
  a function`, which proves only that the entry is missing. The behavioural proof is the background
  matrix, which reaches the same code through `handleWalletMessage`.
- `journal-state.test.ts`: `scope_refused` reads `Error` / `Something went wrong with this
  transaction.` (the default arm).
- `packages/wallet-core/src/jobs/types.test.ts`: `expected [ 'user_rejected', …(16) ] to include
  'scope_refused'`.

## Decisions

- `failQueuedIfUnclaimed` takes the kind as a trailing parameter that defaults to `popup_bound`, so
  the identity-guard call in `handleWalletMessage` is unchanged. As a leading parameter it made that
  call wrap to seven lines, and the plan keeps `handleWalletMessage` from gaining lines.
- `isExpectedRefusal` sits directly after `handleWalletMessage`, outside the regions the parallel
  `connect-window` build edits.
- The matrix also spies `console.debug`, `warn` and `error`: in the extension the console sniffer
  funnels them into the same buffer as the logger.
- A spy on `dispatcher.dispatch` that calls through reads each row's refusal, so every row is proved
  refused by the branch it names, not by an arg guard or the capability check.

## Gate

- `bun --bun vitest run src/jobs/types.test.ts` in `packages/wallet-core`: exit 0, 2 passed.
- `bun --bun vitest run src/wallet/services/wallet-sdk/ src/utils/journal-state.test.ts
  src/utils/log-payload-ban.test.ts` in `apps/extension`: exit 0, 23 files, 345 passed.
- `bun run lint`: exit 0 (pre-existing warnings only; complexity baseline unchanged).
- `bun run typecheck:all`: exit 0, 15 workspaces.
- `bun run test:all`: exit 0. Extension 606 files passed, 3 skipped; 8066 tests passed, 4 skipped,
  8 todo. wallet-bridge 503, extension-messaging 240, wallet-core 247, aztec-runtime 250 passed
  (2 skipped), wallet-crypto 120, design 401, third-party-notices 66, legal 54, landing 40,
  resolve-asset 14, wallet-sdk-schema-patch 11, passkey-rp 5; every workspace exited 0.
