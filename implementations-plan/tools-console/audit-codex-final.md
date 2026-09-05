# Codex audit — final fresh-context pass (consolidated plan + ledger)

Session `01a0718a-3b8e-7072-818a-892def2db8c2`, `gpt-5.6-sol` at `xhigh`, read-only. The first run was cut off by the tool's background cap after it had read everything; the session was resumed with "write the final answer now". Every finding below was checked against the repo before adoption; see plan.md § Decision ledger rows 16–27.

---

## A. Ledger re-evaluation

- **HIGH — `plan.md:100-103,142,243`; `useBridgeJournal.ts:687-700,1460-1462`; `tools-smoke.test.ts:270-279`:** Decision #5 is unsound. An action-less “on screen” dock row is still a second display surface, contradicting the explicit foreground ownership invariant. Smoke 3b only counts list containers; rewriting it to permit a dock plus journal weakens that safeguard. On Send, the dock should use `visibleRecords`; Activity should use `records`.

- **MED — `plan.md:31,50,199`:** `v-show` keeps the dock rendered on Activity, contradicting criterion 8 and the proposed “not rendered” test. Use `v-if` or gate the dock root and its effects completely.

- **Ruling — `BridgeJournalCard.vue:251-265,413-440`; `useOpsInFlight.ts:3-36`; `useBridgeJournal.ts:620-635,753-759`:** Do not globally disable CLAIM/FINISH for `opsBusy`. That counter protects account switching, not operation concurrency; record-local `runtime.busy` and `withRecordLock` already gate duplicate runs. SWITCH must honor `opsBusy`.

All other adopted ledger decisions close their original findings, subject to the implementation holes below.

## B. Architecture and implementation

- **HIGH — `plan.md:58,186`; `BridgeJournalCard.vue:184-193`; `journal.ts:56-57`:** Classification says `busy → running` before `completedAt → done`, but `completedAt` is authoritative and the card derives `done` even if runtime remains busy briefly or is stale cross-tab. Make completion precedence first and add a `completedAt + busy` fixture; the proposed action-only parity pin will not catch this.

- **HIGH — `plan.md:61,90,133`; `journal.ts:335-344`:** A 64-ID seen cap cannot guarantee “stays hidden for that bridge”; the journal may retain more than 64 unfinished records. Also, `hide()` receives no current IDs despite promising to mark them. Retain seen IDs while their records exist and make the input/control flow explicit. Synchronize the seen set on storage events if “per browser” includes already-open tabs.

- **MED — `plan.md:103,198-200`; `BridgeJournalCard.vue:159-181`; `fuel-recovery.ts:72-101`:** CLAIM GAS needs a dock-local, per-record in-flight guard. `claimFuelStandalone` has no record lock, and `opsBusy` is not a mutex; rapid activation can start duplicate sponsored claims.

- **MED — `plan.md:104`; `SendWizard.vue:152,933-945,974-976`:** Background handoff must pass `backgroundedCanonical.value`, not the original `backgroundedId`; provisional records can be rekeyed before Activity opens.

- **LOW — `plan.md:59,86`; `BridgeJournalCard.vue:292-299`:** The feed promises an `age` field but names only records/runtime/wallet as reactive inputs. Read the shared `useNow()` heartbeat inside the feed computed.

The pure policy has no impossible dependency: fuel recovery is record-derived, while account ownership/status can be supplied through `WalletView`. The feed remains reactive because both `setRuntime` and `patchRecord` replace refs, provided wallet refs are read inside the computed rather than snapshotted outside it.

## C. Assumptions

- **MED — `plan.md:159`; `send-smoke.test.ts:414-431`:** Fact 1 remains false: `send-smoke` leaves the journal real but does not assert absence of a journal testid.

- **MED — `plan.md:176-178`:** RETRY/SWITCH/CLAIM GAS, blocked-count semantics, placeholder behavior, and breakpoints are product choices merely labeled owner-vetoable. They require explicit owner confirmation before implementation, especially the expanded dock action set.

## D. Adversarial/security

- **MED — `plan.md:116,193`; `BridgeJournal.vue:33-63,103-130`:** Activity’s first-visit Restore link has no specified secure implementation seam. It must reuse the existing 1 MB pre-read cap, input reset, concurrency guard, validation, and error handling—not duplicate a weaker restore path.

`blocked` replacement, sanitized/capped symbols, no dock DISCARD, and unchanged CSP otherwise cover the identified threats. Update the now-false, plan-referencing foreground comment at `useBridgeJournal.ts:1460-1461`.

## E. Gates

- **LOW — `plan.md:182-211`; `package.json:24,38`; `apps/tools/package.json:12-15`:** The five gates are real and cumulative; Phase 5 adds build and manual preview. Add regression cases for completed-plus-busy, canonical background handoff, claim-gas double activation, and synthetic cross-tab storage updates.

- **LOW — `plan.md:182`:** `<frozen>` correctly detects tracked working-tree/index changes, but `origin/dev` is mutable. Capture the implementation’s base commit and diff against that fixed SHA.

VERDICT: conditional approve — conditions: hide the foreground record from the Send dock, fix completion precedence and dock mounting, make seen-state retention/synchronization explicit, guard CLAIM GAS, use canonical handoff IDs, preserve the restore-file safeguards, and obtain owner confirmation for the unresolved product choices.