# DRAFT (main agent) — account-switch cross-account isolation

Independent plan draft #1 of 3 (main). Consolidated later with codex + Opus drafts into `plan.md`.
Grounded in `research/surface-map.md`.

## Recommended approach: "complete-the-scoping + switch-reset + captured-account guards" (staged)

**Reject the full per-account `Map<accountAddress, state>` refactor as the primary approach.** The
surface map shows most display paths are ALREADY account-scoped (`journalRecordInScope`,
`awaitingAccountTxs`). Only TWO display filters are missing (incoming transfers, orphan executing-task
card) plus a switch-reset and a handful of captured-account async guards. A per-account `Map` would
change the entire feed's state model to close races that a generation-guard closes far more cheaply —
AND it introduces its own hazards (slice lifecycle, unbounded per-account memory, service↔slice sync).

**Adopt instead:** (1) complete display scoping behind ONE shared `recordInScope(record, activeAccount)`
primitive; (2) add a switch-reset `watch` that clears + reloads view state; (3) add a captured-account
guard to every async resolution so a late result for the old account is dropped; (4) an invariant test
that structurally forbids a non-active record from rendering. This delivers structural SAFETY (one
filter, one invariant) at targeted-fix RISK — the direct answer to "structural is right but changing
everything scares me." Each phase is independently shippable and closes a named subset of R1–R8; the
core privacy leak closes FIRST (Phase 1).

## Phases

### Phase 1 — Incoming-transfer account gating (core privacy leak: R3, R4)
- Thread the active `accountAddress` into `useIncomingTransfers`; `onAdded`/`onUpdated` append ONLY when
  `record.accountAddress === activeAccount` (trusted recipient field — see Security). Gate the render
  loops (`RecentActivityView.vue:103-112`, `activity-rows.ts:62-73`) by account.
- React to account change: `refresh()` + clear on the composable's `scope().account` changing.
- **Tests:** component/unit — an `onAdded` for a non-active account is dropped; render excludes non-active
  incoming; the initial `getIncomingTransfers` load stays account-correct.
- **Validation gate:** `bun run test:components src/composables/useIncomingTransfers.test.ts` + a
  `RecentActivityView` incoming case · `bun run lint` · `bun run typecheck`. Exit 0. Layers: unit+component.
  *This phase alone closes the headline leak.*

### Phase 2 — Switch-reset watch + captured-account async guards (R1, R2, R3, R5)
- Add `watch(() => appStore.account?.address, (nv, ov) => { if (nv===ov) return; resetFeedState(); reload(nv) })`
  in `RecentActivityView.vue` and `activity.vue` (shared helper — the two "share verbatim").
- `resetFeedState()` clears `journalOps`/`executingTask`/`executingSubtasks`/`incomingTransfers`/
  `pendingCancelJobIds`.
- Every async resolution captures the account at call time and drops on change:
  `const acct = appStore.account?.address; const r = await …; if (acct !== appStore.account?.address) return`.
  Apply to `getOperations` (:665, :555), `getTasks` (:659), `getIncomingTransfers`/`refresh`.
- **Tests:** component — A→B switch clears state; a late `getOperations` resolving for A after switch to B
  is dropped (fake service with a deferred resolve).
- **Validation gate:** component tests + `bun run lint` + `bun run typecheck`. Exit 0. Layers: unit+component.

### Phase 3 — executingTask + task/cancellation account scoping (R5, R6, R8)
- `hasOrphanExecutingTask` (:427) additionally requires `executingTask.accountAddress === active`.
- `isExecutingTask` (:568) account-scopes the dapp `ExecuteOperation` branch (:571-580), not just UI transfers.
- Terminal-clear helpers scope by the TASK's account, not the currently-active account (defensive post-reset).
- **Tests:** `recent-activity-handlers.test.ts` cross-account task cases + a component orphan-card case.
- **Validation gate:** `bun run test src/popup/components/modules/general` + lint + typecheck. Exit 0.

### Phase 4 — Store guard: `syncTransactions` captured-account (R7)
- Mirror `syncNetworkStatus`'s `oldNetworkId` guard: capture `account.value?.address` before the await,
  drop the assignment if it changed on resolve.
- **Tests:** `app.store.test.ts` — out-of-order A/B resolution keeps B.
- **Validation gate:** `bun run test src/stores/app.store.test.ts` + lint + typecheck. Exit 0.

### Phase 5 — Defense-in-depth: one scope primitive + invariant (structural safety, no Map)
- Extract/generalize a single `recordInScope(record, {profileId, networkId, account})` used by EVERY render
  path (reuse `journalRecordInScope`; apply to incoming + task). One primitive = one place to get right.
- **Invariant test (the regression guard):** metamorphic/property — for an arbitrary mix of records across
  ≥2 accounts, the rendered feed contains ONLY active-account records; switching flips the set completely.
- **Validation gate:** the invariant test + `bun run test` (full unit+component) + lint + typecheck. Exit 0.

