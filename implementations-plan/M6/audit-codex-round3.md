## What v2 got right
- A12 collision is real: `AUDIT.md:102` is the existing `A12` finding, so the rename to M6 is correct.
- The 4 native input refs are correct:
  - `packages/extension/src/popup/pages/auth.vue:179`
  - `packages/extension/src/popup/pages/send.vue:458`
  - `packages/extension/src/popup/components/modules/send/AmountCard.vue:79`
  - `packages/extension/src/popup/windows/capabilities/index.vue:452`
- `PopupCard.vue` is a real layer violation: `packages/extension/src/components/Popup/PopupCard.vue:3-5,16-18,27-36` imports `ConfigServiceClient`, subscribes to updates, fetches config on mount, and disconnects on unmount.
- The `22` CTA refs check out. They are concentrated in:
  - `import.vue:895,903,910,917,928,937,945,950`
  - `profile/new.vue:255`
  - `change-password.vue:204`
  - `export/full.vue:366,370,381,389`
  - `export/key.vue:326,330,337,356`
  - `export/seed.vue:263,267,274`
  - `reset.vue:147`
- The `Button.vue` custom `type` prop rename surface is real. `packages/extension/src/components/ui/Button.vue:13-16,58-60` defines `type`, and repo scan finds `64` `<Button ... type=...>` call sites.
- The 8 proposed L4→L3 files do have zero direct `@/stores` / `@/wallet/services` imports at their own top level. That correction is directionally right, but the “pure presentational” conclusion is too broad; see below.
- Lost Pixel can target built Histoire output directly. Histoire’s default output is `.histoire/dist`, and Lost Pixel has first-class `histoireShots.histoireUrl` support.

## v2 errors / new gaps
- `/tmp/nulo-M6-plan-v2.md:16,100,397-401` is wrong on popup pairs. The repo has 14 New/Edit popup files total, but only 6 actual pairs:
  - `NewAccountPopup` / `EditAccountPopup`
  - `NewContactPopup` / `EditContactPopup`
  - `NewEndpointPopup` / `EditEndpointPopup`
  - `NewFpcPopup` / `EditFpcPopup`
  - `NewNetworkPopup` / `EditNetworkPopup`
  - `NewTokenPopup/NewTokenPopup` / `EditTokenPopup`
  - Unpaired: `NewSenderPopup.vue`, `EditProfilePopup.vue`
  - Correct alternative: say “14 New/Edit popup files = 6 matched pairs + 2 unpaired”.
- `/tmp/nulo-M6-plan-v2.md:20,105-113,149-152,378-390` overstates the L3 promotion list.
  - `WarningView.vue:2-4,14-18` uses `useExternalLink()`, and `externalLinks.ts:15-17` pulls in Pinia stores while `configClient.ts:1-4` instantiates `ConfigServiceClient`.
  - `TransactionsList.vue:3,8,36-38` imports `TransactionCard.vue`, and `TransactionCard.vue:5-18` is explicitly store/service-bound.
  - Correct alternative: keep `WarningView` and `TransactionsList` in L4 unless they are refactored first.
- `/tmp/nulo-M6-plan-v2.md:277-293` is missing the story sandbox bootstrap that this repo needs.
  - Components rely on global CSS vars from `src/assets/styles/_base.scss:11-69` and popup shell styles from `src/popup/index.scss:1-19`.
  - The popup runtime also provides teleport targets in `src/popup/app.vue:291-295`.
  - Several primitives depend on those targets: `Tooltip.vue:180`, `DropdownRoot.vue:227`, `Popover.vue:82`, `ToastManager.vue:21`, `Popup.vue:52`.
  - Correct alternative: add `histoire.setup.ts` / Storybook preview setup that imports the global styles, installs Pinia/router as needed, and creates `#popup/#tooltip/#dropdown/#popover/#toast`.
- `/tmp/nulo-M6-plan-v2.md:335-339,408-410` has a hidden dependency backwards. `4b` cannot cleanly migrate all 4 raw inputs before `5e`.
  - `auth.vue:175-205` is a password field with inline visibility toggle.
  - `send.vue:455-506` is a recipient field with inline status adornments and suggestion popover.
  - Correct alternative: move those two sites into `5e`, or expand `Input.vue` first and then do `4b`.
- `/tmp/nulo-M6-plan-v2.md:54,347-352` misses 2 `components/ui` files despite the “every `components/ui/` SFC” goal:
  - `packages/extension/src/components/ui/ToastManager.vue`
  - `packages/extension/src/components/ui/Popup/PopupHeader.vue`
- `/tmp/nulo-M6-plan-v2.md:309-310` cites the wrong CSS-var sources. The live sources are `src/assets/styles/_base.scss` and `src/popup/index.scss`, not `src/styles/` / `src/popup/index.css`.
- `/tmp/nulo-M6-plan-v2.md:34,174,433-435` is inconsistent on naming: `useDappPayload` vs `useDappInteractionPayload`. Pick one.
- `/tmp/nulo-M6-plan-v2.md:55` is overstated. Eliminating CTA buttons does not mean “everything uses `<Button>`”; repo-wide there are still 55 raw `<button>` sites, many of them icon buttons, close buttons, chips, and popup controls.

## Should be added to v2 (priority H/M/L)
- `H` Add a concrete Phase 2 bootstrap task:
  - `histoire.setup.ts` or Storybook preview imports `src/assets/styles/_base.scss` and `src/popup/index.scss`
  - install Pinia; add router only for stories that need it
  - create teleport roots `popup/tooltip/dropdown/popover/toast`
