# Phase 3 · Glossary page, Settings row, rule-6 texts, CLAUDE.md, the smoke spec

Round-5 picks re-read 2026-09-25 before the phase: still 22 documents, no `tipsb` or `tipsc`, so
U8 and U9 are built as drawn and stay **sign-off pending**.

Built:

- `popup/pages/settings/glossary.vue` + `glossary.test.ts` (11): the shell's title and back
  target, the four sections in order with their entries in order, and each of the nine entries'
  term, definition and where-line as the spec writes them. Section testids take the title
  lower-cased: `glossary-section-balances`, `-fees`, `-apps`, `-transactions`.
- `settings/index.vue`: the Glossary row between Proving and Advanced.
- `SubPageHeaderBase.vue`: `data-testid="subpage-back"`; its click test now selects by it.
- `DappIdentityBlock.vue` (U8): the warning line after the host row, the logo `start`-aligned
  beside it and `center`ed otherwise, the Tooltip gone, the header comment down to the
  sanitization invariant without its tag, the prop doc rewritten. Tests: the visible line (text,
  icon first, `aria-hidden` icon, no tooltip) for `xn--tls-seda.nulo.sh`; a safe host renders no
  line and no icon; the alignment follows the state.
- `ImportSecretForm.vue` (U9): the note span between label and input, the ⓘ gone, `.section`
  declaring its four values with `gap: 8px` and one comment on why, the header's narration and
  the `.hint_row` comment gone. Test: the note's text, its place (label, note, input) and no
  tooltip or info icon.
- `AccountSelectRow.vue` (U-6): `position="center"`, with a test on the ⓘ's tooltip.
- CLAUDE.md: `## Tooltips and the glossary` after the sign-off section, the four bullets of
  `09-claude-md-rule` word for word minus "proposed:".
- `pressEscape`: a `window` capture reader that reads `defaultPrevented` in a `setTimeout(0)`;
  the doc comment's second sentence replaced.
- `tests/e2e/tooltips-glossary.test.ts`, the three tests the plan lists.

Decisions the plan left open (for codex):

1. **`DappIdentityBlock` keeps the host row's `Flex`**, now with one child. The plan says "the
   host row is followed by", and dropping the row changes long hosts: as a column item the span's
   ellipsis would start working, where in the row its `min-width: auto` lets it overflow today.
   That is a visible change nothing draws.
2. **`ImportSecretForm` drops the label's `Flex` row**, whose only other child was the ⓘ. The
   label alone lays out the same (its line box is taller than the 11px icon was), and it matches
   the New Password section's bare label.
3. **The `.section` reason comment sits inside the rule**, under the existing "no section-level
   border-bottom" comment, which is still true and stays.
4. **`ImportSecretForm`'s header keeps its second paragraph** (why inputs run label-less, why
   hints use the `#bottom` rail): that is reason, not narration.
5. **No component test for the Settings row**: `settings/index.vue` has no test file; the smoke
   spec reaches the row through `setting-nav-glossary`.
6. **The lock test uses `registeredExtensionPerTest`**: it locks the wallet, so a retry or any
   later test in the file would start on the lock screen.
7. **Negative waits are bounded polls, not sleeps**: `holds(page, present, 400)` fails as soon
   as the bubble's presence flips and passes only if it holds for 400ms, which covers the 150ms
   close grace and the 300ms open delay.
8. **The click recorder stops the click at `window` capture** (`stopImmediatePropagation` +
   `preventDefault`), so the bubble's own `@click.stop` never runs; the assertion is the target,
   and `mousedown` passes untouched.
9. **The Tab walk stops at the private term** (at most 15 presses) instead of a fixed 30: see
   failed attempt 2.
10. **Cherry-picked `dfef5f06` onto this base** (as `282300b6`, with `-x`): batch 2's fix loop
    committed it after this worktree's frozen base; without it no smoke file loads (failed
    attempt 1). It is batch 2's commit, identical in content: **drop it when this arc's commits
    move onto the stack.**
