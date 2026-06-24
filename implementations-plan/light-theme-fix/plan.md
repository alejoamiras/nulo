# Light Theme Fix — extension repair + faucet toggle

**Status:** ✅ APPROVED (blueprint `deep`) — 2026-06-24. Palette **Direction A (warm chromatic, burnt-amber accent)** chosen at the gate. Scope/tier/validation approved as-is. Implementation pending (cut `fix/light-theme`).
**Plan dir:** `implementations-plan/light-theme-fix/`
**Branch (to cut):** `fix/light-theme`
**Consolidated from three independent plans** (main · codex `xhigh` · Opus planner), then **contradiction-checked + double-audited** (codex resume + a fresh hostile Opus auditor). Both audits returned **conditional approve**; every condition is folded in below and tracked in §11–§12.

---

## 1. Summary

The light theme renders **completely broken** in the extension (dark cards on light backgrounds, invisible borders, dark-on-dark text) and the faucet has **no theme switcher at all**. The theme *infrastructure already exists and works* — the failure is a small, concentrated set of gaps:

1. The shared `[theme="light"]` block in `@nulo/design/base.css` **omits 8 brand tokens**, so ~555 component call sites silently inherit **dark** values in light mode. Root cause; one values edit fixes the majority.
2. **~37 hardcoded dark literals across 27 files**, plus **undefined-var landmines** (`--nulo-primary`, `--nulo-bg`, `--surface-raised/active`, `--warn`) that resolve to dark/black.
3. The faucet never sets a `theme` attribute (permanently dark) and flashes the wrong theme.

We will: build an **honest contrast gate first** (a hand-curated token-pairing assertion + an undefined-var guard), tokenize the hardcodes **palette-agnostically**, land a **designed + signed-off chromatic light palette**, fix the **flash-of-dark** with a real synchronous paint-hint, and add a faucet Dark/Light/System toggle matching the extension. The **dark theme is frozen** except two explicit, reviewed exceptions (§3). **No new design tokens and no new runtime dependencies.**

---

## 2. Tier & rubric (Phase 0.5)

`deep`. Rubric HIGH count: **Novelty** low · **Blast radius** HIGH (shared token foundation, 555 call sites, 3 consumers — a wrong value degrades the *working* dark theme everywhere) · **Irreversibility** low · **Migration cost** low · **External coupling** low · **Security sensitivity** low-moderate (legibility of addresses/amounts/warnings; toggle-state affordance).

