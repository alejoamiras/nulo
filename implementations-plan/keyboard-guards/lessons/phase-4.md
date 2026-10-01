# Phase 4 · The owner's sign-off

Steps 1 and 2 (the pictures) are done. At step 3, on 2026-09-29, the owner picked K1 (a) and signed
off rows 1 to 7 (§ P4). (a) is what is built, so no phase was added and no gate was rerun for it.

## The K1 (b) capture-only commit

A `document` keydown listener in `full.vue` and `import.vue` ran the stage's action only for a
non-repeat Enter aimed at `document.body`. It was committed alone on a local branch on top of the
head, `f08bafed`. Its captures were taken, then the commit was dropped: the branch was deleted and
never pushed. The owner picked (a), so it is not rebuilt.

## The captures

- Every row of the capture list: Chrome, dark theme, the popup at 360x600, onboarding's tab at
  1280x800 and the execute window at its own 400x600.
- K1 (a) and rows 1 to 6 were retaken on the head's smoke build after the codex fixes.
- A throwaway spec sat in `tests/e2e/` for each capture run only and was deleted after it. Row 7
  used the network suite the same way. Neither is committed.

## Where the pictures differ from the plan

- **K1 (a)'s first Tab lands on "Protect with Password", not on the back arrow** the plan
  predicted (§ UI asks). The likely cause is that the browser resumes Tab from where the removed
  button sat (moderate confidence). This is observed on Chrome only.
- **Two focus rings do not show**, so their frames are annotated instead:
  - **Row 1's active Passkey tab.** Its `:focus-visible` outline is `--nulo-accent`, over a fill of
    the same colour.
  - **The back arrow in rows 3 and 4.** It is a bare `<button>` under the base stylesheet's
    `button { outline: none; }`.

  FU-3 carries the fix, and it is the owner's call.
- **Row 7's held Enter is a built capture, not a mock.** The browser sends a real press and a real
  repeat, and the script moves focus from the Fast priority button to Confirm between them.
  Confirm stayed idle and enabled; a fresh Enter then approved.

## Attempts

- **K1 (b)'s first "after Enter" frame** showed the encrypted stage, because encryption ended
  before the screenshot. It was retaken with a wait for "Encrypting" polled on mutations, and the
  screenshot taken straight after.
- **Row 7's fresh-Enter frame** targeted the execute window, which closes on approval. It now shows
  the wallet popup's in-progress card.
- **Rows 3 and 4's first back-arrow frames** claimed a focus ring the page does not draw. The line
  under "CHANGE PASSWORD" is the collapsing header label's own underline. Both frames were retaken
  with an annotation.
- **Row 6's first mock** had no password typed, so Create was disabled and the frame showed
  validation, not the refusal. It was retaken with a valid pair, so Create is enabled and the
  composing Enter is what does nothing.
