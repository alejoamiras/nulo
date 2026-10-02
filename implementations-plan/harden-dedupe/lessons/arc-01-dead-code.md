# Arc 1, dead-code: lessons log

## Build

- Q-26 deleted with its tests, stories and barrel lines: 8 `@nulo/design` components, `SettingValue`, `Divider`, `SelectFpcPopup`, five test-only utils, the dust alias, the dead `.cta` CSS on Change password and Reset, five byte-identical font copies, the ArtifactRegistry policy surface, the no-op profile subscription and `RpcRequest`. The activity-protocol coordinator stays (an owner yes/no on the alignment arc).
- One step past the brief, kept: `userMethodsOf` lost its only caller with `getCallCountLabel`, so it went too.
- `auto-imports.d.ts` kept 7 stale globals after the build, as `lessons.md` warns; removed by hand, and a second build left the tree clean.
- Local gates green: lint, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`, `build` with the notices output (all four font families still claimed), `build-storybook`.

## Codex loop

- Round 1 (GPT-6 Astra, xhigh): CONVERGED. No blocker or should-fix. Two comment nits in lines the arc touched, both fixed: the resolver pin's comment lost its milestone history, and the registry's cache comment now says the key is the class id alone.

## Screenshots

- Base 584057e9 against head 179777e5, Chrome 152 and Firefox 153, dark and light: Change password (empty, scrolled to the end, mismatch hint), Reset (top and end), Home after unlock. 24 of 24 identical. The follow-up commit changes comments only.

## Noted for the final report (out of scope, not changed)

- `ArtifactRegistry.verifiedClassIds` is keyed by class id alone, so once one artifact verifies for a class id, a later different artifact claimed for the same class id skips the recompute. Pre-existing; a security lead, not a dedup item.
