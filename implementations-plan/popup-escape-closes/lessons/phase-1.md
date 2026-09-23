# Phase 1 — flip the default, hold on opt-out, capture the opener (2026-09-23)

## What changed

- `apps/extension/src/components/Popup/Popup.vue`: `closeOnEscape` defaults to `true`; `false` now passes `escapeDeactivates: false` (the trap holds instead of releasing); `activate()` reads `document.activeElement` before its `await nextTick()` and hands it to the trap as `setReturnFocus`. `null` is mapped to `undefined`: focus-trap throws on a `setReturnFocus` that is set but not a node, and `undefined` falls back to its own record.
- `Popup.test.ts`: the fake trap now records `focusedAtCreate`. Three Escape/return cases: default swallows + emits + keeps the trap; `closeOnEscape: false` → `escapeDeactivates === false`, nothing emitted; the return target is the element focused when `show` flipped even though a `nextTick` continuation queued before the popup's own tick focused a child first (the fake trap saw the child focused at creation, `setReturnFocus` still names the opener).
- `SendReviewSheet.vue` drops `close-on-escape`; its test drops the `data-escape` assertion. The send page tests are untouched (their stubs still declare the prop; the "backdrop / Escape" case emits `onClose` on the stub and stays meaningful).

## Gate

| Command | Result |
|---|---|
| `bun run --cwd apps/extension lint` | exit 0 (17 pre-existing warnings, 0 errors) |
| `bun run --cwd apps/extension typecheck` | exit 0 |
| `bun run --cwd apps/extension test src/components/Popup src/popup/components/modules/send src/popup/pages/send.test.ts src/popup/pages/send.integration.test.ts` | 15 files, 311 tests passed, exit 0 |

## Notes

- The ordering the return-target test pins is Vue's: post-flush watchers run inside `flushJobs`, `nextTick` continuations after it in registration order. Registering the child's focus with `nextTick(cb)` right after `setProps` (before awaiting it) puts it ahead of the popup's own continuation, which is the shape `usePopupEntity`'s `onShow` produces in the app.
- No retries, no failures on this phase.
