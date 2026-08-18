1. VERDICT

VERDICT: reject (with blocking findings: the proposed sampler cannot record every transition; terminal-state early failure exceeds the settled spec; the optional overall ceiling permits a second overall criterion; the campaign pools correlated/non-equivalent samples; and the fixed always-on `/tmp` output is neither run-isolated nor TMPDIR-aware).

The normative design permits new early failure only for product-owned-deadline stages and leaves every other stage diagnostics-only, with 300s unchanged as the sole overall clock ([flake-ledger.md:361](implementations-plan/e2e-deflake/flake-ledger.md:361)). The plan instead adds early exits for `failed`, `rollback-failed`, and `rolled-back` ([plan.md:100](implementations-plan/import-stage-deadlines/plan.md:100)) and exposes `overallCeilingMs` to callers ([plan.md:173](implementations-plan/import-stage-deadlines/plan.md:173)). Both should be removed.

The measurement primitive is also invalid as written: a composite `{hash, stage}` returned from `waitForFunction` is truthy and resolves that wait; returning it only after a transition merely resolves on the first transition. It cannot stream every transition to Node. The product unit test deliberately uses a synchronous Vue watcher to capture the full history ([useFullBackupImport.test.ts:1451](apps/extension/src/composables/useFullBackupImport.test.ts:1451)), while the existing idiom returns `true`/`null` only on terminal conditions ([crash-truth.ts:84](apps/extension/tests/e2e/helpers/crash-truth.ts:84)).

2. Outline choice: hybrid

Use a small hybrid:

- Keep Outline 1’s extraction of the duplicated submit path. `importFullBackup` and `driveImportToSubmit` currently duplicate file selection, password entry, and submit nearly verbatim ([import-drivers.ts:149](apps/extension/tests/e2e/helpers/import-drivers.ts:149), [crash-truth.ts:141](apps/extension/tests/e2e/helpers/crash-truth.ts:141)).
- Keep Outline 2’s minimal wait churn: preserve `importFullBackup`’s public API and the exact 300s `waitForHash` success criterion ([import-drivers.ts:178](apps/extension/tests/e2e/helpers/import-drivers.ts:178)).
- Arm a page-side stage recorder before clicking Submit, as the existing round-trip recorder is armed before submit ([backup-roundtrip.test.ts:124](apps/extension/tests/e2e/backup-roundtrip.test.ts:124)). A `MutationObserver` can record `data-restore-stage` changes with `performance.now()`. Continue using the existing hash poll for success.
- Wrap the unchanged hash wait with `withTimeoutMessage`, which changes only Puppeteer timeouts while preserving frame detach, CDP disconnect, and page-crash identities ([extension.ts:1013](apps/extension/tests/e2e/fixtures/extension.ts:1013)).
- Do not use Outline 2’s repeated import loop. Measure instrumented real flows, but as independent, scenario-labelled runs.

This gets the useful deduplication and diagnostics without inventing a general outcome framework or a synthetic warm-loop campaign.

3. ADVERSARIAL/SECURITY

Terminal early exit

Under the current product code, rollback terminal markers are not transient: `rolled-back` is assigned only after deletion succeeds, and `rollback-failed` only after cleanup has failed ([useFullBackupImport.ts:857](apps/extension/src/composables/useFullBackupImport.ts:857)). Therefore a terminal observed for the current attempt is genuinely red.

The proposed helper, however, does not establish “current attempt.” `resetBackupState` resets status and data but does not reset `restoreStage` ([useFullBackupImport.ts:889](apps/extension/src/composables/useFullBackupImport.ts:889)). A same-page retry can briefly expose a stale `rolled-back` or `failed` marker before Vue renders `restoring:profile`. A post-submit poll could then fail a healthy retry.

The current designed-retry test avoids that exact hazard by treating `rolled-back` as expected, closing that page, and opening a new import page before calling `importFullBackup` ([backup-restore-sw-restart.test.ts:207](apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts:207), [backup-restore-sw-restart.test.ts:360](apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts:360)). Converging its specialized terminal wait onto a generic failure waiter would break designed-retry semantics.