- `H` Add the exact Lost Pixel mode/config:
  - `histoireShots.histoireUrl: './.histoire/dist'`
  - explicit `imagePathBaseline`
  - explicit `threshold`
- `H` Either schedule the remaining 5 popup-pair `EntityForm` migrations inside M6, or explicitly descoped them. As written, `5c` only migrates Contact.
- `M` Revise the L3 promotion list:
  - drop or refactor `TransactionsList`
  - drop or refactor `WarningView`
- `M` Add `ToastManager` and `PopupHeader` to Phase 4d so the stated `components/ui` coverage goal is actually reachable.
- `M` Add a story/test note for runtime mocks:
  - Vitest already stubs `chrome.runtime` in `tests/vitest.setup.ts:88-113`
  - Histoire does not, so service-bound stories need mocks or should stay out of Phase 2 scope
- `L` Add to `STATUS.md`:
  - dirty files / intended write scope
  - failing command + last error signature
  - baseline path / baseline commit

## Should be removed from v2
- `/tmp/nulo-M6-plan-v2.md:250-254` should not make `vitest.components.config.ts` mandatory. `packages/extension/vitest.config.ts:40-65` already runs `src/**/*.test.ts` in `jsdom`; a separate config is optional, not required.
- `/tmp/nulo-M6-plan-v2.md:390` should remove “Auto-import handles new paths transparently.” Existing callers use explicit imports, e.g. `send.vue:11-14` and `execute/index.vue:3-4`, so path rewrites are still required.

## Re-ordering suggestions
- Move `5e InputWithButton` before or into `4b Input unification`.
- In `4d`, move `Dropdown*` into the overlay batch with `Popover`/`Tooltip`, and move `LoadingState` into the layout batch. That matches the actual dependency clusters better.
- `7g` can move earlier, immediately after `5d`, because it directly consumes `SecretRevealCard`.
- `7l discover` can run alongside `7a/7b` once `6c` lands.
- `7j LogsViewer` is independent of the Phase 6 composables and can be pulled earlier if scheduling pressure appears.
- Do not move Phase 3 ahead of Phase 1. The meaningful sequencing fix is `5e` before `4b`, not tokens before test infra.

## Open questions answered
1. The v2 correction set is only partially correct. The `A12` rename, 4 raw inputs, 22 CTA refs, 64 `Button type=` callers, and `PopupCard` violation are correct. The popup-pair count and the “8 pure presentational modules” conclusion are not.
2. The big misses both earlier audits still left behind are:
   - Phase 2 lacks the runtime bootstrap Histoire/Storybook needs in this repo.
   - Phase 5 does not actually schedule the full `EntityForm` rollout it claims to motivate.
   - Phase 4d omits `ToastManager` and `PopupHeader`.
   - Tooling refs checked: Histoire config/setup/outDir, Lost Pixel Histoire mode, Pinia testing, Vitest projects/environment, Storybook Vue3-Vite, Vue CSS Modules, unplugin-vue-components:
     - https://histoire.dev/reference/config
     - https://histoire.dev/guide/config.html
     - https://docs.lost-pixel.com/user-docs/setup/project-configuration/modes
     - https://docs.lost-pixel.com/user-docs/api-reference/lost-pixel.config.js-or-ts
     - https://pinia.vuejs.org/cookbook/testing.html
     - https://vitest.dev/config/
     - https://vitest.dev/guide/projects.html
     - https://storybook.js.org/docs/get-started/frameworks/vue3-vite
     - https://vuejs.org/api/sfc-css-features
     - https://www.npmjs.com/package/unplugin-vue-components
3. Risks not in the register:
   - Bun: Vitest officially supports Bun, but warns to use `bun run test`, not `bun test`; this repo already does that. Histoire and Lost Pixel docs I checked do not document Bun-specific guidance, so treat that as an undocumented-tooling risk, not a confirmed blocker.
   - Service-worker context: real risk for stories/tests that transitively instantiate clients or stores; mitigated in Vitest by existing chrome stubs, not mitigated in Histoire yet.
   - CSS-module collisions: not a real risk. Vue CSS Modules are hashed.
   - Tree-shaking: not a real risk. `unplugin-vue-components` is on-demand/tree-shakable; unused composites do not inflate the bundle by directory presence alone.
4. `45-65h` is low. With the current number of sub-PRs and per-sub-PR story/test/visual/e2e gates, the realistic range is `60-85h`. If all remaining popup-pair migrations stay in-scope, it is closer to `70-95h`.
5. `STATUS.md` is a good base, but not enough for a cold-start agent. Add worktree scope, last failing command/error, and baseline reference.
6. The stop rule is under-calibrated:
   - `unit/component test failure` should retry once, then halt the sub-PR if it reproduces.
   - `visual regression > tolerance` needs an explicit threshold. Use `0` globally, and only allow per-story masks/threshold overrides when a specific flaky region is documented.
7. Phase ordering: the important moves are `5e` before `4b`, `Dropdown` into the overlay batch, and allowing `7g/7j/7l` earlier where their dependencies are already satisfied. Phase 3 does not need to move ahead of Phase 1.

## Final verdict
- Greenlight v2 as-is for execution? `N`

- Top 3 must-fix items before approval:
  1. Fix the popup-pair inventory and either schedule or explicitly descoped the remaining 5 non-Contact `EntityForm` migrations.
  2. Add the missing Phase 2 runtime/bootstrap work and the exact Lost Pixel Histoire config.
  3. Fix the invalid L3 promotion assumptions (`TransactionsList`, `WarningView`) and reorder `5e` before `4b`.

After those are fixed, the plan is execution-worthy.
