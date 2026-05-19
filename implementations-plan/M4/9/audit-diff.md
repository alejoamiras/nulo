# M4.9 — audit-diff (post-dual-audit)

Date: 2026-04-26

## BLOCKERs to absorb at execution time

1. **Plan misses RP_ID at credential creation (BOTH audits BLOCKING)**: `popup/windows/passkey/index.vue:35-40` has `rp: { name: "Nulo", id: "nulo.sh" }`. Plan claim "No other RP-ID strings" is FALSE. Both `:40` (create flow) and `:88` (get flow) must be patched. Drift scan must catch nested `rp.id` literals, not just `rpId:`.
2. **Pre-build script reads built manifests that don't exist (codex BLOCKING)**: `bun run check:rp-id && cross-env … vite build` runs the check BEFORE vite builds. At pre-build time, `dist/{chrome,firefox}/manifest.json` don't exist OR are stale (current `dist/chrome/manifest.json` says `0.13.0` while `package.json` says `0.13.1`). False-pass risk. **Fix**: read **source** manifest configs (`manifest.config.ts`, `manifest.chrome.config.ts`, `manifest.firefox.config.ts`) directly, OR move check to post-build/Vite hook.
3. **Test placement under `scripts/` won't run (codex SHOULD-FIX)**: `vitest.config.ts:47-55` only picks up `src/**/*.test.ts`. `scripts/check-rp-id.test.ts` won't be executed. `bun run typecheck` won't typecheck `scripts/**/*.ts` either. **Fix**: move checker/tests under `src/` OR expand Vitest + TS configs.

## Plan agent SHOULD-FIX

- Firefox manifest verification: both browsers share source via spread (`manifest.firefox.config.ts:6` spreads `...ManifestConfig`). Read `manifest.config.ts`'s exported `host_permissions` once + assert chrome/firefox derivations don't override (2-line schema check).
- String-grep drift insufficient. Use TS AST walk (ts-morph viable) restricted to string-literal values in `rpId:` / `rp.id:` properties.
- Tests: actually 4-5 tests not 2. Add: fail when `rp.id` literal at `:40` drifts but `rpId` at `:88` matches.

## NITs to absorb

- Constants directory `packages/extension/src/wallet/passkey/` doesn't exist today. Existing passkey constants live at `src/wallet/services/passkey/spec.ts` + `…/credential.ts`. Put `RP_ID` alongside (e.g. `services/passkey/spec.ts`).
- SECURITY.md "Passkey RP ID" subsection already exists at `SECURITY.md:7-29`. **Update existing entry** to reference `RP_ID` + `check-rp-id.ts`. Don't create a new subsection.
- 5 other `nulo.sh` URL literals (`app.vue:253`, `register.vue:33`, `about.vue`, `runtime.ts:68`) are brand URLs, NOT RP-ID. Distinguish in grep scoping.

## Recommended execution-time absorption

1. **Patch BOTH `rp.id` (line 40) AND `rpId` (line 88)** in `popup/windows/passkey/index.vue`.
2. **Read source manifests** in `check-rp-id.ts`. Import the manifest module objects directly; assert `host_permissions[0] === \`https://${RP_ID}/\``.
3. **Move script + tests** into `src/wallet/passkey/check-rp-id.ts` + `check-rp-id.test.ts` (or wherever the passkey constants land). Picks up under existing Vitest/TS config.
4. **AST-based drift detection** instead of grep. Scope to `popup/windows/passkey/index.vue` specifically, asserting both WebAuthn options objects use `RP_ID`.
5. **Update existing SECURITY.md "Passkey RP ID"** subsection, don't duplicate.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — small revisions in-place; mostly path corrections + creation-flow patch + AST scan.
