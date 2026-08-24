# Cluster F2b — backup envelope format + restore data integrity (data lens)

> Scanner: general agent, 2026-08-22. Scope read in full: backup/**, useFullBackupImport validate/decrypt sections, export side, migration engine, migrations registry.

## F2b-1 — Export flow: no re-entrancy guard + no error boundary around slice collection; SW death strands the UI; reachable interleaving ships a self-rejecting backup

**Severity:** Major | **Repro confidence:** high (double-run + stranded spinner); moderate (stale-checksum artifact) | **Type:** race / missing error handling → hung UI + self-inconsistent artifact
**CONVERGED with F2a Finding 1** — this scanner adds the checksum-stale-write detail:

- Both runs share module-level `let backup` binding (:58): each run reassigns it (:169) then mutates "whatever it currently points to" in the slice loop (:193-198) → interleaved writes into one object.
- Checksum computed as stringify → await digest → assign (:200). The await gap between snapshot and assignment is a stale-write window: A finishes slices first, executes JSON.stringify(backup) (snapshot S₁), awaits getHashHex; during that digest await B writes its final slice; B hashes true final content and assigns checksum = H(final); afterwards A's digest resolves and OVERWRITES checksum = H(S₁). A is last writer; nothing re-hashes. **The downloaded file's embedded checksum no longer matches its body → importing this pristine file dies at the integrity gate ("corrupted or has been tampered with").**

Smallest safe fix (extends F2a's): move status flip before crypto awaits; try/catch/finally around loop; ALSO compute hash synchronously from the same snapshot string used for download (single stringify, hash + body from one variable).

Instances: full.vue:102 (guard), :164 (late status), :169+ :193-198 (shared binding + unguarded loop), :200 (hash/assign gap), :245-258 (Enter re-entry).

## F2b-2 — No size bound anywhere on full-backup import path: wrongly-picked large file freezes/kills popup before any validation

**Severity:** Minor | **Repro confidence:** high (code shape), moderate (frequency) | **Type:** hostile-input-becomes-crash
**CONVERGED with F2a Finding 3.** Extra detail: plain-text huge file → JSON.parse(text) on gigabytes blocks renderer. Benign fallback quirk at files.ts:111-114 (decompress failure resolves raw gzipped file; downstream lands on "Unrecognized Backup File", so truncation/gzip-corruption otherwise handled cleanly).

## Verified clean (no finding)

- Checksum round-trip determinism: checksum added last at export; import strips via rest destructuring preserving insertion order; JSON.parse→stringify order-/escape-stable (incl. lone surrogates post-ES2019); unicode names byte-identical.
- Version gates: epoch Set(4) rejects undefined/string/old fail-closed; schema-version integer ≥1 ≤ max; from == current → validated noop (normalize/denormalize still run so zero-migration imports fully shape-checked); future versions rejected pre-work. With realMigrations=[] baseline 1 every epoch-4 legit backup is current-shape.
- Engine: crash-resume decision table incl. stamped semantics, version ≥ backup.version ⇒ clear-not-restore; guarded commit rejecting undeclared writes; reserved-prefix filtering in snapshot + scratch read-back; per-(version,phase) durable attempt counters; restore-by-declared-refs tombstoning created rows. MemoryStorageArea seeded in exact live key/value format matches chrome.storage semantics for everything engine touches.
- Row-map DSL: define-time canonicalization (accessor/Proxy/__proto__/symbol rejection); clause-order idempotency rules; fail-closed interpreter.
- Anchors/normalization: accountRowId anchor consistent both sides by construction; numberAnchor rejects NaN/∞/non-numbers; duplicate row ids / unknown slice names / non-array-null slices rejected; ownerOf root-prefix matching safe (no @ in roots); config projection lossless with null-proto __proto__ defenses both directions.
- Restore pipeline: unconditional profileId remap closes victim-graft hole; result-index network/token pairing w/ dup-source-id backstop; tx keyed (chainId,account), balances extra token-chain equality pass; active-network pointer resolved only through successful index pairs, unset on mismatch (never dangling); duplicate-account aborts batch with bounded rollback + liveness-gated disconnect handling; imported-keys DEK source→destination rewrap with orphan reconciliation; account-state normalizer enforces caps, routes malformed slices into visible violation records behind bounded wall-clock budget; restoreRows guarantees one ordered result per input underwriting all index pairing.
- Export edge states: degraded/no-DEK session fails export loudly (service.ts:1644-1646); passkey export requires completed ceremony; empty slices round-trip as []; optional slices absent-stay-absent; gzip download ↔ auto-decompressing picker round-trips; entropy/master pairing re-verified at restore before anything seals.
