# Post-implementation · the codex audit and fix loop

## Round 1 (codex `high`, read-only, on the net diff from the plan commit)

- **Verdict.** `approve with fixes`: one minor finding and two nits; no runtime defect found within
  the approved scope.
- **Minor, accepted.** The e2e spec read the nonce's hover text from any titled descendant of its
  row (`querySelectorAll("[title]")`), which is a structural query and would also pass on a title
  placed elsewhere in the row. The value now carries `${prefix}-transfer-nonce-value`, and both the
  e2e spec and the component test read its text and `title` on that element. A testid is not a
  visible change.
- **Nit, accepted.** The descriptors header kept a finished "Migration status … (Q-12 phasing)"
  paragraph and a pointer to per-kind module headers that no longer exist; both are gone.
- **Nit, partly accepted.** The selector gate's six-line comment shrank to three lines that keep
  its reasons (position-based reading, a registered interface can name any selector, kinds looked
  up by role because `_nonce` has no entry). The vocabulary's selector table stopped repeating the
  gate's rationale, and the `openWindow` doc line in the e2e spec is gone. `abiNameFitsRole` kept a
  one-line doc instead of none: it states the parity with the descriptors' predicate that a unit
  test pins.
- **Gate after the fixes.** `bun run --cwd apps/extension test src/popup/windows/execute
  src/utils/token-transfer-vocabulary src/wallet/services/token/functions`: 21 files, 238 tests
  passed. `bun run typecheck` and the e2e tree's name check passed; Biome clean on the six files.
  Committed as `refactor(execute): pin the nonce value by testid and trim the gate's comments`.

## Round 2 (the same codex session, resumed with the fix commit and both rules)

- **Verdict.** `approve`: "No new material findings." It re-read the fix commit and the whole net
  diff; static review only, the tests' runs were not repeated on its side. The loop converged here,
  in two rounds of the three allowed.