### Phase 6 — Network e2e: deterministic cross-account leak proof
- `tests/e2e/network/account-switch-isolation.test.ts`: `createAccount` ×2 (A, B); generate activity on A
  (send from A so A has journal + a terminal/executing record; if feasible, receive an incoming on A);
  `switchAccount` to B; assert B's feed shows ZERO A rows (no incoming card, no journal row, no
  awaiting/executing card). Switch back → A's rows return. Also switch DURING an in-flight incoming poll
  for A and assert no leak.
- **Determinism (honest):** the leak is STEADY-STATE, not solely a narrow race — A's scheduler keeps
  polling after switch and the service broadcasts to all clients — so the test does not depend on hitting
  a thin window; "A-activity present + switch + assert B clean" reproduces it reliably → NON-flaky.
- **Validation gate:** `bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts` green
  (owns anvil+aztec+playground per worktree, parallel-safe). Layers: e2e-live-network.

### Phase 7 — Full regression gate
- **Validation gate:** `bun run audit:vue` (typecheck→unit+component→lint→build) exit 0 · `bun run test:e2e`
  (smoke) green · the new network e2e green.

## Security & Adversarial Considerations

- **Threat model:** cross-account confidentiality breach WITHIN one user's wallet. Users separate accounts
  for privacy; showing account A's incoming transfers / history / in-flight ops while the header says B
  leaks A's financial activity to a shoulder-surfer, a screenshot, or the user's own mental model. Not a
  cross-USER leak, but a real privacy-invariant break.
- **Attacker-controlled input at the trust boundary:** anyone can author an Aztec note to any account
  (sending is permissionless). Incoming-transfer records therefore carry ATTACKER-CONTROLLED content
  (amount, sender). **The account gate MUST scope by the RECIPIENT account** — the account whose PXE
  decrypted the note (a trusted, wallet-derived field) — **never by any sender-supplied field.** Verify
  `record.accountAddress` is the recipient (Assumptions/Ask A1).
- **Order-independence:** Port broadcasts can arrive out of order and the scheduler polls all accounts;
  the fix must not rely on event ordering. The account-gate + captured-account guard are order-independent
  by construction.
- **No new trust in the service:** the service correctly stays account-agnostic (it must poll all accounts
  for notifications/awaiting); isolation is enforced UI-side. We add NO new privilege and remove none.
- **Least privilege / supply chain / crypto:** no new deps, no new permissions, no crypto. Out of scope.

## Assumptions

**Facts (file:line-verified via surface-map.md):**
- No `watch` on `appStore.account` in the feed; only `app.vue:87-96` reacts, reloading `transactions` only.
- `useIncomingTransfers.ts` `onAdded` :61-65 appends unconditionally; render loops unscoped by account
  (`RecentActivityView.vue:103-112`, `activity-rows.ts:62-73`).
- Service broadcasts `onIncomingTransferAdded` to ALL clients (`background/service.ts:84-93`); `serviceEpoch`
  guard (`service.ts:612-614`) is never bumped on UI switch.
- `syncTransactions` (`app.store.ts:153-157`) has no captured-account guard; `syncNetworkStatus` :110-119 does.
- e2e `switchAccount`/`switchAccountByAddress`/`createAccount` helpers exist (`helpers.ts:318-343,295-315`).

**Inferences (attack these):**
- [I1] `record.accountAddress` on an incoming record IS the recipient account (trusted), not a sender field.
  *If false, gating by it is exploitable* — must verify in the service before Phase 1.
- [I2] The leak is steady-state (not solely a race), so the network e2e is deterministic/non-flaky.
- [I3] Clearing + reloading feed state on switch is cheap enough for no visible fl… (perf) — the reload is
  a few RPCs already done on mount.

**Asks (surface, do not silently assume):**
- [A1] Confirm I1 (recipient-account field is trusted) — I will verify in code; flagging as a gate on Phase 1.
- [A2] Depth: is the scope-primitive+guard approach acceptable (my rec), or is the full per-account `Map`
  wanted? (User leaned staged/de-risk → this plan; confirm at the gate.)
- [A3] On switch, keep polling all accounts' schedulers (for notifications) and filter UI-side — confirm we
  do NOT tear down the old account's scheduler.

## Trade-off: staged-scoping (this plan) vs full per-account Map

| | Staged scoping + guards (rec) | Per-account `Map` |
|---|---|---|
| Blast radius | Low — completes existing pattern | High — rewrites feed state model |
| Closes R1–R8 | Yes (guards + gates + reset) | Yes (slices) |
| New hazards | minimal | slice lifecycle, per-account memory, service sync |
| Structural safety | one primitive + invariant test | inherent, but larger |
| Risk rating | **LOW–MED** | **MED–HIGH** |
| Fits "don't change everything" | Yes | No |

**Recommendation: staged scoping. Risk: LOW–MED.** Revisit the Map only if the invariant test can't be
made to hold without per-account isolation (it can — the guard drops late writes; the gate drops foreign records).

## Seeds — deferred to post-approval (see plan.md).
