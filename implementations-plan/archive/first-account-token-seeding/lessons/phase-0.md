# Phase 0 — recon + plan drafting

## Inference verification (done before the codex audit returned)

**Inference 5 — "`chrome.storage.session` is writable from the e2e test into the SW's context" → CONFIRMED.**
`tests/e2e/fixtures/proof-gate.ts:22` is the exact template:

```ts
await extensionPage.evaluate((key) => chrome.storage.session.set({ [key]: { held: true } }), PROOF_GATE_KEY)
```

with the release at `:27` (`chrome.storage.session.remove(key)`). The key literal is imported from the
production module (`@/e2e/chrome-storage-proof-gate`) so the negative bundle-grep and the test share one
source. The seed-source fixture should mirror this shape exactly.

**Inference 3 — "the sandbox token's contract-class id is readable at test runtime" → CONFIRMED, with a
cheaper route than originally assumed.** `AztecTestConfig` (`tests/e2e/fixtures/aztec.ts:37-43`) carries
`nodeUrl` / `tokenAddress` / `sponsoredFpcAddress` / `minterAddress` — no class id. But `deployTestToken`
(`:143-160`) already holds the deployed `contract` object, so the class id is available at deploy time.
Plan: return it from `deployTestToken` and add one `tokenClassId` field to `AztecTestConfig`, rather than
re-fetching the instance from the node inside the test.

## Implementation constraint found in the ProofGate docstring (load-bearing)

`src/e2e/chrome-storage-proof-gate.ts:36-44` records a tried-and-rejected approach:

> Constructed only inside the static-false `if (E2E_PROVERLESS)` branch in `wallet/runtime.ts` (a normal
> top-level import), so prod builds tree-shake this module … (A dynamic `import()` was tried and rejected:
> rollup ships a code-split chunk for it even when dead.) That absence (not storage write-access) is the
> production trust boundary, enforced by the `_build-extension.yml` negative grep.

So the seed-source module must be a **normal top-level import** constructed inside `if (E2E_TOKEN_SEEDS)`.
A dynamic `import()` would defeat the DCE guarantee the whole seam rests on.

## Codex audit

- Session: see `audit-codex.md` for the transcript and verdict.
