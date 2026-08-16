# `packages/design` (`@nulo/design`) — quality scan (duplication focus)

Scanner: Claude (independent pass — repo map used as a guide, not the finding list). Cluster scope
per the map: `packages/design/src` production files. `tokens.ts`/`utilities.css` (generated) and
`*.stories.*` excluded from findings; `*.test.ts` read as evidence only.

---

## Finding 1: The design system's own signature typography (uppercase brutalist micro-label) is hand-rolled independently in 12 files, 15 times, with drifting values

**Smell**: Duplicate Code (Dispensables) — the same 3–5-declaration CSS clump (`font-family` +
`font-weight` + `font-size` + `letter-spacing` + `text-transform: uppercase`) is authored from
scratch at every call site instead of being expressed once. Secondarily a **Shotgun Surgery** risk:
changing the brutalist-label look (a real, plausible design change — this repo already ran one
light-theme repair pass touching this package, `c3db255c`) requires editing all 12 files in lockstep,
none of which import from a shared source for this concern.

**Impact bucket**: structural. Blast radius: 12 files across `ui/` and `composite/`, which are then
re-exported through `index.ts` and consumed by 42 files in `apps/extension` + `apps/faucet` (per the
repo map §3) — so a visual-language change ripples indirectly into every consumer of `Badge`-adjacent
brutalist chrome. Change frequency: **low so far** (`git log` shows single-digit commits touching
these 12 files combined since the package was externalized in round-1/round-2 — `4d245bbb`,
`7ddf2196`, `472ee2a3`, `c3db255c`), but the package is young (externalized ~mid-2026) and its whole
purpose is to be the *shared* place for exactly this kind of styling — the risk grows with the
package's remaining lifetime, not its history.

**Evidence** — all 15 instances, each independently declaring the uppercase-micro-label clump:

1. `packages/design/src/ui/SectionLabel.vue:27-31` — `.wrapper`: font-headline, 12px, 700, 0.1em, uppercase
2. `packages/design/src/ui/LoadingState.vue:33-37` — `.label`: font-headline, 14px, 700, 0.1em, uppercase
3. `packages/design/src/ui/Tag.vue:20-23` — `.tag`: font-mono, 11px, (no explicit weight), 0.08em, uppercase
4. `packages/design/src/ui/Button.vue:229-231` — `.primary`: font-headline, 700, uppercase
5. `packages/design/src/ui/Button.vue:248-250` — `.primary_outline`: font-headline, 700, uppercase
6. `packages/design/src/ui/Button.vue:307-311` — `.cta`: font-headline, 700, 14px, 0.2em, uppercase
7. `packages/design/src/ui/Button.vue:331-335` — `.cta_outline`: font-headline, 700, 14px, 0.2em, uppercase
8. `packages/design/src/ui/Button.vue:352-356` — `.cta_destructive`: font-headline, 700, 14px, 0.2em, uppercase
9. `packages/design/src/ui/ToastManagerBase.vue:84-88` — `.label`: font-headline, 12px, 700, 0.08em, uppercase
10. `packages/design/src/ui/BrutalistTitle.vue:51-55` — `.main`/`.sub`: font-headline, 48px, 700, -0.04em, uppercase
11. `packages/design/src/composite/AddressDisplay.vue:63-67` — `.copied-hint`: 11px, 0.08em, uppercase (inherits mono from parent `.address`)
12. `packages/design/src/ui/Banner.vue:137-141` — `.action_btn`: font-headline, 11px, 700, 0.12em, uppercase
13. `packages/design/src/ui/Toast.vue:56-59` — `.toast__link`: font-mono, 12px, 0.04em, uppercase
14. `packages/design/src/composite/BalanceRow.vue:44-48` — `.label`: font-mono 500 11px/1, 0.08em, uppercase
15. `packages/design/src/ui/SubPageHeaderBase.vue:98-102` — `.title`: font-headline, 13px, 700, 0.12em, uppercase

Note the drift the map flagged is real and confirmed: letter-spacing alone takes 6 different values
(0.04em, 0.08em×4, 0.1em×2, 0.12em×2, 0.2em×3, -0.04em) across what is meant to read as one visual
family. `token-contract.ts` already centralizes font sizes/weights/colors for exactly this kind of
cross-cutting concern (`fontSizes`, `fontWeights`, `textColors` feed the generated `utilities.css`),
so the machinery to fix this without touching 12 files by hand already exists and is simply unused
for this pattern — `grep -n "uppercase" utilities.css` / `token-contract.ts` returns nothing.

**Why it harms future change**: the brutalist aesthetic is this package's entire reason to exist. A
rebrand, an accessibility-driven letter-spacing normalization, or a font-swap for the label family
means 12 separate hand-edits, each a chance to miss one file or introduce a 13th slightly-different
value — the exact failure mode already visible in the current 6-way letter-spacing drift.

