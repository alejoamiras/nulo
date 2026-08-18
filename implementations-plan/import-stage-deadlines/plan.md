# import-stage-deadlines — ARC B: import stage deadlines + console-capture truth (mid tier)

Execute the SETTLED design of the flake-ledger's `importFullBackup`-300s entry
(the remaining half: per-stage envelope measurement in both proving modes +
the early-fail classification), and close the consoleErrors blind-spot entry
on its root cause (the console-sniffer reroute — found and confirmed at
recon). Both OPEN ledger entries re-dispositioned. Delivered as a 2-PR
`gh stack` into dev.

**Audit trail**: codex round 1 `reject` (session `01a01612`) + fable
`conditional approve` — both folded; final fresh-context codex
(session `01a01621`) **`conditional approve`** with five conditions — ALL
FOLDED below — and the row-3 dispute **RULED OUT** (trajectory-labels-only).
`eli5_mode: artifact`.

## Clarifying answers (Phase 0 — self-answered from the goal + committed artifacts)

- **Success criterion**: (a) a committed per-stage envelope table
  (`envelopes.md`) from ≥5 solo measurement runs per proving mode, read off
  `data-restore-stage`, stratified by scenario (never pooled), with the
  solo-local-baseline caveat; (b) `importFullBackup`'s wait reshaped:
  trajectory diagnostics for every consumer, structured lapse errors with
  terminal/degraded labels, the unchanged hardcoded 300s as the SOLE overall
  criterion — NO early exits of any kind, NO per-stage deadline mechanism
  (classification outcome: none qualifies); (c) reshaped waits green 3×
  consecutive solo (`NULO_E2E_RETRY=0`); (d) BOTH ledger entries
  re-dispositioned; (e) fixture comments + e2e-testing skill carry the
  console-capture truth incl. the residuals; (f) PRs green on all three
  status gates, codex iterate-until-approve + `/code-review max --fix`,
  stack merged.
- **Scope IN**: submit-half extraction (converging the crash-truth
  duplication); the internal stage-aware recorder + structured diagnostics;
  focused unit tests for the pure helpers; the measurement campaign; the B2
  confirmation probe + documentation; ledger/skill/fixture updates; the
  parked-ARC-A docs already on this branch.
- **Scope OUT**: terminal-stage / errors-screen early exits (row 3 RULED
  OUT — reacting to product terminals is a possible FUTURE amendment to the
  normative ledger, recorded as an owner option, not this arc); product code
  changes of ANY kind (`resetBackupState`/`restoreStage`, the dead
  `"picked"` member — owner-visible follow-ups only); product-side stage
  budgets (owner asks only); the REJECTED variants (blind 240/60 split;
  `restoreStatus` stall detector); any timeout/bound RAISE (BANNED — a
  mechanical no-timeout-change gate proves it); a fixture SW CDP console
  tap; folding new capture into the ~50 `consoleErrors` assertions;
  instrumenting `waitForPopup` approval windows (gap recorded, deferred).
- **Constraints**: network e2e SOLO with `NULO_E2E_RETRY=0`; long runs in
  tmux; frozen tree between certification runs; commit signing on; the
  approval gate goes to the ACTIVE owner before implementation.
- **Quality bar**: production test-infra (the suite gates every PR).
- **Validation layers**: `bun run lint` + `bun run typecheck`; `bun run
  test:e2e` (smoke — also runs the new pure-helper tests); `bun run
  e2e:agent tests/e2e/network/<file>` solo for measurement + certification.
- **Decisions surfaced vs delegated**: row 3 was the one dispute — resolved
  OUT by the final fresh-context pass; the owner may overrule at the gate,
  which per that ruling requires FIRST amending the normative flake-ledger
  design as a separate decision. Everything else converged.
- **Post-impl hardening**: `/harden` not scheduled.

## Tier call (Phase 0.5)

Novelty LOW-MODERATE, blast radius MODERATE (e2e infra gates every PR),
irreversibility LOW, migration NONE, external coupling LOW, security LOW.
0–1 HIGH → **mid**.

## Normative spec (committed — do NOT re-derive; precision per audits)

