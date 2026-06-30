# Q-22 — cross-package documentation drift sweep · tier: **light** (cosmetic, docs/comments only)

**Re-verify (STEP 1, vs `dev-quality`):** VALID — drifts confirmed against current source. No codex consult (cosmetic; each drift verified directly against the pinned source/value).

## Fixes (all source-verified)
- **PBKDF2 doc** `wallet-crypto/README.md:17`: "250k iterations" → "600k iterations" (source `encryption-key.ts` `PBKDF2_ITERATIONS = 600_000`; OWASP-2023 minimum — the README was the drift, the code comment was already correct).
- **Aztec version 4.2.0 → 5.0.0-rc.1** (pin verified `@aztec/foundation`/`@aztec/pxe` = `5.0.0-rc.1`):
  - `aztec-runtime/README.md:62` ("currently 4.2.0"), `wallet-bridge/README.md:284` ("4.2.0 today") — clear current-version claims.
  - `batched-view-simulation.ts:91` (`@aztec/pxe@…/src/pxe.ts:328-336`), `:355` (`@aztec/constants@…`), `service.ts:363` (`@aztec/pxe@… pxe.js:627`) — upstream-citation comments.
  - **`MAX_ENQUEUED_CALLS_PER_CALL = 32` VERIFIED still correct** in the installed `@aztec/constants` (kept `=32`).
- **`password-secret-box.test.ts`** GUARD-canary comment: "a drive-by change to `spec.ts`" → "`password-secret-box.ts`" (the `ENCRYPTION_GUARD` const lives in `password-secret-box.ts:49`, not `spec.ts` — stale ref).
- **`extension-messaging/README.md`**: added the omitted `src/core/` rows to the file map (the shared `base-service`/`base-client` correlator + `decode`/`error-response` reconstruction + `rpc-methods`/`initialization`).

## Decisions / limitations (transparency)
- **Upstream line numbers carried over, NOT re-verified.** The `@aztec/pxe` SOURCE (`src/pxe.ts`, `pxe.js`) is not vendored in `node_modules` (only `dist`), so `pxe.ts:328-336` / `pxe.ts:1058-1060` / `pxe.js:627` could not be independently re-checked against `5.0.0-rc.1`. The VERSION label was bumped to the verified pin; the line citations are the original author's pointers carried forward. The verified-stable `=32` constant (unchanged 4.2.0→5.0.0-rc.1) is evidence the upstream wasn't drastically rewritten across the rc bump, so the pointers are likely still close.
- **`wallet-core/README.md` `types: []` claim — MOOT:** no such `types`/`tsconfig`/`["node"]` claim found in the current README (grep clean); the cited drift is already absent. tsconfig is `types: ["node"]` (unchanged).

## Validation gate
- `bun run typecheck:all` (12 pkgs — comment-only, no-op) + `bun run lint` (clean) + smoke + FULL network (build is byte-identical — comments stripped; trivial pass per the owner's full-network-per-PR ruling).
- No new unit tests (docs/comments only; no behavior).
