# backup-integrity — round-2 plan 1 (blueprint light)

Scope authority: [round-2 scope](../complexity-residue-round-2/scope.md) § plan 1. Two PRs,
BL/C. Burns 8 directives (validateTransform 53; registry 50 + 41; migrator 36; then the
restore surface's 4). The retained trio in `row-map-migration.ts` (`cloneJsonValue` 24,
`applyRowTransform` 39, `retypeValue` 23) is owner-signed residue — untouched.

## PR-a — migration core (this PR)

### Recon

- `row-map-migration.ts` (363L): `validateTransform` (53) is define-time well-formedness —
  four independent clause validators (`fields` closure; rename table; remapValues chain
  check; cross-clause addDefault overlap) sharing only `target` for error prefixes. All
  throws; error strings are the contract.
- `backup-migration-registry.ts` (406L): `normalizeBackupData` (50) = unknown-slice gate +
  per-descriptor switch (root rows loop / value-projection / pass-through);
  `denormalizeBackupData` (41) = scratch-entry classification loop + registry reassembly
  switch. Both Result-typed (`{ok:false, reason}`), fully synchronous.
- `backup-migrator.ts` (168L): `preflightPending` (36) = coverage-index build + per-migration
  three-gate loop (branded check / blocked-or-uncovered refs / absent-required reads).
  Synchronous; returns a result or undefined.
- Existing equivalence base: `footprint-coverage.test.ts` (18 tests: define-time rejections,
  metamorphic guardrail, run-twice idempotence, brand non-forgeability),
  `backup-migration-registry.test.ts` (12), `backup-migrator.test.ts` (12). Gap: not every
  rejection branch's EXACT reason string is pinned.

### Decomposition (all extractions module-private, synchronous — no await seams exist)

- `validateTransform` → orchestrator + `assertFieldNames(target, names, where)` (the
  hoisted `fields` closure), `validateRenameClause(target, rename)`,
  `validateRemapChains(target, remapValues)`, `validateAddDefaultOverlap(target, t)`.
  Throw sites and message text byte-identical.
- `normalizeBackupData` → orchestrator keeps the registry loop + kind switch; extract
  `normalizeRootSlice(name, desc, slice, entries)` and value-projection arm stays inline
  (5 lines). Root handler returns a reason string or undefined; entries mutation in place.
- `denormalizeBackupData` → extract `classifyScratchEntry(key, raw, rowsByService,
  valueByService)` (phase-1 body, returns reason|undefined) and
  `reassembleSlices(rowsByService, valueByService, normalized)` (phase-2 switch).
- `preflightPending` → extract `buildCoverageIndex()` ({coveredRoots, coveredValueKeys,
  blocked}) and `preflightMigrationRefs(m, index, absentRoots, absentKeys)` (the per-
  migration gates, returning result|undefined); orchestrator is the loop.

### Equivalence (characterization-first)

Pre-extraction pins committed FIRST in `backup-migration-core.pins.test.ts`: exact-reason
assertions for every branch that moves — validateTransform's 12 rejection messages;
normalize's unknown-slice / non-array / row-shape / missing-id / duplicate-id /
value-projection-failure reasons; denormalize's outside-root / non-string / bad-JSON /
non-migratable / id-anchor / vanished-slice reasons; preflight's three incompatible/failed
message shapes (positional data included). Then the three existing suites + the pins stay
zero-edit green across the refactor commits.

### Rollback

Squash revert restores the monolith; no persisted-state or wire-shape change exists (pure
in-memory functions). No migration semantics change — the same objects, same order.

### Acceptance (PR-a)

- Directives burned: 4 (53/50/41/36); manifest 126 → 122 via regen; zero inserted.
- `footprint-coverage` + registry + migrator + pins suites green, zero edits to existing.
- Gates: `bun run e2e:agent tests/e2e/network/backup-migration-roundtrip.test.ts` (+ the
  plan's other three specs ride PR-b where the restore surface changes) — plus audit:vue,
  test:ci-gating.

## PR-b — restore surface (next PR)

`account-state/{service,normalize}.ts` (47, 39), `export/full.vue` (39),
`useProfileImportFlow.ts` (207L), `full-backup-helpers.ts` (21). Recon + decomposition
sections land with that PR; gates: backup-restore-integrity, backup-restore-sw-restart,
profile-reimport-matrix (+ roundtrip re-run if migration files were touched again).

## Codex loop

One session for the plan; position exchange on the decomposition above before
implementation; post-impl review to approve per PR.