Pure rubric = 1 HIGH → `mid`. Escalated to `deep` (user's explicit choice, honored): **cross-cutting across 3 packages**, **production-visible** (real users saw it broken), and it needs a **genuine design review** (deriving + signing off a palette) — exactly what the multi-plan + double-audit ceremony surfaced (the audits killed a naïve ink-accent palette and two false validation claims).

---

## 3. Goal & success criteria

**Done =**
- Extension light theme fully legible and on-brand: every surface, border, text token, badge, input, button, scrim, hover, tooltip, **focus ring**, **toggle ON/OFF state**, and disabled state renders correctly. No dark-on-dark, no invisible borders/text, no state-lying controls.
- Faucet has a Dark/Light/System switcher (localStorage-persisted, default System) consistent with the extension, rendering correctly in both themes, **with full zero-flash on load for both apps** (finding C1). The extension CSP (`script-src 'self' 'wasm-unsafe-eval'`) forbids only *inline* JS but **allows external self-hosted scripts** (precedent: `console-sniffer.ts` already loads in `popup/index.html:8` + `onboarding/index.html:8`), so a tiny synchronous external `theme-boot.js` reads the allowlisted `localStorage` paint-hint and sets the **real `theme` attribute before first paint** — fixing token values AND the 6 components that use `[theme=…]`-gated selectors. The faucet uses the same pattern.
- An **automated contrast gate** (a curated token-pairing WCAG-AA assertion) passes for all semantic + security-relevant pairs in both themes, **and** an **undefined-var guard** fails on any `var(--…)` not defined in base.css.
- A **Storybook theme-matrix** flips every primitive between light/dark via the real `theme` attribute (not a background swap).
- **Dark theme has no _unintended_ restyle**, with exactly **two explicit, reviewed exceptions**: (a) the `--nulo-primary` focus ring (undefined → invisible in *both* themes today; fixing it changes dark too) and (b) the additive `color-scheme: dark`. Everything else in dark is byte-faithful by per-call-site construction. **Honesty note:** Playwright visual-regression was offered and **declined (Q3)**, so the dark-freeze proof is **structural (SHA pin + grep + the gate's dark assertions) + manual smoke**, not a pixel diff — an accepted limitation.
- One source of truth: dead `_base.scss`/`_flex.scss`/`_text.scss` removed.

**Observable signals:** `bun run audit:vue` green; **`bun run --cwd packages/design test`** (the contrast gate + undefined-var guard + parity/drift/SHA) green; `bun run --cwd packages/extension build-storybook` green; `bun run test:e2e` smoke green; manual sign-off on the palette and both apps in light/dark/system.

---

## 4. Scope

**In:** `packages/design` (the `[theme="light"]` values + explicit `--border` fix + `color-scheme` + contrast gate + undefined-var guard + theme-matrix story + tokenizing design primitives), `packages/extension` (tokenizing hardcodes/landmines, the FOUC paint-hint, dead-stylesheet removal), `packages/faucet` (theme composable + toggle UI + undefined-var hygiene + FOUC).

**Out:** Restyling dark (frozen, two exceptions per §3). New design language. Playground toggle/tests (passively inherits the shared fix — flagged as an untested surface in the PR). Deleting dead `--btn-*` tokens (codegen change — follow-up). Splitting `--nulo-accent` into fill-vs-text tokens (considered for the ink look — rejected, §6). Non-theme UX.

---

## 5. Diagnosis (root cause)

### 5.1 The 8 missing light tokens
`base.css` `:root` (dark) defines these; `[theme="light"]` (lines 124–172) **does not** → fall through to dark:

| Token | Dark value | Used for | Light today |
|---|---|---|---|
| `--nulo-surface` | `#141312` | main card/surface | **near-black** |
| `--nulo-surface-low` | `#1d1b1a` | recessed insets, inputs | **near-black** |
| `--nulo-surface-high` | `#2b2a28` | hover/elevated fills | **near-black** |
| `--nulo-surface-highest` | `#363433` | highest elevation (+ mis-aliased as `--border`) | **near-black** |
| `--nulo-accent` | `#f8f1e7` (cream) | **dual-role: 27 fills AND 43 text/link/active/toggle-ON sites** | **cream (invisible on white)** |
| `--nulo-outline` | `#4a463f` | card outlines | **dark brown** |
| `--nulo-border` | `#231f1c` | subtle dividers | **near-black** |
| `--nulo-secondary` | `#999187` | muted text/icons | taupe (low contrast) |

Bug-on-bug: `[theme="light"]` aliases `--border: var(--nulo-surface-highest)` (base.css:132) → a *dark* value. Dark uses explicit `rgba(74,70,63,0.5)`. **Fix:** explicit light `--border`/`--border-hovered`.

**Verified, load-bearing:** all 8 are already in `token-contract.ts` + valued in dark `:root`, so `tokens.parity.test.ts` (name → declared-somewhere, one-way) **already passes**. Adding the 8 to the light block is a **pure base.css values edit — no contract/codegen change**.

### 5.2 The ~37 hardcoded literals + undefined-var landmines (~30 files)
- **Accent foregrounds** `#0a0908` on `--nulo-accent`: `Button.vue:224/225/302/303`, `Toggle.vue:100`, `SelectTokenCard:84`, `SendTypesCard:94`, `ActionButtonsView:79`, `SecretCountdownClose:58`, `change-password`, `reset`. Plus `#fff`: `Button.vue:231/290/313/347/348`.
- **Scrims** `rgba(10,9,8,.8x)`: GlobalLoader, NotificationManager, Popup, PasskeyCeremonyDialog, DappCancelledOverlay, Tooltip.
- **Insets** `rgba(29,27,26,.5)` (= `--nulo-surface-low` @50%): TokenCard, TransactionCard, SelectTokenCard.
- **Hovers** `rgba(248,241,231,.08)` (= `--nulo-accent` @8%): SubPageHeaderBase + 5 settings/token pages.
- **Borders** `#231f1c` (= `--nulo-border`): SendTypesCard ×2, FeePriorityRow.
- **Popover** white inner-glow `rgba(255,255,255,.05)`.
- **Undefined-var landmines** (invisible to a hex grep, no token-test coverage): `--nulo-primary` (`IncomingTrustPopup.vue:269,297`, invisible focus rings — broken in **both** themes); `--nulo-bg` (faucet `BridgeJournal:143`/`BridgeStepper:151`/`BridgePhaseRail:273`, text-on-accent); `--surface-raised`/`--surface-active` (faucet `App.vue:84,107`); `--warn` (faucet `BridgeForm:632`).

### 5.3 Faucet
No `theme` attr (permanently dark). No config service → localStorage persistence (precedent: `useBridgeJournal`). Shell = `App.vue` `<nav class="tabs">` (toggle home). `main.ts` imports `app.css` after `base.css`.

---

## 6. Candidate light palette (the design deliverable — for sign-off)

### 6.1 The accent constraint (forced by audit finding H2)
`--nulo-accent` is **dual-role**: **27 background-fill** sites (CTAs, Toggle-ON track `Toggle.vue:93-95`) **and 43 text/border/active-indicator** sites (links, active-tab `Navigation.vue:80`, selected fee-priority `FeePriorityRow:79/84`). In dark, cream serves both (light-on-dark works as fill *and* bright text). **A near-black "ink" light accent is REJECTED:** it passes contrast but breaks affordance — a link renders as plain body text, and an ON toggle (near-black track) reads as OFF/disabled, which in a wallet (e.g. "strict security mode") is dangerous. **Therefore the light accent must be CHROMATIC** — saturated enough to (a) be a fill with light text, (b) be distinguishable from black body text as a link, (c) read as "on" as a toggle track. Splitting `--nulo-accent` into separate fill/text tokens was considered and rejected (a new token + re-pointing 27 sites + a dark change).

So the real choice is the **accent hue (warm vs cool)**, decided at the Storybook sign-off:

### Direction A — "Warm chromatic" (brand-faithful, RECOMMENDED)
Keeps the warm identity; light surfaces = warm paper, accent = a saturated **burnt amber** that works as both fill and link.

```css
[theme="light"] {
  --nulo-surface:         #ffffff;
  --nulo-surface-low:     #f0efec;
  --nulo-surface-high:    #e7e5e1;
  --nulo-surface-highest: #dcd9d3;
  --nulo-accent:          #b8530f;   /* burnt amber; on #fff ≈ 4.9:1 (link ✓, fill+white-text ✓) */
  --nulo-outline:         #c9c5bd;
  --nulo-border:          #d8d4cc;
  --nulo-secondary:       #6b655c;   /* on #fff = 5.77:1; on inset #f0efec = 5.02:1 (AA ✓) */
  --border:               rgba(124,116,104,0.30);  /* EXPLICIT — not var(--nulo-surface-highest) */
  --border-hovered:       rgba(124,116,104,0.55);
}
```

### Direction B — "Cool blue" (alternative)
Neutral cool greys + a darkened blue accent (raw `#0c8bfe` is a text-fail at 3.42:1 → use `#0c66d6` = 5.4:1).

```css
[theme="light"] {
  --nulo-surface: #ffffff; --nulo-surface-low: #f1f4f8; --nulo-surface-high: #e6ecf4;
  --nulo-surface-highest: #d7e0ec; --nulo-accent: #0c66d6; --nulo-secondary: #5b6573;
  --nulo-outline: #c4cedd; --nulo-border: #d4dcea;
  --border: rgba(70,90,120,0.30); --border-hovered: rgba(70,90,120,0.55);
}
```

### 6.2 Token-foreground insight (verified)
Accent/CTA foregrounds tokenize to **`var(--txt-inverse)`** (light = `rgba(255,255,255,90%)`), which over a saturated accent ≈ 5:1+ (e.g. white over `#b8530f`). The real CTA lever is **`--nulo-accent`** (Button uses it directly at `:223/:301`); `--btn-primary-bg`/`--btn-red-bg` have **zero consumers** (dead — the blue stub is wired to nothing).

### 6.3 Contrast numbers
All figures **computed (WCAG 2.x)**, not eyeballed: ink/fill/secondary/inverse pairs above are real ratios. They are **re-checked in CI by the §8-Phase-0 gate** (which is an asserted pairing table — see C2 honesty note there, not a full-cascade oracle). Load-bearing control borders (e.g. an input's sole boundary) are held to **≥3:1** in the pairing table (finding M3) — `--border` at ~1.4:1 is decorative-only and must never be a control's only affordance.

---

## 7. Tokenization rubric (Phase 1 — palette-agnostic, ZERO new tokens, **per-call-site verified**)

| Literal / landmine | Example | Tokenize to | Per-site check |
|---|---|---|---|
| Accent foreground (on accent fill) | `color: #0a0908` | `var(--txt-inverse)` | **confirm parent bg is `--nulo-accent`** — verified for SendTypesCard.toggle_active, SecretCountdownClose.cta, Button.primary/cta; **`ActionButtonsView.primary .label` + `SelectTokenCard.token_initial` need parent-bg confirmation before swap** |
| **Button hover — text variant** | `.text:hover { color: #fff }` (`:290`) | `var(--txt-primary)` (brightens in dark, darkens in light — theme-correct) | **per-state (H2)** |
| **Button hover — primary/cta fill** | `.primary/.cta:hover { background: #fff }` (`:231,:313`) | a per-theme hover that shifts the chromatic accent *toward contrast* (e.g. `color-mix(in srgb, var(--nulo-accent), var(--txt-primary) 15%)`), NOT a blanket white wash | **per-state design call, decided + shown at the Phase-2 sign-off matrix (H2)** |
| CTA-destructive fg | `.cta_destructive { color/fill: #fff }` (`:347,:348`) | `var(--txt-white)` (white on red works both themes; red fill stays) | confirm |
| Hover wash | `rgba(248,241,231,.08)` | `color-mix(in srgb, var(--nulo-accent) 8%, transparent)` | **semantic check: dark→cream wash (byte-identical); light→amber/blue wash — confirm "accent-tinted hover" is intended** |
| Inset | `rgba(29,27,26,.5)` | `color-mix(in srgb, var(--nulo-surface-low) 50%, transparent)` | byte-identical in dark by construction — **verify in a real Chromium/Firefox render** (not asserted) |
| Solid border | `#231f1c` | `var(--nulo-border)` | token == literal in dark |
| White inner-glow | `rgba(255,255,255,.05)` | `var(--border)` / `color-mix(... --nulo-outline ...)` | sub-perceptual in dark — verify |
| Scrim | `rgba(10,9,8,.85)` | **keep dark in both themes** (optionally de-warm to `rgba(0,0,0,.6)`) | trust-boundary: must fully occlude (§9) |
| `--nulo-primary` ring | `var(--nulo-primary)` | `var(--nulo-accent)` (or `var(--blue)`) | fixes a **both-theme** bug (an explicit dark exception, §3) |
| Faucet `--nulo-bg` | `var(--nulo-bg,#000)` | `var(--txt-inverse)` | text-on-accent chip |
| Faucet `--surface-raised/active` | `var(--…, rgba(255,255,255,…))` | `var(--nulo-surface-high/highest)` | — |
| Faucet `--warn` | `var(--warn,#e0a020)` | `var(--yellow)` / `var(--orange)` | — |

**Precedent:** `color-mix(in srgb, C P%, transparent)` ≡ C-at-P%-alpha is already shipping in the repo (`Spinner.vue:27`), settling both browser support and the dark-equivalence math. **No new tokens, no `gen:tokens`, no parity/drift churn, no base.css edit in this phase** (all edits live in component `<style>` blocks) → the SHA pin is untouched until Phase 2.

---

## 8. Phases

> **Sequencing:** (0) build the contrast gate + undefined-var guard FIRST and watch them go RED on today's light block; (1) tokenize hardcodes **palette-agnostically** + fix the FOUC paint-hint (both are direction-independent, so they parallelize the palette sign-off); (2) land the **signed-off chromatic palette** values; (3) faucet toggle; (4) cross-cutting validation; (5) cleanup. The gate's **light** assertions are **expected-RED from Phase 0 through Phase 1** and flip **required-GREEN at Phase 2** — phases are gated on **dark** until the palette lands (finding H3).

### Phase 0 — Contrast gate (RED) + undefined-var guard + Storybook theme-matrix scaffold ✓
> **✓ COMPLETE.** Gate passed: `packages/design test` 265 pass / 4 xfail (light RED proof) / 1 skip; build-storybook green; typecheck + lint clean; base.css untouched (SHA intact). See `lessons/phase-0.md`.
- Add `packages/design/src/theme-contrast.test.ts` + a small inline luminance/ratio helper (**~80–120 lines, no npm dep**). **HONEST SCOPE (finding C2):** this is an **asserted token-pairing table**, NOT a cascade resolver — the repo's own `faucet/src/app.css.parity.test.ts:21-25` documents that jsdom *cannot* resolve the CSS-var cascade, and the human visual gate covers ordering. So the helper resolves only the **token-reference graph within base.css** (token → token → literal, modeling `:root` + `[theme]` override on one element), flattens a foreground token's alpha over an **explicitly-named background token**, and computes WCAG. Pairs are **hand-curated**: text-on-surface, `--nulo-secondary` × surfaces, **accent-fill ↔ `--txt-inverse`** (the Button landmine), security pairs (addresses/amounts; `--red`/`--orange`/`--yellow` warnings), load-bearing control borders ≥3:1 (M3), `--json-*`/`--log-*` × `--log-background`. Run **both** themes; **dark = required, light = expected-red (xfail) until Phase 2**.
- Add an **undefined-var guard** (finding codex #3) as a **reusable helper** that reads the canonical token set from `base.css` and asserts every `var(--nulo-*)`/theme token referenced in a given package's `<style>` blocks is defined. **Per-package wiring resolves the phasing (final-codex blocker #2):** Phase 0 builds the helper + applies it to the **design package's own** styles (green — design has no ghosts); Phase 1 wires it into the **extension** test (catches `--nulo-primary`, fixed in Phase 1); Phase 3 wires it into the **faucet** test (catches `--nulo-bg`/`--surface-*`/`--warn`, fixed in Phase 3). Each package's guard is thus green exactly when that package's gate runs — no cross-package contradiction.
- Add a Storybook `globalTypes.theme` toolbar + decorator that sets `document.documentElement.setAttribute("theme", …)` — a real theme swap, **replacing the misleading background-only toolbar** (`preview.ts:83-89`, which leaves `theme` dark while only the canvas goes light → false "tested in light" confidence).
- **Demonstrate RED:** capture the failing pairs + undefined-var hits in `lessons/phase-0.md` (a gate that can't fail is theater).
- **Validation gate:** `bun run --cwd packages/design test` (contrast gate present, **dark GREEN / light xfail-red** via vitest `test.fails` — confirmed supported in vitest 4.1.5; undefined-var helper built + design self-scan green; existing parity/drift/SHA still green); `bun run --cwd packages/extension build-storybook`. The per-package guard's RED→GREEN demonstration happens in P1 (extension ghost) and P3 (faucet ghosts), captured in their lessons. Layers: unit + build.

### Phase 1 — Tokenize hardcodes + landmines (palette-agnostic) + extension undefined-var guard
- **Tokenize**, shared `@nulo/design` primitives first (`Button`, `Toggle`, `Popover`, `Tooltip`, `SubPageHeaderBase`), then extension app-local in **failure-mode batches** (scrims → hovers/insets → borders/foregrounds → one-offs incl. `--nulo-primary`). Apply §7 **per call site** (confirm the 2 flagged accent sites). Preserve every `data-testid`.
- **Undefined-var guard (extension):** wire the Phase-0 helper to scan extension `<style>` blocks; it goes RED on `--nulo-primary` (`IncomingTrustPopup.vue:269,297`); fix that ring (→ `var(--nulo-accent)`), turning it GREEN. (This is the `--nulo-primary` fix listed in the one-offs batch.)
- **FOUC — full zero-flash fix (finding C1, codex-endorsed):** on every theme apply (popup + onboarding `settingHandlers`), write the resolved theme to `localStorage["nulo:theme"]` (allowlist-validated; chrome.storage stays the source of truth, localStorage is a paint cache). Add a tiny **synchronous external** `theme-boot.js` (self-hosted in `public/` → `script-src 'self'`-compliant; CSP forbids only *inline* JS, and `console-sniffer.ts` already loads as an external head script) in popup + onboarding `<head>` **before the CSS**, which reads the hint, resolves `system` via `matchMedia`, and sets the real `theme` **attribute** pre-paint — fixing token values AND the 6 `[theme=…]`-gated component selectors. Palette-agnostic (no base.css edit). The faucet reuses the pattern (Phase 3).
- **Dark-regression proof:** mapping table (literal → token → dark value) in `lessons/phase-1.md`; the gate's **dark** assertions stay green; grep gate (only intentional scrim survivors). Light is expected-worse transiently (single PR; not shipped until Phase 2) — gates assert dark only here.
- **Validation gate:** `bun run --cwd packages/design test` (**dark** contrast green; design self-scan green); `bun run lint` + `bun run typecheck:all` + `bun run test` (extension component tests + **the extension undefined-var guard now GREEN** after the `--nulo-primary` fix) + grep gate + `bun run --cwd packages/extension build-storybook`; manual dark smoke + **manual no-flash check** (popup + onboarding opened in light, incl. an explicit choice opposite the OS). **No base.css edit → SHA untouched.** Layers: unit + component + static + build + manual.

### Phase 2 — Land the signed-off chromatic palette in base.css (GREEN) + design sign-off
- In `[theme="light"]`: add the 8 tokens + explicit `--border`/`--border-hovered` (chosen direction) + `color-scheme: light`. Add `color-scheme: dark` to `:root`/`[theme="dark"]` (additive, intentional dark exception per §3 — verify no perceptible diff on the custom UI).
- Resolve the **Button hover states** (§7, finding H2) for the chosen accent — text-hover → `var(--txt-primary)`; primary/cta-hover → the decided contrast-shift — and show them in the matrix. (FOUC is already fixed in Phase 1 via the external boot script — no base.css `@media` needed.)
- Iterate hex until the gate's **light** assertions (flipped from xfail to required here) are GREEN, dark still GREEN.
- **Recompute + update the `base.css.test.ts` SHA-256 in the same commit** (the pin fails CI otherwise; it's a deliberate tripwire, not a no-diff proof — M1).
- Build the Storybook theme-matrix; **the popup is already flash-free (Phase 1 boot script), so the sign-off smoke reflects the real popup, not just Storybook** (codex #2).
- **DESIGN SIGN-OFF GATE (user):** present the matrix + both directions; user picks direction + approves before merge.
- **Validation gate:** `bun run --cwd packages/design test` (**contrast GREEN both themes**, parity/drift green, SHA matches); `bun run --cwd packages/faucet test` (`app.css.parity` green — element-global rules untouched); `bun run --cwd packages/extension build-storybook`; **palette sign-off recorded** in `lessons/phase-2.md`; `git diff` shows dark blocks changed only by additive `color-scheme`. Layers: unit + build + manual design review.

### Phase 3 — Faucet Dark/Light/System toggle + token hygiene + FOUC
- `useTheme.ts`: reactive theme; `setAttribute("theme", resolved)`; **validate the persisted localStorage value against the allowlist `{"dark","light","system"}`** before applying (untrusted-input hardening, §9); default System via `prefers-color-scheme`; OS-change listener while System.
- **Faucet FOUC — full zero-flash (finding C1):** reuse the same pre-paint boot pattern as the extension (the faucet has no CSP, so an inline *or* external `<head>` script before the CSS works) — read the allowlisted `localStorage["nulo:theme"]`, resolve `system` via `matchMedia`, set the `theme` attr before first paint. First-ever visit (no stored pref) falls back to `matchMedia`.
- Toggle UI in `App.vue`'s `<nav class="tabs">` (with `data-testid`s), mirroring the extension's semantics.
- Token hygiene: `--nulo-bg`→`var(--txt-inverse)`; `--surface-raised/active`→`var(--nulo-surface-high/highest)`; `--warn`→`var(--yellow)`; focus ring stays `var(--nulo-accent)` (now chromatic/visible).
- **Validation gate:** `bun run --cwd packages/faucet test` (useTheme unit incl. **allowlist-rejection** + toggle component + `app.css.parity` green; undefined-var guard green for the faucet ghosts); `bun run --cwd packages/faucet typecheck` + `bun run lint`; manual smoke all 3 tabs in Light/Dark/System, hard-reload (no FOUC), persistence. Layers: unit + component + static + manual.

### Phase 4 — Cross-cutting validation
- Storybook theme-matrix as the sign-off artifact; extension manual smoke across **security-relevant surfaces** in light: send-confirm (amounts/fees), dApp-connect, passkey ceremony dialog, address displays, JSON/Logs viewers, danger/warning banners, **and the toggle/active-state affordance** (verify links read as links, ON toggles read as on — finding H2).
- **Validation gate (finding H1 — corrected):** `bun run audit:vue` (typecheck:all → **extension** test → lint → build) **AND `bun run --cwd packages/design test`** (the contrast gate + undefined-var guard — `audit:vue` runs *extension tests only* and does **not** execute the design package, so the oracle must be invoked explicitly; equivalently `bun run test:all`); `bun run --cwd packages/extension build-storybook` (light matrix clean); `bun run test:e2e` (smoke). Layers: typecheck + unit + component + build + smoke e2e + manual security/affordance matrix.

### Phase 5 — Cleanup + final gate
- Delete dead `_base.scss`/`_flex.scss`/`_text.scss`; fix the stale `onboarding.scss` comment; confirm via build nothing referenced them.
- **Recommend (follow-up):** wire `bun run test:all` (or the design contrast gate) into the CI regression aggregate so the dark-freeze guard runs on every PR, not just locally (closes the H1 gap permanently). (Optional Asks: `:root` fallbacks for `--json-*`/`--log-*`; onboarding reading the persisted theme.)
- **Validation gate:** `bun run audit:vue` + `bun run --cwd packages/design test` + `bun run test:e2e` green; final manual smoke of extension (popup + onboarding) and faucet in light/dark/system. Update `implementations-plan/index.md` to completed. Layers: full.

---

## 9. Security & Adversarial Considerations

- **Contrast failure as information-hiding (primary threat).** A wallet: a light-mode bug hiding an **address, amount, fee, network name, or warning** can cause a wrong sign/send — a *financial* loss. The faucet `--nulo-bg` chips and Button labels are such load-bearing text. **Mitigation:** the Phase-0 pairing table encodes address/amount/CTA/warning pairs as **release blockers**.
- **Affordance failure as a safety bug (finding H2).** A control that *lies about its state* (an ON security-toggle that looks OFF, a link that looks like text) is a wallet-specific hazard the contrast gate can't catch. **Mitigation:** the chromatic-accent constraint (§6.1) + the Phase-4 manual affordance check.
- **Trust-prompt legibility & scrim integrity.** dApp-connect / passkey dialogs gate signing. A *too-light* scrim could let a phishing page bleed through and read as part of a trusted prompt. **Mitigation:** scrims stay **dark translucent in both themes** and must fully occlude — verified in the Phase-4 light matrix.
- **No "danger looks safe" inversions:** red/destructive + yellow/warning stay high-contrast and distinct (the gate checks their foregrounds).
- **Dark-regression as a safety property.** Silently degrading the *working* dark theme is the realistic failure mode. Defense-in-depth: per-call-site literal→token maps (pixel-identity in dark); the gate's dark assertions; the **SHA pin** (a tripwire forcing human re-verify, not a no-diff proof); the **undefined-var guard**; manual dark smoke. **Accepted limitation:** no pixel-diff (Playwright declined, Q3).
- **Untrusted theme value (faucet).** localStorage is attacker-writable (XSS / malicious extension). The value only *selects* a hardcoded `[theme]` block (never interpolated into CSS), but we still **validate against `{"dark","light","system"}`** before `setAttribute`.
- **Supply chain.** No new runtime deps; contrast math is hand-rolled inline (no `wcag-contrast` pull into a security gate). `color-mix()`/`color-scheme` are native (color-mix already shipped, `Spinner.vue:27`). Lockfile frozen; 7-day min-age unaffected.
- **Gate integrity.** The gate must demonstrably FAIL on today's light block (Phase-0 acceptance) before its GREEN is trusted; and it must actually RUN in the regression path (finding H1 — it does not run under `audit:vue`; Phase 4/5 invoke it explicitly + recommend wiring into CI).

---

## 10. Assumptions

### Facts (verified — file:line)
- Theme = `<html theme>` attr + `[theme]` blocks (`base.css:124-222`); **`config.ts:5` `theme` is a plain class field defaulting `"system"` — `new Config()` reads NOTHING; persistence is async via `chrome.storage.local` (`config/store.ts`).** Popup applies theme **async** in `onBeforeMount` after `getProps()` → real first-paint flash; onboarding applies synchronously but only the `new Config()` default.
- **Extension CSP forbids only INLINE JS, not external self-hosted JS:** `manifest.config.ts:41-42` → `extension_pages: "script-src 'self' 'wasm-unsafe-eval'"`. `'self'` **allows external self-hosted scripts** — precedent: `popup/index.html:8` + `onboarding/index.html:8` already load `console-sniffer.ts` as an external head script. Only `'unsafe-inline'` is absent. So the CSP-safe pre-paint FOUC fix is an **external** `theme-boot.js`, not an inline script.
- **6 components use `[theme=…]`-gated selectors** (`ConfirmPopup.vue:210`, `IncomingTrustPopup.vue:303`, `SecretCountdownClose.vue:163`, `ReceivePopup.vue:100`, `SecretExportLayout.vue:222`, `Banner.vue`) → a first-paint FOUC fix must set the real `theme` **attribute** (the boot script), not just token values (an `@media` fallback wouldn't match these). These are also a small extra slice of light-theme surface to verify in the matrix.
- **Button hover states hardcode `#fff`:** `.primary/.cta:hover { background: #fff }` (`Button.vue:231,313`), `.text:hover { color: #fff }` (`:290`) — these break in light independently of accent hue and need per-state treatment.
- **`color-scheme`/`@media (prefers-color-scheme)` are not yet used** in base.css (only queried from JS via `isPrefersDarkScheme`).
- `[theme="light"]` omits 8 brand tokens; `--border` aliases a dark value (`base.css:132`). The 8 are already in `token-contract.ts` + dark `:root` → adding to light needs **no codegen**.
- `base.css` is **SHA-256 pinned** (`base.css.test.ts:16`); `gen-tokens.ts` writes only `tokens.ts`+`utilities.css`.
- `tokens.parity.test.ts` is **one-way** → ghost vars (`--nulo-primary/-bg`, `--surface-*`, `--warn`) have no coverage (motivates the new undefined-var guard).
- `--nulo-accent` = **27 fills + 43 text/border/active sites** incl. `Toggle.vue:93-95` ON-track and `Navigation.vue:80` active-tab → **must stay chromatic** (finding H2).
- `--btn-primary-bg`/`--btn-red-bg` have **zero `var()` consumers**; CTA fill = `var(--nulo-accent)`.
- `color-mix(in srgb, C P%, transparent)` ≡ C-at-alpha, already shipping (`Spinner.vue:27`); byte-identical to the replaced rgba in dark (verify in a real render).
- `audit:vue` = `typecheck:all && test && lint && build`, and `test` = **extension only** → it does **not** run the design contrast gate (finding H1).
- `_base.scss`/`_flex.scss`/`_text.scss` unimported (stale doc-comment only). Faucet dark-only, localStorage precedent. All cited commands exist.

### Inferences (unverified — attack these)
- Completing the 8 tokens + `--border` fix + tokenizing the literals/landmines is *sufficient*. **Risk:** more second-order failures (disabled `opacity:0.8` dipping a light CTA below AA — `Button.vue:156`; dark-tuned box-shadows; icon/svg fills; placeholder text). The pairing table + Storybook matrix flush these; inventory may grow.
- The chosen chromatic accent satisfies all three roles (fill/link/toggle) at AA — verified for the candidate hexes; final hue confirmed at sign-off.
- `--txt-secondary` (light `rgba(0,0,0,.60)` = 5.74:1) and `--nulo-secondary` (light `#6b655c` = 5.77:1) both mean "muted" but differ slightly — both ≥4.5; consider aligning at sign-off.

### Asks (surface to user)
1. **Palette direction** (A warm-chromatic vs B cool-blue) — resolved at the Phase-2 sign-off gate. (Ink accent is off the table — H2.)
2. Confirm playground passively inherits the fix (no toggle/tests) — assumed yes (Q4).
3. Confirm the two dark exceptions are acceptable: `--nulo-primary` focus-ring fix (changes dark) + additive `color-scheme: dark`; and that dark-freeze proof is structural + manual (no pixel diff, Q3-declined).
4. Optional deferred cleanups: delete dead `--btn-*` tokens; `:root` fallbacks for `--json-*`/`--log-*`; onboarding reading the persisted theme; wiring the design gate into CI.

---

## 11. Decision ledger

| Decision | Source | Rejected alternative | Rationale |
|---|---|---|---|
| Contrast gate FIRST (TDD red→green) | all three | gate last (my v1) | only machine check for "structurally-valid but visually-broken"; faucet `app.css.parity` header documents a byte-identical regression that slipped every structural check |
| Gate is an **asserted pairing table, not a cascade resolver** | Opus auditor (C2) | "~30-line exact-cascade oracle" (my v1) | repo's own test declares jsdom cascade-resolution infeasible; honest descope keeps it achievable + still catches the root bug |
| **Undefined-var guard test** added | codex (#3) | grep-only | grep is weaker than a test; prevents the next ghost token (`--nulo-bg` class) |
| Tokenize BEFORE/parallel to palette; **gate dark-only until Phase 2** | Opus planner + auditor (H3) | require light-green per phase | tokenization is palette-agnostic; light is transiently worse pre-Phase-2 (single PR) so light assertions are xfail until the palette lands |
| ZERO new tokens (color-mix + existing swaps + scrims-stay-dark), **per-call-site verified** | Opus planner + codex (#4) | new `--scrim`/`--hover` tokens (my v1) / blanket swaps | avoids codegen/SHA round-trip; but swaps are design decisions verified per site (2 accent sites flagged) |
| **Accent must be CHROMATIC** (warm-amber or blue) | Opus auditor (H2) | ink `#1a1714` (consolidated v2) | ink breaks link/toggle/active affordance in 43 sites incl. security toggles |
| **Real FOUC fix = synchronous localStorage paint-hint** (popup + faucet) | Opus auditor + codex (C1, #2) | port onboarding's `new Config()` apply (v2) | `new Config()` is the hardcoded default; the cheap fix still flashes for explicit-choice≠OS users |
| Gate runs via `--cwd packages/design test`/`test:all`, **not `audit:vue`** | Opus auditor (H1) | rely on `audit:vue` (v2) | `audit:vue` runs extension tests only; the design gate wouldn't execute |
| SHA-pin recompute as explicit per-phase item | Opus planner | (missed v1) | every base.css diff fails CI until the hash is updated in-commit |
| `color-scheme` light/dark added | codex + Opus | omit | native controls/scrollbars/autofill mismatch |
| localStorage value allowlist-validated | Opus planner | trust the string | closes a low-prob untrusted-input sink |
| Dark-frozen **redefined** with 2 explicit exceptions | codex (contradiction-check) | "provably unchanged" (v2) | focus-ring fix + `color-scheme` genuinely change dark — name them, don't overclaim |
| Scrims dark in both themes | Opus planner | per-theme/light scrim | trust-boundary + modal-focus; removes a token |
| **FOUC = external self-hosted pre-paint `theme-boot.js` + localStorage hint** (both apps, FULL zero-flash) | final codex re-review (C1) | `@media` CSS-only fallback (v4, overstated — misses `[theme=]`-gated selectors) / inline script (v3, CSP-blocked) | CSP blocks only *inline* JS; `'self'` allows external scripts (precedent `console-sniffer.ts`); the boot script sets the real attribute so `[theme=…]`-gated component selectors also paint correctly |
| **Undefined-var guard wired per-package** (design self-scan P0; extension P1; faucet P3) | final codex (blocker #2) | one design-hosted guard scanning all packages (v3) | a monorepo-wide guard can't be green in P1 while faucet ghosts remain → contradictory gates |
| **Button hover states get per-state treatment** | final codex (H2 residual) | generic `#fff → --txt-white/keep` (v3) | `.primary/.cta:hover{background:#fff}` + `.text:hover{color:#fff}` break in light regardless of accent hue |
| Delete dead SCSS in final cleanup phase | me + Opus (timing per codex) | delete first / never | keep as reference while tuning → delete at the end |

**Deferred (Asks):** dead `--btn-*` deletion; `--json-*`/`--log-*` `:root` fallbacks; onboarding persisted-theme read; wiring the design gate into CI.

---

## 12. Audit verdicts

- **Codex — independent plan + adversarial (round 1):** delivered; surfaced SHA pin, onboarding-persistence, popup FOUC, reverse-parity gap, `color-scheme`, `--nulo-primary`. Folded in.
- **Opus planner — independent plan + adversarial (round 1):** delivered; surfaced zero-consumer `--btn-*`, palette-agnostic sequencing, zero-new-tokens via color-mix, the SHA tripwire, faucet `--nulo-bg` landmine, 11 ranked risks. Folded in.
- **Codex — contradiction-check (round 2):** **conditional approve** — conditions: redefine "dark frozen" (✓ §3), move popup FOUC before/with sign-off (✓ now Phase 1), add a static undefined-var/reverse-parity guard (✓ Phase 0), treat color-mix/`--txt-inverse` as per-call-site verified (✓ §7). All addressed.
- **Opus fresh hostile auditor — round 2:** **conditional approve (load-bearing conditions)** — C1 real FOUC fix (✓ localStorage paint-hint), C2 descope the oracle honestly (✓ asserted pairing table + cited precedent), H1 wire the gate into the regression path (✓ explicit `--cwd packages/design test` + CI-wiring recommendation), H2 chromatic accent (✓ §6.1), H3 honest per-phase gates (✓ dark-required/light-xfail), M1 no pixel-diff honesty (✓ §3/§9), M2 corrected contrast numbers (✓ §6), M3 load-bearing border ≥3:1 (✓ §6.3/Phase-0). All addressed.
- **Final fresh codex pass (round 3, fresh session):** **reject** — 3 blockers: (C1) the FOUC paint-hint can't ship under the extension CSP + onboarding clobbers a cached hint; (#2) the undefined-var guard's all-packages scan contradicts the per-phase gates; (H2 residual) Button *hover* states (`#fff` text/fill) need per-state decisions. It **confirmed C2/H1 are genuinely fixed** and that vitest 4.1.5 supports `test.fails`. **All 3 blockers folded.**
- **Final codex re-review (round 4, resume):** **conditional approve** — confirmed **#2 cleared** (per-package guard matches the gates) and **H2 cleared** (per-state hover rows). The one residual: C1's `@media` token-fallback was still overstated (it misses the 6 `[theme=…]`-gated component selectors), and codex pointed out **`script-src 'self'` allows an external self-hosted pre-paint script — only inline is blocked.** **Condition ADOPTED (codex's own proposed solution):** the FOUC fix is now an **external `theme-boot.js`** that sets the real `theme` attribute pre-paint (verified precedent: `console-sniffer.ts` already loads as an external head script at `index.html:8`), giving FULL zero-flash for both apps incl. the attribute-gated selectors — §3/§8 (Phase 1)/§10/ledger updated. This is the exact fix codex endorsed, so C1 is now resolved, not merely improved.

**Net audit outcome:** 2 independent plans + a contradiction-check + a fresh hostile audit + a final fresh pass + a re-review — converged on **conditional approve, all conditions folded**. No open High/Critical findings remain.

---

## 13. Seeds

_(DRAFT — finalized after the approval gate. One per session; they don't compose. Start the session in the intended permission mode — a loop stalls on permission prompts.)_

**Recommended — `/goal`** (completion is transcript-observable via plan.md ✓ + gate output):
```
/goal Drive implementations-plan/light-theme-fix to completion. All phases marked ✓ in plan.md (the per-phase headers in the file, not just chat), each ✓ backed by its phase's validation gate reported passing in the transcript; the Phase-0 contrast gate is GREEN on dark (and GREEN on light from Phase 2 onward) and the undefined-var guard is green; for each phase print `LESSONS_FILE=implementations-plan/light-theme-fix/lessons/phase-N.md`. STOP at the Phase-2 design sign-off: build the Storybook theme-matrix, surface both palette directions (A warm-chromatic / B cool-blue), and do NOT proceed to Phase 3 until I approve a direction. After Phase 5: `/code-review max --fix` applied + committed; codex post-impl audit (high/critical addressed); `bun run audit:vue`, `bun run --cwd packages/design test`, and `bun run test:e2e` all exit 0 in the transcript.
```

**Alternative — `/loop`** (cron-style cadence; fixed 15m):
```
/loop 15m Drive implementations-plan/light-theme-fix forward. Never idle. Each firing: read plan.md + lessons/ (authoritative), `git status`, `git log --oneline -5`. Pick the next pending step; after each edit run the fast gates (`bun run lint` + the touched package's `test`); commit + push. At Phase 2, build the Storybook matrix, surface both palette directions, and HOLD for my sign-off. Phase green = its plan.md validation gate passes — paste the result, mark ✓, file lessons/phase-N.md, print LESSONS_FILE=... . Stuck or facing a decision (except the Phase-2 palette pick)? Call `/codex xhigh`, go back and forth, log the verdict; never idle on me. Same step failing 5×? Stop, reassess with codex. All phases ✓? `/code-review max --fix` → commit → codex post-impl audit → address high/critical → wrap-up report. Keep the ASCII checklist visible each firing.
```