Settled design (ledger verbatim anchor): measure per-stage envelopes in both
proving modes; grant an early-fail window ONLY to stages with a
product-owned deadline — every other stage diagnostics-only; unchanged 300s
as the sole overall criterion. REJECTED variants stay rejected (blind 240/60
split; `restoreStatus` stall detector). **The spec grants the window only
WHERE a product-owned deadline exists — it nowhere requires granting one;
"diagnostics-only everywhere" is a fully spec-compliant close** (all three
audit legs, independently).

Code truth about the one candidate: `chain-sync`'s 45s is one ABSOLUTE
budget (`importChainSync.ts:29`; preflight capped 21s inside it :31/:69;
registration min(30s, remaining) :89) and its designed timeout/probe/restore
rejection paths **degrade to skip records** — the import proceeds to
`finished` (`:90-109`). The product-owned deadline does not INTENTIONALLY
throw (unexpected faults can still escape — precision per the final pass).

consoleErrors OPEN entry (verbatim): "e2e consoleErrors capture cannot see
app `console.*` … browser-emitted entries arrive; console-API calls from the
extension page do not … needs its own infra arc." Root cause (recon,
code-confirmed): the sniffer's SUCCESS path never invokes the native page
console (`console-sniffer.ts:25-30`) — ordinary app `console.*` forwards
over RPC to the SW realm (`logger/utils.ts:115-135`). Precision: the catch
path DOES call the page original; `popup/app.vue:192` calls `console._log`
directly — accurate claim: "successful ordinary forwarding never invokes the
native page console".

## Architecture & Implementation (FINAL — all audit conditions folded)

### B1: submit-half convergence + internal stage-aware wait (read-once recorder)

**Public surface: unchanged.** `importFullBackup(page, filePath, password,
shell, { expectError?: boolean | string })` keeps its exact signature; its 6
consumers are untouched. No new exported wait API, no `overallCeilingMs`
knob; **300_000 hardcoded** as the only import success-wait ceiling.

1. **`submitFullBackupImport(page, filePath, password, shell)`** (exported):
   the pick-file→password→submit half, extracted verbatim;
   `crash-truth.ts`'s `driveImportToSubmit` becomes a thin re-export.
   `reimportToTerminal` KEEPS its own predicate (crash flows differ).
