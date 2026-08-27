# Fable audit transcripts — crash-truth fixes (deep tier)

The "fable" role = the independent top-tier Claude planning/audit leg run via
subagents, per the blueprint protocol. Three engagements; paths rewritten
repo-relative.

## 1. Independent planning leg (summary)

Decided the five open asks: (1) transport fork → the FULL Ready-handshake
transport rework (MessageType.Ready ack after the F-09 trust check; client
stays Connecting until Ready; queue NEWLY-issued (never-sent) calls; sent
calls keep fail-fast; capped reconnect backoff; `chrome.runtime.lastError`
read in onDisconnect; plus the newly-found ProfileService boot race —
deleteProfile fail-fasts on an unset deletionDelegate, wired last-phase —
closed via a bounded `awaitInitialized` wait); (2) fence → offscreen-only
direct-throw WITH the marker + client generation-equality guard; (3)
scenario-A retry strict, control tolerant; (4) consoleErrors blind spot →
ledger; (5) transport tests → package unit layer (COMPOSITION-TESTS.md
scopes composition tests to the wallet service graph — wrong layer).
Consolidation adopted (2), (4), (5) and A-strict from (3); rejected the
transport rework for this arc (ledgered as the follow-up design) and
control-tolerant (superseded by codex's strict).

## 2. Contradiction check (resumed) — verdict: no-contradictions

- Re-attacked the transport-fork rejection of its own plan and CONCEDED:
  enumerated liveness failure modes (delegate ordering — verified wired
  before the liveness write; churn-wakes-SW — proven by scenario B's greens;
  baseline race — self-heals via the 10s heartbeat; onChanged delivery —
  fails closed to the ceiling; second crash — torn backstop). "No mode
  justifies pulling the Ready-handshake rework forward."
- Fence marker leak check: none — same-gen/deleting/live-mismatch all stay
  marker-less.
- Dropped-idea recovery: the `chrome.runtime.lastError` churn-silencing read
  had vanished — restored into ledger row 1's follow-up entry.
- Folds applied: heartbeat self-healing documented + ceiling sized under
  ROLLBACK_BUDGET_MS; onChanged probe step added (later superseded by the
  concurrent event+poll shape, ledger row 12).

## 3. Fresh-context hostile audit — verdict: conditional approve

Verified every load-bearing anchor against source (fence, provision matrix,
key erase, retry mechanics, sole liveness writer + heartbeat, provider
double-read, composable-local client, ROLLBACK_BUDGET_MS, gate scripts,
`@requires-proverless` refusal in `apps/extension/scripts/e2e/agent.sh`).
Adversarial pass could not break D4: marker grants nothing; a successful G2
provision opens an EMPTY store; provision/clear atomicity untouched;
mid-retry clear → deleting → marker-less reject; inverse-stale dies at the
guard or live-mismatch; rollback exactly-once holds; wrong-profile
impossible; never-respawn → ceiling → torn backstop.

Conditions (all folded into fix-plan.md):
1. **Crash-on-retry deletion edge** — `clearProfileState` refuses a G2 clear
   while the map holds `deleted(G1)` (different-gen guard), so a crash after
   the retry mints G2 but before provisioning leaves a delete-refusing state
   until offscreen restart; fails closed to the torn backstop. → pin 6b +
   follow-up ledger note; behavior pinned, not changed.
2. **Inner rollback legs out of scope** — the composable's duplicate-branch
   deleteProfile calls are not liveness-gated (mid-restore, live worker);
   scope boundary now stated in PR-3.
3. Stale 17-commit Fact → corrected (22 at plan freeze).

Low observations: liveness is wall-clock (`clock.now()`) — a step-back
stalls to the ceiling, fail-closed, documented in the util; poll-only
simplicity noted (resolved by ledger row 12's concurrent shape).
