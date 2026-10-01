# Phase 2 — strip, sheet, `Popup.vue`

Date: 2026-09-21. Gate: `bun run --cwd apps/extension test src/components/composite/send src/components/Popup src/stores/popup.store.test.ts src/popup/components/modules/send/SendReviewSheet.test.ts` (plus the phase 1 files) → 12 files, 182 tests green · `bun run --cwd apps/extension build-storybook` → "Storybook build completed successfully", the six `composite-send-publishstrip--*` stories in `storybook-static/index.json` · `bun run lint` → 0 errors · `bun run --cwd apps/extension typecheck` → exit 0.

## The Storybook build was already broken on `dev` — two ways, neither ours

`bun run --cwd apps/extension build-storybook` is a phase gate, and CI never runs it, so nobody had seen it red:

1. `strip-artifact-debug-info` (from #646) is inherited from the app's Vite config and errors at `buildEnd` when a contract artifact never transforms — stories import no artifact. Dropped from the Storybook build in `.storybook/main.ts`, the same way the app's `unplugin-vue-components` instance already was.
2. `vite-plugin-node-polyfills/shims/buffer` failed to resolve from `packages/wallet-core/src/utils/serialization.ts` (reached through `Popup.vue` → `@/utils/core` → the service graph, so any popup story hits it). `viteFinal` replaces `resolve.alias` with `@`/`~` only and so drops the app's shim alias, which is what the isolated linker (#455) needs. Added the alias through `@nulo/resolve-asset` directly — `vite.shared.ts` cannot be imported from `main.ts`, because Storybook's Node loader rejects its attribute-less `./package.json` import (`ERR_IMPORT_ATTRIBUTE_MISSING`).

Both are config-only, inside the Storybook config file, no app behaviour touched.

## Deviations from plan.md

- **`Popup.vue` gained an `initialFocus` prop** (default `false` = today) alongside `closeOnEscape`. The sheet passes `#send-review-title`, so focus-trap itself focuses the heading on activation and records the opener as the element to return to. Doing the focus from the sheet would run before the trap activates (parent watchers fire first) and make the trap "return" focus to the heading instead of the opener.
- **The sheet keeps an always-mounted marker** `<div data-testid="send-review-sheet" data-open hidden>` beside the `Popup`: the dialog itself is inside the popup's `v-if`, and a leaving `<Transition>` keeps its old attributes, so an attribute on the dialog could never read "closed". e2e waits on the marker.
- **`SendReviewSheet` derives its rows in one computed** (`visibility`, `filled`, `word`, `sentence`, `remedy`, `noticeShape`) and the template only reads them.
- **`PopupHeader.vue` is now `lang="ts"` with `defineSlots`**: a TS consumer filling its `#title` slot did not typecheck (`Property 'title' does not exist on type '{}'`) — the sheet is the first TS SFC to do so. Its behaviour is unchanged.
- **`maskAddress` extracted** to `components/composite/send/masked-address.ts`; `RecipientCard` uses it, so the sheet's masked recipient is the same function, not a copy.
- **T5's "Enter / Space" case is not a test**: the strip is a native `<button type="button">`, so keyboard activation is the browser's, and adding `@keydown` handlers would double-fire. The component test asserts one native button; the keyboard e2e (T16e) drives it for real.
- **T7's "closed again during the pending tick" case is not a test**: with `await nextTick()` the activation continuation runs one microtask after the test's own `await`, so a test cannot close the popup inside that window without contrivance. The `!props.show` re-check stays (cheap); the reachable cases — unmount before the tick, re-show within the tick, unmount while active — are tested and kill M16.

## Harness notes

- A `Popup` mounted with `show: true` never activates its trap (the watcher is not `immediate`, as in production, where registry popups mount closed). Tests open it after mount.
- Vitest processes CSS modules with the stable strategy (`_name_hash`), so a test must compare against the imported module map (`mark.filled`), never a literal class name.
- A `Popup` stub's `closeOnEscape` must be declared `Boolean`, or the boolean-shorthand attribute arrives as `""`.
