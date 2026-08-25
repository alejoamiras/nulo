# data-safety — batch 5 of audit-448-remediation (rev 2)

Fixes **N-06 (launch-gate bullet)** — the orphan imported-key sweep builds its live-set from CODEC-VALIDATED rows, so a schema-invalid-but-present account row gets its sealed imported signing key really-deleted (permanently un-signable account) — **N-24** — authwit restore writes duplicates ((account,hash) pairs re-imported from a cloned backup each burn cap headroom) — and **N-20 hardening only** (the finding is REFUTED as production-reachable; the allocator hardening + a CORRECT pin ship, the defective proof `c5-3` is dropped). Spec: `implementations-plan/audit-448-remediation/runbook.md` batch 5; recon: [recon.md](./recon.md). Base: dev `f8faf6b8`. Tier: **light** (bounded, three surgical fixes in two services + one allocator, no cross-package surface).

## Light floor — verified Facts (all recon-verified with file:line)

1. `sweepOrphanImportedKeys` (account/service.ts:120-127) live-set comes from codec-validated `liveRows()`; `allRowIds()` enumerates raw — the asymmetry IS the bug.
2. `rawAddressesForProfile` (:543-557) is the in-file F-B23 precedent: identity from canonical keys via `rawStringEntries()`; `accountRowId()` equals the key-suffix shape, so a raw key-set compares directly (no parse).
3. Authwit hashes are legitimately shared across accounts (revokeAuthwits :199-205) — the dedupe key MUST be compound `(account, hash)`; tx restore's bare `contains(hash)` would false-reject.
4. `nextNumericId`'s bare `+x` lets `"999999999999999999999"` pin the allocator at 1e21 forever (float64 ulp ≈ 2^17 there: `1e21 + 1 === 1e21`); `canonicalNumericStorageId` (purge-rows.ts:93-97) is the proven round-trip filter with an existing alias-table pin.
5. Proof `c5-3` asserts two pure reads of an unmutated store DIFFER — false in every world (adjudication: "can never go green"); it is dropped, replaced by the two correct pins below.
6. No storage shape changes → no migration; `footprint-coverage.test.ts` (Migrations-only) must not move.

No silent Asks: every fix direction, key shape, and test form above is pinned by the recon; the only judgment call (dedupe template = account-restore's storage-seeded + intra-batch Set, not tx's contains) is stated and justified (Fact 3).

## Architecture & Implementation (rev 2 — codex round-1 findings folded)

- **N-06** (`account/service.ts`): in `sweepOrphanImportedKeys`, build `accountKeys` from **`this.storage.getKeys()`** (NOT `rawStringEntries` — that skips non-string-VALUED rows, so an object-stored account would still false-delete; `getKeys` is the widest physical view, and identity needs only the key suffix). **The sweep becomes AWAITED inside `init`** (try/catch + log there): the prior fire-and-forget raced `importAccount`'s key-first write order — sweep snapshots accounts → import writes the key row → sweep deletes it → import writes the account row. Init-awaited, no service call can interleave.
  Tests (account/service.test.ts, F-B23 style, fresh service start per case): (1) malformed account row (raw garbage under a real accountRowId key) + its key row → key row SURVIVES; (2) a TRUE orphan key row (no account key at all) → DELETED — proves the sweep actually ran, de-vacuousing (1); (3) object-valued (non-string) account row + its key row → key row survives (the `getKeys` discriminator).
- **N-24** (`auth-registry/service.ts` restore): compound identity encoded **injectively** as `JSON.stringify([account, hash])` (accounts/hashes are arbitrary attacker-shaped strings — a `::` delimiter is forgeable: `("a::b","c")` vs `("a","b::c")`). The `seen` seed comes from **raw payloads** (`rawStringEntries` + lenient JSON.parse, extracting `account`/`hash` when present) — `getValues()` hides malformed/key-aliased rows whose pairs must still block duplicates. The sequential id cursor additionally skips **raw-occupied numeric keys** (`getKeys`-derived occupancy) so a hidden row is never overwritten. **NO `assertWithinCap` in restore** — these are already-granted authorizations; rejecting unique rows would destroy the only revocation index.
  Tests (existing P1 block): intra-batch duplicate (row0 clean, row1 `restoreError`); pre-existing-in-storage duplicate; same hash under TWO accounts CLEAN; **delimiter-collision pair** (`("a::b","c")` + `("a","b::c")` both restore clean); hidden-row cases: a raw-malformed row carrying (A,H) blocks a restore of (A,H), and a hidden row's numeric key is never overwritten (cursor skips it).
- **N-20** (`id-allocators.ts`): `nextNumericId` filters keys through `canonicalNumericStorageId` **plus an allocator-local `Number.isSafeInteger` bound** — canonical-but-unsafe keys exist (`"1e+21"` round-trips `String(1e21)`; `"9007199254740992"` = 2^53 round-trips exactly) and both still pin `+1`. The composition lives in the allocator (a new local guard), NOT in `canonicalNumericStorageId` itself — hardening the shared helper would silently change purge-classification semantics. Silent exclusion (no purge — retention; logging optional). Empty/all-rejected stores yield 1; exhaustion near MAX_SAFE_INTEGER is documented as unreachable-by-construction.
  Tests (id-allocators.test.ts): (1) exclusion — `["0","1","999999999999999999999"]` → `2`; (2) canonical-but-unsafe — `"1e+21"` and `"9007199254740992"` contribute nothing; (3) write-back loop — allocate/persist/allocate ×3 strictly increasing with the poisoned keys present (genuinely RED pre-fix); (4) alias table.
- OUT: auth-registry's inlined LIVE allocator (immune via `keyIdentityMode: "numeric"`; changing it is creep per codex), token-store key-identity guards (creep), any migration/footprint change.

## Security & Adversarial

Backup blobs and storage keys are hostile input (CLAUDE.md posture): N-24 stops attacker-shaped duplicate inflation of the per-account cap; N-20 stops a hostile/corrupt key from wedging or colliding id allocation; N-06 stops data-integrity failures from cascading into key destruction (fail-open on unparseable = keep, never delete). None of the three changes a trust boundary; all three make destructive/allocating paths conservative.

## Validation

Per-fix: the colocated suites above. Batch: `bun run audit:vue`; smoke (SW/services touched); full solo `e2e:agent` (restore + token flows are network-adjacent). Then post-impl: `/code-review max --fix` → codex loop → PR (title ≤93) → checks → squash-merge.

## Ledger

- Dedupe key compound (Fact 3) → rev 2: JSON-array-encoded (injective, codex R1); account-restore template over tx.
- c5-3 dropped with rationale + the two correct pins (adjudication mandate; codex R1 confirms the defect analysis and the replacement).
- Codex R1 (REJECT, 6 findings, ALL adopted): getKeys over rawStringEntries (non-string-valued rows); sweep awaited in init (destructive startup race vs key-first import); injective pair encoding; raw-payload seeding + raw-occupancy id cursor; NO assertWithinCap in restore (would destroy the revocation index); allocator-local safe-integer bound (canonical-but-unsafe keys) kept OUT of the shared helper (purge-semantics preservation).
- **Tier escalation (codex R1 ask, granted)**: light → light+1 — one additional codex audit round on rev 2 before implementation (the boot-time deletion race + the shared allocator boundary justify a second set of eyes; a full mid-tier second-model leg would be over-ceremony for three S-fixes — logged as the deliberate middle path).
- Auth-registry inline live allocator untouched (immune, verified; codex R1 concurs); footprint-coverage untouched (Migrations-only).
