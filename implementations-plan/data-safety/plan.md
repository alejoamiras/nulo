# data-safety — batch 5 of audit-448-remediation (rev 1)

Fixes **N-06 (launch-gate bullet)** — the orphan imported-key sweep builds its live-set from CODEC-VALIDATED rows, so a schema-invalid-but-present account row gets its sealed imported signing key really-deleted (permanently un-signable account) — **N-24** — authwit restore writes duplicates ((account,hash) pairs re-imported from a cloned backup each burn cap headroom) — and **N-20 hardening only** (the finding is REFUTED as production-reachable; the allocator hardening + a CORRECT pin ship, the defective proof `c5-3` is dropped). Spec: `implementations-plan/audit-448-remediation/runbook.md` batch 5; recon: [recon.md](./recon.md). Base: dev `f8faf6b8`. Tier: **light** (bounded, three surgical fixes in two services + one allocator, no cross-package surface).

## Light floor — verified Facts (all recon-verified with file:line)

1. `sweepOrphanImportedKeys` (account/service.ts:120-127) live-set comes from codec-validated `liveRows()`; `allRowIds()` enumerates raw — the asymmetry IS the bug.
2. `rawAddressesForProfile` (:543-557) is the in-file F-B23 precedent: identity from canonical keys via `rawStringEntries()`; `accountRowId()` equals the key-suffix shape, so a raw key-set compares directly (no parse).
3. Authwit hashes are legitimately shared across accounts (revokeAuthwits :199-205) — the dedupe key MUST be compound `(account, hash)`; tx restore's bare `contains(hash)` would false-reject.
4. `nextNumericId`'s bare `+x` lets `"999999999999999999999"` pin the allocator at 1e21 forever (float64 ulp ≈ 2^17 there: `1e21 + 1 === 1e21`); `canonicalNumericStorageId` (purge-rows.ts:93-97) is the proven round-trip filter with an existing alias-table pin.
5. Proof `c5-3` asserts two pure reads of an unmutated store DIFFER — false in every world (adjudication: "can never go green"); it is dropped, replaced by the two correct pins below.
6. No storage shape changes → no migration; `footprint-coverage.test.ts` (Migrations-only) must not move.

No silent Asks: every fix direction, key shape, and test form above is pinned by the recon; the only judgment call (dedupe template = account-restore's storage-seeded + intra-batch Set, not tx's contains) is stated and justified (Fact 3).

## Architecture & Implementation (compact)

- **N-06** (`account/service.ts`): in `sweepOrphanImportedKeys`, build `accountKeys` from `this.storage.rawStringEntries()` key-suffixes instead of `liveRows()`. A codec-hidden row keeps counting as occupied; genuinely-deleted rows don't physically exist, so the sweep still reaps true orphans. Comment: raw-not-decoded is load-bearing (the F-B23 rule: never let a hideable view feed a destructive operation).
  Test (account/service.test.ts, F-B23 style): seed a VALID account row + its imported-key row, plus a MALFORMED account row (raw JSON garbage under a second accountRowId key) + its imported-key row; run the sweep (fresh service init); assert BOTH key rows survive; delete the valid account row physically and re-run; assert its key row is now reaped (the sweep still works).
- **N-24** (`auth-registry/service.ts` restore): inside the lock, seed `const seen = new Set(existing.map((x) => `${x.account}::${x.hash}`))` from `getValues()`, and in `restoreRows`' writer: compound key check → `throw new Error("authwit already exists (account+hash)")` on hit; add post-write. Best-effort semantics preserved (throw = per-row `restoreError`, batch continues).
  Tests (existing P1 block): intra-batch duplicate (row0 clean, row1 `restoreError`); pre-existing-in-storage duplicate (record live, then restore the same pair → `restoreError`); same hash under TWO accounts restores CLEAN (the false-reject trap pinned).
- **N-20** (`id-allocators.ts`): `nextNumericId` maps keys through `canonicalNumericStorageId` and filters `undefined` before `array_max`. Empty-post-filter yields 1 (unchanged contract). Import from purge-rows.
  Tests (id-allocators.test.ts): (1) exclusion pin — `["0","1","999999999999999999999"]` allocates `2`; (2) write-back loop pin — allocate, add `String(id)` to the store, allocate again → strictly increasing small integers across 3 rounds with the poisoned key present (genuinely RED pre-fix: the 1e21 pin repeats); (3) alias table — `"0x10"`, `"01"`, `" 1"`, `"1e3"` contribute nothing.
- OUT: auth-registry's inlined max (incidentally immune via `keyIdentityMode: "numeric"` — recon-verified; a comment there noting the immunity is the only touch, if any); any migration/footprint change; `imported-keys-repository` API changes.

## Security & Adversarial

Backup blobs and storage keys are hostile input (CLAUDE.md posture): N-24 stops attacker-shaped duplicate inflation of the per-account cap; N-20 stops a hostile/corrupt key from wedging or colliding id allocation; N-06 stops data-integrity failures from cascading into key destruction (fail-open on unparseable = keep, never delete). None of the three changes a trust boundary; all three make destructive/allocating paths conservative.

## Validation

Per-fix: the colocated suites above. Batch: `bun run audit:vue`; smoke (SW/services touched); full solo `e2e:agent` (restore + token flows are network-adjacent). Then post-impl: `/code-review max --fix` → codex loop → PR (title ≤93) → checks → squash-merge.

## Ledger

Dedupe key compound (Fact 3); account-restore template over tx (multi-row batch shape); c5-3 dropped with rationale + two correct pins (adjudication mandate); auth-registry inline max untouched (immune, verified); footprint-coverage untouched (Migrations-only).
