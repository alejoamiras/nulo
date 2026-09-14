# tools-recovery — codex audit (OpenAI leg, GPT-6 Astra at `high`, read-only)

## Round 1 — on plan v1 + the competing outline (2026-09-11)

**Verdict: reject** (with blocking findings: false completion paths, incorrect deposit matching, unsafe exit attribution and re-keying, and background wallet prompts).

Security
1. **High** — A trusts a journal-supplied `messageHash` as the deposit's identity; a hostile record can pair another consumed message's hash/secret with different displayed facts; an unrelated consumed-fuel error can trigger the check. Recompute the full message commitment from validated record/envelope fields, including the leaf index, before accepting nullification.
2. **High** — `flows.ts:222`: C accepts a match anywhere in `l2ToL1Msgs`, but `consumeWithdrawal`, `expectedWitness` and `consumedElsewhere` always select index zero; if zero is another already-consumed message the catch can falsely complete this exit. Require the expected commitment at index zero and revalidate before consuming/checking consumption.
3. **High** — one remaining transaction does not prove which attempted exit produced it; two hash-less records can share one candidate; an earlier identical exit inside the slack window matches an unsent attempt; `taken` ignores discarded/pruned records and competing provisional records. Refuse competing claims; do not describe window uniqueness as provenance.
4. **High** — `useBridgeJournal.ts:377`: re-keying carries `busy` but transfers neither `inFlight` nor the old-id cleanup; `journal.ts:389` overwrites an existing destination record. Guard source identity/completion and destination absence, serialize cross-tab attachment, preserve fresh fields, hand execution to the canonical-id lock.
5. **High** — the prompt rule is already false along reused paths: automatic receipt resume enters `claimGuards → ensureTokenGrant → retryCapabilities`; the fresh private branch at `:808` ignores `interactive`. Gate both on explicit interaction; test automatic resume with missing grants/secrets.

Assumptions — Facts
6. **High** — `send-flow.ts:158`: B's mapping misses real deposits: private token deposits publish recipient zero; `bridgeWithFuel.totalAmount` = journal token amount + fuel amount; gas records have no `token`; gas does not always use `bridge` (`sendEntrypoint:112`). Mirror the existing mappings; verify both recipients, both secret hashes and the fuel minimum output.
7. **Medium** — the paste outline calls receipt-leaf extraction an identity verifier; it checks router/event structure only. "Identical deposits cannot both be valid" is wrong: `hash.nr:19` includes the leaf index in the message hash. Copying public calldata does not imply knowing its secret.

Assumptions — Inferences
8. **High** — viem's `getLogs` rejects/omits `args` with `events` (`getLogs.ts:60,168`); block bodies need `{ includeTransactions: true }`; encode the real signatures in fakes.
9. **High** — A stays fee-dependent because its probe runs only after the simulate fails; fee construction can stop earlier; the public wording `"L1-to-L2 message is already nullified"` is missed by `isMsgConsumed`. Probe validated material before fee construction; return a distinct completed outcome from `awaitConsumable`.
10. **Medium** — wall time → chain time keeps clock skew; caps, missing history and RPC failures are "search incomplete", not "none"; bound RPC duration/candidate volume; recheck canonical block/receipt identity before attaching (a reorg can latch an orphaned hash).

Assumptions — Asks
11. **High** — "none open" silently accepts RPC honesty, permanence of `latest`, and attribution of identical exits; a fabricated witness can mark unclaimed funds done. Settle the trusted-node/finality boundary explicitly and whether a matching payment destination suffices for C.

Implementation
12. **Medium** — an externally wired dep cannot reach module-private `secretCache`/`publicClaimSecretOf`; pass resolved material explicitly; restrict the hub derivation to hub token records. Three optional deps fit; keep scans app-local.
13. **Medium** — extract classification and attachment control flow rather than growing the runners; add regressions for private matching, multi-message exits, concurrent completion, prompt suppression.
14. **Medium** — prefer corrected B scanning plus a verified-hash fallback; C needs explicit attribution when ambiguous; keep shared verifiers independent so reverting A does not disable B/C.

