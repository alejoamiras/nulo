# Fable audit — round 1 (plan audit, independent leg)

Verdict: **conditional approve** (conditions C1–C5 below, all folded into the
consolidated plan). Ran in parallel with codex round 1; neither saw the other.

## Conditions

- **C1 — the composite `waitForFunction` cannot stream transitions** (resolves
  once on first truthy). Real shape: Node-side snapshot loop or re-armed
  waits; recorder is the deliverable, so this is a spec bug, not a nit.
- **C2 — expectError/terminal claims corrected**: the expectError paths never
  set a terminal stage (validation reject freezes stage at
  `restoring:profile` with `restoreStatus="failed"`,
  `useFullBackupImport.ts:379-383`; duplicate-account rolls back with no
  stage write, `:638-648`). The banner wait stays the expectError predicate;
  drop expectError from the stage machinery. Early-exit coverage is PARTIAL
  (outer-catch failures only) — say so.
- **C3 — red-path gate**: nothing currently proves the early-exit FIRES; add
  one deliberate red-path check (crafted mid-restore failure → outer catch →
  structured throw with trajectory).
- **C4 — JSONL hygiene**: runId (pid+startTs) + attempt per record;
  campaign-start truncation; `/tmp` is tmpfs here and nothing reaps
  `nulo-probes-*`; vitest default retry 2 outside `NULO_E2E_RETRY=0` makes
  unattributed records ambiguous.
- **C5 — do not ship the deadline table**: empty mechanism = dead
  configuration shipped before evidence.

## Key analysis adopted into the plan

- **Outline: hybrid** — Outline 1's submit-half convergence + stage-aware
  internals; Outline 2's zero-public-surface change. The wait half has
  exactly ONE caller at ship (`importFullBackup`); ship it internal, `void`
  return, trajectory in thrown errors + JSONL. `RestoreOutcome` is dead API.
- **Terminal early-exit: approve in scope** (vs codex's reject — the one
  genuine dispute): terminal assignments are strictly forward within an
  attempt (`useFullBackupImport.ts:807-873`); no resume-to-success path; the
  stale-terminal hazard is a PRIOR-attempt artifact, structurally absent
  today (every driver consumer fresh-mounts; ref inits `""` at :244) — write
  the fresh-mount invariant down and fence mechanically. Today's behavior
  (terminal at t+X, bare TimeoutError at 300s) is pure waste.
- **Chain-sync cannot produce a terminal**: `runImportChainSync` NEVER throws
  — overruns degrade to skip records and the import proceeds to `finished`
  (`importChainSync.ts:90-109`). An e2e chain-sync deadline could only fire
  when the product mechanism is broken, and that regression already reds the
  unchanged 300s with a chain-sync-shaped trajectory. Stays OUT.
- **Two silent-burn categories the plan missed**: (a) deadline-skipped import
  lands on the Continue-gated errors screen which never auto-routes — silent
  300s burn at stage=`finished`; `reimportToTerminal` already treats the
  continue-button as terminal (`crash-truth.ts:91`) — adopt it into the
  terminal set; (b) activation-recovery timeout routes to `#/popup/auth`
  (`popup/pages/import.vue:77-89`) — lapse copy must name
  "import finished, activation didn't".
- **Suite-level masking nuance**: a fast red leaves more retry budget than a
  300s burn; PR network gates run retry=0 so exposure is local/smoke runs
  only — state precisely, don't claim "cannot mask".
- **Measurement caveats to commit with the table**: solo-local baseline (the
  original lapses were load-dependent CI-shard events — never a CI tail
  estimate); 200ms sampling aliases sub-cadence stages; integrity's tampered
  slices are real-flow but labeled; 5 runs/mode = means, not tails —
  acceptable only because no deadline ships from it.
- **B2**: probe → document-as-designed matches the code truth; pageErrors
  covers THROWN/unhandled only — a caught-and-`console.error`'d app error is
  invisible on BOTH channels (the accepted residual the ledger close must
  state); pendingLogs pre-wire buffering loss modes; `waitForPopup`
  no-listener gap recorded, deferred.
- **Fact fixes**: 45s is one ABSOLUTE budget (21s preflight cap + min(30s,
  remaining) registration inside it), and it "degrades-and-continues", never
  "fails closed"; `import-stage-timing.ts`'s "cycle" rationale was false (no
  cycle exists — either location is fine); `NULO_E2E_PROVERLESS` is set by
  the invoker, consumed + stamp-verified by agent.sh.

## Decision-ledger positions (rows 1–5)

1 hybrid · 2 no table (chain-sync out) · 3 approve with C2+C3+fence (+
errors-screen terminal) · 4 approve document-as-designed, no SW tap ·
5 approve real-flow campaign with attribution + labeling conditions.
