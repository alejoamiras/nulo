# backup-integrity — round-2 plan 1 (blueprint light)

Scope authority: [round-2 scope](../complexity-residue-round-2/scope.md) § plan 1. Two PRs,
BL/C. Burns 9 directives (PR-a: validateTransform 53, registry 50 + 41, migrator 36; PR-b: the
restore surface's 5 — 47/39/39/207L/21). The retained trio in `row-map-migration.ts` (`cloneJsonValue` 24,
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
- Existing equivalence base: `footprint-coverage.test.ts` (24 instantiated tests: define-time
  rejections, metamorphic guardrail, run-twice idempotence, brand non-forgeability),
  `backup-migration-registry.test.ts` (20), `backup-migrator.test.ts` (12). Gap: not every
  rejection branch's EXACT reason string is pinned, and the reject-oracle ORDERING
  (brand → blocked → uncovered → absent-read) was unpinned.

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
normalize's unknown-slice / non-array / row-shape / missing-id / duplicate-id reasons and
the config projection's toStored/fromStored converter reasons; denormalize's outside-root /
non-string / bad-JSON / id-anchor / vanished-slice reasons; preflight's FOUR message shapes
(non-branded, blocked, uncovered, absent-required) plus three PRECEDENCE pins fixing the
reject-oracle order (brand → blocked → uncovered → absent-read); parameterized field-name
pins proving `where` and `target` both propagate through the hoisted helper. 43 pins total.
Denormalize's `non-migratable slice` branch is unreachable through the current registry
(ownerOf returns only root/value-projection descriptors) — it is preserved mechanically,
not pinned. Then the three existing suites + the pins stay zero-edit green across the
refactor commits.

### Rollback

Squash revert restores the monolith; no persisted-state or wire-shape change exists (pure
in-memory functions). No migration semantics change — the same objects, same order.

### Acceptance (PR-a)

- Directives burned: 4 (53/50/41/36); manifest 126 → 122 via regen; zero inserted.
- `footprint-coverage` + registry + migrator + pins suites green, zero edits to existing.
- Gates: ALL FOUR binding specs on PR-a (it changes every full-import path):
  backup-migration-roundtrip, backup-restore-integrity, backup-restore-sw-restart,
  profile-reimport-matrix via `e2e:agent` — plus audit:vue, test:ci-gating. PR-b re-runs
  the same four.
- Codex conditions folded (session 01a05d54): coverage index built fresh per preflight
  invocation (never module-cached — the registry is only TypeScript-readonly), treated
  read-only by the per-migration validator; ordering pins added; converter + where/target
  pins added; counts corrected.

## PR-b — restore surface (this PR)

### Recon

- `account-state/normalize.ts` (199L): `normalizeAccountStateSlice` (39) — three sync
  phases over hostile input: gates (array/serializable/size caps) → duplicate-network merge
  loop (malformed counting) → per-network cap enforcement. Violation-record strings are the
  oracle. Cuts: `mergeSliceItems(inputItems, violations)` → byNetwork map + malformed
  counters appended as violations; `applyNetworkCaps(byNetwork, violations)` → items.
- `account-state/service.ts` (383L): `restore` (47) — async, deadline-budgeted,
  per-network {unreachable, skippedByDeadline} state + `classify` closure; two await-bearing
  loops (senders, contracts). Cuts preserving await parity: hoist each loop to
  `restoreSenders(...)` / `restoreContracts(...)` guarded by
  `if (item.senders.length > 0)` so the zero-entry fast path stays synchronous (non-empty
  paths already awaited ≥1×); per-item context out-param `{unreachable, skippedByDeadline}`
  travels between the two (contracts sees senders' unreachable). `classify` hoists with the
  context. Deadline `expired()` passed as a thunk (read-at-call-time).
- `export/full.vue` (682L): `handleBackup` (39) — generation-fenced export flow. Cuts as
  SETUP-LEVEL sibling functions (nesting 0): `acquirePasskeyCredential(gen)` (the Path-A
  try/catch verbatim, returns credential | "handled"), `exportKeyMaterial(gen, cred)` (the
  discriminated export try/catch, returns material | "handled"), `buildBackupEnvelope(material)`
  (sync). Every gen-check keeps its exact position (catch blocks travel with their try;
  stage boundaries already sat at await + gen check — no new seams). isBusy latch +
  finally stay in the orchestrator.
- `composables/useProfileImportFlow.ts` (358L): ONE length directive (207 lines) — split
  the returned-flow builder at its handler seams (no cognitive directive; pure length).
- `utils/full-backup-helpers.ts` (458L): one 21 — a single shallow extract-helper.

### Equivalence

- normalize: exact violation-string pins (pre-extraction) + existing suite.
- service.restore: pins via the service test harness — unreachable propagation
  (sender connectivity failure → contracts all SKIP_UNREACHABLE), deadline skip counting,
  network-not-found precedence over address-parse (pre-existing contract, keep verbatim),
  protocol-contract skip (address ≤ 6). Check existing account-state tests first.
- full.vue: full.test.ts harness — stage-order + silent-cancel (UserRejectedError resets
  isAgreed) + wrong-password path + gen-fence (superseded run writes nothing) pins where
  not already covered.
- Gates: all four backup e2e specs re-run (sharded per owner directive: 2×2 parallel
  agent runs).

### Acceptance (PR-b)

- Directives burned: 5 (47/39/39/207L/21); manifest 122 → 117 via regen; zero inserted.
- Existing account-state + full.vue + import-flow suites green, zero edits; new pins green
  pre- and post-refactor.
- Gates: the four backup e2e specs re-run SHARDED (2×2 parallel agent runs, proverless
  where gated) + audit:vue + test:ci-gating.

## Codex loop

One session for the plan; position exchange on the decomposition above before
implementation; post-impl review to approve per PR.