11. **`ae080720` regenerates the auto-import declarations** that phases 1 and 2 left stale
    (`glossary.ts`'s exports, `DottedTerm`): the first build of the batch rewrote them. A fix
    commit of its own.
12. **CLAUDE.md**: the `update-docs` skill's propose-and-confirm step is the approved plan's
    exact text. `git diff origin/dev -- CLAUDE.md` shows dev ahead of the stack's base in other
    sections (the npm publish bullet, the Workers Builds lines); nothing touches this section's
    neighbourhood, so it will merge line-clean.

Failed attempts:

1. Chrome smoke, first run: the suite failed at import, `PLAYGROUND_TEST_URL.endsWith` on
   `undefined` (`fixtures/playground.ts:26`). Batch 2's placement spec had made the test page a
   module-level constant, and the smoke setup provides no `playgroundUrl`, so every smoke file
   broke. Fixed by decision 10.
2. Firefox, `settledBubble` timed out after `page.focus(TERM)`. A throwaway probe showed the term
   focused, no bubble, and `document.hasFocus() === false`: the 30-press walk went past the last
   stop (`BODY`) into the browser's own UI, and a scripted `focus()` on an unfocused document
   fires no focus events on Firefox. A second probe with the walk skipped: `hasFocus()` true
   from load, and focus opened the bubble. Fixed by decision 9.
3. Firefox, `Unknown key: "Space"`: Puppeteer's BiDi keyboard has no key named `Space`. `" "`
   works on both protocols (`USKeyboardLayout` maps it to code `Space`).

Failing first:

- `DappIdentityBlock.test.ts` against the pre-change `.vue` (swap script): the visible-line and
  alignment tests red; the safe-host test passes there too, since the old block also rendered no
  icon for a safe host.
- `ImportSecretForm.test.ts` against the pre-change `.vue`: the note test red.
- `AccountSelectRow.vue` mutated back to `position="start"`: the new test red.
- `pressEscape` swapped back to the old helper, tooltip test on Chrome, retry 0: red at
  `tooltips-glossary.test.ts:200`, the `pressEscape` call (`Waiting failed: 5000ms exceeded`):
  the tooltip's capture-phase `stopPropagation` starves a bubble-phase reader (Fact 11).
- `glossary.vue` and the smoke spec are new; the spec against a pre-phase-1 build was not run
  (a rebuild of the old tree, not cheap).

Observed:

- Smoke gas card: `gas-skeleton-*` at load, then `0 FJ` on both balances, by 5s on Firefox and
  between 5 and 15s on Chrome (throwaway probe). The spec touches only the labels and the bubble.
- Under the bubble's centre with it closed: a `DIV` with no testid on either browser.
- Tall bubble (U-5): 42.78px on Chrome, 42.80px on Firefox; the viewport set to 47px and
  `innerHeight` read back 47 on both, so both honour a window at least that short (lower not
  probed). The bubble's top sits at 8 and its bottom past 47.
- `settleClosedPopup` reports "forced" whenever the popup is still in the DOM once its leave
  class shows, which is the normal state right after Escape; `popup-stack.test.ts` logs the same
  line. Not a stuck transition.
- `<Tooltip>` source tags in the extension: 33 at the batch base, 34 now, as the plan counts.

Gate:

- `bun run lint` → exit 0 (29 warnings, 3 infos; none new).
- `bun run typecheck:all` → exit 0 (15 workspaces).
- `bun run test:all` → exit 0: extension 571 files passed, 3 skipped / 7208 tests passed,
  4 skipped, 7 todo; design 40 files / 370 tests; every other workspace unchanged.
- Chrome, smoke build: `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e
  tests/e2e/tooltips-glossary.test.ts tests/e2e/passkey-backup.test.ts` → exit 0, 2 files,
  6 tests passed, no retries.
- Firefox, the same with `NULO_E2E_BROWSER=firefox` → exit 0, 2 files, 6 tests passed, no
  retries.
- `bun run e2e:reap` after each chain: nothing left to reap.
