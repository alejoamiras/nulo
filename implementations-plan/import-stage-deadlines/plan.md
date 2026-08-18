# import-stage-deadlines — ARC B: import stage deadlines + console-capture truth (mid tier)

Execute the SETTLED design of the flake-ledger's `importFullBackup`-300s entry
(the remaining half: per-stage envelope measurement in both proving modes +
stage-scoped early-fail only where a product-owned deadline exists), and
close the consoleErrors blind-spot entry on the root cause recon already
established (the console-sniffer reroute). Both OPEN ledger entries
re-dispositioned. Delivered as a 2-PR `gh stack` into dev.

`eli5_mode: artifact` (owner is active in-session; gate presented explicitly).

## Clarifying answers (Phase 0 — self-answered from the goal + committed artifacts)

- **Success criterion**: (a) a committed per-stage envelope table from ≥5 solo
  measurement runs per proving mode, read off the shipped `data-restore-stage`
  markers; (b) `importFullBackup` reshaped: stage-scoped early-fail ONLY for
  stages with a product-owned deadline, all other stages diagnostics-only, the
  unchanged 300s remaining the SOLE overall failure criterion; (c) reshaped
  waits green 3× consecutive solo (`NULO_E2E_RETRY=0`); (d) BOTH ledger
  entries re-dispositioned (importFullBackup-300s closed; consoleErrors closed
  or re-ledgered as permanent with the mechanism documented); (e) fixture
  comment + e2e-testing skill carry the console-capture truth; (f) PRs green
  on `quality-status`/`smoke-e2e-status`/`network-e2e-status`, codex
  iterate-until-approve + `/code-review max --fix` before codex, stack merged.
- **Scope IN**: e2e-side per-stage timing instrumentation; the measurement
  campaign (both proving modes); the wait reshaping in
  `tests/e2e/helpers/import-drivers.ts`; the consoleErrors empirical
  confirmation + capture decision (fix or document-permanent); ledger/skill/
  fixture-comment updates; the parked-ARC-A preservation docs already
  committed on this branch (ride PR-1).
- **Scope OUT**: product-side stage-deadline ENFORCEMENT (new product budgets
  are a user-visible behavior change — written up as owner asks, never
  implemented here); the REJECTED variants (blind 240/60 split;
  `restoreStatus` stall detector); any timeout/bound RAISE (BANNED); product
  code changes of any kind (incl. the dead `"picked"` union member — noted,
  not fixed); transport work (ARC A parked); folding a new console tap into
  the ~50 existing `consoleErrors` assertions (burst-of-reds risk — if a tap
  lands, it is diagnostics-first; assertion promotion is a separate future
  campaign).
- **Constraints**: network e2e SOLO with `NULO_E2E_RETRY=0`, nothing else
  local during suites; long runs in tmux; measurement is wall-clock heavy
  (plan for hours, unattended-safe); commit signing on; merge authority per
  the goal but the approval gate below goes to the ACTIVE owner first.
- **Quality bar**: production test-infra — the suite is the repo's merge
  gate; a wrong early-fail classification would flake every PR.
- **Validation layers** (real tooling): `bun run lint` + `bun run typecheck`;
  `bun run test` for touched unit surfaces; `bun run test:e2e` (smoke) when
  the shared driver/fixtures change; `bun run e2e:agent
  tests/e2e/network/<file>` solo for measurement + certification.
- **Decisions surfaced vs delegated**: the stage classification
  (product-owned-deadline or not) is decided WITH codex against the
  measurement data and recorded in the decision ledger; B2's fix-vs-document
  fork likewise. Owner gate before implementation; product-budget proposals
  surface as asks.
- **Post-impl hardening**: `/harden` not scheduled (test-infra arc).

## Tier call (Phase 0.5)

Rubric: novelty LOW-MODERATE (CDP capture internals — now already
root-caused at recon), blast radius MODERATE (e2e infra gates every PR),
irreversibility LOW, migration NONE, external coupling LOW, security LOW.
0–1 HIGH → **mid**. Matches the goal's "expect mid".

