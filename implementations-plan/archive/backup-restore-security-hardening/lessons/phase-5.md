# Phase 5 — index-pair token relink + token validation (G) — lessons

**Status: ✓ (`ec55852`).** Gate: `vitest run useFullBackupImport.test.ts token` 98 pass; typecheck 0; lint 0.

## What was built
- **Composable token relink:** replaced the `(chainId,contract)` composite-key + ambiguity heuristic with **index-pairing** (`oldTokens[i].id → newTokens[i].id` for successful restores, like networks). Benefits: token-OWNERSHIP for free (a balance's token maps only to a this-restore token), no cross-chain collapse, and one duplicate token FAILING no longer drops a surviving token's balance. Plus **token/account chain-equality** (final-pass #5): a balance is kept only if its account was imported ON THE TOKEN'S CHAIN (`importedChainAddress.has(`${tokenChain}:${account}`)`).
- **`TokenService.restore`:** `TokenSchema.parse({ ...token, id })` before allocation/write (G) — a `chainId:"1:"` token is rejected up-front instead of "succeeding" and orphaning a relinked balance.

## Key decisions / gotchas
- **Scope hoist:** `importedChainAddress` was declared inside the account-restore `try`; the token relink runs AFTER that try → out of scope → runtime ReferenceError failed 5 tests before typecheck even flagged it. Hoisted `const importedChainAddress` above the try (populated inside).
- **Two tests changed by the new behavior:**
  - "keeps same-contract tokens on different chains distinct" — chain-equality now requires the account imported on BOTH chains → updated the fixture to import `0xa` on chain 1 AND chain 2 (chain-distinct accounts).
  - "skips-and-records ambiguous (duplicate composite)" — **obsolete**: index-pairing maps duplicate-contract tokens distinctly by id, so the balance is correctly KEPT (mapped to its own token), not dropped. Replaced with a positive index-pairing test.
- **"detects OLD-side ambiguity" test still passes** under index-pairing (a balance whose token FAILED restore → no map entry → dropped), for the right reason now (failed token, not composite ambiguity).
- **id types:** widened `newTokens.id` cast to `unknown` (real ids are numeric, test mocks use `"n1"` strings); the map is `Map<unknown, unknown>`, so both flow through.
