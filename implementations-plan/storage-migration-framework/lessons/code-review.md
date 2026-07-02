# Post-impl `/code-review max --fix` — findings + disposition

Three parallel lens-reviewers (correctness/concurrency · security/adversarial · quality/simplification) over the branch diff; every finding verified against the code before applying. Fixes land as a SEPARATE commit from the implementation (provenance for the codex audit).

## Adopted — the big four (all engine)
1. **[Critical] Stamp-vs-clear crash window silently reverted committed data.** A kill between `version=N` and the journal clear made the next boot's resume restore the pre-migration backup UNDER the already-stamped marker — old-shape data, new version, zero signal, migration never re-runs. Resume now compares `version >= backup.version` ⇒ completed ⇒ clear WITHOUT restoring. (New test: "crash AFTER stamp but BEFORE journal-clear".)
2. **[High] Failure left `running` set for the rest of the boot** — the "boot degraded" path wedged every facade call on the barrier and showed a permanent UPDATING (not the degraded banner). Failures now restore + clear the journal IMMEDIATELY (same next-boot convergence via the unchanged version, no wedge); a failing restore keeps the journal and returns `needs-recovery` with BOUNDED retries.
3. **[High] Restore re-inferred refs from backed-up key NAMES** — misclassified `@`-bearing value keys as roots (could tombstone sibling profiles' keys) and missed rows created under roots that were EMPTY at backup time. `BackupPayload` now carries the migration's DECLARED refs; `rootsFromKeys` deleted. (New tests: empty-root tombstoning; `@`-value-key sibling safety.)
4. **[High] Commit-time footprint enforcement.** Staged keys outside the declared `writes` (or inside the reserved `nulo:schema:` namespace / the legacy key) now fail the migration — an undeclared write isn't in the backup and can't be restored, so it's rejected instead of silently committed. (Negative tests added.)

## Adopted — the rest
- Run-scoped `running` marker (whole run, no inter-migration gaps); the residual check-then-act TOCTOU documented in the facade header (true mutual exclusion = the deferred SW-routing follow-up).
- Degraded boot clears a stale `blocked`; `needs-recovery` gained `retryable` (transient restore failure → "reopen to retry" copy; corrupt marker/legacy/invalid backup → terminal).
- Invalid journal backup = tampering (it's written atomically, partial-from-crash impossible) → fail closed, journal kept; restore filters engine-namespace/legacy keys from a crafted backup.
- MigrationBarrier: events-win race guard (a stale `refresh()` snapshot can no longer resurrect a cleared state — deferred-get test proves it); running>degraded precedence test; style/copy nits (headers, `--yellow` fallback, dismiss-WHY comment).
- Facade-ban DENYLIST: `wallet/services/*/client*` (runs in UI pages) is denied despite the `wallet/` allowance.
- `MinimalStorageArea` deduped (re-exported from `entity_storage`); `StagingArea` extracted to `staging.ts`; failure field unified to `reason`; `isValidMarker` is a type predicate; cast-free ref filtering; plan-phase vocabulary stripped from comments; false "reset/uninstall wipe set" claim removed.
- Shared `tests/helpers/chrome-storage-mock.ts` (call-time snapshots + deferrable gets) replaces two divergent inline mocks; e2e imports the fixture's exported constants, guards `profileDir` cleanup, and waits for the journal clear before asserting it empty (kills a stamp-vs-clear poll flake); constructor-validation tests added.

## Rejected / deferred (with reasons)
- **Reject-all port handler before the blocked-boot throw** (dApp requests hang silently): acceptable fail-closed posture, barrier covers the human UX; a pre-services handler is new surface — deferred.
- **Dropping write-side generics on `setRows`/`setValue`**: kept — symmetric API; the interface doc already disclaims that type params assert rather than validate.
- **Cross-context lease (`navigator.locks`) for the residual barrier TOCTOU**: belongs to the route-all-UI-storage-through-the-SW follow-up; documented instead.
- **Engine test count: 23 → 32; facade/barrier/ban: 19 → 22.**

## Verified-fine (security lens, recorded)
No XSS in the barrier (mustache-escaped); fixture prod-exclusion chain sound end-to-end; workflows least-privilege, no injection; independent raw-storage tree scan matches the ban; the backup duplicating encrypted profile ciphertext stays within the same storage trust domain (no new exposure, cleared on success).

## Codex post-impl audit (3 rounds → approve)
- **R1 `reject`** — 3 blockers, all verified real: (1) resume ran before marker validation → an armed journal with a missing version could restore/clear then FRESH-STAMP hostile state; (2) a non-breaking failure returned immediately → degraded boot on data with LATER migrations unapplied; (3) syncedRef adopted raw `onChanged` newValues mid-migration. Fixed in `be501e5` (+ Mediums: ref-shape validation, attempts-before-clear, structural registry test).
- **R2 `reject`** — sharper: `typeof version !== "number"` still admitted `-1`/`1.5`/`999`/`NaN` (typeof number!) into the restore/clear matrix; `backup.version` unbounded before its refs were trusted. Fixed in `514385f` (full `isValidMarker` + `1..maxVersion` bounds under an armed journal; per-value pinning tests).
- **R3 `approve`** (unconditional).
Residual, explicitly accepted by the auditor: the documented facade check-then-act TOCTOU (deferred to the SW-routing follow-up). Final counts: engine tests 37, facade/barrier/ban 22, registry structural 3, e2e 4/4 (re-proven after every engine change).

## Final fresh-context round (user-requested, key-infra bar): fable max + fresh codex — BOTH found new real issues
Two zero-context auditors, primed with the fixed ledger to hunt beyond it. They triangulated:
- **[codex Critical] Post-stamp cleanup failure restored old data under the stamped version** — the synchronous twin of the crash window: `remove(BACKUP)` sat inside the try, so its rejection fired the restore AFTER `version=N` landed. Fixed with a `stamped` flag (cleanup failure after the stamp = success; the orphaned backup is swept, never restored, on the next run). Pinning test incl. the orphan sweep.
- **[both High] `run()` could THROW** (barrier set / snapshot / backup writes sat outside every catch — disk-full territory) → no blocked status, potentially stranded barrier, permanent silent "Updating". The engine is now contractually non-throwing (any unexpected throw ⇒ barrier cleared + retryable `needs-recovery`); runtime adds a belt-and-braces catch. Tests: failing backup write, failing barrier write.
- **[fable Medium] The e2e fixture squatted version 2** — the exact slot the template assigns the first real migration → duplicate-version SW boot crash across ALL smoke builds the day it lands. Fixture moved to a 9001 sentinel + template note.
- **[codex High] Authoring guardrails**: an authored-but-unimported `NNN-*.ts` file passed CI silently → registry test now fs-scans the dir and requires registration + version CONTIGUITY from the baseline. And migrations could bypass staging via raw `chrome.storage` (the dir sat inside the ban's `wallet/` allowance) → migrations dir added to the ban DENYLIST.
- **[fable Low, adopted] workflow env coupling single-sourced** (`MIGRATION_FIXTURE_ARMED`).
- **Accepted as tracked follow-ups** (both auditors' explicit non-blockers): up()-hang watchdog (M2), cross-code-version retry-budget nuance (L1), re-execution of terminally-blocked migrations per boot (L2), facade not gating on `blocked` (L3), MemStore's all-or-nothing set vs chrome's partial-set reality (L5), non-vacuous-test enforcement for future migrations (L6).
Engine tests 37 → 40; registry structural 3 → 5; ban 5 → 6.