It also would not catch all product failures. Integrity rejection leaves the stage at `restoring:profile` ([useFullBackupImport.ts:378](apps/extension/src/composables/useFullBackupImport.ts:378)); profile restore and finalize failures similarly set `restoreStatus="failed"` without assigning terminal `restoreStage` values ([useFullBackupImport.ts:479](apps/extension/src/composables/useFullBackupImport.ts:479), [useFullBackupImport.ts:759](apps/extension/src/composables/useFullBackupImport.ts:759)). The terminal shortcut is therefore incomplete as well as outside the settled design.

It cannot turn a product failure green, but it can suppress the intended error-surface assertion or prevent later recovery evidence from being gathered. The current `expectError` branch proves disabled submit plus expected banner text and must remain unchanged ([import-drivers.ts:166](apps/extension/tests/e2e/helpers/import-drivers.ts:166)).

`/tmp` JSONL

The small stage/timing JSONL is not itself a meaningful tmpfs-capacity risk. The large-resource rule exists because multi-GB Aztec data under `/tmp` can pin RAM, which is why the runner moved that data to a real-disk configurable root ([lockfile.ts:31](apps/extension/tests/e2e/lockfile.ts:31)).

The proposed fixed `/tmp/nulo-probes-import-stages.jsonl` is still wrong operationally ([plan.md:121](implementations-plan/import-stage-deadlines/plan.md:121)):

- Concurrent worktrees and stale prior runs append into the same dataset.
- A predictable shared path permits symlink redirection on a shared host.
- It ignores `TMPDIR`.
- The CI wildcard is uploaded only on failure, so it does not preserve successful campaign evidence ([\_network-e2e.yml:344](.github/workflows/_network-e2e.yml:344)).
- The existing probe precedent already supports an explicit output-path environment variable and truncates at run start ([\_probe-warmup-effect.test.ts:32](apps/extension/tests/e2e/network/_probe-warmup-effect.test.ts:32), [\_probe-warmup-effect.test.ts:125](apps/extension/tests/e2e/network/_probe-warmup-effect.test.ts:125)).

Use an env-gated output path, defaulting through `tmpdir()`, with a run ID/PID. Write one atomic JSON object per import, not one line per stage, and include outcome plus whether the last duration is right-censored.

Measurement bias

“Integrity + matrix are clean envelopes” is false:

- Integrity mutates the exported backup by adding transactions, authwits, and token balances ([backup-restore-integrity.test.ts:91](apps/extension/tests/e2e/network/backup-restore-integrity.test.ts:91)).
- Matrix imports a synthetic backup, deletes it, then deliberately reimports it in the same browser/offscreen lifetime to exercise a tombstone ([profile-reimport-matrix.test.ts:103](apps/extension/tests/e2e/network/profile-reimport-matrix.test.ts:103), [profile-reimport-matrix.test.ts:136](apps/extension/tests/e2e/network/profile-reimport-matrix.test.ts:136)).
- The synthetic matrix backup carries no `account-state` slice ([import-drivers.ts:287](apps/extension/tests/e2e/helpers/import-drivers.ts:287)), so it skips `chain-sync` entirely ([useFullBackupImport.ts:788](apps/extension/src/composables/useFullBackupImport.ts:788)).
- Running both files in one Vitest invocation shares one global sandbox; files are sequential but isolated into forked workers ([vitest.e2e.network.config.ts:16](apps/extension/vitest.e2e.network.config.ts:16), [vitest.e2e.network.config.ts:23](apps/extension/vitest.e2e.network.config.ts:23)).

Report results by scenario and import ordinal; do not pool 15 correlated imports as 15 independent samples. Alternate proving modes rather than running all proverless first and all prover-on second, and label cold versus warm imports.

Finally, solo quiet runs cannot establish the CI tail that caused this work: the committed ledger explicitly identifies the recurrence as load-dependent ([flake-ledger.md:351](implementations-plan/e2e-deflake/flake-ledger.md:351)). Solo runs satisfy controlled measurement, but the report must state that they are not CI-shard envelope evidence. Do not derive non-product deadlines from their maxima.

4. ASSUMPTION-ATTACK

Facts