## Normative spec (committed — do NOT re-derive)

The settled design (three codex rounds, ledger verbatim): expose a
`restoreStage` ref advancing at real stage boundaries **(SHIPPED, round 4:
`data-restore-stage`, incl. the rollback fork)**; measure per-stage envelopes
in both proving modes; grant an early-fail window ONLY to stages with a
product-owned deadline — every other stage diagnostics-only, the unchanged
300s as the sole failure criterion. REJECTED variants (stay rejected): blind
240/60 split; `restoreStatus`-based stall detector ("a shorter timeout in
disguise").

consoleErrors OPEN entry (verbatim): "e2e consoleErrors capture cannot see
app `console.*` … browser-emitted entries arrive; console-API calls from the
extension page do not … Diagnosed in `lessons/phase-1.md` run 7; needs its
own infra arc."

## Architecture & Implementation (Outline 1 — MAIN)

### B1: converge the drivers, measure through the shared wait

**Shape**: split `importFullBackup` into the two halves the codebase already
proves (recon §A: `crash-truth.ts`'s `driveImportToSubmit` +
`reimportToTerminal`), and make the wait half stage-aware for EVERY consumer:

1. **`submitFullBackupImport(page, filePath, password, shell)`** — the
   pick-file→password→submit half (extracted verbatim from
   `import-drivers.ts:142-…`; `crash-truth.ts:141-156` converges onto it).
2. **`awaitRestoreOutcome(page, shell, opts)`** — the wait half, replacing
   the bare `waitForHash(…, 300_000)`:
   - Polls BOTH `window.location.hash` AND `data-restore-stage` (same 200ms
     cadence as today's `waitForHash`) via one `page.waitForFunction`
     returning a composite `{hash, stage}` snapshot; the driver records every
     stage TRANSITION with a monotonic timestamp (the envelope recorder —
     always-on, zero-cost when nothing changes).
   - **Success criterion unchanged**: resolve when `hash === successHash`;
     overall ceiling unchanged at 300s.
   - **Terminal-failure early-exit** (causal signal, not a deadline): stage
     ∈ {`failed`, `rollback-failed`} (and `rolled-back` when the caller did
     not expect an error) → throw IMMEDIATELY with a structured message
     embedding the full stage trajectory + timings. Today these terminals
     burn the remaining 300s and then throw a bare TimeoutError.
   - **Lapse diagnostics**: on the 300s ceiling, throw with the trajectory +
     current stage (never a bare TimeoutError again).
   - **Stage-scoped early-fail, product-owned only**: wired as a DATA-DRIVEN
     table `PRODUCT_OWNED_STAGE_DEADLINES: Partial<Record<RestoreStage,
     number>>` — EMPTY at phase 1. Candidates enter it only in phase 4, only
     with a code-verified product budget behind them (recon finds exactly
     one: `chain-sync`, product budget 45s), only with codex sign-off, only
     with envelope-informed margins. All other stages: diagnostics-only,
     forever, per the settled design.
   - `expectError` flows keep their current semantics (assert the failure
     surface; terminal-failure early-exit inverts into the expected path).
3. **`importFullBackup` remains as the composed convenience** (submit +
   await) so the 6 existing consumers keep their one-line call; crash-truth's
   duplicated halves become re-exports/thin wrappers of the new shared halves
   (its `reimportToTerminal` keeps its own terminal predicate — it treats
   MORE states as terminal by design).
4. **Envelope JSONL**: each `awaitRestoreOutcome` appends per-stage records
   `{file, test, mode, stage, enteredAtMs, durMs}` to
   `/tmp/nulo-probes-import-stages.jsonl` (the reserved CI artifact slot,
   `_network-e2e.yml:352`) — `appendFileSync`, mirrored to console on
   failure only (pool:forks swallows pass-stdout; recon §A precedents).
   Proving mode read from the build stamp env the runner already sets.

**Measurement campaign** (no product code, no new test files): ≥5 solo runs
per proving mode of the UNMARKED importFullBackup drivers —
`backup-restore-integrity.test.ts` (1 import/run) +
`profile-reimport-matrix.test.ts` (2 imports/run) — under
`NULO_E2E_RETRY=0`, each mode via its `NULO_E2E_PROVERLESS` setting. The
crash file's retry-leg samples are recorded but annotated (post-crash
context, not primary envelope input). Envelope table committed to
`implementations-plan/import-stage-deadlines/envelopes.md` + cited by the
ledger close.

### B2: confirm the mechanism, then document (fix-fork decided with codex)

Recon root-caused the blind spot (console-sniffer reroutes `console.*` over
RPC to the SW realm; native page console never invoked; CDP
`consoleAPICalled` never fires; browser-emitted entries bypass the patch).
Remaining work is confirmation + the capture decision:

1. **Empirical confirmation** (throwaway, env-gated, not landed as a gate):
   drive a popup, `page.evaluate(() => console.error("NULO-PROBE-<nonce>"))`,
   assert absent from `page.on('console')`; attach a CDP session to the SW
   target (template `frozen-account-canary.test.ts:52`) and observe the
   routed line arrive there. Plus the 2-minute built-artifact check that
   `dist/chrome/src/popup/index.html` preserves sniffer-before-bundle order.
2. **The fork** (codex-argued, decision ledger): (a) fixture-side SW-target
   console tap as a DIAGNOSTICS-ONLY stream (recovers post-RPC app logs;
   pre-connect calls stay lossy), OR (b) document-as-permanent — the
   product's centralized SW-owned logging is deliberate; `pageErrors` is the
   reliable app-error channel (recon: very likely NOT blind — verify in the
   probe); stage/DOM evidence is the assertion surface. EITHER WAY: the two
   fixture comment blocks (`extension.ts:161-174`, `:1101-1114`) and the
   crash file's tap caveat get the mechanism truth; the e2e-testing skill
   gains a dated section; the ledger entry is re-dispositioned (root-caused +
   fixed | root-caused + permanent-by-design). The `waitForPopup`
   no-listeners gap is RECORDED (ledger note) either way; instrumenting it
   is explicitly deferred (scope).

### Key interfaces

```ts
// helpers/import-drivers.ts (all e2e-internal; loose types fine)
export async function submitFullBackupImport(page, filePath, password, shell): Promise<void>
export interface RestoreOutcome {
  terminal: "success" | RestoreStage       // success = successHash reached
  trajectory: Array<{ stage: string; atMs: number; durMs: number }>
}
export async function awaitRestoreOutcome(page, shell, opts?: {
  expectError?: boolean
  overallCeilingMs?: 300_000               // NEVER overridden upward by callers
}): Promise<RestoreOutcome>
export async function importFullBackup(page, filePath, password, shell, opts?): Promise<void> // composed
const PRODUCT_OWNED_STAGE_DEADLINES: Partial<Record<string, number>> = {} // phase-4 gated
```

### Data & control flow (critical path)

test → `importFullBackup` → submit half → `awaitRestoreOutcome` → one
`waitForFunction` snapshot loop (hash + stage) → transitions recorded →
[terminal-failure? throw structured] / [product-owned deadline exceeded?
(phase-4 table only) throw structured] / [hash reached? resolve + append
JSONL] / [300s? throw structured with trajectory].

### File-level change map

- `apps/extension/tests/e2e/helpers/import-drivers.ts` — the split + wait
  rework (MODIFY).
- `apps/extension/tests/e2e/helpers/crash-truth.ts` — converge
  `driveImportToSubmit` onto the shared submit half (MODIFY, thin).
- `apps/extension/tests/e2e/helpers/import-stage-timing.ts` — NEW: JSONL
  appender + trajectory formatting (kept out of import-drivers so
  crash-truth can reuse formatting without cycles).
- `apps/extension/tests/e2e/fixtures/extension.ts` — comment-truth updates
  (both console blocks); optional SW-tap if fork (a) wins (MODIFY).
- `.claude/skills/e2e-testing/SKILL.md` — dated lessons section (MODIFY).
- `implementations-plan/e2e-deflake/flake-ledger.md` — both entries
  re-dispositioned (MODIFY, edit-in-place per convention).
- `implementations-plan/import-stage-deadlines/{plan,recon,envelopes}.md`,
  `lessons/` — plan artifacts.
- NOT touched: `useFullBackupImport.ts` (product), the raw
  `data-restore-stage` reads in `backup-restore-sw-restart.test.ts`, the
  RestoreGate, all `consoleErrors` assertions.

### Non-obvious mechanics

- The stage poll must tolerate the marker element not existing yet (early
  routes) and the `""` initial stage — trajectory records only real
  transitions; `readStage`'s accessor is the model (`crash-truth.ts:23-27`).
- Mode detection for the JSONL: `process.env.NULO_E2E_PROVERLESS` in the
  TEST process (the runner exports it; the build stamp is the belt for the
  wallet build itself — recon §A).
- The post-`finished` seam (30s `completeImportWithRecovery`, recon §A) means
  `finished` → successHash has its own gap: the trajectory records
  `finished→success` duration explicitly so the campaign measures that seam
  instead of hiding it.
- `rolled-back` under `expectError:false` is a product-terminal for the
  DESIGNED-retry flows in the crash file only — which does not use this wait
  half (its `reimportToTerminal` predicate stays authoritative there). For
  plain imports, `rolled-back` = failure → early-exit.

### Trade-offs & alternatives not taken

- **Probe-file-only campaign** (Outline 2 below) — rejected as primary:
  envelopes measured by a bespoke loop diverge from real-test conditions
  (fixture state, funded backups, real assertions); the settled design's
  intent is envelopes of the REAL flows. Kept as fallback if run-count
  economics force it.
- **Per-stage deadlines for all stages** — violates the settled design
  (blind-split-adjacent); only product-owned budgets qualify.
- **`restoreStatus` stall detector** — REJECTED in the ledger; stays out.
- **Raising any bound** — BANNED.
- **Fixing the console monkeypatch product-side** (calling the native
  original in the page realm too) — product behavior change (double
  logging, perf) + touches every entry point; out of scope; noted as an
  owner-visible option in the close-out.

## Competing outline (Outline 2 — probe-first, minimal driver churn)

For the audits to weigh against Outline 1:

1. Leave `importFullBackup` intact except: swap the bare `waitForHash` for
   `Promise.race([hashWait, terminalStageWait])` + a trajectory dump in both
   error paths (no split, no crash-truth convergence).
2. Add `_probe-import-stages.test.ts` (underscore, `NULO_E2E_PROBE=1`-gated,
   modeled on `_probe-warmup-effect.test.ts`): per boot, loop
   export→delete→re-import N times recording envelopes → 1 boot per proving
   mode yields N samples each; campaign = 2 boots instead of ≥10 runs.
3. Stage-deadline table + ledger close as in Outline 1.
- **Pros**: far less shared-code churn (the 6 consumers see zero interface
  change); campaign wall-clock collapses (~2 boots vs ~10+ runs); probe
  loops give more samples.
- **Cons**: envelopes measured off a synthetic loop (state accumulation
  across iterations, warm caches — recon's `_probe-warmup-effect` exists
  precisely because warmup skews); the crash-truth duplication REMAINS (two
  wait implementations, one stage-aware one not — the exact drift recon
  flagged); the always-on trajectory diagnostics (the biggest debuggability
  win) don't reach the real tests; "5+ solo runs per proving mode" of the
  settled design is arguably not satisfied by 1 probe boot per mode.

## Security & Adversarial Considerations

- **Threat surface**: test-infra only; no product trust boundary moves. The
  real adversarial risk is SELF-INFLICTED FLAKE: a wrong early-fail
  classification converts a healthy suite into a PR-blocking flake source.
  Mitigations: the deadline table ships EMPTY; entries require a
  code-verified product budget + measured envelope + codex sign-off; the
  300s ceiling and success predicate are unchanged; terminal-failure
  early-exit reacts only to explicit product terminal states.
- **Measurement integrity**: solo runs, retry=0, frozen tree between runs;
  proving mode recorded per sample; the JSONL lands in the reserved CI
  artifact slot (no new upload surface, `contents: read` untouched — no
  workflow permission changes at all).
- **Supply chain / crypto / secrets**: none touched. No new deps.
- **Console tap (if adopted)**: reads the SW target's console via CDP in
  TESTS only; no product logging change; diagnostics-only so no assertion
  semantics move; the tap must not weaken the existing "never blanket-benign"
  filter rule (skill Gotchas :45).
- **Prompt-injection/log-content risk**: JSONL content is stage names +
  timings only — no user data, no secrets, no backup contents.

## Assumptions

**Facts** (verified in recon, file:line in recon.md):
1. The 300s wait is `import-drivers.ts:182` via hash-only `waitForHash`
   (`fixtures/extension.ts:1194-1196`); lapse = bare TimeoutError.
2. `data-restore-stage` is live on both import pages
   (`popup/pages/import.vue:194`, `onboarding/pages/import.vue:142`);
   accessor precedent `crash-truth.ts:23-27`.
3. Exactly one stage has a product-owned aggregate deadline: `chain-sync`
   (`importChainSync.ts:29,31,34` — 45s = 21s + 30s; clamp
   `account-state/service.ts:253`).
4. `backup-restore-integrity.test.ts` + `profile-reimport-matrix.test.ts` +
   `backup-migration-roundtrip.test.ts` are prover-capable importFullBackup
   drivers; the crash file is proverless-only (runner-refused).
5. `/tmp/nulo-probes-*.jsonl` is a reserved, currently-unwritten CI artifact
   glob (`_network-e2e.yml:352-357`, `if: failure()`).
6. The console blind spot's mechanism: `console-sniffer.ts:25-30` never
   calls the native original on success; sniffer loads first in all three
   entry HTMLs; the saved original fires only in the SW realm
   (`logger/utils.ts:115-135`). ~50 `consoleErrors` assertions exist.
7. The stage-sequence unit pin is `useFullBackupImport.test.ts:1466-1494`;
   the crash file reads the marker raw at :213,:433,:451.
8. `"picked"` is a dead union member (never assigned).

**Inferences** (attackable):
1. `pageErrors` is NOT similarly blind (native uncaught path preserved) —
   to be verified by the B2 probe before the ledger close states it.
2. Envelope variance between proving modes will be concentrated in
   `chain-sync` + the post-`finished` seam; local stages (profile/tokens/
   services) should be mode-insensitive. The campaign tests this.
3. The terminal-failure early-exit cannot mask a product bug: every
   early-exit path throws (never passes), so it can only make red runs
   faster + better-diagnosed. (Audits: attack this.)
4. Integrity + matrix runs are undisturbed imports (no kill), so their
   samples are clean envelopes.

**Asks** (to the owner at the gate):
1. Approve the terminal-failure early-exit as within the settled design's
   spirit (causal product-state signal; NOT a deadline, NOT a split, NOT a
   stall detector). It changes red-run behavior only.
2. Approve the empty-until-evidenced deadline table (possibly staying empty
   if codex + data say `chain-sync`'s e2e early-fail adds no coverage —
   "close the entry with diagnostics-only everywhere" is an acceptable
   outcome of the settled design).
3. Approve the B2 posture: confirmation probe → document-as-designed as the
   default outcome, SW-tap only if codex argues it earns its keep
   (diagnostics-only either way).

## Decision ledger

(Filled during the audit rounds; current state:)

| # | Decision | Chosen | Rejected (why) | Source |
|---|---|---|---|---|
| 1 | B1 shape | Outline 1: driver split + shared stage-aware wait | Outline 2 probe-first (synthetic-loop envelopes diverge from real flows; duplication remains; diagnostics don't reach real tests) — kept as fallback | main; audits pending |
| 2 | Deadline table | Empty at ship; `chain-sync` only with envelope + codex sign-off; possibly empty forever | Pre-wiring all stages (blind-split-adjacent, violates settled design) | main; audits pending |
| 3 | Terminal early-exit | In scope as causal product-state reaction | Treating it as out-of-design (it is not a deadline/split/detector) | main; audits pending |
| 4 | B2 fork | Confirmation probe → document-as-designed default; SW-tap only if it earns its keep, diagnostics-only | Folding a tap into the ~50 assertions (burst-of-reds); product-side monkeypatch change (product behavior) | main; audits pending |
| 5 | Campaign source | Real tests (integrity + matrix, both modes) | Probe-file loop (synthetic conditions) | main; audits pending |

## Phases & validation gates

### Phase 1 — Driver split + stage-aware wait + diagnostics (B1 code)

Split `importFullBackup`; implement `awaitRestoreOutcome` (trajectory
recording, terminal-failure early-exit, structured lapse errors, empty
deadline table); converge `crash-truth.ts`'s submit half; JSONL appender in
`import-stage-timing.ts`.

**Validation gate**: `bun run lint && bun run typecheck` exit 0;
`bun run test:e2e` — full smoke suite green (exercises the driver via
`backup-migration.test.ts` + `import-paths.test.ts` incl. the `expectError`
path); layers: lint/typecheck + smoke e2e.

### Phase 2 — Proverless measurement leg (≥5 solo runs)

In tmux, solo, frozen tree: `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run
e2e:agent tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` × ≥5 (yields ≥15
proverless import samples: 5×1 + 5×2).

**Validation gate**: all runs attempt-1 green (retry=0), zero exit-86; ≥15
samples present in the JSONL with stage-complete trajectories; layers:
network e2e (solo).

### Phase 3 — Prover-ON measurement leg (≥5 solo runs)

Same two files × ≥5 without `NULO_E2E_PROVERLESS`.

**Validation gate**: same criteria, prover-ON build stamps verified by
agent.sh's own grep; layers: network e2e (solo).

### Phase 4 — Envelope table + deadline decisions + ledger close (B1 docs)

Commit `envelopes.md` (per-stage P50/max per mode, sample counts, the
`finished→success` seam split out); codex xhigh consult on the deadline
table (chain-sync in or empty) + any product-budget proposals (written as
owner asks only); re-disposition the importFullBackup-300s ledger entry
(edit-in-place); skill lessons.

**Validation gate**: `bun run lint` exit 0 (docs + any table wiring);
if the table gains `chain-sync`: 1 extra solo proverless run of the two
files green with the deadline armed; codex verdict recorded in
`audit-codex.md`; layers: lint + conditional network e2e.

### Phase 5 — B2 confirmation probe + capture decision + truth landing

Empirical probe (PROBE console.error absent from page stream, present via
SW-target session; pageErrors probe; built-artifact script-order check —
evidence into `lessons/phase-5.md`); codex xhigh on the fork; land the
outcome: fixture comment blocks (both copies), skill dated section,
consoleErrors ledger re-disposition, `waitForPopup` gap note; SW-tap only if
codex-argued (diagnostics-only).

**Validation gate**: `bun run lint && bun run typecheck` exit 0; `bun run
test:e2e` full smoke green (fixture comments/tap touch the shared fixture);
probe evidence quoted in lessons; layers: lint/typecheck + smoke e2e.

### Phase 6 — Certification (3× solo) + wrap

3× consecutive solo `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run
e2e:agent tests/e2e/network/backup-restore-sw-restart.test.ts
tests/e2e/network/backup-restore-integrity.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` — every test attempt-1
green, zero retries, zero exit-86, frozen tree (the reshaped wait running
inside the two trigger files + the matrix). Record in `certification.md`.
3 consecutive failures → STOP AND SURFACE.

**Validation gate**: the 3× record + `bun run lint && bun run typecheck &&
bun run test` exit 0 at stack top; layers: network e2e (solo) + fast layers.

## Delivery

`gh stack` into dev, 2 arcs:

- **PR-1 `test(e2e): stage-aware import wait + envelope campaign`** — Phases
  1–4 (+ the already-committed parked-ARC-A docs + this plan's artifacts).
  Independently revertable: driver split + measurement + ledger close B1.
- **PR-2 `test(e2e): console-capture truth`** — Phase 5 (+ certification
  record from Phase 6 lands here as the stack-top docs commit).
  Stacks on PR-1 (shares fixture comment context; keeps each PR one-sitting
  reviewable).

`gh stack init --adopt worktree-import-stage-deadlines` (rename to
`isd/stage-wait` as arc 1), `gh stack add isd/console-truth` at the arc
boundary, `gh stack submit --draft --auto` early, `gh stack sync` to
cascade. Merge: only after certification + owner-authorized (goal grants
stack-merge authority once the ENTIRE stack + certification is green;
approval-gate conditions may narrow this).

## Post-implementation (self-contained — the implementing session executes THIS)

1. Run `/code-review max --fix` on the full implementation diff. Skim the
   applied fixes for unintended changes; commit them SEPARATELY from
   implementation commits (identifiable as code-review-applied).
2. Codex post-impl audit (`/codex xhigh`, NEW session): provide (a) the net
   diff from the plan baseline (implementation commits only), (b) a summary
   of the code-review-applied commits as a distinct artifact, (c) this
   plan.md + decision ledger, (d) the adversarial/security ask ("what could
   go wrong; what are we trusting that we shouldn't; could any early-exit
   mask a product bug or flake a healthy suite"), and (e) verbatim: "Report
   bugs and small, targeted improvements only. Do not propose speculative
   abstractions, extra configuration surface, new layers, or rewrites — the
   smallest change that fixes each real problem. If code works and is clear,
   leave it alone."
3. Iterative fix loop: verify codex's factual claims against the repo first;
   apply accepted fixes; commit; log the round (consult + verdict) in
   `lessons/`; RESUME the same codex session with the fix diff for
   re-review. Repeat until a round yields no new material findings. Still
   churning after 3 rounds → stop and surface to the owner.
4. Delivery: `gh stack sync`; mark PR-1 then PR-2 ready; per-PR CI green on
   `quality-status`/`smoke-e2e-status`/`network-e2e-status`; then the
   certification (Phase 6) if not yet recorded; then merge per authority.
5. Close-out: `implementations-plan/index.md` completed marker; agent-worktree
   status updates; owner report (shipped, consults + verdicts, open asks).

## Seeds

(DRAFT — finalized after the approval gate.)

Recommended: `/goal` (completion is transcript-observable).

```
/goal ARC B complete: all six phases marked ✓ in
implementations-plan/import-stage-deadlines/plan.md, each backed by its
validation gate passing in the transcript (phase 2/3: ≥5 solo retry=0 runs
per proving mode with samples in the JSONL; phase 6: the 3× consecutive solo
certification record); envelopes.md committed; BOTH flake-ledger entries
re-dispositioned; /code-review max --fix applied+committed; codex post-impl
fix loop converged (resumed pass with no new material findings quoted);
gh stack PRs ready + green on quality-status/smoke-e2e-status/
network-e2e-status; bun run test and bun run lint exit 0 in the transcript.
```

Fallback `/loop 15m`: reality-check plan.md + lessons/, drive the next
pending phase, gates as written, codex xhigh at forks, 5-failure stop rule,
never idle. (Full loop text synced post-approval.)
