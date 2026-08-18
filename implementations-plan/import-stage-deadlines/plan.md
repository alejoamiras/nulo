# import-stage-deadlines — ARC B: import stage deadlines + console-capture truth (mid tier)

Execute the SETTLED design of the flake-ledger's `importFullBackup`-300s entry
(the remaining half: per-stage envelope measurement in both proving modes +
the early-fail classification), and close the consoleErrors blind-spot entry
on its root cause (the console-sniffer reroute — found and confirmed at
recon). Both OPEN ledger entries re-dispositioned. Delivered as a 2-PR
`gh stack` into dev.

**Consolidation state**: dual audit round 1 complete — codex `reject`
(session `01a01612`, findings folded), fable `conditional approve`
(conditions C1–C5 folded). One disputed row (decision ledger row 3) goes to
the final fresh-context codex pass + the owner gate. `eli5_mode: artifact`.

## Clarifying answers (Phase 0 — self-answered from the goal + committed artifacts)

- **Success criterion**: (a) a committed per-stage envelope table
  (`envelopes.md`) from ≥5 solo measurement runs per proving mode, read off
  `data-restore-stage`, stratified by scenario (never pooled), with the
  solo-local-baseline caveat; (b) `importFullBackup`'s wait reshaped:
  trajectory diagnostics for every consumer, structured lapse errors, the
  unchanged hardcoded 300s as the SOLE overall criterion, and — if row 3
  survives its gate — terminal-failure early-exit; NO per-stage deadline
  mechanism ships (classification outcome: none qualifies — see row 2);
  (c) reshaped waits green 3× consecutive solo (`NULO_E2E_RETRY=0`);
  (d) BOTH ledger entries re-dispositioned; (e) fixture comments +
  e2e-testing skill carry the console-capture truth incl. the accepted
  residuals; (f) PRs green on all three status gates, codex
  iterate-until-approve + `/code-review max --fix`, stack merged.
- **Scope IN**: submit-half extraction (converging the crash-truth
  duplication); the internal stage-aware wait + recorder; the measurement
  campaign; the B2 confirmation probe + documentation; ledger/skill/fixture
  updates; the parked-ARC-A docs already on this branch.
- **Scope OUT**: product code changes of ANY kind (incl. `resetBackupState`
  not resetting `restoreStage`, the dead `"picked"` member, and any
  attempt-fence product change — all recorded as owner-visible follow-ups);
  product-side stage budgets (owner asks only); the REJECTED variants (blind
  240/60 split; `restoreStatus` stall detector); any timeout/bound RAISE
  (BANNED — and a no-timeout-change diff gate proves it at post-impl); a
  fixture SW CDP console tap (rejected — `readSwLogTrail` already exists);
  folding new capture into the ~50 `consoleErrors` assertions;
  instrumenting `waitForPopup` approval windows (gap recorded, deferred).
- **Constraints**: network e2e SOLO with `NULO_E2E_RETRY=0`; long runs in
  tmux; frozen tree between certification runs; commit signing on; the
  approval gate goes to the ACTIVE owner before implementation.
- **Quality bar**: production test-infra (the suite gates every PR).
- **Validation layers**: `bun run lint` + `bun run typecheck`; `bun run
  test:e2e` (smoke) whenever the shared driver/fixtures change; `bun run
  e2e:agent tests/e2e/network/<file>` solo for measurement + certification.
- **Decisions surfaced vs delegated**: row 3 (terminal early-exit) is
  DISPUTED between the auditors — resolved by the final fresh-context codex
  pass + the owner at the gate; everything else converged (ledger below).
- **Post-impl hardening**: `/harden` not scheduled.

## Tier call (Phase 0.5)

Novelty LOW-MODERATE, blast radius MODERATE (e2e infra gates every PR),
irreversibility LOW, migration NONE, external coupling LOW, security LOW.
0–1 HIGH → **mid**.

## Normative spec (committed — do NOT re-derive; precision fixed per audits)