- Correct: the current success wait is a bare hash-only 300s wait ([import-drivers.ts:178](apps/extension/tests/e2e/helpers/import-drivers.ts:178), [extension.ts:1194](apps/extension/tests/e2e/fixtures/extension.ts:1194)).
- Correct: both import pages expose `data-restore-stage` ([popup/import.vue:194](apps/extension/src/popup/pages/import.vue:194), [onboarding/import.vue:142](apps/extension/src/onboarding/pages/import.vue:142)).
- Misstated: “45s = 21s + 30s.” The total is one 45s absolute budget; preflight is capped at 21s and registration at 30s or the remaining total, whichever is smaller ([importChainSync.ts:28](apps/extension/src/composables/importChainSync.ts:28), [importChainSync.ts:65](apps/extension/src/composables/importChainSync.ts:65), [importChainSync.ts:89](apps/extension/src/composables/importChainSync.ts:89)). Timeout is converted to skip records rather than thrown ([importChainSync.ts:95](apps/extension/src/composables/importChainSync.ts:95)).
- Incomplete: the `/tmp` wildcard is merely a failure-artifact path; it is not a run-isolated measurement facility ([\_network-e2e.yml:344](.github/workflows/_network-e2e.yml:344)).
- Overstated: the saved native console original does not fire “only in the SW realm.” The sniffer invokes the page original when forwarding throws ([console-sniffer.ts:18](apps/extension/src/utils/console-sniffer.ts:18)), and the popup deliberately calls `console._log` directly ([popup/app.vue:192](apps/extension/src/popup/app.vue:192)). The accurate claim is that successful ordinary `console.error(...)` forwarding does not invoke the native page console.
- Correct: `"picked"` is declared but never assigned; every assignment is to another stage ([useFullBackupImport.ts:52](apps/extension/src/composables/useFullBackupImport.ts:52), [useFullBackupImport.ts:361](apps/extension/src/composables/useFullBackupImport.ts:361)).

Inferences

- “`pageErrors` is not blind”: plausible only for uncaught exceptions and unhandled rejections on fixture-opened popup/onboarding pages. The entry handler does not call `preventDefault` ([popup/index.ts:15](apps/extension/src/popup/index.ts:15)), but this still needs separate thrown-error and rejected-promise probes. It is not a general app-error channel: each new page resets the shared arrays ([extension.ts:1098](apps/extension/tests/e2e/fixtures/extension.ts:1098)), and approval windows receive no listeners ([popups.ts:22](apps/extension/tests/e2e/fixtures/popups.ts:22)).
- “Variance will concentrate in `chain-sync` and post-finished”: unsafe. `finalizing` opens the restored profile/session ([useFullBackupImport.ts:756](apps/extension/src/composables/useFullBackupImport.ts:756)), and the proving-mode switch changes the offscreen PXE factory ([offscreen/index.ts:100](apps/extension/src/offscreen/index.ts:100)). Measure; do not predict the concentration.
- “Terminal early-exit cannot mask a product bug”: too strong. It stays red, but it can preempt recovery/error-surface evidence or misclassify a stale terminal from a prior same-page attempt because stage reset is missing ([useFullBackupImport.ts:889](apps/extension/src/composables/useFullBackupImport.ts:889)).
- “Integrity + matrix are clean envelopes”: false for the reasons above. They are valuable named workloads, not clean independent samples.

Asks

- Terminal-failure early exit: reject for this arc. It is not in the settled design’s permitted early-fail set. If the owner wants it, amend the normative ledger separately and add an attempt-start fence.
- Deadline table: approve an empty outcome, but do not land an empty mechanism. Record that `chain-sync` is the sole qualifying stage and already owns/enforces the product budget; close with diagnostics-only.
- B2 posture: approve confirmation followed by document-as-designed, but reject a permanent SW CDP tap by default. The owner must also explicitly accept that `consoleErrors` is browser-native/page-scoped, `pageErrors` is uncaught-only and page-scoped, and approval windows remain uninstrumented.

Additional asks that need surfacing: independence/cold-warm rules for the campaign, treatment of missing stages and censored failures, output-path ownership/retention, and whether the ledger may close without any e2e deadline.

5. IMPLEMENTATION CRITIQUE

The driver split is justified only for the duplicated submit half. A large `RestoreOutcome` abstraction, configurable overall ceiling, and empty deadline registry are not.

The idiomatic wait shape is:

1. Arm a page-side stage trace before submit.
2. Submit through the shared helper.
3. Await the unchanged `waitForHash(..., 300_000)`.
4. On timeout only, read and format the trace through `withTimeoutMessage`.
5. Under an explicit measurement env gate, append the completed/censored import trace.

