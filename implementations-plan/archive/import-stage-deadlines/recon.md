# Recon — import stage deadlines + console-capture truth (phase 0.4, mid tier)

Two read-only scouts against dev @ `3e3bd129` (this worktree's base). Line
numbers exact at that ref. Feeds the draft + every audit: auditors must check
the design against this reuse map.

## A. The import pipeline + the 300s wait (B1)

**The driver** — `apps/extension/tests/e2e/helpers/import-drivers.ts`
(`helpers/`, not `fixtures/`): `importFullBackup(page, filePath, password,
shell, { expectError })` :142-184. The 300s wait is :182 —
`waitForHash(page, shell.successHash, 300_000)`, where `waitForHash`
(`fixtures/extension.ts:1194-1196`) is a bare
`page.waitForFunction(hash === …, {polling: 200})`. **It reads zero stage
information** — no `data-restore-stage`, no storage signal. On lapse it
throws a bare Puppeteer `TimeoutError` with **no diagnostic payload** (no
stage dump, no route trace) — unlike `backup-roundtrip.test.ts:124-135,157-205`
(route-trajectory recorder + dump) and `helpers/crash-truth.ts`'s
`reimportToTerminal` :83-99 (throws with `stage=${await readStage(page)}`).

**Consumers (6 files)**: smoke — `backup-migration.test.ts:71,108`,
`import-paths.test.ts:242`; network — `backup-restore-sw-restart.test.ts:367`
(designed-retry leg only), `backup-restore-integrity.test.ts:142`,
`backup-migration-roundtrip.test.ts:110`, `profile-reimport-matrix.test.ts:116,142`.
(`backup-roundtrip.test.ts` hand-rolls its own equivalent wait — does NOT use
the driver.)

**Existing duplication (the structural hint)**: `helpers/crash-truth.ts`
already splits the same flow — `driveImportToSubmit` :141-156 (duplicates the
pick-file→submit half verbatim) + `reimportToTerminal` :73-107 (duplicates
the wait half, but STAGE-AWARE: its terminal predicate reads
`data-restore-stage` :92-93). The pair exists only because `importFullBackup`
bundles submit+wait opaquely. Splitting the driver into a submit half + a
stage-aware wait half converges the duplication and is the natural home for
any stage-scoped logic; `readStage(page)` (`crash-truth.ts:23-27`) is the
one existing marker accessor — reuse it, don't re-derive.

**The stage machine** (`apps/extension/src/composables/useFullBackupImport.ts`):
union :52-66 — NOTE `"picked"` is declared but never assigned anywhere
(dead union member; the sequence unit test `useFullBackupImport.test.ts:1478-1487`
omits it). Stage transitions and what each brackets:

| Stage (set at) | Brackets | Product-owned bound today |
|---|---|---|
| `restoring:profile` :361 | validateAndMigrateBackup :378 + OPTIONAL passkey ceremony :437-459 (user-paced, open-ended by design) + `profileService.restore()` :477 | none aggregate; ceremony leg unboundable |
| `restoring:networks` :496 | `networkService.restore()` :497 + active-net write :553 + THE WHOLE `accountService.restore()` block :564-655 (conflates two services under one marker; duplicate-account rollback branch :628-649) | none aggregate |
| `restoring:tokens` :657 | `tokenService.restore()` :661 + balance re-link | 60s per-RPC only |
| `restoring:services` :738 | sequential loop :740-745 over SIX clients :727-733 | none aggregate (worst ≈ 6×60s) |
| `finalizing` :757 | `finalizeRestore()` :759 (argon2 unseal + session/PXE open :1727-1797; CPU/local) | 60s per-RPC only |
| `restoring:account-state` :788 | near-instant slice check → chain-sync or finished | n/a |
| `chain-sync` :793 | `runImportChainSync` (`importChainSync.ts`) | **THE one product-owned aggregate deadline**: `IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS = 45_000` :29 (= 21s preflight :31, sub-budgeted by `importPreflight.ts` + 30s registration :34; `AccountStateServiceClient.restore` deadline clamps to [0, 30_000] `account-state/service.ts:253`) — already fails closed product-side |
| `finished` :807 / `failed` :869 / `rolling-back` :830 (LIVENESS_CEILING_MS 60s :76; `rollbackCreatedProfile` ≤3 attempts :69,:405-423) / `rolled-back` :858 / `rollback-failed` :862 | terminals + rollback fork | rollback loop has no aggregate cap |

The generic bound under almost everything is `DEFAULT_RPC_TIMEOUT_MS = 60_000`
(`packages/extension-messaging/src/background/client.ts:16`) — app-wide
transport default, NOT a stage budget; not aggregate for multi-call stages.

**Post-`finished` seam**: `popup/pages/import.vue:74-89` runs
`completeImportWithRecovery({ timeoutMs: 30_000 })` :80 AFTER the composable
returns at `finished` — invisible to the stage marker; the driver's 300s
comment (:179-181) already budgets for it. A stage-scoped design must account
for this as post-finished time, not a named stage.

**DOM exposure**: `popup/pages/import.vue:194` and
`onboarding/pages/import.vue:142` bind `:data-restore-stage="restoreStage"`
(pure passthrough via `useProfileImportFlow.ts:228/238/306`).

**THE DESIGN-SHAPING FINDING**: the settled design's "early-fail ONLY for
stages with a product-owned deadline" resolves, at code level, to exactly
ONE qualifying stage (`chain-sync`) — which already self-bounds product-side.
Every other stage has no aggregate product bound, and `restoring:profile` is
deliberately unboundable (user-paced ceremony). Discovering candidate stages
worth bounding = NEW product-side budget work = surface to owner first (the
goal already mandates this). The e2e-side value that remains unambiguous:
the measurement table; diagnostics-on-lapse (stage trajectory in the error);
and terminal-failure early-exit (today a `failed`/`rollback-failed` terminal
burns the remaining 300s before a bare TimeoutError — reacting to an
explicit product terminal state is causal-signal, not a time split, not a
stall detector).

**Proving-mode capability of importFullBackup drivers**:

| File | Suite | prover-ON capable? |
|---|---|---|
| `backup-restore-sw-restart.test.ts` | network | NO — `@requires-proverless` (agent.sh refuses, exit 2) |
| `backup-restore-integrity.test.ts` | network | YES (the entry's own named trigger sibling) |
| `backup-migration-roundtrip.test.ts` | network | YES (migration fixture armed in both build branches, agent.sh:89,102) |
| `profile-reimport-matrix.test.ts` | network | YES (2 importFullBackup calls per run; endorsed for prover-ON in the crash file's docstring :40-42) |

CI's prover-ON canary job runs NONE of the importFullBackup drivers today
(`pr-network-e2e.yml:208-229`: transfers, tx-sendTx-default, frozen-account-canary).

**Measurement-campaign precedents (reuse)**:
- `_probe-warmup-effect.test.ts` — THE template: env-gated
  (`NULO_E2E_PROBE=1` skipIf :121), `appendFileSync` mirror to a file
  (:36-38 — vitest pool:forks swallows stdout on PASS; skill documents the
  same at SKILL.md:50), configurable out path env, trials/mean/stdev/verdict,
  underscore-prefix = probe-not-gate convention (still glob-matched).
- **Reserved-but-unused CI artifact slot**: `_network-e2e.yml:352-357`
  already harvests `/tmp/nulo-probes-*.jsonl` on failure — nothing writes it
  today. The recorder should write there (note: upload is `if: failure()` —
  local campaign runs just keep the file on disk).
- `NULO_E2E_OPENPOPUP_LOG` (:1069,:1157-1159,:1178-1180) — env-gated timing
  log precedent.
- `NULO_E2E_RETRY=0` for precision runs (retried attempts pollute samples) —
  precedent: `account-switch-isolation.test.ts`, `authwit-lifecycle.test.ts`.

**Runner mechanics**: `bun run e2e:agent tests/e2e/network/<file>` (solo,
passes args to vitest); artifacts in `apps/extension/.e2e-state/` +
`/tmp/aztec-*.log` etc.; no `test-results/` dir exists; solo-run duration has
NO documented empirical figure (part of what the campaign establishes; hard
per-test ceiling 900s; sandbox boot ≈ 30s).

**Collision risks (B1)**:
- `useFullBackupImport.test.ts:1466-1494` pins the exact stage sequence as an
  ordered subsequence — any stage-granularity change is a deliberate edit.
- `backup-restore-sw-restart.test.ts` reads `data-restore-stage` RAW
  (:213,:433,:451) independent of the driver — the reshape must not alter
  what mid-flight raw reads see.
- The proverless-only RestoreGate (`src/e2e/restore-gate.ts`) instruments the
  same restore path but is compiled out of prover-ON builds — the recorder
  must not depend on it.
- `"picked"` dead union member — flag, don't silently build around.

## B. The consoleErrors capture (B2) — ROOT CAUSE FOUND AT RECON

**Capture wiring** (`fixtures/extension.ts`; puppeteer 25.3.0): exactly two
wiring sites, structurally identical, both listener-BEFORE-navigation —
`openOnboarding` :158-186 and `setUpPopupPage` :1098-1161.
`ctx.consoleErrors` ← `page.on("console")` msgs with `type() === "error"`,
filtered `!text.includes("Client disconnected")` (:161-174, :1101-1114);
`ctx.pageErrors` ← `page.on("pageerror")` minus the same substring
(:175-183, :1116-1124). **No CDP session / Runtime.enable / Log domain
anywhere in the console path** (the only createCDPSession uses are WebAuthn
`fixtures/passkey.ts:79,101,123` and the canary's SW terminate :52).
`launchExtension` attaches no listeners. **Approval sub-windows
(`fixtures/popups.ts:22-102` `waitForPopup`) get NO listeners at all** — a
second, structural gap.

**The mechanism (very high confidence, evidence-backed)**:
`apps/extension/src/utils/console-sniffer.ts:1-32` monkeypatches
`console.trace/debug/log/info/warn/error` in EVERY page context — loaded as
the FIRST `<script type="module">` in `popup/index.html:11`,
`onboarding/index.html:6`, `offscreen/index.html:6`. The patched method calls
`self.on<method>` (wired by `popup/index.ts:1-13` / `onboarding/index.ts:8-20`
/ `offscreen/index.ts:40-47`) → `LoggerServiceClient.log` → RPC over the
background Port → SW `LoggerService.log`
(`wallet/services/logger/service.ts:22-24`) → `LoggerStore.logWithContext`
(`wallet/logger/store.ts:46-62`) → `print` (`wallet/logger/utils.ts:115-135`)
→ **`console._error` (the saved original) fires ONLY in the SW's realm**.
The success path NEVER calls the native original in the page realm
(`console-sniffer.ts:25-30` — original only invoked in the catch). CDP's
`Runtime.consoleAPICalled` fires only for the native inspector-bound
function → `page.on('console')` structurally cannot see app `console.*`.
Browser-emitted entries (Chrome's own extension-API bindings, e.g.
"Unchecked runtime.lastError") hold a private pre-patch console reference →
they DO arrive. This exactly reproduces the ledger's phrasing.

**Corroboration**: `offscreen/is-benign-sw-disconnect.ts:13-14` ("the
console-sniffer calling `logger.log(...)`"); the independent architecture
note `architecture/my-notes/01-entry-points-and-messaging.md` §"Console
Interception Timing" (predates round 4; treat snippets as illustrative);
round-4 run 7's own evidence (88 native churn lines, ZERO app lines, while
the composable's `console.error` provably fired) —
`implementations-plan/deflake-round-4/lessons/phase-1.md:210-234`; the
honest inline caveat already at `backup-restore-sw-restart.test.ts:180-186`.

**Key asymmetry**: `ctx.pageErrors` is very likely NOT blind — the entry
points' `self.onerror`/`onunhandledrejection` closures don't suppress the
default uncaught path (distinct from an intercepted `console.error()` call),
and run-2 evidence proved pageerror capture works for the disconnect cascade
(comment at `extension.ts:176-181`). Verify empirically in the fix phase.

**Blast radius of a naive "fix"**: ~50 `expect(consoleErrors).toEqual([])`
hard assertions across smoke+network (enumerated: security-backup 4×,
security 3×, auth-flows 3×, contacts 5×, endpoints 5×, accounts 8×,
profile-rename 3×, navigation 4×, appearance 3×, registration 1×,
settings-crud 7×, network/connect-dapp 1×, networks 4×,
account-switch-isolation 2×, register-token 1×). Today these can only catch
native noise; surfacing app-level console.error into them would likely
red currently-invisible real error paths in a burst — a fix must be
diagnostics-first, not silently folded into assertions.

**Remaining empirical checks before closing** (cheap): (1) a PROBE repro —
`console.error("PROBE")` in the popup → absent from `page.on('console')`;
present via a CDP session on the SW target (template:
`frozen-account-canary.test.ts:52`); (2) a built-artifact check that
`dist/chrome/src/popup/index.html` preserves sniffer-before-bundle script
order (module order is spec-guaranteed; 2-minute elimination of the
build-reorder residual).

**Fix-fork option space** (for the decision ledger): (a) SW-target console
tap in the fixture (recovers post-RPC logs; NOT pre-connect ones — early
calls can fail silently per the architecture note), diagnostics-first;
(b) document-as-permanent: the product's centralized SW-owned logging is a
deliberate design structurally incompatible with page-scoped
`page.on('console')`; lean on `pageErrors` (not blind) + stage/DOM evidence
— which is already the fixture's own inline guidance (`extension.ts:170`).
Adjacent noted gap either way: `waitForPopup` windows carry no listeners.

**Vitest-layer note**: all e2e configs run `environment: "node"` — fixture
`console.log` output is the RUNNER's stdout, a completely separate channel
from `ctx.consoleErrors` (easy category error). `observability.test.ts` is
unrelated to this pipeline (pins `formatPgMismatch` + the retry-error
reporter contract).

## C. Shared conventions both work items must match

- Env-gate everything new (`NULO_E2E_*`); mirror measurement output to a
  file (stdout swallowed on pass); zero-retry precision runs; probe files
  underscore-prefixed and skip-by-default; solo runs for any timing claim.
- Ledger discipline: entries close by EDITING the original block (round-4
  precedent), dated section, CLOSED/OPEN subsections, evidence + disposition.
- Skill routing: durable lessons append to `.claude/skills/e2e-testing/SKILL.md`
  as a dated section; the wait-taxonomy (Class A/B/C) lives in the
  flake-ledger :320-349, NOT the skill — cross-reference, don't duplicate.
- The `// LEDGER ENTRY <n> (e2e-deflake) FIX:` comment convention
  (`backup-roundtrip.test.ts:148` model) for fix-side code.
