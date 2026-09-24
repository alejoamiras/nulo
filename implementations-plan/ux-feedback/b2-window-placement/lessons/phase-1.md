# Phase 1 · Placement maths and the window manager

Built:

- `apps/extension/src/wallet/services/window-manager/window-manager.ts`: `topRightOf`, `createPlaced`,
  the required `placement` on `OpenAndAwaitOpts`, a private `createWindow` (center: plain `create`;
  top-right: `createPlaced` with `stillWanted = () => this.handles.get(handleId) === handle`); the
  final `.catch` is identity-fenced, logs `[kind/handleId] window could not be opened` and settles
  "Failed to open window."; both stray-window `remove` calls catch.
- Callers: `dapp-interaction/service.ts` passes `"top-right"`, `passkey/service.ts` `"center"`.
- `apps/extension/src/core/adapters/chrome-browser-api.ts`: a normal answer returns its bounds and
  records itself; any other answer awaits a snapshot of the pending focus lookups, then re-reads
  `lastNormal` with `windows.get`. The focus tracker is added by the first `getLastFocused()` and
  only when `chrome.runtime.getBrowserInfo` is a function; observations carry a start `seq`.
- Tests: `window-manager.test.ts` (+16: `topRightOf` ×4, `createPlaced` ×5, the placement and fence
  cases ×7; the existing centering case now passes `placement: "center"`), `passkey/service.test.ts` (+1),
  `dapp-interaction/service.test.ts` (+3, one per kind), `chrome-browser-api.test.ts` (+8; `stubWindows`
  gains `get`, `onFocusChanged`, `WINDOW_ID_NONE` and a `firefox` toggle for `getBrowserInfo`).

Decisions inside the plan:

- `completeBounds` is shared by `centerOn` and `topRightOf`; `centerOn`'s behaviour is unchanged.
- The recovered-refusal `debug` line is logged after the retried create succeeds ("window position
  refused; opened with the size only"); a failed retry logs nothing there, the caller's constant
  line covers it.
- The window manager's constant failure line keeps the `[kind/handleId]` prefix every other line
  of that logger carries: neither value is the request id, the URL or the hash.
- `trackFocusOnFirefox()` runs inside `getLastFocused`'s `try`, so a missing `onFocusChanged` could
  not break the never-throws contract.
- The dApp consumer test calls the private `interaction()` once per kind: execute and capabilities
  need the whole service graph to reach it, and all three share that call site.

Deviations: none.

Traps:

- A `vi.fn` / `vi.spyOn` observes the promises it returns (`mock.settledResults`), which handles a
  rejection: `mockRejectedValue` on `remove` could not tell `void remove()` from
  `remove().catch()`. The swallow test replaces `browser.windows.remove` with a plain function; with
  the old `void` the run then reports an unhandled rejection and exits 1 (probed).
- `vi.fn(impl as never)` types the mock as `never`, so `mockImplementationOnce` does not typecheck;
  the adapter stubs are `vi.fn<Stub>()`.
- Mutation probes, each reverted from a scratch copy: dropping the `.catch` identity fence, the
  `seq` guard, the pending-lookup wait, the `getBrowserInfo` check or the once-only guard each red
  their named test.
- Root `bun run typecheck` cannot find `vue-tsc` in this worktree; `typecheck:all` (the gate) runs
  it per workspace.

Gate:

- `bun run lint` → exit 0 (30 warnings, 5 infos, none in changed files).
- `bun run typecheck:all` → exit 0 (16 workspaces).
- `bun run test:all` → exit 0; extension 562 files / 7151 passed, 4 skipped, 7 todo; every other
  workspace green.
