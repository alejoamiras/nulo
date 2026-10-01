# Phase 1 — Tokenize hardcodes + landmines (palette-agnostic) + extension undefined-var guard + FOUC

## What landed
**Design primitives** (`packages/design/src/ui/`): Button (`#0a0908`→`--txt-inverse`; text-hover `#fff`→`--txt-primary`; primary/cta hover `#fff`→`color-mix(--nulo-accent, --txt-primary 18%)`; cta-destructive `#fff`→`--txt-white`), Toggle slider `#0a0908`→`--txt-inverse`, Popover inner-glow `rgba(255,255,255,.05)`→`color-mix(--txt-primary 8%)`, SubPageHeader hover `rgba(248,241,231,.08)`→`color-mix(--nulo-accent 8%)`.

**Extension** (20 sites / 13 files, applied via a guarded exact-match script): accent foregrounds→`--txt-inverse` (6, each verified on a `var(--nulo-accent)` fill), insets `rgba(29,27,26,.5)`→`color-mix(--nulo-surface-low 50%)` (3), hovers `rgba(248,241,231,.08)`→`color-mix(--nulo-accent 8%)` (5), borders `#231f1c`→`--nulo-border` (3), input placeholder `#363433`→`--txt-tertiary` (1), `--nulo-primary`→`--nulo-accent` (2 focus rings).

**Undefined-var guard** wired into the extension (`src/design/theme-vars.test.ts`) via the new `@nulo/design/testing` barrel.

**FOUC** (the real fix, codex-endorsed): `public/theme-boot.js` — a classic render-blocking external script (CSP allows `'self'` scripts; precedent `console-sniffer.ts`) in popup + onboarding `<head>` that reads the allowlisted `localStorage["nulo:theme"]` and sets `<html theme>` before first paint. `persistThemeHint()` (utils/general.js) writes the raw choice on every apply (popup + onboarding). Build-verified: `theme-boot.js` lands in `dist/chrome/` + is referenced in both built HTMLs.

## Gate result (PASS)
- `bun run --cwd packages/design test` → 265 pass / 4 xfail / 1 skip (dark freeze-guard GREEN; both var-guards GREEN).
- `bun run --cwd packages/extension test` → **2598 pass** / 7 todo / 1 skip (no component-test breakage from the CSS swaps).
- `bun run --cwd packages/extension typecheck` exit 0; `bun run lint` exit 0; `build:chrome` OK.
- Grep gate: only the 5 dark scrims (kept dark by design — modal trust boundary) + legit `Spinner color="--<defined-token>"` props remain. No ghosts.

## Lessons / decisions
- **The guard earned its keep — caught 2 ghosts the inventory missed.** `--nulo-error` (TransactionTerminalCard style `var(--nulo-error,#f85149)`→`--red`) AND the SAME token as an `<Icon color="--nulo-error">` prop (TokenImportRow→`color="red"`). The ghost class appeared in BOTH a style `var()` and a component prop, so I **hardened the guard regex to also match quoted `"--token"` prop forms** — catches both, prevents regression. (Plus `--nulo-primary` from the inventory.)
- **`color-mix(--nulo-accent 8%, transparent)` is byte-identical to `rgba(248,241,231,.08)` in dark** because `--nulo-accent` dark == `#f8f1e7` == `rgb(248,241,231)`. Zero dark regression by construction. Same for the `--nulo-surface-low 50%` insets.
- **Button primary/cta hover is the H2 per-state decision.** Replaced the broken `#fff` wash with `color-mix(--nulo-accent, --txt-primary 18%)` — lightens in dark (cream→toward light text), darkens in light (amber→toward dark text). The dark hover shifts from pure-white to lightened-accent (a minor, intentional refinement; confirmed in the Phase-2 matrix).
- **Scrims stay dark literals in both themes** (5 files) — a dark scrim over a light modal is standard + a security boundary; documented survivors, not regressions.
- **`general.js` has a hand-maintained `general.d.ts`** that shadows JS inference — adding `persistThemeHint`/`THEME_HINT_KEY` to the `.js` required updating the `.d.ts` too (typecheck caught it). The build also auto-added them to `auto-imports.d.ts` (clean addition, committed).
- **Light is still RED** (4 xfail) — palette lands in Phase 2; this phase asserted dark only, as designed.