That reuses the repo’s existing timeout-preservation helper ([extension.ts:1019](apps/extension/tests/e2e/fixtures/extension.ts:1019)) and pre-submit recorder pattern ([backup-roundtrip.test.ts:124](apps/extension/tests/e2e/backup-roundtrip.test.ts:124)). It also avoids the proposed composite wait.

The empty-until-evidenced deadline table is over-engineering. There is one qualifying stage, and its product code already races the registration leg against the remaining absolute budget and records deadline skips ([importChainSync.ts:89](apps/extension/src/composables/importChainSync.ts:89)). An empty table implies future authority that this e2e arc does not have.

Yes: close B1 with measurement plus diagnostics-only everywhere and no deadline table. The close must explicitly say why this is the correct result of applying the settled classification rule, not claim that stage deadlines were added.

For B2, confirmation→document-as-designed is right. The SW tap has not earned its lifecycle complexity: it would need to reattach after MV3 worker replacement. More importantly, the repo already has the app-log source of truth:

- `LogViewerService.getLogs` exposes the live logger ring ([log-viewer/service.ts:23](apps/extension/src/wallet/services/log-viewer/service.ts:23)).
- `LoggerStore` persists recent logs to session storage ([logger/store.ts:80](apps/extension/src/wallet/logger/store.ts:80)).
- E2e already provides `readSwLogTrail` over that store ([journal.ts:217](apps/extension/tests/e2e/fixtures/journal.ts:217)).

The confirmation probe should therefore prove:

- nonce absent from `page.on("console")`;
- nonce present in `readSwLogTrail`;
- uncaught throw and unhandled rejection independently reach `pageErrors`;
- built HTML retains sniffer-before-entry order, which source HTML currently has ([popup/index.html:11](apps/extension/src/popup/index.html:11)).

6. Open decisions

The ledger’s five rows reduce to three real gates, but every row should be resolved explicitly:

| Row | Position |
|---|---|
| 1 — B1 shape | Hybrid: extract shared submit; pre-submit trace; retain the existing 300s hash wait. |
| 2 — deadline table | No table. Diagnostics-only, including `chain-sync`; document why its product-owned 45s budget makes an e2e duplicate unnecessary. |
| 3 — terminal early-exit | Reject/drop from this arc. It exceeds the settled early-fail rule and lacks an attempt fence. |
| 4 — B2 fork | Confirmation then permanent documentation. No fixture SW tap; reuse `readSwLogTrail` for diagnostics. |
| 5 — campaign source | Instrument real flows, but run them independently and report by scenario/import ordinal. No repeated synthetic loop and no pooling correlated matrix samples. |

7. What the plan MUST add

- A measurement contract defining stage entry/exit, skipped stages, `finished→route`, failed/censored traces, clock source, and sample independence.
- A pre-submit trace gate. Starting observation after submit can miss the earliest stages; starting before submit is already the repo precedent ([backup-roundtrip.test.ts:124](apps/extension/tests/e2e/backup-roundtrip.test.ts:124)).
- Unit coverage for trace start/stop, DOM unmount at success, fast/coalesced stages, measurement disabled=no filesystem write, and preservation of non-timeout Puppeteer errors.
- Exact API preservation for `expectError?: boolean | string`; the planned interface currently narrows that behavior ([import-drivers.ts:142](apps/extension/tests/e2e/helpers/import-drivers.ts:142)).
- Removal of `overallCeilingMs`; hardcode 300s so no caller can tighten or raise the sole overall criterion.
- Env-gated, unique output with run/import IDs and outcome/censor metadata; truncate or create a new file per campaign run.
- Independent per-mode runs, alternated mode order, scenario-stratified tables, and a clear statement that solo maxima are not CI-shard contention envelopes.
- A B2 probe that distinguishes `console.error`, uncaught throw, and unhandled rejection, plus documentation of array resets and uninstrumented approval windows.
- A no-timeout-change diff gate. The final audit should enumerate every touched numeric timeout and prove that none changed.
- Ledger wording that closes B1 as “measured; classification yielded no useful e2e deadline; 300s unchanged; diagnostics improved,” rather than claiming the remaining work shipped a deadline mechanism.

No repository changes or test executions were needed for this read-only audit.
---

_Session: 01a01612-7543-7721-a104-f8a315a6e4d6 (round 1, plan-audit, reject). Final fresh-context pass recorded below when run._
