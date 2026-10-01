# Phase 3 — Faucet Dark/Light/System toggle + token hygiene + FOUC

## What landed
- **`useTheme.ts`** (composable + exported pure helpers): `THEME_MODES` Dark/Light/System; `isThemeMode` (allowlist), `resolveTheme` (system→`prefers-color-scheme`), `readStoredTheme` (allowlist-validates the untrusted localStorage value → junk falls back to `system`). Module-singleton `mode` ref; `setTheme` persists + sets `<html theme>`; `cycleTheme` rotates; an OS-change listener re-resolves while in System.
- **`ThemeToggle.vue`**: a nav button that cycles the 3 modes (Material Symbol + label), `data-testid="fa-theme-toggle"` + `data-theme-mode`. Wired into `App.vue` via a new `.topbar` (tabs left, toggle right).
- **FOUC**: `public/theme-boot.js` (render-blocking external script) in `index.html` `<head>` reads the allowlisted localStorage hint + resolves System → sets `<html theme>` before first paint. Build-verified: `theme-boot.js` in `dist/` + referenced in the built HTML.
- **Token hygiene (6 ghost vars fixed):** `--nulo-bg`→`--txt-inverse` (BridgeJournal/Stepper/PhaseRail — text on accent chips), `--warn`→`--orange` (BridgeForm), `--surface-raised`/`--surface-active`→`color-mix(--txt-primary 4%/10%, transparent)` (App.vue tabs bar — dark-faithful: txt-primary @ low alpha ≈ the old white overlay in dark, a dark overlay in light).

## Gate result (PASS)
- `bun run --cwd packages/faucet test` → **422 pass** (+9 new: useTheme, ThemeToggle, the faucet undefined-var guard — all green).
- `bun run --cwd packages/faucet typecheck` exit 0; `biome check` clean on the changed files; `bun run --cwd packages/faucet build` OK.
- The faucet **undefined-var guard is GREEN** → all faucet ghosts are now real tokens.

## Lessons / decisions
- **The faucet reuses the extension's FOUC pattern** (external `theme-boot.js` + localStorage hint) — even though the faucet has no CSP and could inline, the external file keeps the two apps consistent and is CSP-safe regardless. Each app has its OWN localStorage origin, so the boot logic is duplicated by design (a standalone ~15-line script).
- **`--surface-raised`/`--surface-active` → `color-mix(--txt-primary X%)`** rather than the solid surface tokens: the originals were translucent white overlays; `txt-primary` at low alpha reproduces that in dark (light text @ 4%) AND gives a correct subtle dark overlay in light. Same self-correcting trick as the Popover inner-glow.
- **localStorage is allowlist-validated on read** (`readStoredTheme`) — an attacker-writable value only ever selects a hardcoded `[theme=…]` block, and a junk value can't force an invalid attribute (it falls back to System).
