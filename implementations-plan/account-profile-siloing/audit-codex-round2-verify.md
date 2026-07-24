VERDICT: reject (blocking: stale-send CAS, permanent checkpoint holes, terminal-marker recovery failure, and unsafe deletion/lineage recovery).

Per finding:

- B1 — partial — `sessionGeneration` fixes identity ABA, but `deriveDappSessionMacKey()` bypasses the facade lock (`profile/service.ts:577-579`); its TTL check can close the session while the CAS awaits marker persistence.
- B2 + Minor — partial — private lock-held checking and awaiting outside `runExclusive` are sound. However production `node.sendTx()` only queues a zero-delay batch (`safe_json_rpc_client.ts:208-225`); fetch starts later. Treat/test enqueue as the irreversible boundary or synchronously flush it.
- B3 — new-bug — an abandoned allocation permanently wedges the contiguous checkpoint (§5.4:246-256).
- B4 — new-bug — reservation can be indefinite, while the bundle/orphan ledger retains deleted-profile transaction data.
- B5 — new-bug — “any record with a live marker” includes already-terminal records, causing an illegal terminal→`submission_unknown` transition.
- S6 — partial — no crash-safe lineage allocation/activation protocol exists; deletion purging lineage (§15:716-717) also permits generation reuse.
- S7 — closed — A2(i) is coherent, provided approval explicitly accepts cold switch-back and revises the instant cross-profile-cache outcome.
- S8 — partial — UI transfer preview currently reaches submission through estimate reuse.
- S9 — partial — P12 states a property but assigns no startup owner, ordering, locks, or retry behavior.

New fix-induced bugs, most severe first:

1. **CAS can still stale-send.** Trace: check generation G → await unbounded `chrome.storage.local` write under the facade lock → an off-lock TTL close bumps G, or the five-minute force-release fires (`lock.ts:36-44`) and a switch runs → storage resolves → send occurs without another check. The old `finally leave()` can also release a newer holder. Fix: persist the candidate bundle before acquiring the facade lock; then perform final fence check plus irreversible RPC enqueue synchronously with no intervening await. Centralize all active-session assignments/clears in `SessionManager` behind the facade lock.

2. **Checkpoint permanent hole.** Trace: checkpoint/allocation=4 → allocate 5 → SW dies before row → next row commits as 6 → checkpoint cannot advance past missing 5 → restart snapshots include only rows ≤4 (§5.4:249-250), so row 6 never appears. Add durable intents/skip records and boot repair, or safely reuse a provably unobserved allocation. Test permanent crash holes.

3. **Recovery breaks after successful recovery.** Trace: tx and journal `succeeded` persist → SW dies before marker deletion → boot stamps `submission_unknown` → `succeeded` has no outgoing edge (`jobs/fsm.ts:47-50`) → reconciliation throws and the marker remains forever. Terminal matching records must clean up the marker directly; only eligible nonterminals transition to unknown. Reconcile markers independently with durable retries.

4. **Deletion has an impossible termination choice.** Time-bounded “absence” is not proof that a lost-response transaction was rejected. Either the marker remains unknown and deletion stays reserved indefinitely, or it is failed/purged and a later-accepted tx is lost. Immediately erase profile secrets/feed data; detach a minimal encrypted recovery record with explicit retention/force-purge policy. Do not retain `txDraft`/`authwitTail` indefinitely.

Clear to proceed on: monotonic session generations, the private locked helper, outside-lock awaiting, capability-bound recording, pinned endpoints, marker-deleted-last, and the surfaced A2 fork.