**Smallest safe refactoring**: **Extract Class** (CSS) — add one generated utility (e.g.
`.label--eyebrow` with a `size` modifier, driven by a new `token-contract.ts` entry the same way
`textColors`/`flexGaps` already drive `utilities.css`), then **Inline/Replace** each of the 15 local
declarations with the utility class, keeping only the per-component color/positioning that's
genuinely different. Behavior-preserving requires picking one canonical letter-spacing/size per
existing "family" (Button's CTA row already agrees on 14px/0.2em across 3 variants — start there)
before touching the more divergent 4px/8px/10px/11px/12px group.

**Instances**: see the 15-item Evidence list above (file:line for every occurrence).

---

## Finding 2: Bordered-surface "box" primitive reimplemented in raw CSS 6× with no shared class

**Smell**: Duplicate Code (Dispensables). The literal string `border: 1px solid var(--nulo-outline)`
paired with a `background: var(--nulo-surface[-low])` declaration is retyped verbatim in every file
that wants a bordered card/pill/panel, instead of being expressed once.

**Impact bucket**: structural. Blast radius: 5 files / 6 sites (`ui/Card.vue`, `ui/Tag.vue`,
`ui/Toast.vue`, `composite/AddressDisplay.vue`, `composite/EmojiGrid.vue` — the last has two
independent instances, the outer grid and the per-cell box). Change frequency: low-to-unknown per
`git log` (3 combined touches across these 5 files since introduction) — consistent with a young,
rarely-revisited package rather than evidence the pattern is safe to leave alone.

**Evidence**:

1. `packages/design/src/ui/Card.vue:12-13` — `.card`: `background: var(--nulo-surface); border: 1px solid var(--nulo-outline);`
2. `packages/design/src/ui/Tag.vue:19,25` — `.tag`: `border: 1px solid var(--nulo-outline);` (19) … `background: var(--nulo-surface-low);` (25)
3. `packages/design/src/ui/Toast.vue:38-39` — `.toast`: `background: var(--nulo-surface); border: 1px solid var(--nulo-outline);`
4. `packages/design/src/composite/AddressDisplay.vue:53,55` — `.address`: `border: 1px solid var(--nulo-outline);` (53) … `background: var(--nulo-surface-low);` (55)
5. `packages/design/src/composite/EmojiGrid.vue:31-32` — `.emoji-grid`: `background: var(--nulo-surface-low); border: 1px solid var(--nulo-outline);`
6. `packages/design/src/composite/EmojiGrid.vue:43-44` — `.cell`: `background: var(--nulo-surface); border: 1px solid var(--nulo-outline);`

**Why it harms future change**: this is the single most common visual motif in the whole package (a
bordered "brutalist box" is the base unit the entire aesthetic sits on). It's currently defined
nowhere and reimplemented everywhere — a border-width or outline-color token rename requires a
grep-and-pray sweep across every consumer instead of one class edit; a new component author has no
canonical example to compose from and will most likely add a 7th hand-rolled copy.

**Smallest safe refactoring**: **Extract Class** — add a `.box` (or `.bordered-surface`) utility
(plain CSS custom class, or a `composes:` in each `<style module>` block) exposing
`border: 1px solid var(--nulo-outline)` + a `surface` modifier for the `--nulo-surface` /
`--nulo-surface-low` choice; **Inline** it at all 6 call sites, keeping only genuinely
component-specific declarations (padding, flex layout, font) locally.

**Instances**: see the 6-item Evidence list above.

---

## Finding 3: `Tooltip.vue`'s position resolver duplicates its own cross-axis `switch` verbatim across all 4 sides

**Smell**: Duplicate Code (Dispensables), classic "parallel switch statements in sibling branches"
form — the inner `switch (props.position)` block is copy-pasted twice (once computing `xPos` for
`top`/`bottom`, once computing `yPos` for `left`/`right`), byte-identical within each pair.

**Impact bucket**: local. Blast radius: 1 file (`ui/Tooltip.vue`), but it's the package's largest
UI-logic file at 280 LOC and the positioning `watch` handler is its core behavior. Change frequency:
low (`git log` shows 3 touches to this file total), but it is imported by `Input.vue`
(`ui/Input.vue:9`) as well as used package-wide, so the resolver is on a load-bearing path.

**Evidence** (`packages/design/src/ui/Tooltip.vue`):

- Lines 70-82 (`case "top":`, inner switch on `props.position` computing `xPos`):
  ```
  case "center": xPos = triggerRect.left - (tooltipRect.width / 2 - triggerRect.width / 2); break
  case "start":  xPos = triggerRect.left; break
  case "end":    xPos = triggerRect.right - tooltipRect.width; break
  ```
- Lines 88-100 (`case "bottom":`) — **identical** inner switch body to the `top` case above, only
  reached via a different `yPos` computation.
- Lines 106-118 (`case "left":`, inner switch on `props.position` computing `yPos`):
  ```
  case "center": yPos = triggerRect.top - (tooltipRect.height / 2 - triggerRect.height / 2); break
  case "start":  yPos = triggerRect.top; break
  case "end":    yPos = triggerRect.bottom - tooltipRect.height; break
  ```
- Lines 124-136 (`case "right":`) — **identical** inner switch body to the `left` case above.

**Why it harms future change**: the cross-axis centering/start/end math is real geometry logic, not
styling — a bug fix (e.g. correcting rounding, adding a viewport-clamp) applied to one copy and
forgotten in its sibling produces a tooltip that's correctly positioned on `top`/`bottom` but subtly
wrong on `left`/`right` (or vice versa), a class of bug that's easy to ship because the two axes are
visually exercised by different call sites and rarely compared side-by-side.

**Smallest safe refactoring**: **Extract Function** — pull the 3-way `position` switch into a single
helper, e.g. `crossAxisOffset(position: Position, start: number, end: number, size: number): number`
returning `start - (size/2 - triggerSize/2)` / `start` / `end - size` for `center`/`start`/`end`
respectively (parameterizing which rect dimension feeds it). Call it once for the `top`/`bottom`
branch (passing trigger/tooltip width) and once for `left`/`right` (passing height). The two
19-line duplicate `switch` bodies collapse to two call sites.

**Instances**: `packages/design/src/ui/Tooltip.vue:70-82`, `:88-100`, `:106-118`, `:124-136`.

---

## Non-findings

- **Severity/tone-to-color mapping across `Badge`/`Banner`/`Toast`/`ToastManagerBase`** (map
  candidate #2) — already remediated in this exact shape by a prior audit finding: `git log` shows
  `578861be` (`refactor: harden-quality arc`) landing **Q-11 "shared `SeverityTone` + typed
  Badge/Banner/Toast tone props"** (PR #199). What remains is `severity.ts`'s own doc comment
  explicitly declaring the per-renderer color divergence (background vs icon-fill vs left-border)
  deliberate, and explicitly carving `ToastManagerBase`'s raw `red|green|orange` axis out as a
  separate, intentionally-unmigrated concern. The map's "4th implementation not accounted for" read
  is inaccurate — the doc already accounts for and names it. Nothing new to flag here.
- **Two parallel icon systems (`Icon.vue` vs `MaterialIcon.vue`)** (map candidate #3) — read both in
  full; they render via genuinely different technology (custom SVG path data vs. a web-font glyph)
  and do not share prop shape beyond `name`/`size`/`color`, which is the minimum any icon component
  needs. No duplicated logic to extract; this is two renderers for two icon sources, not one
  reimplemented twice. Flagging it would be "speculative flexibility" territory (excluded by scan
  rules), not a named smell with a concrete fix.
- **`Button.vue` (393 LOC) as a Bloater / Large Class** — read in full. Its length is 8 variant ×
  size CSS blocks plus one component; each variant reads as ~15-25 lines of genuinely
  variant-specific rules (colors, hover/active states) once the shared uppercase-label clump
  (Finding 1) is factored out. Not a Long Method/Large Class case once that extraction happens —
  deferred to Finding 1 rather than double-counted here.
- **`Input.vue` (407 LOC) as a Bloater** — read in full. Length is script logic (`handleInput`,
  `handlePaste`, `handleKeydown`) for a real multi-mode input (sanitize / maxLength / numeric /
  int-clamp / paste-clamp), not CSS duplication — the map's speculation about a "variant-block
  duplication" (mirroring Button) does not hold; the style block is ~95 lines, single "brutalist"
  variant (the doc comment at line 313-317 notes the old boxed variant was already removed). Some
  maxLength-clamping logic is echoed between `handleInput` and `handlePaste`, but the two operate on
  different event shapes (typed keystroke vs. paste-with-selection-range) and a shared extraction
  would need to thread selection-range state through the typing path for no real benefit — not a
  clean win, left as-is.
- **`Icon` depending on a static `icons.json` vendored file** — not duplication or coupling in the
  Fowler sense; it's a single, intentional data source consumed once. No finding.
- **`composables/outside.ts` / `composables/toast.ts`** — read in full; each is a single-purpose,
  non-duplicated composable (61 / 44 LOC) with no overlapping responsibility with each other or with
  any component. No finding.
- **`theme-vars.ts` / `theme-contrast.ts` / `token-contract.ts`** — single-source generators feeding
  `tokens.ts`/`base.css`/`utilities.css`; this is the deliberate, already-guarded (drift tests)
  convention, not duplication.
- **`DisclaimerTag.vue` (7 LOC) as a Lazy Class** — it's a fixed-copy wrapper (`<Tag tone="test">`)
  used to centralize the exact "Test token · no real value" string at every faucet call site; a
  1-line wrapper that exists purely to DRY a string literal is the opposite of a Lazy Class problem
  here, not a smell.
