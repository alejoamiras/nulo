# Q-21 — host utility seam: 2 small drifts (lastError reuse + general.js→.ts) · tier: **light** (moderate-confidence, both-models)

**Re-verify (STEP 1, vs `dev-quality`):** VALID. The harden synthesis narrowed this to TWO concrete drifts (the chrome adapter's double-casts are "localized and correct" → LEAVE them):
1. **`lastError` re-shimmed outside the port with `as any`** — `files.ts:71-72` does `(chrome.runtime as any).lastError as {message?}` (+ a `biome-ignore noExplicitAny`); the canonical reader is the adapter `chrome-browser-api.ts:136-139` `get lastError()` (`as unknown as {lastError?}` → `{message}`) backing `RuntimePort.lastError` (`runtime-port.ts:52-54`). Host-API typing changes need edits in two places.
2. **`general.js` + a hand-maintained `general.d.ts` shadow** — `general.js` (5 exports) can drift from `general.d.ts` with no compiler check. `general` is **auto-imported** (vite `useAutoImport`, `dts: src/types/auto-imports.d.ts`).

## Design
**Part A — one lastError reader.** Extract `readChromeLastError(): { message: string } | undefined` (the `as unknown as { lastError?: { message?: string } }` pattern, NO `as any`) into a small shared extension util; use it in BOTH `files.ts` (replacing the `as any` + dropping the biome-ignore) and the adapter `get lastError()`. (Codex to confirm the home + that files.ts→util doesn't cross a layer the adapter shouldn't.) The `chrome-browser-api.ts:136-137` localized double-casts elsewhere stay (synthesis).

**Part B — general.js → general.ts.** `git mv general.js general.ts`; type the 5 functions inline FROM `general.d.ts` (isPrefersDarkScheme(): boolean; THEME_HINT_KEY: string; persistThemeHint(value: string): void; debounce<T>(fn,delay); ensurePermissions(perms: chrome.permissions.Permissions): Promise<boolean>); **delete `general.d.ts`**; regenerate `src/types/auto-imports.d.ts` (it currently references `../utils/general.js`) via a vite build so the refs become `general`. The 3 explicit importers use `@/utils/general` (no ext) → resolve to `.ts` unchanged.

## Behavior preservation
- Part A: same lastError read semantics (read inside the callback; `{message}` shape, `?? "unknown"/"Download failed"` fallbacks preserved per-site).
- Part B: identical runtime (a `.js`→`.ts` rename + inline types; no logic change). Auto-import names unchanged → call sites untouched.
- THEME_HINT_KEY stays `"nulo:theme"` (shared with `public/theme-boot.js` — must not change).

## Validation gate
- `bun run lint` (files.ts should lose a biome-ignore) + `bun run typecheck:all`.
- `bun run test` for **extension** (general importers: app.vue/security/useContactImportExport; files util) + **wallet-core** (runtime-port, if the reader lands there).
- `bun run build` (regenerates auto-imports.d.ts — commit the regen) + smoke + FULL network.

## Codex consult questions
1. Part A: best home for `readChromeLastError()` — a `utils/` helper both import, or export from the adapter? Any layer rule against `files.ts` importing it? Should the port/adapter `get lastError()` also route through it, or stay as-is (it's already the clean cast)?
2. Part B: does renaming `general.js`→`.ts` + a build regenerate `auto-imports.d.ts` cleanly (general, not general.js)? Any OTHER generated file (`components.d.ts`) or `.eslintrc-auto-import.json` referencing `general.js`?
3. Is the inline typing faithful to `general.d.ts` (esp. `debounce` generic + the `chrome.permissions.Permissions` param)?
