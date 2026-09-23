# Cluster F4b — app-shell orchestration + store sync (watcher/scope-change lens)

> Scanner: general agent, 2026-08-22.

## F4b-1 — Superseded network-watcher run can survive disconnect() (pre-registration RPC immunity) and land cross-chain state

**Severity:** Medium-High (≈Major) | **Repro confidence:** moderate (mechanism verified end-to-end; trigger needs SW-restart window overlapping the flip) | **Type:** Missing generation fence + transport-level stale-survivor write

**Counter-example (exact interleaving):**
1. Active network X, profile P. MV3 SW restarting (chrome.runtime.connect throwing → clients park in waitForConnection, polling every 300ms).
2. User flips X→A. Watcher run WA (app.vue:100): replaces managers.account = clientWA, issues getAccounts(P, chainA) → suspends in awaitReadyWithinDeadline (base-client.ts:120-121) — BEFORE pending-registration (base-client.ts:143).
3. User flips A→B. Activation serializes fine, commits network=B. Watcher run WB starts: managers.account.disconnect() (background/client.ts:66-78) rejects only REGISTERED pendings — WA's request isn't in the map yet → survives; waitForConnection (client.ts:113-121) reconnects clientWA once SW returns.
4. SW returns. WB completes: accounts=[B-list], setupActiveAccount epoch N → commits B-account, writes durable pointer.
5. WA's getAccounts(chainA) resolves LAST:
   - appStore.accounts = [A-list] — unfenced (app.vue:123);
   - WA enters setupActiveAccount — holds the NEWEST epoch (it started later), and its scope capture re-reads LIVE (profile, network) = (P, B), matches current → NOT superseded;
   - pointer lookup for B-address fails against [A-list] → falls to first = accounts.value[0] = a chain-A account → commitScopeChange admits → account.value = A-account, durable pointer poisoned.

**Violated invariant:** "the active (network, account) pair is consistent, and a superseded activation never lands after the winner" — what setupActiveAccount's epoch doc (app.store.ts:63-75) claims. The epoch misses because the watcher run never carries its TRIGGER identity; setupActiveAccount re-captures scope at entry, validating against what IS current, not what the run was FOR. Pure rapid-flip interleavings (SW healthy) converge — rejectAllPending kills superseded runs at their next old-client await.

**Expected:** network=B + B-accounts + B-account. **Actual:** network=B showing chain-A account list, active account = chain-A address (balances/send validation/token lists query wrong identity) until next flip or popup reopen (full bootstrap self-heals pointer).

**Smallest safe fix:** capture targetNetworkId (+ profile id) synchronously at watcher entry; bail after every await when they no longer match — same isCurrent pattern initNetworks uses (useProfileBootstrap.ts:62,66,76,83).

**Instances:** app.vue:100-131 (sole unfenced shared-client mutation). Residual cosmetic sibling: bootstrap-vs-watcher client stomping produces recurring unhandled rejections — noise, converges.

## F4b-2 — RecentActivityView reset keyed on address only: same-address profile switch keeps foreign journal/task state and hides the new profile's in-flight cards

**Severity:** Medium (≈Major-Minor boundary) | **Repro confidence:** moderate (deterministic given shared-seed-profile scenario) | **Type:** Scope key too narrow (ABA-blind reset)

**Counter-example:** Import same mnemonic as profiles A and B (activity.store.ts:61-63 documents two profiles derive identical addresses). On A start a UI transfer (task + journal record, account X). Lock, unlock B. bootstrapActiveProfile(B) → setupActiveAccount re-points account.value to row with address X — SAME STRING. RecentActivityView's reset watcher keys on appStore.account?.address (RecentActivityView.vue:707-720, if (nv === ov) return) → NO clear, NO resnapshot; resnapshotJournal's captured-account guard (:596-598) likewise address-only. Result: journalOps still holds A's ops (render-filtered for B by journalRecordInScope :286), A's executingTask survives isExecutingTask (:623-624 checks only senderAddress === X) → renders as orphan fallback card under profile B with live subtask progress attributed to B's wallet. B's own in-flight/terminal records invisible until unrelated journal event / port reconnect / popup reopen. Contrast: useIncomingTransfers keys its flush-sync reset on FULL (profileId, networkId, account) triple (useIncomingTransfers.ts:64,121-128).

**Violated invariant:** Layer-A containment ("a switch A→B must synchronously clear what B could SEE of A's progress", :698-706) — component's own stated rule, defeated by narrow watch source.

**Smallest safe fix:** watch [appStore.profile?.id, appStore.network?.id, appStore.account?.address] triple for reset+resnapshot; include profile/network in captured guards of resnapshotJournal/loadExecutingTaskSnapshot.

**Instances:** RecentActivityView.vue:707-720, :591-608, :681-696, :454-464.

## Verified clean

- selectAccount bypassing commitScopeChange: premise doesn't hold — both production callers already wrap it (AccountsPopup.vue:36, settings/accounts/index.vue:40); passing async fn as sync commit contract-safe. Store-level method remains latent footgun only.
- Account-watcher fire-and-forget syncTransactions: per-scope mutationVersion capture-and-refuse + wholesale-replace install makes duplicates safe; dropped history needs >4-attempt continuous event storm (~750ms uninterrupted mutations) — pathological.
- balances.store belt/suspenders: belt covers every profile-id change incl. lock/unlock-different-profile; suspenders cover lock-same-profile because auth-route navigation unmounts all subscribers (no KeepAlive). No gap where neither fires.
- activity.store LRU @32: evicting slice with fetch in flight safe — mutationVersion entries survive eviction (:200-204), updateSlice recreates slice, placeholder exemption protects optimistic state; incarnation baseline closes absent-key ABA.
- Popup close/reopen mid-bootstrap: fresh JS context each reopen; EventHandler.add dedups by function identity (event-handler.ts:34-38); concurrent bootstraps join via single-flight.
- Crash-loop storms: listener accumulation impossible; churn bounded by flap rate; converges.
- cache.store closures: trust queue triple-guarded with captured triples not live reads.
- NOTE on F4a-1 (aztecReset): this scanner judged the blocking-overlay defense sufficient EXCEPT the lock→re-unlock path ("lock flow never nulls appStore.profile") — cross-model disagreement with F4a's exploitability assessment flagged for adjudication.
