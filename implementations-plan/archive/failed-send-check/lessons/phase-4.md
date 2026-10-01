# Phase 4 · The card and the journal page

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-4.md`

## Interruption

The session hit an API spend limit while reading the files for this phase, before any P4 command
ran. Nothing of this build was running and no port was registered, so there was nothing to reap;
the phase resumed at its first step.

## Red run (new and updated tests, unbuilt code)

From `apps/extension`, the gate's test command: **16 failed, 157 passed**, 2 of 6 files failed,
exit 1.

- `journal-state.test.ts`: 16 failures. Twelve are `sendOutcome is not a function`: the four
  outcomes for a transfer and for a wire-shaped dApp send, the transfer and the dApp send failed
  while proving, the lock at the send line, and the renamed no-`from` transfer pin. The two sends
  failed at the send line read the base's kind arms where "Not confirmed yet" is expected: amber
  "Transaction was interrupted" for `stale_on_resume`, red "Account already initialized — retry
  after sync" for `duplicate_initialization`. The two interruptions before the send line read the
  base's "…check the explorer." context.
- `journal-detail-scope.test.ts` fails to load: the module does not exist.
- `TransactionTerminalCard.test.ts`: the first version of the green case **passed on the base**.
  Vitest does not process CSS here and answers every CSS-module name with a class
  (`_${name}_${hash}`, vitest 4.1.10's `getCSSModuleProxyReturn`), so a class assertion cannot see
  a missing rule. The case now also checks the rule in the SFC source, and fails on the base:
  1 failed, 14 passed.

## Build notes

- **The scope predicate moved with its read.** `readJournalDetail(client, id, scope)` awaits
  `getOperation`, then reads the scope, so "a record read after a scope switch" is a real case (a
  held read, a switch, then the answer). A pure predicate could only be handed a scope by the test.
  `loadOp` is now three lines, and A4 and the file map say so.
- `bindJournalDetailUpdates` takes the id as a getter, so it follows the route the way the deletion
  listener does. The page's reload on an update or a reconnect catches at `debug`: a port drop
  rejects the read in flight, and the reconnect that follows reads again.
- The outcome step runs before the cancel and kind checks in both helpers. `nothing_sent` keeps the
  card and changes only the page's words for `transfer`, `dapp_execute` and the two interrupted
  kinds; every other kind falls through to its arm, `session_ended` included.
- One test error, not a red of the code: the humanizer maps `transfer_in_public` to
  "Transfer (public)", and the dApp case first expected "Transfer In Public".
- Two more comments the change made false, both narrowed: the page's hero-fiat comment ("what the
  transfer WOULD have moved") and its `category` comment (milestone tags and "consumes only … stage").
- The composition case now also reads the card after the check answers: "Sent", green.
- **Helper modules in a pages directory are routes.** `vite-plugin-pages`' Vue resolver defaults to
  `vue`, `ts` and `js`, and `scripts/pages-options.ts` sets no `extensions`, so the build emits
  `journal-detail-scope-*.js` beside the existing `send-submit-*.js` and `received-copy-*.js`.
  The plan puts the helper there and the pattern predates it; no link reaches the route. Left as is.
- The root `typecheck` script exits 127 (`vue-tsc` is not a root dependency under the isolated
  linker); the gate's `typecheck:all` runs each workspace's own.

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun --bun vitest run src/utils/journal-state.test.ts src/components/composite/activity src/popup/pages/journal` (apps/extension) | 0 | 6 files, 183 passed |
| `bun run lint` | 0 | 29 warnings, 3 infos (the base's counts); complexity baseline OK; 1905 files |
| `bun run typecheck:all` | 0 | every workspace, rerun after the build regenerated the declarations |
| `bun run build` | 0 | built; it regenerated `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` for `sendOutcome` and `SendOutcome`, committed with the phase |
| `bun --bun vitest run src/wallet/services/execution/service.composition.test.ts scripts/pages-options.test.ts` (apps/extension) | 0 | 2 files, 34 passed |

`git status` after the phase commit: clean, no stray generated diff.
