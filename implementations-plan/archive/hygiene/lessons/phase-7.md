# Phase 7 · C6 to C10 · docs and skills

## What changed

- D1 and D4 (`CLAUDE.md`), D2 (`README.md`), D6 (the chrome-extension-debug skill) and D8
  (`apps/extension/tests/e2e/FIREFOX.md`, four rows) as the plan writes them, with the corrections
  below. D3: the root `typecheck` script runs the extension's own (`bun run --cwd apps/extension
  typecheck`). D5 and D7: the e2e-testing skill's "Reproduce like CI" block runs from the repo root,
  and § 2 gains the two helper notes and the subsection "Harness behaviours that look like product
  bugs". D9: `implementations-plan/follow-ups.md` (below); `lessons.md`'s timing-budget line
  already names `presto/client` beside `content-message-relay` (P1).

## The claims, checked at build time

Every D7 and D8 claim was re-read against the tree and its record before it was written (a
read-only pass, 2026-09-29). `src/` is `apps/extension/src/`, `e2e/` is `apps/extension/tests/e2e/`,
`pptr` is puppeteer-core 25.8.0's `lib/puppeteer/`, and record paths are under
`implementations-plan/`. None was dropped. Four D7 and D8 claims were corrected, and two smaller
edits sit beside them (D6's citation, the `settleClosedPopup` note's opening), all listed below.

| Claim | Verdict | Tree | Record |
|---|---|---|---|
| D7 · `clickByTestId` cannot click an SVG `<Icon>` | holds | `e2e/fixtures/extension.ts:1431`, `:1450` (`target.click()`, the same in `clickSelector` at `:1412`); `packages/design/src/core/Icon.vue:57` (root `<svg>`); `pptr/common/WaitTask.js:96-101`, `pptr/injected/Poller.js:65-85` (a throwing predicate never settles, so the wait runs to its timeout) | `ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-2.md:93-97` |
| D7 · `settleClosedPopup`'s `true` is the normal mid-leave state | holds | `e2e/fixtures/popup-leave.ts:15-24`, `:25-31` | `ux-feedback/b3-tooltips-glossary/lessons/phase-3.md:102-104` |
| D7 · Chrome's created windows keep the launch size; focus moves only on create | holds | `e2e/fixtures/browser/chrome.ts:28`, `:39-40`; `e2e/fixtures/extension.ts:70-83`; `e2e/network/window-placement.test.ts:46`; `e2e/fixtures/browser/index.ts:189` | `ux-feedback/b2-window-placement/lessons/phase-3.md:21-52`, `:131-133` (Chrome 152.0.7977.42, Firefox 153.0.4) |
| D7 · an approval window's page can have no viewport | holds, re-cited | `e2e/fixtures/popups.ts:53`; `pptr/cdp/Target.js:54-70` (`asPage`; the `null` viewport at `:66`, an existing page returned at `:55-60`), `:209-218` (`page()`, the default viewport); `pptr/common/util.js:17` (800×600) | `ux-feedback/b2-window-placement/lessons/phase-3.md:71-77`, `:176-177` |
| D7 · `protocolTimeout` is set in two places | holds | `e2e/fixtures/browser/chrome.ts:59`, `e2e/fixtures/browser/bidi-attach.ts:30` (the suite's only two); the 180 s default at `pptr/cdp/Connection.js:45`, `pptr/bidi/Connection.js:29`; `sendTransfer`'s wait at `e2e/fixtures/helpers.ts:1180` (300 s prover-ON, 60 s proverless) | `ux-feedback/b1-first-run-wording/lessons/phase-5.md:62-70` |
| D7 · `inject(key)` returns `undefined` for an unprovided key | holds | vitest 4.1.10 `dist/chunks/test.DNmyFkvJ.js:4164-4166`; `e2e/global-setup-smoke.ts:48` (provides `extensionPath` only); `e2e/global-setup.ts:299`, `:306`; `e2e/fixtures/playground.ts:17-29` | `ux-feedback/b2-window-placement/lessons/phase-4.md:7`; `ux-feedback/b3-tooltips-glossary/lessons/phase-3.md:69-72` |
| D7 · a resting pointer hovers what opens under it (Chrome) | holds, record only | `packages/design/src/ui/ToastManagerBase.vue:109`; `e2e/snackbar.test.ts:275-287`, `:369-407` | `ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-6.md:204-207` |
| D7 · a page a failed test left open keeps its subscriptions | holds | `e2e/network/incoming-arrival.test.ts:92` (in `closeAtEnd`, `:89-94`) | `ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-4.md:155-158` |
| D7 · a hash change right after the popup opens can lose to its start-up route | holds | `e2e/network/authwit-variants.test.ts:126-128`; `e2e/tooltips-glossary.test.ts:111`; `e2e/fixtures/helpers.ts:507`, `:1033` | `ux-feedback/b5-permissions/lessons/phase-4.md:86-89`; `ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-4.md:98-100`, `:159-161` |
| D8 · no media-feature emulation | holds, sharpened | `pptr/bidi/Page.js:156` (a CDP `EmulationManager`), `:357-365`; `pptr/bidi/CDPSession.js:48-51` (`send` throws `UnsupportedOperation` with no CDP connection); guards `e2e/network/cap-window.test.ts:201-202`, `e2e/network/incoming-arrival.test.ts` (`if (!isFirefox)`) | `ux-feedback/b3-tooltips-glossary/lessons/phase-4.md:155-156`; `ux-feedback/b5-permissions/lessons/phase-9.md:35-36` |
| D8 · a Tab walk past the last stop leaves the document | holds | `e2e/tooltips-glossary.test.ts:133-136`; `e2e/helpers/pointer-probes.ts:57-64` | `ux-feedback/b3-tooltips-glossary/lessons/phase-3.md:53-54`, `:73-77` |
| D8 · an overflowing scroll area is a Tab stop | holds, narrowed | `e2e/network/cap-window.test.ts:131-144`, `:179-180`; `src/popup/windows/capabilities/index.vue:4` (`fillsWindow`) | `ux-feedback/b5-permissions/lessons/phase-9.md:63-70`, `:155-162` |
| D8 · `windows.getLastFocused` ignores `windowTypes` | holds, re-cited | `src/core/adapters/chrome-browser-api.ts:200-219`, `:221-245`; `src/core/adapters/chrome-browser-api.test.ts:60` | `ux-feedback/b2-window-placement/lessons/phase-3.md:43-50` (Firefox 153.0.4; Chrome 152.0.7977.42 honours the filter) |
| D6 · an open Tooltip stops Escape at `window` capture | holds, re-cited | `e2e/helpers/pointer-probes.ts:72-91` (`pressEscape`); `packages/design/src/ui/Tooltip.vue:132-139` (the handler), `:160` (added only while open, `:158-163`) | `ux-feedback/b3-tooltips-glossary/lessons/phase-3.md:26-27`, `:88-90` |
| D1 · the pre-commit hook does not typecheck | holds | `.githooks/pre-commit:3-5` (Biome on staged files, the local-path guard, the complexity baseline); `package.json:28` | code only |
| D3 · the root `typecheck` exits 127 | holds | `package.json:27`; the root `node_modules/.bin` holds only `biome` and `commitlint`; `apps/extension/package.json:23` (`vue-tsc --noEmit`) | code only |
| D4 · the global `chrome` stub has no storage | holds | `apps/extension/tests/vitest.setup.ts:50-77` (`storage: {}` at `:53`, ports at `:55`, listeners at `:63-65`); 22 `src/**` tests stub `chrome` themselves | code only |
| D5 · `e2e:agent` is a root script | holds | `package.json:20` (the only `e2e:agent`); the skill's block at `:532-537`; `agent.sh:14` | `ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-4.md:144-146` |

Corrections against the plan's text:

- **D8, media emulation**: the call does not silently do nothing; `emulateMediaFeatures` (and
  `emulateMediaType`) throws `UnsupportedOperation`. The row's symptom says so.
- **D8, the scroll area**: the plan's "`cap-window.test.ts` at 360px" case is history, from before
  the capabilities window filled its window (`fillsWindow`); the tree no longer supports it, so the
  row keeps only today's case, a re-request's five badged rows (a scroll height of 717 against
  690).
- **D8, `getLastFocused`**: cited `:200-245` (the lookup and the Firefox focus tracker), not
  `:200-222`; the row carries the recorded browser versions. Rows 1 to 3's records name no Firefox
  version, so those rows state none.
- **D6**: cited `Tooltip.vue:132-139` for the handler and `:160` for where it is added, not
  `:132-138`.
- **D7, `asPage`**: cited `cdp/Target.js:54-70`, the whole function, not `:54-69`.
- **D7, `settleClosedPopup`**: the note names the helper (`` `settleClosedPopup`'s `true` ``) rather
  than opening on "Its", since it follows a sentence whose last subject is `closeStuckPopup`.

## D9 · the curated layer

`implementations-plan/follow-ups.md`, 19,192 bytes at `85c4d20f`, is 17,121 after it:

- § ux-feedback: technical loses the twelve entries this PR resolves: `presto/client`'s cold
  import (P1), the derivation-parity script (P5), `legal-acceptance`'s mouse park (P4), the
  workflow-history comments (P6), the typecheck gate row and the `chrome` stub (D1, D3, D4), the
  "Reproduce like CI" block (D5), the chrome-extension-debug line (D6), the harness and Firefox
  findings (D7, D8), the three-file retry entry (P2) and the incoming-arrival entry (P3).
- It gains F-1, F-2, F-4 and F-6 at its end. F-1 also names the three comments the plans gate
  reports as linking plan files no longer in the tree (below), all in files this branch does not
  touch.
- F-3 goes under "ux-feedback: taken by a follow-up plan", for `layout-polish`.
- The vitest entry's recheck names the file-scoped `extraTokens` fixture
  (`apps/extension/tests/e2e/fixtures/extra-tokens.ts`), which replaced `send-picker`'s own.

`lessons.md` keeps P1's edit to the timing-budget line (7,065 bytes at `85c4d20f`, 7,134 now);
the gotchas this plan found go in at its close.

## Gate

- The root `typecheck` script's old body, run the way `bun run` runs a script (the root
  `node_modules/.bin` first on `PATH`): `vue-tsc: command not found`, exit 127. With D3,
  `bun run typecheck` exits 0 (`bun run --cwd apps/extension typecheck`, then `vue-tsc --noEmit`).
- `bun run typecheck:all`: exit 0, all 15 workspaces.
- The Chrome smoke build: exit 0. Then D5's first line from the repo root,
  `taskset -c 0,1 bun run --cwd apps/extension test:e2e --retry=0 tests/e2e/legal-acceptance.test.ts`:
  exit 0 in 234 s, 1 file, 13 passed, 0 skipped, 0 failed. `bun run e2e:reap`: exit 0.
- `bun scripts/ci-cd/plans/check.ts`: exit 0, 3 findings, 0 enforced. All three are report-only
  `path-token` findings, comments that link plan files no longer in the tree
  (`apps/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts:64`,
  `apps/extension/vitest.e2e.network.config.ts:40`, `scripts/ci-cd/prune-stale-branches.sh:6`);
  the branch's diff over those three files is empty.
- `bun run lint`: exit 0 (1,899 files, 28 warnings, 3 infos, the complexity baseline OK).
- `wc -c implementations-plan/lessons.md`: 7,134 (at most 8,192).
- Reconciled against trunk right before the commit: `origin/dev` is still `85c4d20f`, this
  branch's base, so the three shared files took nothing from another branch meanwhile.
