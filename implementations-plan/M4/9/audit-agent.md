# M4.9 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- **Plan misses `rp.id` site at credential creation** at `popup/windows/passkey/index.vue:40`: `rp: { name: "Nulo", id: "nulo.sh" }`. Plan claim "No other RP-ID strings" (line 13) is FALSE. Both `:40` and `:88` must be patched. Drift scan must catch nested `rp.id` literals, not just `rpId:`.
- Plan reads source manifest, not built — `check-rp-id.ts` runs BEFORE `vite build` (per package.json:64). At pre-build time, `dist/{chrome,firefox}/manifest.json` don't exist yet OR are stale (false-pass risk). Read **source** manifest configs (`manifest.chrome.config.ts`, `manifest.firefox.config.ts` both spread from `manifest.config.ts:14`) OR move to post-build.

**SHOULD-FIX**
- Firefox manifest verification underspecified. `manifest.firefox.config.ts` spreads `...ManifestConfig` (line 6) without overriding. Both browsers share the source. Read `manifest.config.ts`'s exported `host_permissions` once + assert chrome/firefox derivations don't override (a 2-line schema check).
- String-grep drift detection insufficient. Use TS AST walk (ts-morph viable) restricted to string-literal values in `rpId:` / `rp.id:` properties. Naive grep misses nested object literals (the B1 site).
- Test count discrepancy: plan says "Two tests" then lists 3 cases, then adds 3rd file with "happy + 2-3 mismatch shapes." Net 4-5 tests. Add: (a) fail when `rp.id` literal at `:40` drifts but `rpId` at `:88` matches (catches B1-class regressions).

**NIT**
- Constant location: `packages/extension/src/wallet/passkey/constants.ts` directory **doesn't exist today**. Existing passkey constants live at `src/wallet/services/passkey/spec.ts` (e.g. `PASSKEY_PRF_LABEL`) and `…/credential.ts`. Put it alongside.
- SECURITY.md "Passkey RP ID" subsection already exists at `SECURITY.md:7-29`. Update existing entry to mention `check-rp-id.ts`, don't create new subsection.
- 5 other `nulo.sh` URL literals (`app.vue:253`, `register.vue:33`, `about.vue`, `runtime.ts:68`) are brand URLs not RP-ID. Distinguish in grep scoping or false-positive count is high.
- Pre-build vs post-build: defer until B2 resolved.
