reject (with blocking findings: journal-detail bypass; initial incoming reads still fail open; legitimate delegated notes can be dropped)

### Bypass

- **Blocking — journal details survive A→B.** [`journal/[id].vue:172`](</home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/popup/pages/journal/[id].vue:172>) fetches solely by ID, never validates `profileId/networkId/accountAddress`, and never watches identity. The global header remains available, so switching via [`AccountsPopup.vue:30`](</home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/popup/components/popups/AccountsPopup.vue:30>) leaves A’s amount, recipient, dApp origin, and error rendered under B indefinitely.
- **Foreign-network gaps remain.** Awaiting placeholders carry only account/contract/destination ([`app.store.ts:16`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/stores/app.store.ts:16)); reset watches address only (`:168`), and task matching uses sender address only ([`RecentActivityView.vue:610`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/popup/components/modules/general/RecentActivityView.vue:610)). On two networks sharing chain/account address, an old placeholder or UI task can render. History also ignores journal `networkId/profileId` ([`activity-rows.ts:65`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/utils/activity-rows.ts:65)); Recent Activity deliberately admits legacy journals missing `networkId` (`RecentActivityView.vue:272-280`).
- For the ordinary same-network feed, Added/Updated incoming events, tx events, journal/task rendering, initial snapshots, reconnect refreshes, and direct tx/incoming mutations are scope-filtered or synchronously reset. No A→B paint window was found there.

### Fail-closed

- **Blocking — reads still fail open.** [`service.ts:274`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/incoming-transfer/service.ts:274) catches visibility-config failure and continues returning records (`:286-296`). Only live emission uses the fail-closed helper (`:735-740`). Thus a reconnect/remount can expose receives while the privacy setting is unverifiable.
- **Blocking regression — owner mismatch is over-reaching.** `NoteService` obtains `content.owner` from trusted `NoteDao.owner`, not sender-controlled note content ([`note/service.ts:278`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/note/service.ts:278)). Aztec explicitly documents that delivery scope and owner may legitimately differ for delegated discovery. The drop at [`service.ts:669`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/incoming-transfer/service.ts:669) can therefore suppress legitimate notes and contributes nothing to isolation because rendering keys on `accountAddress`. [Aztec documentation](https://docs.aztec.network/aztec-nr-api/mainnet/noir_aztec/messages/processing/fn.enqueue_note_for_validation)
- Removing uncorrelated dApp `ExecuteOperation` tasks is otherwise sound: send progress normally has account/network-scoped journal records; no other activity card renders those tasks. Journal creation failure loses progress, but fails closed.

### Regression

- The promised event-during-snapshot reschedule is absent. Incoming refresh (`useIncomingTransfers.ts:64-74`) and `syncTransactions` (`app.store.ts:219-237`) can overwrite a newer Added/Updated/Delete event with an older snapshot.
- Journal/task snapshot guards compare address only, so A→B→A accepts the original A request ([`RecentActivityView.vue:578`](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/popup/components/modules/general/RecentActivityView.vue:578), `:668`). This causes stale resurrection/clobbering, though not foreign rendering.
- Unique awaiting IDs and account-scoped settlement cleanup are solid for same-network account switching.

### Deferral

- The nullifier claim is overstated. Siloed nullifiers are unique within one rollup’s global nullifier tree, not across independent `networkId` trees. Because this repository spans networks, cloned/forked chains can repeat the value. [Aztec nullifier-tree documentation](https://docs.aztec.network/developers/docs/aztec-nr/framework-description/state_variables)
- Re-keying can remain a follow-up for the same-network privacy fix because UI scope filters prevent disclosure, but the current rationale is false and leaves cross-network data loss/corruption risk.
- Wire-event validation is defensibly deferred: current final render gates contain forged foreign scope. It remains robustness/DoS hardening, not the blocker above.

### Tests

- The e2e commits A’s incoming record before switching, so it does not network-test the live broadcast race.
- Its observer checks incoming/awaiting but omits `tx-card` (`account-switch-isolation.test.ts:392`); History never renders awaiting cards (`:242-250`), making that assertion vacuous.
- It covers neither home Recent Activity, journal/task/detail routes, reconnect, network/profile switching, nor the account-creation switch path. DOM positive controls are generic counts, not correlated to the seeded records.
- Focused tests could not be rerun here because the read-only sandbox prevented Vitest creating its `/tmp` client directory; collection never started.

### What’s solid

- Synchronous account clears and transaction generation guards.
- Incoming live-event triple scoping and defensive feed filters.
- Exact-ID placeholder rejection cleanup and journal-based dApp progress.