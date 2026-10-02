# Phase 1 — validate every restore writer (finding H) — lessons

**Status: core ✓ (committed `cfa4290`); account-owned-slice malformed pins fold into P3.** Gate: `bun run --cwd apps/extension vitest run src/wallet/services/{account,token-balance,auth-registry,contact,fpc}` 57 pass; `bun run typecheck` 0; `bun run lint` 0.

## What was built
Parse-before-write at the exact `.set()` of the four EntityStorage-codec restore writers, using the SAME schema the read-codec uses (so parse-before-write mirrors validate-on-read):
- `token-balance/service.ts` — `TokenBalanceRawSchema.parse({ ...tb, id })` before `repo.set`; pushes the PARSED row (D17).
- `auth-registry/service.ts` — `AuthwitSchema.parse({ ...authwit, id })` before `authwits.set`; pushes parsed.
- `contact/service.ts` — `ContactSchema.parse(written)` inside the `restoreRows` writeOne.
- `fpc/service.ts` — `StoredFpcSchema.parse(stored)` (the STORED shape, not `FpcInfo`) before `storage.set`.

## Key decisions / gotchas
- **Parse the WRITTEN row, not the input** — writeOne reassigns id (collision/cursor); validating the input id would wrongly reject a row whose written form is valid. Parse `{ ...row, id }` immediately before `.set()`.
- **Return the parsed (key-stripped) row (D17, final-pass caveat).** `z.object` strips unknown keys → returning the parsed row stops extra attacker fields propagating downstream. Changed `result.push({ ...tb, id })` → `result.push(row)`.
- **Why "written, then codec-hidden" is the bug** — pre-fix, `EntityStorage.set` writes any shape; on read the codec (`decodeRow`) KEEPS-but-returns-`undefined` for an invalid row → the malformed row persists AND is invisible to a later `getValues()` cleanup (permanent private-data leak on a "deleted" profile). The pin asserts the malformed row is NOT in raw `api.storage.local.get(null)` — this FAILS pre-fix (row is written) and passes post-fix.
- **config is OUT of scope** — it uses `setValue` (ValueStorage), not an EntityStorage read-codec, so the keep-but-hide failure mode doesn't apply.
- **Representative-pin decision:** the parse-before-write mechanism is byte-identical across the four writers; one end-to-end pin (contact) proves it. The two security-critical account-owned slices (token-balance, auth-registry) get their malformed-row pin in P3, written in the same pass as their provenance/ownership tests (one test-authoring pass per service, less churn). fpc + account-state per-item validation: fpc parse is in (typecheck-covered); account-state is networkId-keyed (audits verified no forgeable account field) — validated in its own handling if needed.
