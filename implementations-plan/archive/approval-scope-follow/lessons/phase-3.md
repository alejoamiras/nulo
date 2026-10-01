# Phase 3 — the follow (2026-09-17)

- `utils/storage.ts`: `storageLocalSet(items, { unless })` returns `Promise<boolean>`; the predicate runs after `migrationIdle()`, before `chrome.storage.local.set`. Pinned in `storage.test.ts` with the mock's `deferNextGet()` (predicate flipped during the barrier → `false`, no write; plain call unchanged).
- `execute/scope-follow.ts` (new): `createScopeFollow(deps)` → `{ invalidate, capture, follow }`. The generation is the fence; `follow` never throws; both writes run inside `navigator.locks.request("nulo:scope-follow", …)`; network first, then the pointer via the guarded facade write with `unless: () => !stillOurs()`. The follow trusts the resolver for the hidden-account rule (no `visible` re-check).
- `execute/index.vue`: deps wired to `appStore.refreshInFlight` / `hasInFlightSend`, `requireNetwork().setActiveNetwork`, `storageLocalSet`; `capture()` before `approveInteraction`, `follow()` before `closeWindow(true)`; `invalidate` from the profile-change listener (wrapped around the shell's guard — the frozen oracle pins exactly one registration), a `flush: "sync"` watcher on `isLogined → false`, and unmount.
- Tests: `scope-follow.core.test.ts` (14 cases on the module with a fake serializing Web Lock: order under the lock; nothing/declined/stale capture; guard read after the refresh; in-flight skips both; same-row pointer only; no follow account → network only; network rejection skips the account; account rejection rolls nothing back; sync invalidate; abort during refresh / during network write; the REAL facade with the barrier suspended → no `set`; the same write lands when nothing changed; two follows → two whole pairs). `scope-follow.test.ts` gains 6 window cases (chain follow through the lock and the window closes, store untouched; account-only; declined/rejected/failed approval move nothing; a throwing follow keeps the approval successful and closes; a lock or a profile change during the approval call aborts).
- Mutations, each failing tests: `capture()` moved after the approval (2 window cases); the guard read before the refresh (the cold-tracker case).

## Gate

- `bun --bun vitest run src/popup/windows/execute src/utils/storage.test.ts` → 16 files, 151 tests passed.
- `bun run typecheck` → exit 0; biome clean.