2. **The wait half (internal)** — the final fresh-context pass's simplified
   shape (its condition 2):
   - **Recorder**: armed BEFORE submit — a page-side `MutationObserver` on
     `[data-restore-stage]` pushing `{stage, tMs: performance.now()}` into a
     window-scoped buffer, seeded with the pre-submit baseline entry. NO
     periodic drain loop (a 200ms drain would add ~1,500 page evaluations
     per 300s wait, perturbing the measurement, and is unnecessary: the
     success route is a Vue HASH route — `createWebHashHistory`, same
     `window` stays alive — so the buffer survives success).
   - **Success**: the UNCHANGED `waitForHash(page, shell.successHash,
     300_000)`. When it settles — success OR timeout — ONE final
     `page.evaluate` reads the buffer + current hash + the degraded-screen
     marker and stamps the final observation on the SAME page
     `performance.now()` clock (one monotonic clock for everything).
   - **No early exits** (row 3 RULED OUT): terminal stages (`failed`,
     `rollback-failed`, `rolled-back`) and the Continue-gated screen are
     diagnostic LABELS, never exits. The Continue screen is labeled
     **degraded partial-success, NOT failure** — the product sets
     `restoreStatus="finished"`, retains `importedProfile`, and lets the
     user continue (`useFullBackupImport.ts:806`); its `restoreErrorLog`
     class is BROADER than chain-sync (network/account/token/service-loop
     errors also land there — final-pass finding).
   - **Lapse diagnostics**: on the 300s ceiling, `withTimeoutMessage`
     (`fixtures/extension.ts:1019` — TIMEOUT-only relabeling, preserves
     frame-detach/CDP-disconnect/page-crash identities) attaches the full
     trajectory + labels, with specific copy for: a failure-terminal stage
     (import definitively failed at t+X — the red run's diagnosis), the
     Continue-gated degraded screen, and `finished`+`#/popup/auth`
     ("import finished, activation didn't" — `popup/pages/import.vue:77-89`).
   - **expectError flows: untouched stage-wise** — the banner-text predicate
     remains the sole expectError criterion (its failure paths never set
     terminal stages — scoped to the CURRENT consumer; the option's contract
     is re-checked if a future caller expects a different failure shape).
3. **Measurement contract** (final-pass condition 3 — specified AND
   unit-tested):
   - **Clock**: page `performance.now()` for every event incl. the final
     observation; durations are same-clock diffs.
   - **Stage entry/exit**: entry = observer mutation timestamp; exit = next
     entry (or final observation for the last stage). The `finished→success`
     seam = last `finished` entry → final observation at success.
   - **Vue-coalesced / unobserved stages**: a stage that never produced a
     DOM mutation (e.g. `restoring:account-state` advancing within one
     render turn) is reported **unobserved** — NEVER a zero-duration
     envelope row.
   - **Censoring**: on timeout, the last stage's duration is
     `rightCensored: true`; a missing trace after a page crash yields an
     explicit `traceLost` record, not silence.
   - **Attribution**: `runId = <pid>-<startTs>` per test-file fork (vitest
     forks per file); `file`/`test` from vitest's `expect.getState()`;
     `retryEnv` recorded (`NULO_E2E_RETRY` value) — the campaign contract
     REQUIRES retry=0, so samples are attempt-1 by construction.
   - **Output ownership**: each fork writes its OWN file —
     `nulo-probes-import-stages-<runId>.jsonl` under
     `NULO_E2E_STAGE_LOG_OUT` dir or `os.tmpdir()` (TMPDIR-aware locally;
     `/tmp` in CI where the reserved harvest glob `nulo-probes-*` matches).
     No shared-file truncation problem exists by construction. Enabled only
     under `NULO_E2E_STAGE_LOG=1`; disabled ⇒ ZERO filesystem writes
     (unit-tested). A write failure logs to runner stdout and NEVER fails
     the import wait. Cleanup: the observer disconnects in the final read.
   - ONE atomic JSON object per import: `{runId, file, test, importOrdinal,
     retryEnv, mode, trajectory: [{stage, atMs, durMs|null, unobserved?}],
     outcome, rightCensored}` — `mode` from `process.env.NULO_E2E_PROVERLESS`
     (set by the invoker; agent.sh stamp-verifies the build side).
4. **Focused unit tests** (final-pass condition 3/5 — round-1 codex ask,
   now landed): the pure helpers (trajectory assembly from a raw buffer,
   unobserved-stage handling, censoring, record building, formatter) live in
   `tests/e2e/helpers/import-stage-timing.ts` with a colocated pure-node
   test at `tests/e2e/import-stage-timing.test.ts` — picked up by the SMOKE
   config's `tests/e2e/*.test.ts` glob, no browser launch, no config change.
   Covers: disabled ⇒ no writes; coalesced stages reported unobserved;
   censoring math; non-timeout errors keep their identity (formatter is
   TIMEOUT-only via `withTimeoutMessage` semantics).

### B1 measurement campaign (Phases 2–3)

≥5 solo runs per proving mode of `backup-restore-integrity.test.ts` +
`profile-reimport-matrix.test.ts`, `NULO_E2E_RETRY=0`,
`NULO_E2E_STAGE_LOG=1`, **modes alternated**, tree frozen. Reported BY
SCENARIO × import ordinal, never pooled: integrity (real funded backup,
tampered slices labeled, chain-sync PRESENT), matrix first import
(synthetic, NO account-state slice ⇒ chain-sync SKIPPED), matrix
same-lifetime re-import (tombstone context; correlated within a lifetime —
"valid named workloads", not independent samples). Committed table
(`envelopes.md`): per-stage P50/max per scenario per mode, sample counts,
the seam, unobserved-stage counts, and the caveats — solo-local baseline
(the original lapses were load-dependent CI-shard events; these maxima are
NOT a CI tail estimate; no deadline derives from them), observer-timestamp
precision, tampered-slice labeling.

### B1 classification outcome (Phase 4)

**No deadline mechanism ships; no early exits ship.** All three audit legs:
`chain-sync` (the only code-verified product-owned budget) stays OUT — its
designed overruns degrade internally; its regression already reds the
unchanged 300s with a chain-sync-shaped trajectory; an e2e mirror adds a
false-fire surface for zero unique detection. The ledger entry closes as:
**"measured; the settled classification rule yielded no stage warranting an
e2e early-fail window; 300s unchanged as the sole criterion; diagnostics
improved (trajectory + labeled structured errors)."** Product-budget
candidates from the data → owner asks only. The row-3 amendment option
(product-terminal early-exit as a FUTURE normative-ledger change) is
recorded for the owner.

### B2: confirmation probe → document-as-designed (no CDP tap)

1. **Probe** (throwaway, evidence into `lessons/phase-5.md`): on a
   fixture-opened popup — (a) `console.error("NULO-PROBE-<nonce>")` →
   ABSENT from `page.on('console')`; PRESENT via `readSwLogTrail`
   (`fixtures/journal.ts:217`) **polled past the SW log ring's 2-second
   persistence debounce** (`logger/store.ts:80` — final-pass condition 4);
   (b) an uncaught throw AND a separate unhandled rejection → each PRESENT
   in `pageErrors`; (c) built-artifact check: `dist/chrome/src/popup/index.html`
   preserves sniffer-before-entry script order.
2. **Documentation landing**: fixture comment blocks (`extension.ts:161-174`,
   `:1101-1114`) + the crash file's tap caveat get the mechanism truth; the
   e2e-testing skill gains a dated section; the ledger entry re-dispositions
   as **root-caused + permanent-by-design**, carrying the residuals:
   (i) caught-and-`console.error`'d app errors are invisible on BOTH
   channels (pageErrors sees only thrown/unhandled); (ii) `readSwLogTrail`
   is delayed + bounded diagnostics (2s debounce ring), not a lossless
   channel; (iii) pre-wire `pendingLogs` buffering: entries flush through
   whichever console method FIRST fires post-wiring — **possible
   wrong-severity replay** (final-pass finding) — and are lost entirely if
   wiring never completes; (iv) approval windows (`waitForPopup`) carry no
   listeners (recorded, deferred); (v) per-page array resets.
3. **No fixture SW CDP tap** (all legs concur).

### Key interfaces

```ts
// helpers/import-drivers.ts — public surface UNCHANGED except the new export:
export async function submitFullBackupImport(page, filePath, password, shell): Promise<void>
export async function importFullBackup(page, filePath, password, shell,
  { expectError = false }: { expectError?: boolean | string } = {}): Promise<void>
// wait half internal; 300_000 hardcoded; trajectory in errors + env-gated JSONL
// helpers/import-stage-timing.ts — pure: assembleTrajectory, buildRecord,
// formatTrajectory (+ the env-gated appender); unit-tested.
```

### File-level change map

- `tests/e2e/helpers/import-drivers.ts` — submit-half extraction + internal
  read-once stage-aware wait (MODIFY).
- `tests/e2e/helpers/crash-truth.ts` — `driveImportToSubmit` → re-export
  (MODIFY, thin; `reimportToTerminal` untouched).
- `tests/e2e/helpers/import-stage-timing.ts` — NEW: pure helpers + appender.
- `tests/e2e/import-stage-timing.test.ts` — NEW: pure-node unit tests
  (smoke-glob-matched, no browser).
- `tests/e2e/fixtures/extension.ts` — comment-truth updates only (MODIFY).
- `.claude/skills/e2e-testing/SKILL.md` — dated lessons section (MODIFY).
- `implementations-plan/e2e-deflake/flake-ledger.md` — both entries
  re-dispositioned, edit-in-place (MODIFY).
- Plan artifacts: `plan.md`, `recon.md`, `audit-codex.md`, `audit-fable.md`,
  `envelopes.md`, `certification.md`, `lessons/`.
- NOT touched: ALL product code; the crash file's raw stage reads;
  RestoreGate; every `consoleErrors` assertion; every numeric timeout
  (mechanical gate proves it).

### Non-obvious mechanics

- The observer buffer survives success because the success route is a hash
  route (same window) — the final read happens after `waitForHash` settles
  either way; the observer disconnects in that read.
- Baseline seeding: the arm records the current stage as `baseline: true` so
  a stale pre-submit value (possible: `resetBackupState` does not reset
  `restoreStage`) is distinguishable in the trajectory — labels only
  consider post-baseline entries.
- `errorsScreen` marker read reuses `reimportToTerminal`'s continue-button
  selector (`crash-truth.ts:91`) — one source; labeled degraded, never
  failure.

### Trade-offs & alternatives not taken

- **Terminal-failure early-exit** — RULED OUT (final fresh-context pass):
  outside the settled spec's permitted early-fail set; coverage incomplete
  (status-only failures leave nonterminal stages); the Continue screen is a
  partial-success outcome whose early-exit would misclassify; a future
  normative-ledger amendment is the recorded path if the owner wants it.
- **Composite single `waitForFunction`** — invalid (resolves once).
- **200ms Node drain loop** — measurement-perturbing (~1,500 evaluations per
  wait) + unnecessary (hash route keeps the window).
- **Public `awaitRestoreOutcome` API / `RestoreOutcome` type** — dead API.
- **`PRODUCT_OWNED_STAGE_DEADLINES` table (even empty)** — dead config.
- **Probe-file synthetic campaign** — diverges from real flows; fallback only.
- **Fixture SW CDP console tap** — lifecycle cost, no unique value.
- **`restoreStatus` watching** — adjacent to the rejected stall detector.
- **Raising any bound** — BANNED.

## Security & Adversarial Considerations

- **Self-inflicted flake is the threat**: mitigations — public API, success
  criterion, and the 300s ceiling all unchanged; NO early exits (red-run
  behavior changes only in MESSAGE content, green-run behavior only by one
  pre-submit arm + one final read); recorder is passive (no polling load);
  unit tests pin the pure logic; full smoke + 3× solo certification are the
  empirical backstop.
- **Measurement integrity**: solo, retry=0, frozen tree, alternated modes,
  per-scenario stratification; per-fork run-attributed files (no
  cross-worktree interleaving); env-gated (disabled ⇒ no writes);
  TMPDIR-aware; content is stage names + timings only.
- **No workflow/permission changes; no new deps; no product trust-boundary
  moves**; the B2 probe runs against a local fixture build only.

## Assumptions

**Facts** (verified; final-pass corrections folded):
1. The 300s wait is `import-drivers.ts:182` via hash-only `waitForHash`
   (`fixtures/extension.ts:1194-1196`); lapse = bare TimeoutError.
2. Both import pages expose `data-restore-stage`
   (`popup/pages/import.vue:194`, `onboarding/pages/import.vue:142`).
3. `chain-sync`'s 45s is one ABSOLUTE product-owned budget whose DESIGNED
   overrun paths degrade to skip records (`importChainSync.ts:29-109`); it
   does not intentionally throw.
4. Prover-capable importFullBackup drivers: integrity, matrix,
   migration-roundtrip; the crash file is proverless-only (runner-refused).
5. `/tmp/nulo-probes-*.jsonl` is a failure-only harvest glob
   (`_network-e2e.yml:344-357`) — an artifact path; hygiene is ours.
6. Console blind-spot mechanism: sniffer success path never calls the native
   page console (`console-sniffer.ts:25-30`); catch path does;
   `popup/app.vue:192` uses `console._log`; the routed original fires in the
   SW realm (`logger/utils.ts:115-135`); `readSwLogTrail`
   (`fixtures/journal.ts:217`) reads the ring PAST a 2s persistence debounce
   (`logger/store.ts:80`) — delayed + bounded, not lossless. ~50
   `consoleErrors` assertions exist. Shared `pendingLogs` flushes through
   the first post-wiring method — wrong-severity replay possible
   (`console-sniffer.ts:2,14`).
7. Stage-sequence unit pin `useFullBackupImport.test.ts:1466-1494`; crash
   file reads the marker raw (:213,:433,:451); `expectError` is
   `boolean | string`; `withTimeoutMessage` preserves non-timeout error
   identities (`extension.ts:1013-1030`).
8. The success route is a Vue HASH route (`createWebHashHistory`,
   `popup/index.ts:50`) — same window survives success. `"picked"` is dead
   in the union; `resetBackupState` does not reset `restoreStage`; the
   CURRENT expectError consumer's failure paths never set terminal stages
   (validation reject freezes `restoring:profile`; duplicate-account writes
   no stage); the Continue screen sets `restoreStatus="finished"` + retains
   `importedProfile` (`useFullBackupImport.ts:806`) and its error-log class
   spans network/account/token/service errors (:543,:718,:738).

**Inferences** (attackable):
1. `pageErrors` reliably captures UNCAUGHT throws + unhandled rejections on
   fixture-opened pages — verified by the B2 probe before the ledger close
   asserts it; NOT a general app-error channel (the caught-and-logged
   residual is stated).
2. Envelope variance concentration is UNKNOWN (hypotheses: chain-sync, the
   seam, `restoring:services`, `finalizing`) — the campaign measures.
3. Integrity + matrix runs are kill-free real flows (fresh mounts verified);
   valid NAMED WORKLOADS with labeled caveats — not independent samples.

**Asks** (owner, at the gate):
1. Accept row 3's OUT ruling (no early exits; labels only). Overruling to IN
   requires first amending the normative flake-ledger design — recorded as a
   future option, not this arc.
2. Accept "diagnostics-only everywhere, no deadline mechanism" as the
   classification outcome closing the importFullBackup-300s entry.
3. Accept B2's document-as-designed posture + residuals (caught-and-logged
   errors invisible to assertions; delayed bounded ring; wrong-severity
   pendingLogs replay; uninstrumented approval windows).
