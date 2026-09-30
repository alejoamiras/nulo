# Phase 8 · Whole-tree gate

At `59ab3104`, P7's last commit, before the codex loop. `origin/dev` is still `85c4d20f`.

## Static and unit gates

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 1,899 files; 28 warnings and 3 infos, none on a line this branch adds or changes (all 31 printed with `--max-diagnostics=500` and matched against the diff's new-side ranges); the complexity baseline OK |
| `bun run typecheck:all` | 0 | 15 workspaces, 29 s |
| `bun run test:all` | 0 | 153 s, itself, with no isolated rerun (per workspace below) |
| `bun run test:ci-gating` | 0 | 244 passed, 2 skipped, 0 failed, 17 files |
| `bun run build` | 0 | 27 s; `git status` clean afterwards, and again after both smoke builds, so no regenerated `src/types/*.d.ts` |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 3 findings, 0 enforced: the three report-only `path-token` findings F-1 names |
| `bun run lint:actions` | 0 | |

`test:all` per workspace, files then tests:

- `extension`: 605 passed and 3 skipped; 8,022 passed, 4 skipped, 8 `todo`.
- `aztec-runtime`: 34 passed and 1 skipped; 250 passed, 2 skipped.
- All passed: `wallet-bridge` 12 and 481, `design` 41 and 401, `wallet-core` 21 and 247,
  `extension-messaging` 13 and 239, `wallet-crypto` 16 and 120, `third-party-notices` 5 and 66,
  `legal` 3 and 54, `landing` 4 and 40, `resolve-asset` 1 and 14, `wallet-sdk-schema-patch` 2
  and 11.
- `passkey-rp` (`bun test`): 2 files; 5 passed, 6 skipped (its `RP_HOST_LIVE` suite).

The skips are P6's, every one an env-gated suite; no test file this branch changes holds a skip or
a `todo`.

## Smoke, sharded

Per the owner's instruction of 2026-09-29: one smoke build per browser, then three parallel shards
(`--shard=i/3`) at retry 0, against `dist/<browser>` and two copies whose paths prefix neither it
nor each other (`dist/smoke2` and `dist/smoke3`; `dist/ffsmoke2` and `dist/ffsmoke3`), each shard
with its own `EXTENSION_PATH`, the armed-build env and `NULO_E2E_MIGRATION_FIXTURE=1`. Chrome
first, then Firefox, never both at once; the copies are removed afterwards.

| Browser | Shard | Files | Tests | Passed | Skipped | Failed | Exit |
|---|---|---|---|---|---|---|---|
| Chrome | 1/3 | 14, 2 skipped | 52 | 50 | 2 | 0 | 0 |
| Chrome | 2/3 | 14, 1 skipped | 45 | 41 | 4 | 0 | 0 |
| Chrome | 3/3 | 13 | 67 | 66 | 1 | 0 | 0 |
| **Chrome** | **608 s** | **41** | **164** | **157** | **7** | **0** | |
| Firefox | 1/3 | 14, 1 skipped | 52 | 51 | 1 | 0 | 0 |
| Firefox | 2/3 | 14, 1 skipped | 45 | 41 | 4 | 0 | 0 |
| Firefox | 3/3 | 13 | 67 | 61 | 6 | 0 | 0 |
| **Firefox** | **701 s** | **41** | **164** | **153** | **11** | **0** | |

Every skip is gated in its own file, and this branch changes none of those files:

- Both browsers: `store-captures` (`STORE_CAPTURES`), `_probe-console-capture`'s three
  (`PROBE_ENABLED`), `appearance`'s "theme persists across navigation away and back" and
  `sw-resilience`'s "strict mode OFF" (both `test.skip`).
- Chrome only: `action-popup-layout`'s one test, which runs on Firefox only.
- Firefox only: `import-dead-rpc`'s four (CDP Fetch, which BiDi lacks) and `sw-resilience`'s "an
  open popup outlives the kill" (`skipIf(isFirefox)`).

The smoke files this branch changes (`legal-acceptance`, `import-stage-timing`,
`imported-account-lifecycle`) ran and passed on both. `bun run e2e:reap` after each browser: exit
0, nothing to reap. No shard showed a timeout, so the host's load needed no rerun.

## Diff inspection

`git diff origin/dev...HEAD -- apps/extension/src packages ':(exclude)*.test.ts' ':(exclude)*.fake.ts'`,
read hunk by hunk: 122 changed lines in 10 files, each inside a `//` comment or a `/** … */` block,
and no executable code, template, style, directive or config line. A scan that judges each removed
line in the old file and each added line in the new one agrees: none outside a comment.

| File | Removed (old lines) | Added (new lines) |
|---|---|---|
| `apps/extension/src/popup/components/modules/general/RecentActivityView.vue` | 51-54, 56-61, 94, 414-417, 457, 463-466 | 51-53, 55-58, 91, 411-413, 453, 459-461 |
| `apps/extension/src/popup/components/modules/general/recent-activity-handlers.ts` | 2-11 | 2-3 |
| `apps/extension/src/popup/components/modules/settings/connected-apps/connected-app-helpers.ts` | 8-10 | 8-9 |
| `apps/extension/src/popup/components/popups/PopupManager.vue` | 50-55, 83, 108, 123, 196-197, 208-209, 232, 235 | 50-54, 82, 107, 122, 195, 206, 229, 232 |
| `apps/extension/src/utils/journal-state.ts` | 130 | none |
| `apps/extension/src/wallet/services/backup/row-map-migration.ts` | 89 | 89 |
| `apps/extension/src/wallet/services/incoming-transfer/service.ts` | 324, 412, 910-914, 1515 | 324, 412, 910-913, 1514 |
| `apps/extension/src/wallet/services/operation-journal/spec.ts` | 96, 104-106, 110, 239-241 | 96, 104-105, 109, 238-239 |
| `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts` | 17, 39-40 | 17, 39-40 |
| `packages/aztec-runtime/src/pxe/service.ts` | 249, 490-491 | 249, 490 |

`git diff --stat origin/dev...HEAD -- apps/extension/src/components/composite/CollapsingHeroLayout.vue`:
empty.

## Record correction

`phase-6.md`'s `test:all` line left out `passkey-rp`'s six skipped tests (the same `RP_HOST_LIVE`
suite as here); it now names them.
