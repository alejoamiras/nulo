# Phase 5 · The connect page waits; the check's header names who and where

## The faithful `Button` stubs first

Both discover files' `Button` stubs now bind `:disabled="disabled"` as the real primitive does
(`packages/design/src/ui/Button.vue`: only `disabled` sets the attribute), and both carry
`data-loading`. Run alone before any other change: 2 files, 26 passed. No existing case leaned on
the old `disabled || loading` stub.

No unit case pinned `closeWindow(true)` after Allow: the lifecycle oracles pin the shell through
`closeWindow()` and `reject()` called directly, and `index.test.ts` case 7 asserts only the
`resolveInteraction` call. Nothing to update there.

## Red first (the P5 production files as on `85c4d20f`)

`bun --bun vitest run` over the gate's paths: exit 1, 6 files failed, 13 tests failed / 42 passed,
two of the files failing to load.

- `useDappApprovalWindow.test.ts`: 1 failed (`completeInteraction` is not a function).
- `discover/index.lifecycle.test.ts`: 3 failed. After a resolved Allow the log was
  `removeEventListener:beforeunload`, `windows.remove`: the window closed. The switch and the lock
  cases failed on their first assertion for the same reason.
- `discover/index.test.ts`: 3 failed. The window closed at Allow and Allow stopped loading; no step
  bar; a second `approve()` sent a second `resolveInteraction`.
- `verify/index.test.ts` (new): 6 failed. The header read `No accountNULO` (new connection) and
  `Savings·chain 0NULO` (reconnect); a repeat, a composing and an IME-boundary Enter on OK all went
  through; no step bar.
- `ConnectStepBar.test.ts`, `verify/header-labels.test.ts`: failed to load, the modules not yet
  written.
- Green before and after (pins): the raced `JobCancelledError` still shows the cancelled overlay; a
  failed Allow leaves the waiting state (Allow stops spinning, Deny is enabled again, the error
  shows, the window stays); the grid is drawn from the URL's hash and not the row's; nothing is
  focused after mount and no key listener lands on `document` or `window`; a plain Enter on OK goes
  through.

"A failed Allow re-enables it" is read as leaving the waiting state: Allow itself stays disabled
after an error, by `processingError?.type === 'error'`, as today (`index.test.ts` case 8).

## Build

- `useDappApprovalWindow`: `completeInteraction()` drops the `beforeunload` rejection and closes
  nothing; `closeWindow(true)` calls it. The header keeps the invariants, without the history and
  the plan link.
- Connect page: after a resolved Allow, `completeInteraction()` and no close; `isLoading` resets
  only in the `catch`, so Allow spins, Deny stays disabled and the dot stays orange; Allow's
  `disabled` gains `isLoading`. The readiness comments keep only what the code cannot say.
- `verify/header-labels.ts`: the network by the profile's name for the session's chain in every
  branch; the account as before when shared, else the active account (O2 a) or "No account";
  `warn` for a shared account parsed onto another chain, or the active account while the active
  network is another.
- Verify page: the header from `verifyHeaderLabels`; OK cancels a repeat or composing Enter with
  `isRepeatOrComposing` (keyboard-guards' shared export is not on `dev` yet); the six narrating
  comments removed.
- `ConnectStepBar.vue` (O1 a): two 2 px segments, the onboarding bar's tokens (`--nulo-accent`
  filled, `--nulo-border` empty), `aria-hidden`, a `data-step` for tests and captures; step 1 under
  the connect page's strip, step 2 under the check's strip on a new connection only.

## Interruption

An API spend limit cut the session off during the build, after the red run and the shell edit. No
process of this worktree was running (checked with `ps`), no e2e run was in flight, and nothing
needed reaping. Resumed on the same tree; nothing was redone.

## Gate

- `bun --bun vitest run src/popup/windows/discover src/popup/windows/verify
  src/popup/windows/ConnectStepBar.test.ts src/composables/useDappApprovalWindow.test.ts`: exit 0,
  6 files, 63 passed.
- Regression beyond the gate: `bun --bun vitest run src/popup src/composables src/components`: exit
  0, 228 files, 2858 passed, 1 todo.
- `bun run typecheck:all`: exit 0.
- `bun run lint`: exit 0 after one fix (a test helper's `w?.vm` cast, flagged
  `noUnsafeOptionalChaining`) and one formatter pass. 29 warnings and 3 infos, pre-existing.
- `bun run build`: exit 0; no diff under `src/types/`.