4. Product follow-ups recorded (not implemented): `resetBackupState` not
   resetting `restoreStage`; the degraded-import Continue screen + auth-route
   UX; the dead `"picked"` member.

## Decision ledger

| # | Decision | Chosen | Rejected (why) | Source |
|---|---|---|---|---|
| 1 | B1 shape | Hybrid: submit-half convergence + internal read-once recorder (observer buffer + single final read on `waitForHash` settle, one page clock); zero public-surface change | Composite waitForFunction (resolves once); 200ms Node drain (measurement-perturbing + unnecessary — hash route); public wait API (dead); probe-first campaign (synthetic) | 3 legs convergent; recorder shape = final pass |
| 2 | Deadline mechanism | NONE; classification documented (chain-sync out: designed overruns degrade internally; 300s+trajectory catches its regression); "diagnostics-only everywhere" is the spec-compliant close | Empty table + enforcement (dead config); pre-wiring stages (blind-split-adjacent) | 3 legs convergent |
| 3 | Terminal early-exit | **RULED OUT** — labels only. New decisive finding: the Continue screen is a PARTIAL-SUCCESS outcome (`restoreStatus="finished"`, profile retained) — an exit would misclassify; coverage incomplete; outside the settled spec's early-fail set. Future path: normative-ledger amendment (owner option, recorded) | fable's IN-with-fence (fence sound for stale stage values, but the Continue-level check had no transition fence and the semantic expansion exceeds the spec); the plan's red-path e2e case (burns 300s under OUT — replaced by pure-helper unit tests) | final fresh codex ruling; codex r1 concurring; fable position recorded |
| 4 | B2 fork | Probe (debounce-aware) → document-as-designed; residuals incl. wrong-severity pendingLogs replay; `readSwLogTrail` = delayed bounded diagnostics channel; no SW CDP tap | Fixture CDP tap; folding into assertions; product-side sniffer change | 3 legs convergent + final-pass findings |
| 5 | Campaign | Real flows, both modes alternated, per-scenario stratification, per-fork run-attributed env-gated JSONL, solo-local labeling, unobserved-stage honesty | Probe-file loop; pooled samples; fixed shared /tmp path; zero-duration coalesced stages | 3 legs convergent |
| 6 | Diagnostics scope | Trajectory + labeled structured errors for every consumer; degraded/auth-route copy; failure-terminal labels | Bare TimeoutError; `restoreStatus` watching; early exits (row 3) | fable find + final-pass labeling correction |

