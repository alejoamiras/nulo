# Recon — data-safety (batch 5 of audit-448-remediation)

Base: dev `f8faf6b8`. Two read-only sweeps (code paths; backup/test conventions). Condensed; every claim carried file:line in the sweep reports.

## N-06 — orphan imported-key sweep deletes keys behind codec-hidden accounts

- `AccountService.sweepOrphanImportedKeys` (account/service.ts:120-127, called from init :114-116): live-set from `liveRows()` → `storage.getAll()` → **codec-validated** (a JSON/zod-invalid row is KEPT in storage but dropped from the decoded view); the sweep's other side, `ImportedKeysRepository.allRowIds()` (imported-keys-repository.ts:49-56), enumerates **raw** via `rawStringEntries()`. A schema-invalid-but-present Account row ⇒ its sealed imported signing key looks orphaned ⇒ REAL delete ⇒ permanently un-signable account.
- In-file F-B23 precedent to mirror: `rawAddressesForProfile` (:543-557) — identity from canonical KEYS only via `rawStringEntries()`. Since `accountRowId()` is the exact key-suffix shape, the fix is `new Set((await this.storage.rawStringEntries()).map(([id]) => id))` — no parse needed (~5 lines, matches the adjudication's estimate). Widening the live-set can only REDUCE deletions — no new false-delete risk.
- No test exists (proof = "recipe"); no imported-keys-repository.test.ts at all. Pin mirrors the F-B23 tests in account/service.test.ts (:112-175 style): seed a malformed account row + its key row raw via `api.storage.local.set`, drive init, assert the key row SURVIVES.

## N-24 — authwit restore lacks the (account,hash) dedupe

- `AuthRegistryService.restore` (auth-registry/service.ts:450-468): fresh sequential id per row, unconditional write — no dedupe. The same service's LIVE path `recordPendingAuthwits` (:156-170) dedupes by account-scoped hash Set (:160), pinned at service.test.ts:54-58.
- **Trap**: tx restore's guard (transaction/service.ts:543-545) is `contains(hash)` — hash-keyed storage. Authwit hashes are legitimately shared ACROSS accounts (revokeAuthwits :199-205 exists because of this) — a literal port false-rejects. The key must be compound `(account, hash)`.
- Structural template: `account/service.ts` restore (:612-655) — storage-seeded check + intra-batch `seen` Set; `restoreRows` (restore-rows.ts) turns per-row throws into `restoreError` tags (best-effort, batch continues).
- Harm: duplicates consume the `MAX_TRACKED_AUTHWITS_PER_ACCOUNT = 256` cap headroom (spec.ts:22; the audit's "255" is off by one).
- Pin mirrors account/service.test.ts:44-48 ("(P3) dedupes an address repeated within the same restore batch"), dropped into the existing hostile-row P1 block (auth-registry/service.test.ts:138-219) with its `authwit(account, hash)` factory; plus a pre-existing-in-storage duplicate case.

## N-20 (hardening only — refuted as production-reachable) — nextNumericId alias/precision poisoning

- `nextNumericId` (id-allocators.ts:14-16): `array_max(keys.map((x) => +x)) + 1` — bare coercion. A junk key `"999999999999999999999"` → 1e21; float64 ulp there ≈ 2^17 so `1e21 + 1 === 1e21` — the allocator pins forever and every write clobbers `${root}@1e+21`. Smaller aliases (`"0x10"`, `"01"`) skew the max too.
- `canonicalNumericStorageId` (purge-rows.ts:93-97) is the proven round-trip filter (alias table pinned at purge-rows.test.ts:156-169). Fix: `.map(canonicalNumericStorageId).filter(...)` before `array_max`; empty-post-filter still yields 1 (`array_max([]) === 0`).
- Callers (verified; a residual repo-wide-grep gap noted): token/service.ts (:270 persistToken, :681 restore — this file already uses canonical for its F-B23 harvest :614-632) and token-balance/balance-repository.ts:44-46 (→ token-balance/service.ts allocateUnfencedId :202-211). Auth-registry INLINES the same math but is incidentally immune: its storage has `requireKeyIdentityMatch + keyIdentityMode: "numeric"` (:70-78), so decoded rows are pre-screened — do NOT chase it.
- Both Token and TokenBalanceRaw stores are constructed WITHOUT key-identity guards — `nextNumericId` is genuinely the only gate.
- **Why proof c5-3 is defective** (adjudication :38/:53/:60): it calls `nextNumericId` twice on an UNMUTATED store and asserts the results differ — a pure read returns equal values whether buggy or fixed; the assertion is false in every world. NEVER adopt. Correct pins: (1) exclusion — keys `["0","1","999999999999999999999"]` ⇒ next id is `2`; (2) write-back loop — allocate, persist `String(first)`, allocate again ⇒ differs and equals the expected small integer (genuinely RED today via the 1e21 pin, GREEN after).

## Cross-cutting

- No storage SHAPE changes → no migration, no `IMPORT_BLOCKING_ACK`; `footprint-coverage.test.ts` iterates Migrations only and must NOT be touched (calibrate any reviewer expecting it to move).
- Backup blobs are HOSTILE input (CLAUDE.md) — the dedupe + canonicalization are exactly that posture applied to restore/allocation.
- Test harness: FakeBrowserApi + real service + `svc()` stubs via composition-harness; raw rows seeded via `api.storage.local.set`.
