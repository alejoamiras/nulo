---
plan: harden-dedupe / design-tokens (arc 2 of 25)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/02-design-tokens, stacked on hd/01-dead-code
---

# design-tokens: one dark palette, named hairline and scrim tokens

Finding Q-23 (a) and the token half of Q-23 (b), from `audit/quality/2026-09-30-dedup-high/`. This batch only declares tokens. Consumers adopt them in later arcs: visual-shells-a and visual-shells-b swap the literals in the files they touch, and visual-shells-b sweeps the rest.

## Outcome & Quality Bar

- **For whom:** the next person who restyles a colour. Today that means editing two dark blocks that must stay identical, and grepping about 18 hairline and 6 scrim literals.
- **Excellent:**
  - Each dark colour is declared once.
  - Hairline and scrim values have names consumers can adopt.
  - The rendered pixels are unchanged in both themes and on the landing, proven by zero-diff screenshots.
- **Good enough:** no consumer edits here, and no light-theme correction (that would be an owner call; the panel kept today's values).

## Architecture & Implementation

- **`packages/design/src/base.css`:**
  - Split the dark declarations into two blocks:
    - `:root, [theme="dark"]`: every declaration the two dark blocks share today, the 28 byte-identical ones.
    - `:root`: what only `:root` declares today (fonts, sizes, nav clearance, the `--nulo-*` brand set).
  - Place the shared block before `[theme="light"]`, so a light root still overrides it. Equal specificity resolves by source order, so a light root keeps today's values.
  - Keep a `[theme="dark"]` block holding only what `[theme="dark"]` declares alone today: the json and log tokens.
  - Each selector ends up with exactly the declarations it has now:
    - a root carrying `theme="dark"` matches all three blocks, so the same set as before;
    - a root carrying `theme="light"` matches `:root` plus the shared block, and the light block overrides them, also as before;
    - no element other than the root carries the `theme` attribute (`popup/app.vue`, `onboarding/app.vue`, `public/theme-boot.js`, Storybook's `preview.ts` all set it on `documentElement`).
- **New tokens, declared at today's exact values, in the `:root, [theme="dark"]` block only:**
  - `--hairline-soft: rgba(74, 70, 63, 0.2)` and `--hairline-strong: rgba(74, 70, 63, 0.3)`. The light theme inherits the same values, which is what every literal renders today.
  - Four scrims named by role, all `rgba(10, 9, 8, α)`:
    - `--scrim-popup` (0.8), used by Popup and DappCancelledOverlay;
    - `--scrim-sheet` (0.82), the legal sheet;
    - `--scrim-loader` (0.85), GlobalLoader and the passkey dialog;
    - `--scrim-barrier` (0.92), BarrierOverlay.
- **`token-contract.ts`:** add `hairlineSoft` and `hairlineStrong` to `borders`, and a `scrims` group. Then run `bun run --cwd packages/design gen:tokens` and add `scrims` to the group list in `tokens.parity.test.ts`.
- **`theme-contrast.ts`:** `parseBlock` matches one exact selector header, so it would stop seeing the shared block. Make `themeMap(theme)` merge `:root`, every block whose selector list includes `:root` or the theme selector, and then the theme block, in source order. Add the test Q-23 asks for: for each theme, the merged map equals the map built from the pre-change file's semantics, pinned against today's literal values for a sample of tokens in both themes.
- **`base.css.test.ts`:** bump the hash, with a dated line in the existing comment style.
- **Alternative not taken:** strip the duplicates out of `[theme="dark"]` and rely on `:root` alone. That is pixel-identical today, but it silently breaks a `[theme="dark"]` subtree inside a light root. The selector list keeps that working and costs nothing.

## Security & Adversarial Considerations

None material. The change is CSS custom properties on the wallet's own stylesheet: no data, input, crypto or dependency changes. The one risk is a cascade slip that makes security copy unreadable, for example a wrong contrast on the "irreversible" confirm. The pinned contrast tests (`theme-contrast.test.ts`) and the zero-diff screenshots cover it.

## Assumptions

**Facts:**

1. The two dark blocks share 28 byte-identical declarations, at `base.css:72-123` and `:194-241` (recon).
2. `[theme="dark"]` declares only json and log tokens beyond those 28 (`base.css:194-241`, read 2026-10-02).
3. The app sets the `theme` attribute on `documentElement` (`popup/app.vue:50,103-105`, `onboarding/app.vue:28-35`, `public/theme-boot.js:20`, `.storybook/preview.ts:104`), and onboarding also puts it on `<presto-banner>` (`onboarding/pages/presto.vue:95`). Codex corrected this; the selector list serves both.
4. `base.css` is hand-authored and SHA-256-pinned (`base.css.test.ts`).
5. `themeMap` merges `:root` with one `[theme="…"]` block by exact header (`theme-contrast.ts:33-37`).
6. The landing imports `@nulo/design/base.css` and sets no `theme` attribute (`apps/landing/src/main.ts:1`), so it renders the `:root` dark values.

**Inferences:**

- Component rules gated on `[theme="dark"] .x` (for example `ReceivePopup.vue:104`) are unaffected, because they match an attribute, not a token block.

**Asks:** none. The light-theme hairline value stays as today, by the program panel's call.

## Phases

### Phase 1: one dark palette, new tokens

Split the blocks as described, add the six tokens, extend the contract, regenerate `tokens.ts`, update the parity group list, make `themeMap` aware of selector lists and add its equality test, then bump the hash.

**Validation gate:**

- **Commands:** `bun run --cwd packages/design test`, `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run audit:vue`.
- **Pass criteria:** all exit 0; `tokens.drift.test.ts` is green after `gen:tokens`.
- **Screenshots:** `bun ~/.cache/hd-shots/run.ts --batch design-tokens --base <parent> --head <head>` must report every surface identical. The surfaces are Home, Settings, Change password, Reset, a popup with its scrim (Receive), and the landing page, on Chrome and Firefox, in dark and light.
- **Layers:** lint, typecheck, unit, visual.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `hd/01-dead-code` (gh stack on base `harden-dedupe`), then add both e2e labels. When the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/02-design-tokens`, stacked on `hd/01-dead-code`. Code review: off.

## UI impact

None by design. Both themes and the landing must be pixel-identical, proven by the zero-diff harness.

## Decisions (delegated)

### Plan audit, Codex round 1 (GPT-6 Astra, xhigh): REVISE

All four findings were adopted:

1. **The shared block is 28 custom properties plus `color-scheme: dark`, and the base sizes belong to it.** They are declared in both dark blocks, and in light too.
2. **Fact 3 was wrong.** Onboarding's `<presto-banner :theme>` puts the attribute on a descendant (`onboarding/pages/presto.vue:95`). The selector list still gives that element exactly the declarations it had, so the onboarding Presto page joins the screenshots.
3. **The sample-literal test was too weak.**
   - One-off proof: every token resolves to the same value for an unthemed, dark and light root, old file under the old reading against new file under the new one. That is 40, 50 and 50 tokens with 0 mismatches.
   - Kept in the suite: an explicit dark root must resolve every unthemed token identically, which is Q-23's blind spot.
   - `themeMap` is now one source-order pass over exact selector-list members.
4. **The undefined-token guard missed the new namespaces.** `--hairline-` and `--scrim-` were added to `OWNED_PREFIXES` in `theme-vars.ts`.