Confirmed sound: hub/private-secret formula and node-client membership API; additive schema field; tools-only scope; no proposed deposit/burn resubmission.

### Triage (driver, verified against the repo)

| # | Verified? | Call |
|---|---|---|
| 1 | yes — `L1ToL2Message(sender: L1Actor(portal, chainId), recipient: L2Actor(hub, version), content, secretHash, index).hash()` recomputes the commitment from record facts (`messaging.nr:15-27`, stdlib `l1_to_l2_message.d.ts:24-36`); contents at `content-hash.ts:49-54` | **adopted** — A recomputes the message hash and requires it to equal `rec.messageHash` |
| 2 | yes — `flows.ts:222`, `useHubExit.ts:189` read `l2ToL1Msgs[0]` | **adopted** — C requires the recomputed hash at index 0 |
| 3 | yes — `taken` is this journal only; identical exits share a hash | **adopted** — attribution rule rewritten; ambiguity refuses; the residual is an accepted Ask |
| 4 | yes — `rekeyRecord` filters `next.id` (`journal.ts:389-393`); `withRecordLock` keys `inFlight` by id (`:625-642`) | **adopted** — attach returns `{ rekeyedTo }`; the outer runner re-enters under the new id; destination absence guarded |
| 5 | partly — `prepareSendLane`/`resolvePrivateClaimMaterial` on a NON-interactive run happen only for records this page session started (`resumeActionFor` skips the rest) — the journal's stated exception | **rejected as pre-existing and by design**; the new branches take no prompting path; a unit test pins that a non-interactive run with no cached secret returns `null` and asks for nothing |
| 6 | yes — `witnessRecipient` publishes zero for private token deposits (`send-flow.ts:150-154`); `totalAmount: p.amount` (`:180`) with the record's `amount = total − fuel` (`SendWizard.vue:890`); gas-only entrypoints (`:112-116`) | **adopted** — B filters by router + event, post-filters on the decoded secret hash(es), then verifies calldata; scope = hub token records (`claimsThroughHub`) |
| 7 | yes | **adopted** — outline text corrected; leaf-index note |
| 8 | yes — viem 2.55 `getLogs.js:35` | **adopted** — one `event` per call |
| 9 | yes — `public_context.nr:259` wording; probe order | **adopted** — the nullifier is read BEFORE the claim build; `isMsgConsumed` gains the public wording; `awaitConsumable` returns a tri-state |
| 10 | yes | **adopted** — `"incomplete"` outcome; receipt/effect re-check before the write |
| 11 | yes | **adopted as explicit decisions** for the approval gate (trusted node = the app's existing boundary; destination-match suffices for C) |
| 12 | yes | **adopted** — `messageNullified(rec, secretHex)` |
| 13 | yes | **adopted** — helpers + regressions listed per phase |
| 14 | design choice | **partly** — scan ships; paste fallback stays out of scope (fable agrees); ledger records the disagreement |

## Round 2 — on plan v2 (resumed session)

**Verdict: reject** (with blocking findings: cross-tab attachment remains unserialized, and explicit identity mismatches can still complete records).

1. **High** — presence/hashlessness guards do not establish that the live record still matches the verified snapshot; check identity fields, `completedAt` and submission hashes after awaits. C's destination check + re-key are non-atomic across tabs (`withRecordLock` is process-local); serialize and recheck destination ownership inside that lock.
2. **High** — A maps a proven commitment mismatch to `null`, and `handleSuccessReceipt` treats `null` as permission to complete (`useBridgeJournal.ts:1308`). Distinguish invalid identity from unavailable evidence; stop on invalid in both paths.
3. **Medium** — `getBlocks(from, limit)` does not include bodies by default (`BlocksIncludeOptions.includeTransactions`); specify the option in the contract and the fake.
4. **Medium** — `BridgeWithFuel` exposes `tokenSecretHash`, not `secretHash` (`router-abi.ts:60`); pin both event shapes.
5. **Medium** — replacing `recordMessageConsumed` universally changes gas/legacy receipt completion; keep the existing probe for excluded shapes.
6. **Medium** — the whole-run "non-interactive ⇒ no prompt" test cannot pass with unchanged material resolution (`:808`); scope it to the new probe; `resumeActionFor` also admits rediscovered receipt-wait records.

Confirmed sound: recomputed commitments, probe ordering, index-zero matching, canonical-id handoff, explicit trust/attribution decisions, scan-only scope.

### Triage (driver, verified)

| # | Verified? | Call |
|---|---|---|
| 1 | yes (`withRecordLock` `:625-642`; localStorage has no mutex — `journal.ts:372`) | **adopted** — snapshot-equality guards; new synchronous `rekeyRecordWhen` with a destination check in the same block; documented as the journal's best-effort guard |
| 2 | yes (`:1308`) | **adopted** — the dep answers `nullified / live / invalid / unknown`; `invalid` stops as `tampered` in both paths |
| 3 | yes (`block_response.d.ts:13-21`, `aztec-node.d.ts:189`) | **adopted** |
| 4 | yes (`router-abi.ts:55-66`) | **adopted** |
| 5 | yes | **adopted** — the probe dispatches by shape; excluded shapes keep today's probe |
| 6 | yes (`resumeActionFor` `:1446-1448`) | **adopted** — test scoped to the probe; ledger corrected; the grant-on-rediscovered-receipt wart recorded as a follow-up |

## Round 3 — on plan v3 (resumed session) — the three-round stop

**Verdict: reject** (with blocking findings: the synchronous re-key guard still permits concurrent attachment and duplicate consume attempts).

1. **High** — "a lost race never double-attaches" is false: synchronous execution prevents interleaving within one tab, not between tabs. Both tabs load a journal where destination `H` is absent, both guards pass, both write, both enter `runWithdrawConsume(H)` under process-local locks. The Outbox prevents double payment, but duplicate prompts, submitted transactions and lost journal facts remain. Use cross-tab exclusion (a shared Web Lock covering destination ownership and the consume handoff, canonical runners participating), recheck guards inside it, fail closed if unavailable; add an interleaving regression (both loads before either write).

Confirmed sound: invalid/unknown separation, excluded-shape probe preservation, explicit block-body requests, event-field matching, snapshot checks, scoped prompt tests.

### Triage

| # | Verified? | Call |
|---|---|---|
| 1 | yes — `withRecordLock` is a process-local set; localStorage has no mutex | **adopted** — `withRecordLock` gains an injectable same-origin exclusive lock (production: `navigator.locks`; tests: an in-memory table shared by the two "tabs"); the attach fails closed without it; guards re-run inside; the old→new id handoff acquires the new lock before releasing the old; the interleaving regression is in Phase 6's tests |

Round 3 was still material, so the loop stopped here per protocol; the finding is folded into v4 and the fresh final pass re-evaluates the whole plan.

## Fresh final pass #1 — new session, on plan v4 + the decision ledger

**Verdict: reject** (with blocking findings: incomplete cross-tab exclusion and an unsafe Web Locks adapter/handoff).

1. **High** — record locks do not protect the storage unit: every mutation rewrites the whole journal array (`journal.ts:351`); tabs holding different record locks overwrite each other; discard/import bypass runner locks. Add one short journal-wide lock around every load–guard–write; keep record locks for running operations; test different-record writes and attach vs discard/import.
2. **High** — with `ifAvailable: true` the callback is still invoked (with `null`); wrap `lock => lock ? fn() : "held-elsewhere"`; test the null branch.
3. **Medium** — "then discard" on an ambiguous result directs users to destroy recovery material despite positive evidence; say keep/export instead (`BridgeJournalCard.vue:394`).
4. **Medium** (Facts) — `chain-constants` does not cover the `local` target used by the browser gates; bind A/C to `resolveToolsTarget()` (`network-targets.ts:11,64`).
5. **Medium** (Inferences) — caps and batching do not prevent a hang; the L1 client has no transport deadline (`useL1Wallet.ts:29`); specify a total deadline and budgets; drop timed-out continuations.
6. **High** — the handoff holds `H` and calls `runWithdrawConsume(H)`, which re-acquires `H` — exclusive locks are not reentrant; acquire `H` before the destination check/re-key and run the canonical consume body inside; the live `useHubExit.ts:512` re-key runs outside `withRecordLock` today — same helper.
7. **Medium** — locking is scheduled only in Phase 6 but promised for all arcs; put it in arc 1; same-thread fakes cannot prove browser exclusion.

Asks: the trusted-node and destination-only attribution decisions are explicit and defensible if approved; neither proves finality or provenance.

Confirmed sound: hub hashes/siloing, private-secret derivation, calldata mappings, index-zero matching, helper boundaries and complexity gates; ship scan-only after these fixes.

### Triage — all seven verified (the whole-array `write`, the spec's null callback, the un-locked live re-key, the local target's `define`d identity, the deadline-less L1 client) and **adopted** in v5: two injectable locks introduced in arc 1 (journal-wide mutation lock + record run lock with the null-branch adapter), one executable handoff shared with the live exit, scan deadline/budgets with late-result drops, keep/export copy, active-target identity, and a two-tab browser cell (31c).

## Fresh final pass #2 — new session, on plan v5 + the decision ledger

**Verdict: reject** (with blocking findings: async persistence is not carried through callers; the finality decision understates potential loss).

1. **High** — the journal lock makes mutations asynchronous, but `addRecordVerified`, `persistPreTx` and the recovery hooks depend on synchronous persistence (`send-flow.ts:240,298,304` invoke hooks without awaiting); wrapping could send before recovery material is durable.
2. **High** (Facts/Asks) — `latest` means proposed (`block_parameter.d.ts:8`); the existing completion floor is checkpointed (`claim-receipt.ts:9-12`); an orphaned claim becomes permanently done and `journal.ts:403` prunes its sealed secret — a strandable private deposit. Use `checkpointed`; correct the approval decision.
3. **Medium** — Phase 6 still instructs outer-runner re-entry; the diagram and `exclusive` interface are stale.
4. **Medium** — calling the consume body directly bypasses its canonical-id error boundary (`useBridgeJournal.ts:1337`); catch/report against `H` inside the handoff.
5. **Medium** — provisional exits cannot export a recovery file (`BridgeJournalCard.vue:32`, `backup.ts:293`); C's ambiguous copy must not say so.
6. **Medium** — simultaneous clicks do not guarantee contention; specify two pages in one context and a controlled pause after lock acquisition.

Confirmed sound: commitment formulas, private derivation/siloing, calldata mappings, index-zero matching, bounded scans, null-lock handling, the attach's unavailable-API refusal, reuse boundaries, helper placement.

### Triage — all six verified (`BlockTag` doc, `claim-receipt.ts:7-13`, `pruneCompleted` `journal.ts:403`, the sync callers, `exportable` `BridgeJournalCard.vue:31-34`) and **adopted** in v6: the journal lock scoped to the plan's new guarded writes only (existing sync writes untouched, follow-up filed); `checkpointed`; Phase 6 / diagram / `locks` interface aligned to the handoff with its own error boundary; truthful C copy; cell 31c with a parked L1 portal transaction (L1 fixture `release()`) as the contention window.

## Fresh final pass #3 — new session, on plan v6 + the decision ledger

**Verdict: reject** (with blocking findings: A can complete a replaced record and strand unclaimed private fuel).

1. **High** — A lacks B/C's snapshot guard; `completeDeposit` (`:707`) checks existence, not identity; a same-id replacement during the read gets completed. Pass the verified snapshot; persist `claimedByOther` + `completedAt` together; regression.
2. **High** — token nullification does not prove fuel consumption: a relayer can claim the token with its own fees; `fuel-claim-state.ts:323` reads a completed private record as settled and the prune (`journal.ts:405`) removes the recovery material. Withhold completion while private fuel is unsettled; inverse regression (TOKEN nullified, FUEL live).
3. **Medium** — the security section still claims discard/import participate and "never loses facts"; Web Locks coordinate cooperating callers only. State the residual.
4. **Medium** — "bookkeeping, not loss" understates the trusted-node decision: a false completion + prune can destroy a private deposit's only secret. State it.
5. **Low** — stale ledger rows (outer re-entry, universal locking, export advice for exits).

Confirmed sound: commitment formulas, private derivation/siloing, calldata mappings, index-zero matching, bounded scans, null-callback adapter, the canonical error boundary shared with live exits, unavailable-lock refusal, the parked-transaction 31c design, separable arc-1 locks, helper placement.

### Triage — all five verified (`completeDeposit` `:707-731`, `fuel-claim-state.ts:318-326`, `decideStandaloneFuelRecovery` in `record-policy.ts`) and **adopted** in v7. Not re-audited: this was the third fresh pass after the three-round stop; the plan is surfaced to the owner with the recommended condition that a fourth fresh pass returns `approve` before Phase 1 starts.

## Fresh pass #4 — new session, on plan v7 (the approval condition)

**Verdict: reject** (with blocking findings: v7 routes unsettled private fuel into a public-only recovery action).

1. **High** — the promised private-fuel recovery cannot execute: `fuel-claim-state.ts:323` classifies private fuel as settled, `fuel-recovery.ts:99` rejects private standalone recovery, `deposit-flow.ts:180` builds with `isPrivate: false`; private fuel belongs to the PrivateFPC.
2. **Medium** — B's L1 client delegates reads to the injected provider (`useL1Wallet.ts:29`); a chain switch mid-scan yields a false `none`. Reuse `assertL1Chain` around the scan; `incomplete` on change.
3. **Medium** — phase text drift: the journal lock "used by arcs 2/3 only", `record-policy` "untouched for A", the unconditional A-completion diagram.

Asks: the checkpointed single-node boundary and single-candidate attribution are explicit, approved trade-offs.

Confirmed sound: commitment formulas, private derivation/siloing, calldata mappings, index-zero matching, bounded scans, scoped Web Locks semantics, the canonical handoff, separable arcs, Biome limits.

### Triage — all three verified (`claimFuelStandaloneOnce` refuses private, `resolvePrivateFuelFee`/`privateFpcFee` is the only private fuel spend, `assertL1Chain` at `useSend.ts:105`) and **adopted** in v8: public token+gas routes to the existing public standalone recovery and completes on settlement; private token+gas stays open with its sealed material (follow-up `private-fuel-standalone`, no new fee surface); the L1 chain is asserted before and after the scan; Phase 1 owns A's locked completion and both policy callers; the diagram is corrected.

## Fresh pass #5 — new session, on plan v8 (the approval condition)

**Verdict: approve.** No new blocking findings; three low corrections: (1) `backup.ts:107` — add `isOptionalBoolean(d.claimedByOther)` to `assertDepositFacts` with a malformed-value regression; (2) the remaining `latest` inference → `checkpointed`, `null` → `unknown`; (3) editorial alignment of the seed's re-entry wording, the export advice, "only bridge-core change", the historical summary. Confirmed sound: recomputed identities; invalid/unknown separation; chain-pinned, bounded scans; index-zero attribution; canonical lock handoff; token-only completion, public standalone-fuel recovery, retention of unsettled private fuel's sealed material.

### Triage — all three adopted (the validator check is a Phase 1 task; the plan text aligned).
