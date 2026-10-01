# Phase 4 · Deletion removes profile-keyed UI keys (A4)

## Red, on the unfixed code (`b172f0ca`, identical to `624117cd` for these files)

`bun --bun vitest run src/wallet/services/profile-deletion/coordinator.test.ts
src/composables/usePinnedTokens.test.ts` from `apps/extension`, the coordinator test importing
`pinnedTokensKey` from its old home so it loads: exit 1, 4 failed, 27 passed.

- The 13-step order: the received list had no `uiKeys` between `networks` and `pxe`.
- `runFor("p1")` over storage seeded with `p1`'s and `p10`'s keys: both keys stayed.
- A throwing `remove`: the purge resolved.
- The pin parked in `knownContracts`, the marker raised, the write waiting at the barrier (the
  facade's listener joined the composable's, 2 listeners), then the scope switched to `p2` and
  the marker cleared: `"pinned"`, not `"stale"`.

The positive control (scope unchanged, the pin lands) and the pin (a deletion cleanup after the
purge writes nothing) passed, as they must.

## Green

- `utils/profile-ui-keys.ts` holds the prefix list, `pinnedTokensKey` and `profileUiKeys`;
  `popup/constants/storage-keys.ts` keeps only `UI_STORAGE_KEYS`.
- The move forced one import outside the file map: `popup/pages/tokens/[id].test.ts`.
- The coordinator removes `profileUiKeys(profileId)` after the networks and before the PXE;
  `runtime.ts` passes `browserApi.storage.local`. No other site builds the coordinator.
- `writeMap` resolves whether the write landed; `pinOp` returns `"stale"` when its `unless`
  (`() => !ctx.live()`) skipped the write. The deletion cleanup passes none.
- The scan test's fixtures carry `${` in plain strings, so the file opens with a file-wide
  `noTemplateCurlyInString` ignore, as `log-payload-ban.test.ts` does. Lint stays at 29 warnings.
- Both halves of the scan test fail on a probe and pass again once it is gone:
  - A temporary file outside the module, holding the old template builder and a `+` builder:
    both lines listed.
  - An unregistered `recentKey` appended to the module: `expected [] to have a length of 1`.
- `bun run build` regenerated `auto-imports.d.ts` and `.eslintrc-auto-import.json` with the three
  exports.

## The gate

- `bun --bun vitest run src/wallet/services/profile-deletion/ src/composables/usePinnedTokens.test.ts
  src/utils/profile-ui-keys.scan.test.ts src/utils/storage-facade-ban.test.ts
  src/wallet/services/profile/service.integration.test.ts` from `apps/extension`: exit 0,
  5 files, 183 passed.
- `bun run lint` exit 0 (29 warnings, 3 infos; complexity baseline OK).
- `bun run typecheck:all` exit 0.
- `bun run test:all` exit 0. The extension had 7843 passed, 4 skipped and 8 todo; every other
  workspace was green.
