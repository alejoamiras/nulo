# Phase 1 · The send waits for its record; the journal keeps it

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-1.md`

## Red run (base code, new tests)

`bun --bun vitest run` over the five touched test files, from `apps/extension`: **24 failed, 174
passed**, exit 1.

- `operation-journal/service.test.ts`: the carry cases fail on the stored shape
  (`expected { stage: 'failed' } to deeply equal { stage: 'failed', …(3) }`), `setSendCheck` and
  both predicates are undefined (`service.setSendCheck is not a function`,
  `isSendCheckable is not a function`).
- `execution-coordinator.test.ts`: the commit case fails on `commitSubmitting` never being called;
  the refused-write case resolves where it must reject (the base swallows the write and sends);
  the reaper-failed case resolves too (same reason, `node.sendTx` called).
- `execution-lane.test.ts`: `lane.commitJournal` is undefined.
- `transfer-executor.test.ts`, `dapp-send-executor.test.ts` (three paths): the context carries no
  `commitSubmitting` (`bound.commitSubmitting is not a function`).
- One new case passes on the base, by design: "a cancel that reaches the journal before the commit
  surfaces as the cancel" is a pin (see below).

## Build notes

- **The cancel race the fail-closed write would have opened.** A cancel landing while
  `assertAuthorization` or `toTx` runs moves the row `proving → cancelled`, so the `submitting`
  write is refused. The base swallows that refusal and the next `checkCancelled` reports the
  cancel; a bare fail-closed commit would instead throw the `IllegalTransitionError`, so the popup
  would read "Send status unknown" and a dApp would get an error instead of 4001. The coordinator
  runs `checkCancelled()` when the commit rejects, before rethrowing: the cancel's `abort()` follows
  its journal write within microtasks, while the refused commit needs a storage read first. Pinned
  green on the base and after. One ledger line in `plan.md`.
- `isTerminal` became a type predicate (`stage is TerminalStage`) so `failedFrom` narrows the prior
  stage to `ActiveStage` without a cast; no runtime change. The reaper's private `ActiveStage`
  alias now imports the one from `@nulo/wallet-core/jobs`.
- `submittedEndpointUrl` is a required member of the context (typed `string | undefined`), so a
  caller that forgot it fails to compile; each caller computes `primaryEndpointUrl(network)` once
  and hands the same value to the journal and to its activity record.
- The facade wires the lane's new `commitJournal` into the dApp executor (`execution/service.ts`),
  and three test fixtures that build a lane literal gained the member.
- The biome warning count rose to 30 on the first lint (`useOptionalChain` in `setSendCheck`);
  rewritten as `existing?.progress.stage !== "failed"`, the `updateProvingBackend` shape. Back to
  the base's 29.

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun --bun vitest run src/jobs` (packages/wallet-core) | 0 | 3 files, 15 passed |
| `bun --bun vitest run src/wallet/services/operation-journal src/wallet/services/execution src/wallet/services/legal/call-sites.test.ts` (apps/extension) | 0 | 53 files passed, 1 skipped (`batched-view-simulation.integration.test.ts`, env-gated, pre-existing); 785 passed, 7 todo |
| `bun run lint` | 0 | 29 warnings, 3 infos (the base's counts); complexity baseline OK |
| `bun run typecheck:all` | 0 | every workspace |

`legal/call-sites.test.ts` is green and unedited.