## Phases & validation gates

### Phase 1 ✓ — Submit-half convergence + read-once recorder + unit tests (B1 code)

> GATE PASSED 2026-08-18: `bun run lint` exit 0; `bun run typecheck` exit 0;
> armed smoke suite (`VITE_NULO_E2E_MIGRATION_FIXTURE=1` build +
> `NULO_E2E_MIGRATION_FIXTURE=1` run) — 27 files / 111 tests passed, EXIT:0,
> incl. `import-stage-timing.test.ts` (16 pins) and the armed
> `backup-migration` expectError path. Evidence: `lessons/phase-1.md`.

Extract `submitFullBackupImport`; implement the internal wait (observer
buffer + final read, labels, structured lapse errors via
`withTimeoutMessage`, hardcoded 300s, env-gated per-fork JSONL); converge
crash-truth's submit half; land `import-stage-timing.ts` + its pure-node
unit tests (disabled ⇒ no writes; unobserved-stage honesty; censoring;
non-timeout identity preservation).

**Gate**: `bun run lint && bun run typecheck` exit 0; `bun run test:e2e`
full smoke green (runs the new unit tests + the existing driver consumers
incl. the expectError path). Layers: lint/typecheck + unit + smoke e2e.

### Phase 2 ✓ — Measurement campaign leg 1 (alternating modes)