Settled design (ledger verbatim anchor): measure per-stage envelopes in both
proving modes; grant an early-fail window ONLY to stages with a
product-owned deadline — every other stage diagnostics-only; unchanged 300s
as the sole overall criterion. REJECTED variants stay rejected (blind 240/60
split; `restoreStatus` stall detector). **The spec grants the window only
WHERE a product-owned deadline exists — it nowhere requires granting one;
"diagnostics-only everywhere" is a fully spec-compliant close** (both
auditors, independently).

Code truth about the one candidate: `chain-sync`'s 45s is one ABSOLUTE
budget (`importChainSync.ts:29`; preflight capped 21s inside it :31/:69;
registration min(30s, remaining) :89) and it **degrades-and-continues** —
overruns become skip records, the import proceeds to `finished`
(`:90-109`); it NEVER throws. An e2e mirror could fire only when the product
mechanism is broken, and that regression already reds the unchanged 300s
with a chain-sync-shaped trajectory.

consoleErrors OPEN entry (verbatim): "e2e consoleErrors capture cannot see
app `console.*` … browser-emitted entries arrive; console-API calls from the
extension page do not … needs its own infra arc." Root cause (recon,
confirmed reading `console-sniffer.ts:25-30`): the sniffer's SUCCESS path
never invokes the native page console — ordinary app `console.*` forwards
over RPC to the SW realm (`logger/utils.ts:115-135`). Precision (codex): the
catch path DOES call the page original, and `popup/app.vue:192` calls
`console._log` directly — the accurate claim is "successful ordinary
forwarding never invokes the native page console".

## Architecture & Implementation (CONSOLIDATED — the audited hybrid)

### B1: submit-half convergence + internal stage-aware wait

**Public surface: unchanged.** `importFullBackup(page, filePath, password,
shell, { expectError?: boolean | string })` keeps its exact signature and
its 6 consumers untouched. No new exported wait API, no `RestoreOutcome`
type (dead API at ship — fable), no `overallCeilingMs` knob (a caller-visible
handle on the sole criterion — codex); **300_000 is hardcoded**.

1. **`submitFullBackupImport(page, filePath, password, shell)`** (exported):
   the pick-file→password→submit half, extracted verbatim;
   `crash-truth.ts`'s `driveImportToSubmit` becomes a thin re-export
   (verified near-verbatim duplication). `reimportToTerminal` KEEPS its own
   terminal predicate (its terminal set genuinely differs — crash flows).
