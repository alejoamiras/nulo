# Phase 2 · Each network on its own pipeline (B2)

## Red first (base `8ccac491`, P1's head)

`bun --bun vitest run src/composables/importChainSync.test.ts` from `apps/extension`: exit 1,
7 failed and 12 passed (19 tests).

- A stalled network costs only its own row: `expected [ [ n1's result, …(1) ] ] to deeply equal
  [ [ n1's result, n2's deadline record ] ]` (the base's single call timed out, so n1 was marked
  "ran out of time" too).
- Each network registers as soon as its own probe answers: `expected 4000 to be less than 4000`
  (the base sent n1's call only after n2's probe answered, 4 s in).
- A rejected call records only its own network: the base wrote two deadline records, n2's included.
- Resolved connectivity versus payload failures, the REJECTING case's retry set, and the retry-set
  case: `expected undefined to deeply equal [ … ]` (the base returns nothing).
- Violations and outcomes are tagged: `expected [ undefined, undefined ] to deeply equal
  [ 'violations', 'outcomes' ]`.
- Guards, green on the base as the plan says: both networks stalled (one deadline record each,
  from the aggregate timeout), and a probe answering on its third attempt with a registration that
  never settles (the tail settles 45 000 ms after its start, the late resolution appends nothing).

## Change

- `importChainSync.ts`: one pipeline per network with work (`syncOneNetwork`): a created network
  runs its own one-id preflight and registers the moment it answers "go"; an unknown id registers
  at once and is never retryable. `registerOneNetwork` races one `restore([item], remaining)` at
  the exact remainder; a rejection or a non-array result becomes the constant deadline record.
  Outcomes are recorded once, after `Promise.all`, tagged `"outcomes"`; violations keep their own
  earlier record, tagged `"violations"`. A resolved result is retryable when its item carries the
  deadline copy or a child carries the unreachable copy or a connectivity-class message.
- The tail resolves with the retryable networks' normalized items rather than their ids, so P3's
  stage keeps what a Retry replays without normalizing the slice again (Decision ledger).
- Zero-work items are no longer sent; the three budgets are unchanged.
- `useFullBackupImport.ts`: the `Q-02` and `(P7)` tags dropped from the two comments, their
  invariants kept. `useFullBackupImport.test.ts`: the seeded-id case now expects two calls, one
  item each.

## Gate

- `bun --bun vitest run src/composables/importChainSync.test.ts src/composables/importPreflight.test.ts src/composables/useFullBackupImport.test.ts src/composables/useFullBackupImport.stages.test.ts src/wallet/services/account-state/`
  (from `apps/extension`): exit 0, 8 files, 173 passed, 0 skipped.
- `bun run lint`: exit 0 (the same 29 pre-existing warnings; complexity-baseline check OK; no
  finding in `importChainSync.ts`).
- `bun run typecheck:all`: exit 0, every workspace.