> GATE PASSED 2026-08-18: 10/10 alternated solo runs attempt-1 green
> (retry=0), zero exit-86; 30/30 imports with complete attributed records,
> zero trace-lost. Evidence: `lessons/phase-2.md`, `envelopes.md`.

In tmux, solo, frozen tree, `NULO_E2E_RETRY=0 NULO_E2E_STAGE_LOG=1`:
alternate proverless / prover-ON runs of
`tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts`.

**Gate**: all runs attempt-1 green, zero exit-86; every import has a
complete attributed record (or an explicit traceLost). Layers: network e2e
(solo).

### Phase 3 ✓ — Campaign completion

> GATE PASSED 2026-08-18: per-scenario sample sets complete — 5×integrity +
> 5×matrix-first + 5×matrix-reimport per mode, stratified in `envelopes.md`
> (no pooling; scenario + ordinal carried on every record).

Continue alternation to ≥5 runs per mode; verify per-scenario sample sets
(integrity×mode, matrix-first×mode, matrix-reimport×mode) are complete.

**Gate**: sample-count table complete; zero pooling violations. Layers:
network e2e (solo).

### Phase 4 — Envelope table + classification close (B1 docs)

Commit `envelopes.md` (stratified P50/max, seam, unobserved counts,
caveats); codex xhigh consult confirming the close; re-disposition the
importFullBackup-300s entry (edit-in-place); skill lessons; owner asks
written.