2. **The wait half (internal to `importFullBackup`)** replaces the bare
   `waitForHash`:
   - **Recorder**: armed BEFORE submit (repo precedent:
     `backup-roundtrip.test.ts:124`) — a page-side `MutationObserver` on
     `[data-restore-stage]` pushing `{stage, tMs: performance.now()}` into a
     window-scoped array (no transition can be missed, incl. sub-200ms
     stages); Node drains the array every 200ms alongside a `{hash,
     errorsScreen}` snapshot via one `page.evaluate` (single Node clock for
     envelopes; rAF-throttle-immune — same rationale as `waitForHash`'s
     `polling: 200`). At most one drain window is lost at success-navigation;
     terminals drain on prior polls. The `finished→success` seam is measured
     Node-side (last `finished` drain → hash observed).
   - **Attempt fence (mechanical — codex's stale-marker hazard)**: the
     pre-submit arm reads the CURRENT stage as baseline; terminal
     classification requires a transition OBSERVED AFTER arming. A stale
     pre-submit terminal (possible because `resetBackupState` does not reset
     `restoreStage` — `useFullBackupImport.ts:889ff`) can never classify.
     The fresh-mount invariant is ALSO documented ("assumes a fresh
     import-page mount; reusing a page across attempts reintroduces stale
     reads pre-arm") — today every driver consumer fresh-mounts (verified).
   - **Success**: hash === successHash → resolve (unchanged criterion).
   - **Terminal-failure early-exit** (row 3 — DISPUTED, ships only if its
     gate survives): observed-after-arm transition into `failed`,
     `rollback-failed`, or `rolled-back` (plain flows only), OR the
     errors-screen Continue button rendered (the chain-sync-degraded outcome
     that never auto-routes — `reimportToTerminal` already treats it as
     terminal, `crash-truth.ts:91`) → throw IMMEDIATELY with the trajectory.
     Coverage is PARTIAL and documented: status-only failures (validation
     reject freezes stage at `restoring:profile`; duplicate-account rollback
     writes no stage) still ride to the ceiling — with better diagnostics.
     If row 3 falls, these terminals become lapse-diagnostics labels instead
     (the recorder and structured errors ship regardless).
   - **expectError flows: UNTOUCHED stage-wise** (fable C2): the existing
     banner-text predicate remains the sole expectError criterion — the
     expectError failure paths never set terminal stages, so the stage
     machinery ignores them by construction.
   - **Lapse diagnostics**: on the 300s ceiling, the existing
     `withTimeoutMessage` helper (`fixtures/extension.ts:1019` — TIMEOUT-only
     relabeling, preserves frame-detach/CDP-disconnect/page-crash
     identities) wraps the wait with a diagnostic naming the full trajectory
     + current stage, with special copy for the two silent-burn shapes:
     `finished`+errors-screen ("import degraded, Continue-gated") and
     `finished`+`#/popup/auth` ("import finished, activation didn't" —
     `popup/pages/import.vue:77-89`).
3. **Envelope JSONL (env-gated)**: `NULO_E2E_STAGE_LOG=1` enables; path
   `NULO_E2E_STAGE_LOG_OUT` defaulting to
   `path.join(os.tmpdir(), "nulo-probes-import-stages.jsonl")` —
   TMPDIR-aware (real disk on the dev box; `/tmp` in CI where the reserved
   harvest glob `_network-e2e.yml:352-357` matches). ONE atomic JSON object
   per import appended at import end: `{runId (pid+startTs), file, test,
   importOrdinal, attempt, mode, trajectory: [{stage, atMs, durMs}],
   outcome, rightCensored}`. Campaign runs truncate at start (per-run file
   via runId in the name); disabled ⇒ zero filesystem writes. Formatting +
   record-building live as small pure helpers beside the driver
   (`import-stage-timing.ts` — either location fine; the draft's "cycle"
   rationale was false and is retracted).

### B1 measurement campaign (Phases 2–3)

≥5 solo runs per proving mode of `backup-restore-integrity.test.ts` +
`profile-reimport-matrix.test.ts`, `NULO_E2E_RETRY=0`, **modes alternated**
(not all-proverless-then-all-prover-ON), tree frozen. Reported BY SCENARIO ×
import ordinal, never pooled: integrity (real funded backup, tampered slices
labeled, chain-sync PRESENT), matrix leg A first import (synthetic, NO
account-state slice ⇒ chain-sync SKIPPED — codex), matrix same-lifetime
re-import (tombstone context). Crash-file legs: annotated context only.
Committed table (`envelopes.md`) carries: per-stage P50/max per scenario per
mode, sample counts, the `finished→success` seam, and the caveats — 
solo-local baseline (the original lapses were load-dependent CI-shard
events; these maxima are NOT a CI tail estimate and no deadline derives from
them), 200ms drain quantization (sub-cadence stages measured by observer
timestamps, drained late), tampered-slice labeling.

### B1 classification outcome (Phase 4)

**No deadline mechanism ships.** Both auditors independently: `chain-sync`
(the only code-verified product-owned budget) stays OUT — it cannot throw,
degrades internally, and its regression already reds the unchanged 300s with
a named trajectory; an e2e mirror adds a false-fire surface (CI event-loop
starvation stretches OBSERVED stage time past 45s while the product budget
held) for zero unique detection. The ledger entry closes as: **"measured;
the settled classification rule yielded no stage warranting an e2e
early-fail window; 300s unchanged as the sole criterion; diagnostics
improved (trajectory + structured errors [+ terminal early-exit per row
3])."** Any stage whose envelope suggests a candidate PRODUCT budget is
written as an owner ask in the close-out — never implemented here.

### B2: confirmation probe → document-as-designed (no CDP tap)

1. **Probe** (throwaway, evidence into `lessons/`): on a fixture-opened
   popup — (a) `console.error("NULO-PROBE-<nonce>")` → assert ABSENT from
   `page.on('console')` AND PRESENT via the existing `readSwLogTrail`
   (`fixtures/journal.ts:217` — the SW's session-storage log ring; no CDP,
   no new lifecycle); (b) an uncaught throw AND a separate unhandled
   rejection → each PRESENT in `pageErrors` (distinguishing the three
   channels); (c) built-artifact check: `dist/chrome/src/popup/index.html`
   preserves sniffer-before-entry script order.
2. **Documentation landing**: the two fixture comment blocks
   (`extension.ts:161-174`, `:1101-1114`) + the crash file's tap caveat get
   the mechanism truth; the e2e-testing skill gains a dated section; the
   ledger entry re-dispositions as **root-caused + permanent-by-design**,
   explicitly carrying the residuals: (i) a caught-and-`console.error`'d app
   error is invisible on BOTH channels (pageErrors sees only thrown/unhandled
   — the accepted weakened posture); (ii) pre-connect `pendingLogs` buffering
   flushes only on the next post-wire call and is lost if wiring never
   completes; (iii) approval windows (`waitForPopup`) carry no listeners
   (recorded, deferred); (iv) per-page array resets. Diagnostics guidance:
   `readSwLogTrail` is the app-log evidence channel.
3. **No fixture SW CDP tap** (codex; fable concurs on cost): MV3
   worker-replacement reattach lifecycle for a diagnostics stream the log
   ring already provides.

### Key interfaces

```ts
// helpers/import-drivers.ts — public surface UNCHANGED except the new export:
export async function submitFullBackupImport(page, filePath, password, shell): Promise<void>
export async function importFullBackup(page, filePath, password, shell,
  { expectError = false }: { expectError?: boolean | string } = {}): Promise<void>
// wait half internal; 300_000 hardcoded; trajectory in errors + env-gated JSONL
```

### File-level change map

- `tests/e2e/helpers/import-drivers.ts` — submit-half extraction + internal
  stage-aware wait (MODIFY).
- `tests/e2e/helpers/crash-truth.ts` — `driveImportToSubmit` → re-export of
  the shared submit half (MODIFY, thin; `reimportToTerminal` untouched).
- `tests/e2e/helpers/import-stage-timing.ts` — NEW (~30 lines): pure
  trajectory/record helpers + env-gated appender.
- `tests/e2e/backup-migration.test.ts` — +1 red-path case (fable C3): a
  crafted mid-restore failure (malformed networks slice → outer catch →
  `rolled-back`) asserting the structured throw + trajectory content —
  proves the early-exit FIRES (or, if row 3 falls, asserts the lapse
  diagnostic's terminal label).
- `tests/e2e/fixtures/extension.ts` — comment-truth updates only (both
  console blocks) (MODIFY).
- `.claude/skills/e2e-testing/SKILL.md` — dated lessons section (MODIFY).
- `implementations-plan/e2e-deflake/flake-ledger.md` — both entries
  re-dispositioned, edit-in-place (MODIFY).
- Plan artifacts: `plan.md`, `recon.md`, `audit-codex.md`, `audit-fable.md`,
  `envelopes.md`, `certification.md`, `lessons/`.
- NOT touched: `useFullBackupImport.ts` + ALL product code; the crash file's
  raw stage reads; RestoreGate; every `consoleErrors` assertion; every
  numeric timeout (post-impl diff gate proves it).

### Non-obvious mechanics

- The observer array dies with the document on success-navigation — drains
  on the 200ms cadence bound the loss to one window; terminal states are
  always drained before any navigation they gate.
- Baseline-fenced classification: `terminalObservedAfterArm =
  transitions.some(t => TERMINALS.has(t.stage))` — a stale pre-arm terminal
  never appears in `transitions`.
- Mode label for JSONL: `process.env.NULO_E2E_PROVERLESS` in the test
  process (set by the invoker; agent.sh consumes + stamp-verifies the build
  side).
- `errorsScreen` detection reuses the exact selector `reimportToTerminal`
  uses for its continue-button terminal (`crash-truth.ts:91`) — one source.

### Trade-offs & alternatives not taken

- **Composite single `waitForFunction`** (draft) — INVALID (resolves once;
  cannot stream) — both auditors; replaced by observer+drain.
- **Public `awaitRestoreOutcome` API** — dead API at ship (one caller);
  internal instead.
- **`PRODUCT_OWNED_STAGE_DEADLINES` table (even empty)** — dead
  configuration implying future authority this arc does not have (codex);
  mechanism only ever added on evidence, which Phase 4 concluded against.
- **Probe-file synthetic campaign** (Outline 2) — synthetic-loop envelopes
  diverge from real flows; duplication unconverged; kept as fallback only.
- **Fixture SW CDP console tap** — lifecycle cost without unique value
  (`readSwLogTrail` exists).
- **`restoreStatus` watching** — adjacent to the REJECTED stall detector's
  data source; stays out; status-only failures remain ceiling-bound with
  better lapse copy.
- **Raising any bound** — BANNED (diff gate at post-impl).

## Security & Adversarial Considerations

- **Self-inflicted flake is the threat**: mitigations — public API + success
  criterion + 300s unchanged; classification requires observed-after-arm
  transitions (stale-marker hazard fenced mechanically); terminal set is
  explicit product-terminal states only; the red-path case proves fire; the
  full smoke suite + 3× solo certification prove no-false-fire; retry-budget
  nuance stated honestly (a fast red leaves more retry budget than a 300s
  burn — PR network gates run retry=0 so exposure is local/smoke defaults
  only; certification runs retry=0).
- **Measurement integrity**: solo, retry=0, frozen tree, alternated modes,
  per-scenario stratification, run-attributed records; JSONL is env-gated
  (disabled ⇒ no writes), TMPDIR-aware, run-unique (no cross-worktree
  interleaving, no predictable-path symlink exposure beyond what tmpdir
  already implies), content is stage names + timings only.
- **No workflow/permission changes**; no new deps; no product trust boundary
  moves; the B2 probe runs against a local fixture build only.

## Assumptions

**Facts** (verified; corrections from audits folded):
1. The 300s wait is `import-drivers.ts:182` via hash-only `waitForHash`
   (`fixtures/extension.ts:1194-1196`); lapse = bare TimeoutError.
2. Both import pages expose `data-restore-stage`
   (`popup/pages/import.vue:194`, `onboarding/pages/import.vue:142`).
3. `chain-sync`'s 45s is one ABSOLUTE budget with internal caps
   (`importChainSync.ts:29,31,69,89`) and it degrades-and-continues (skip
   records, `:90-109`) — it never throws.
4. Prover-capable importFullBackup drivers: integrity, matrix,
   migration-roundtrip; the crash file is proverless-only (runner-refused).
5. `/tmp/nulo-probes-*.jsonl` is a failure-only harvest glob
   (`_network-e2e.yml:344-357`) — an artifact path, not a run-isolated
   facility (hygiene is ours).
6. The console blind spot's mechanism: sniffer success path never calls the
   native page console (`console-sniffer.ts:25-30`); catch path does;
   `popup/app.vue:192` calls `console._log` directly; the routed original
   fires in the SW realm (`logger/utils.ts:115-135`). ~50 `consoleErrors`
   assertions exist. `readSwLogTrail` (`fixtures/journal.ts:217`) reads the
   SW log ring test-side.
7. Stage-sequence unit pin `useFullBackupImport.test.ts:1466-1494`; crash
   file reads the marker raw (:213,:433,:451); `expectError` is
   `boolean | string`; `withTimeoutMessage` preserves non-timeout error
   identities (`extension.ts:1013-1030`).
8. `"picked"` is dead in the union; `resetBackupState` does not reset
   `restoreStage`; expectError failure paths never set terminal stages
   (validation reject freezes `restoring:profile`; duplicate-account writes
   no stage); terminal stage assignments are strictly forward within an
   attempt with no resume-to-success path (`useFullBackupImport.ts:807-873`).

**Inferences** (attackable):
1. `pageErrors` reliably captures UNCAUGHT throws + unhandled rejections on
   fixture-opened pages (default path not suppressed) — verified by B2 probe
   before the ledger close asserts it; it is NOT a general app-error channel
   (caught-and-logged errors invisible on both — stated as the residual).
2. Envelope variance concentration is UNKNOWN (hypotheses: chain-sync, the
   finished→success seam, `restoring:services`' 6 sequential RPCs,
   `finalizing`'s argon2) — the campaign measures; no prediction is load-bearing.
3. The terminal early-exit, as fenced (observed-after-arm), cannot fire on a
   healthy run: terminals are forward-only within an attempt; the red-path
   case + full smoke + 3× certification are the empirical backstop. At suite
   level it cannot turn red green; the retry-budget nuance is stated, not
   waved away.
4. Integrity + matrix runs are kill-free real flows (fresh mounts verified);
   their samples are valid per-scenario envelopes with the labeled caveats.

**Asks** (owner, at the gate):
1. **Row 3 — terminal-failure early-exit** (THE disputed call): codex reads
   the settled spec as excluding it (early-fail = product-owned-deadline
   stages only) and would drop it this arc; fable argues it is a causal
   product-terminal reaction (not a deadline/split/detector), pure waste
   today (terminal at t+X, bare TimeoutError at 300s), and safe once fenced
   + red-path-proven. The consolidated plan ships it ONLY with the mechanical
   fence + red-path gate + smoke/cert evidence; dropping it costs little
   (trajectory diagnostics remain). Final fresh-context codex weighs in;
   the owner decides.
2. Accept "diagnostics-only everywhere, no deadline mechanism" as the
   classification outcome closing the importFullBackup-300s entry.
3. Accept B2's document-as-designed posture + residuals (incl. that
   caught-and-logged app errors stay invisible to e2e assertions), with
   `readSwLogTrail` as the diagnostics channel and no SW tap.
4. Product follow-ups recorded (not implemented): `resetBackupState` not
   resetting `restoreStage` (enables page-reuse retries later); the
   errors-screen/auth-route silent-burn UX; the dead `"picked"` member.

## Decision ledger

| # | Decision | Chosen | Rejected (why) | Source |
|---|---|---|---|---|
| 1 | B1 shape | Hybrid: Outline 1's submit-half convergence + stage-aware internals; Outline 2's zero public-surface change; observer+drain recorder | Composite waitForFunction (INVALID — resolves once); public wait API (dead at ship); probe-first campaign (synthetic loop); full driver split with new return type | codex+fable convergent |
| 2 | Deadline mechanism | NONE ships; classification documented: chain-sync stays out (cannot throw; degrades internally; 300s+trajectory already catches its regression); "diagnostics-only everywhere" is the spec-compliant close | Empty table + enforcement (dead config implying unearned authority); pre-wiring all stages (blind-split-adjacent) | codex+fable convergent |
| 3 | Terminal early-exit | **DISPUTED** — plan ships it WITH mechanical attempt fence (observed-after-arm), expectError exclusion, errors-screen terminal, red-path gate, cert evidence; falls back to trajectory-labels-only if the final pass or owner rejects | codex: exceeds settled spec + stale-marker hazard + partial coverage → drop this arc; fable: approve with conditions (all adopted) | → final codex + owner |
| 4 | B2 fork | Probe → document-as-designed; residuals stated; `readSwLogTrail` = diagnostics channel; no SW CDP tap | Fixture CDP tap (MV3 reattach cost, no unique value); folding into assertions (burst-of-reds); product-side sniffer change (product behavior) | codex+fable convergent |
| 5 | Campaign | Real flows, both modes alternated, per-scenario stratification, run-attributed env-gated JSONL, solo-local labeling | Probe-file loop; pooled samples; fixed always-on /tmp path (TMPDIR-blind, unattributed) | codex+fable convergent |
| 6 | Lapse/terminal diagnostics scope | Trajectory + structured errors for every consumer; silent-burn copy for finished+errors-screen and finished+auth-route | Leaving the bare TimeoutError; watching `restoreStatus` (adjacent to the rejected stall detector's source) | fable find; codex idiom |

## Phases & validation gates

### Phase 1 — Submit-half convergence + stage-aware wait + red-path (B1 code)

Extract `submitFullBackupImport`; implement the internal wait (observer+drain
recorder, fence, terminal set per row 3's standing state, structured
lapse/terminal errors via `withTimeoutMessage`, hardcoded 300s, env-gated
JSONL); converge crash-truth's submit half; add the red-path smoke case.

**Gate**: `bun run lint && bun run typecheck` exit 0; `bun run test:e2e`
full smoke green (incl. the new red-path case + the expectError path).
Layers: lint/typecheck + smoke e2e.

### Phase 2 — Measurement campaign leg 1 (alternating, ≥5 per mode total)

In tmux, solo, frozen tree, `NULO_E2E_RETRY=0`, `NULO_E2E_STAGE_LOG=1`:
alternate `NULO_E2E_PROVERLESS=1` and prover-ON runs of
`tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` until ≥5 runs per mode
(≥15 imports per mode across the three scenarios).

**Gate**: all runs attempt-1 green, zero exit-86; every import has a
complete, attributed JSONL record. Layers: network e2e (solo).

### Phase 3 — Campaign completion + integrity of samples

Continue alternation to target counts; verify per-scenario sample sets are
complete (integrity×mode, matrix-first×mode, matrix-reimport×mode).

**Gate**: sample-count table complete; zero pooling violations (records
carry scenario + ordinal). Layers: network e2e (solo).

### Phase 4 — Envelope table + classification close (B1 docs)

Commit `envelopes.md` (stratified P50/max, seam, caveats); codex xhigh
consult confirming the classification close (no e2e deadline; row 3
disposition per its gate); re-disposition the importFullBackup-300s entry
(edit-in-place); skill lessons; owner asks written.

**Gate**: `bun run lint` exit 0; codex verdict recorded in `audit-codex.md`.
Layers: lint + docs review.

### Phase 5 — B2 probe + documentation landing

Run the three-channel probe + built-artifact order check (evidence into
`lessons/phase-5.md`); land fixture comments, skill section, ledger
re-disposition with residuals.

**Gate**: probe evidence quoted in lessons (nonce absent page-side / present
in `readSwLogTrail`; throw + rejection each in pageErrors; dist order
verified); `bun run lint && bun run typecheck` exit 0; `bun run test:e2e`
full smoke green. Layers: lint/typecheck + smoke e2e.

### Phase 6 — Certification (3× solo) + wrap

3× consecutive solo `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run
e2e:agent tests/e2e/network/backup-restore-sw-restart.test.ts
tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` — attempt-1 green, zero
retries, zero exit-86, frozen tree. (Certification is proverless; the
reshaped wait's prover-ON coverage comes from Phases 2–3's ≥5 prover-ON
runs — stated for honesty.) Record `certification.md`. 3 consecutive
failures → STOP AND SURFACE.

**Gate**: the 3× record + `bun run lint && bun run typecheck && bun run
test` exit 0 at stack top. Layers: network e2e (solo) + fast layers.

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
   the adversarial ask ("could any early-exit fire on a healthy run; does
   any diagnostic change mask identity of real faults; enumerate every
   touched numeric timeout and prove none changed" — the no-timeout-change
   diff gate); verbatim: "Report bugs and small, targeted improvements only.
   Do not propose speculative abstractions, extra configuration surface, new
   layers, or rewrites — the smallest change that fixes each real problem.
   If code works and is clear, leave it alone."
3. Iterative fix loop: verify claims against the repo; apply accepted fixes;
   commit; log round in `lessons/`; RESUME the same session with the fix
   diff. Repeat until no new material findings; 3 churning rounds → surface.
4. Delivery per above; per-PR CI green on the three status gates; then
   certification (Phase 6) if not recorded; merge per authority.
5. Close-out: index.md completed marker; manifest status; owner report
   (shipped, consults + verdicts, the recorded product follow-ups).

## Seeds

(DRAFT — finalized after the approval gate; recommended `/goal`.)

```
/goal ARC B complete: all six phases marked ✓ in
implementations-plan/import-stage-deadlines/plan.md, each backed by its
validation gate passing in the transcript (phases 2-3: alternated solo
retry=0 runs, ≥5 per proving mode, attributed JSONL samples; phase 6: the 3×
consecutive solo certification record); envelopes.md committed with the
stratified table + caveats; BOTH flake-ledger entries re-dispositioned;
/code-review max --fix applied+committed; codex post-impl fix loop converged
(resumed pass with no new material findings quoted); gh stack PRs ready +
green on quality-status/smoke-e2e-status/network-e2e-status; bun run test
and bun run lint exit 0 in the transcript.
```

Fallback `/loop 15m` synced post-approval.
