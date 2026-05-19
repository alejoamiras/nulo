# Codex CLI Audit — `@aztec/accounts@4.2.0` bun patch removal

**Date:** 2026-04-30
**Branch:** `nulo/test-drop-patch`
**Codex version:** `codex-cli 0.120.0` (model `gpt-5.4`, reasoning effort `high`, sandbox `read-only`)
**Tokens used:** 253,782
**Patch under review:** `patches/@aztec%2Faccounts@4.2.0.patch` (REMOVED on this branch — `package.json` `patchedDependencies` is empty `{}`)

## Question

Is the bun patch on `@aztec/accounts` (which adds `with: { type: 'json' }` import attributes to dynamic JSON imports in `dest/*/lazy.js` files) still necessary in this Vite/MV3 codebase, given:
- Vite `^7.1.1`
- MV3 service-worker + offscreen runtime
- Empirical evidence: clean install/typecheck/lint/test (948/948) and clean `bun run build` emitting a JS chunk (`SimulatedSchnorrAccount-BIudfUvs.js`) for the JSON artifact.

## VERDICT: `probably-obsolete-with-caveats`

For this repo's current MV3 Chrome build path, the patch is obsolete. Vite build already converts the lazy JSON imports into JS chunks, and the extension runtime imports those JS chunks only. One caveat: a future direct **native Node / Bun** import of `@aztec/accounts/*/lazy` could still fail because the upstream lazy loaders still do `import('./x.json')` without attributes (Node 24+ can reject that).

## Evidence & reasoning (verbatim from codex)

### 1. Vite JSON-import handling

Vite's JSON pipeline turns imported JSON into JS modules, not raw runtime `.json` fetches. The docs say `json.stringify` defaults to `'auto'`, and large JSON is emitted as `export default JSON.parse("...")` ([Vite docs](https://vite.dev/config/shared-options#json-stringify)). The emitted chunk `packages/extension/dist/chrome/assets/SimulatedSchnorrAccount-BIudfUvs.js` is exactly that: a JS module with `JSON.parse(...)`, plus normal JS imports/exports.

### 2. MV3 runtime path

Chrome MV3 is loading JS, not JSON. The background is a module service worker in `packages/extension/dist/chrome/manifest.json` (line 13), which loads `service-worker-loader.js`. The offscreen page loads `offscreen-Bou4tMsg.js`. Inside the bundled service code (`packages/extension/dist/chrome/assets/service-BgVXz9Y1.js`), the lazy path imports `./SimulatedSchnorrAccount-BIudfUvs.js`, **not** `./SimulatedSchnorrAccount.json`. So the runtime never performs a native JSON-module import.

### 3. Vite issue 19095

The linked comment explicitly says Vite was not stripping import attributes from **dynamic** imports, so browsers saw them directly and failed: Firefox with syntax errors, Chrome with JSON-module MIME errors ([issue](https://github.com/vitejs/vite/issues/19095), [exact comment](https://github.com/vitejs/vite/issues/19095#issuecomment-2566074352)). As of **May 6, 2026**, the issue is still open, and the proposed fixes are still open PRs ([#21680](https://github.com/vitejs/vite/pull/21680), [#22023](https://github.com/vitejs/vite/pull/22023)). So this was **not** "fixed in Vite 7" in released Vite. The fix direction is **not** "attributes are now required" — it is the opposite for Vite dev: strip them because Vite already handles JSON itself. The PR text is explicit that build was already fine and the bug was **dev-only**.

### 4. Real remaining risk if dropped

No current MV3 production failure mode. The repo imports the eager `@aztec/accounts/schnorr` entrypoint, not `@aztec/accounts/*/lazy` (`packages/aztec-runtime/src/account/nulo-account.ts:30`, `packages/extension/src/wallet/services/account/contracts/nulo-account.test.ts:2`), and there are no real code imports of those lazy subpaths. The main caveat is future **native Node/Bun** use of `@aztec/accounts/*/lazy`: unpatched upstream lazy loaders still do `import('./x.json')` without attributes, and Node 24+ can reject that. The repo's own `packages/extension/vitest.e2e.network.config.ts:17` hints at the broader Node concern, though it is not biting the currently tested paths.

## Caller's empirical evidence (independent confirmation)

- `bun install` clean
- `bun run typecheck` clean
- `bun run lint` clean
- `bun run test` — 948/948 pass
- `bun run build` clean — Vite emits `dist/chrome/assets/SimulatedSchnorrAccount-BIudfUvs.js` (a JS chunk derived from the JSON artifact)

## Implications

- Drop is safe for production MV3 Chrome build.
- Keep an eye on any future code path that would `import('@aztec/accounts/schnorr/lazy')` (or ecdsa/stub equivalents) directly under Node/Bun (i.e. without going through the Vite bundler). If that lands, re-evaluate.
- E2E smoke tests (registration uses Schnorr; non-lazy path) remain the gating empirical check before removal lands on master.