**Gate**: `bun run lint` exit 0; codex verdict recorded in `audit-codex.md`.
Layers: lint + docs review.

### Phase 5 — B2 probe + documentation landing

Three-channel probe (console nonce ABSENT page-side, PRESENT in
`readSwLogTrail` polled past the 2s debounce; throw + rejection each in
pageErrors) + built-artifact order check → `lessons/phase-5.md`; land
fixture comments, skill section, ledger re-disposition with all five
residuals.

**Gate**: probe evidence quoted in lessons; `bun run lint && bun run
typecheck` exit 0; `bun run test:e2e` full smoke green. Layers:
lint/typecheck + smoke e2e.

### Phase 6 — Certification (3× solo) + mechanical timeout gate + wrap

3× consecutive solo `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run
e2e:agent tests/e2e/network/backup-restore-sw-restart.test.ts
tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` — attempt-1 green, zero
retries, zero exit-86, frozen tree. (Certification is proverless; prover-ON
coverage of the reshaped wait comes from Phases 2–3's ≥5 prover-ON runs.)
**Mechanical no-timeout-change gate**: enumerate every numeric timeout in
the final diff (`git diff origin/dev...HEAD -- 'apps/extension/tests/**'`
grepped for `\b\d{3,6}\b` literals) and record in `certification.md` that
none increased and `300_000` remains the only import success-wait ceiling.
3 consecutive certification failures → STOP AND SURFACE.

**Gate**: the 3× record + the timeout-diff record + `bun run lint && bun run
typecheck && bun run test` exit 0 at stack top. Layers: network e2e (solo) +
fast layers + the mechanical gate.

## Delivery

`gh stack` into dev, 2 arcs:

- **PR-1 `test(e2e): stage-aware import wait + envelope campaign`** — Phases
  1–4 + the parked-ARC-A docs + plan artifacts. Independently revertable.
- **PR-2 `test(e2e): console-capture truth`** — Phase 5; Phase 6's
  certification record lands here as the stack-top docs commit.

`gh stack init --adopt` the worktree branch as arc 1 (rename to
`isd/stage-wait`), `gh stack add isd/console-truth` at the boundary,
`gh stack submit --draft --auto` early, `gh stack sync` to cascade. Merge
only after certification + the owner-gate conditions.

## Post-implementation (self-contained)

1. `/code-review max --fix` on the implementation diff → skim → commit the
   applied fixes SEPARATELY.
2. Codex post-impl audit (`/codex xhigh`, NEW session): net diff from plan
   baseline; separate summary of code-review commits; this plan + ledger;
   the adversarial ask ("does any diagnostic change mask the identity of
   real faults; does the recorder perturb what it measures; enumerate every
   touched numeric timeout and prove none changed and 300_000 remains the
   only import success-wait ceiling"); verbatim: "Report bugs and small,
   targeted improvements only. Do not propose speculative abstractions,
   extra configuration surface, new layers, or rewrites — the smallest
   change that fixes each real problem. If code works and is clear, leave
   it alone."
3. Iterative fix loop: verify claims against the repo; apply accepted fixes;
   commit; log round in `lessons/`; RESUME the same session with the fix
   diff. Repeat until no new material findings; 3 churning rounds → surface.
4. Delivery per above; per-PR CI green on the three status gates; then
   certification (Phase 6) if not recorded; merge per authority.
5. Close-out: index.md completed marker; manifest status; owner report
   (shipped, consults + verdicts, the recorded product follow-ups + the
   row-3 amendment option).

## Approval

**Approved via the goal's standing authorization** (owner confirmed
autonomous execution in-session, 2026-08-18: "didn't we make our /goal to
run independently…"). The gate's four asks resolve to the audit-converged
defaults: (1) row-3 OUT accepted (labels, no early exits; the
normative-ledger amendment stays a recorded future option); (2) the
no-deadline classification close accepted; (3) B2 document-as-designed +
residuals accepted; (4) the three product follow-ups stay recorded, not
implemented. Implementation proceeds; merge still requires the full Phase-6
certification per the goal's merge authority.

## Seeds

ELI5 Artifact: https://claude.ai/code/artifact/ce1cd30f-a72a-4f9f-bd29-d9cd46ee9fd5
(source: `implementations-plan/import-stage-deadlines/eli5.html` — redeploying
the same file path updates the same URL).

(DRAFT — finalized after the approval gate; recommended `/goal`.)

```
/goal ARC B complete: all six phases marked ✓ in
implementations-plan/import-stage-deadlines/plan.md, each backed by its
validation gate passing in the transcript (phases 2-3: alternated solo
retry=0 runs, ≥5 per proving mode, attributed JSONL samples or explicit
traceLost records; phase 6: the 3× consecutive solo certification record +
the mechanical no-timeout-change record); envelopes.md committed with the
stratified table + caveats; BOTH flake-ledger entries re-dispositioned;
/code-review max --fix applied+committed; codex post-impl fix loop converged
(resumed pass with no new material findings quoted); gh stack PRs ready +
green on quality-status/smoke-e2e-status/network-e2e-status; bun run test
and bun run lint exit 0 in the transcript.
```

Fallback `/loop 15m` synced post-approval.
