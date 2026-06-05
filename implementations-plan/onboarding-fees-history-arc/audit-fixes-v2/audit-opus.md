# Audit: audit-fixes-v2/plan.md — opus (fresh context)

## 1) Verdict

**Reject** — the plan is structurally close to right, but it ships at least one demonstrably-wrong load-bearing claim (C2's H2 hypothesis), under-specifies the reconcile invariant in a way that re-opens the codex High, leaves the journal hook's storage scoping silently wrong, and routes P9b's repro through a phase the source code says won't reproduce. Several other High/Medium issues compound. Multiple findings need new evidence or a re-derivation before any code lands.

## 2) Findings

### Critical

**C-1 — P9b's H2 hypothesis is false; the leading C2 fix is built on a wrong premise.**

`plan.md` lines 412-417 ("**H2 likely** (opus's guess): `onConnected` doesn't fire on FIRST connect, only on reconnect") is contradicted by source. `packages/extension-messaging/src/background/client.ts:60` calls `this.onConnected.invoke()` synchronously inside the first `connect()`'s success path, *before* `return`. There is no "first-vs-reconnect" branch — first connect and `onDisconnect→connect` reconnect both flow through the same line 60 path.

What this means: `PopupManager.vue:105`'s `incomingTransferService.onConnected.add(...)` listener WILL fire on the first connect — **if** the listener was registered before `connect()` ran. Note PopupManager registers it at module-load (line 105) and the explicit `await incomingTransferService.connect()` happens at line 143 inside `onMounted`. So the listener is in place. H2 cannot be the root cause as written.

Real candidate hypotheses that the plan should be looking at instead:
- **H6 (added by audit)**: PopupManager is mounted/unmounted with the popup window itself. `onBeforeUnmount` (`PopupManager.vue:180`) calls `incomingTransferService.disconnect()`. On popup-close → popup-reopen the `pendingTrustQueue` (a module-local `const`, line 58) is RE-INSTANTIATED to `[]` on remount. So unresolved-Allow/Reject prompts that were queued in the prior popup instance are gone. The replay path needs to fire on remount — and it does (via `onConnected` → `replayPendingPrompts`) — BUT only if the active appStore triple is ready at that moment (line 106 guard returns early).
- **H7**: After popup re-open the `appStore.profile`/`network`/`account` triple is populated only after `loadProfile()` finishes (an async cascade triggered from `app.vue:181` `onBeforeMount`). The PopupManager's `onConnected` listener fires within `onMounted` which runs *before* `loadProfile()` resolves — so the guard at PopupManager.vue:106 silently rejects the replay. There is no rearming. This is the actual probable root cause.

Fix direction: rewrite P9b. Acknowledge H2/H3 dies on source inspection. P9a stands; P9b's commit must be drafted only after the failing repro yields a deterministic signal (console log of which guard returned early). Treat P9a as the actual deliverable for this PR; gate P9b on a separate decision.

**C-2 — The reconcile invariant scopes wrong.**

The "Load-bearing invariant — the reconcile rule" (plan.md:26-46) says: "trust = pending IFF ∃ record r where ... r.hidden = true". Records persist `hidden` for `pending` AND `blocked` and any flipped-from-pending records (setTrustAllow flips them visible). So a `blocked` contract's records have `hidden = true` too. If the user blocked first, then reconcileTrust runs, the algorithm at line 236 short-circuits on `current.state !== "pending"` — fine. But invariant R's IFF as written would imply `blocked` (which carries hidden records) also satisfies the pending predicate. The IFF should read "...AND `getTrustState() === pending`" or the invariant should explicitly state "given trust in `pending` state, pending iff records-grounding-exist." As written the rule is inconsistent.

Additionally, the multi-account case: records may belong to N different accounts under the same (profile, network, contract) triple. The early-return at plan.md:249 ("grounding record exists; trust stays pending") doesn't disambiguate whether the grounding record is for account A or B. If account B still has a legitimately pending record, the reconcile correctly leaves trust=pending — but account A's stale records were already deleted in the journal hook. The popup-side handler in P7 conflates "any record under this contract has a residual" with "no stragglers anywhere".

Fix direction: rewrite the invariant precisely. Either (a) define the predicate `groundingRecordsExist(profileId, networkId, contract, accountAddress)` per-account and require ALL grounding records cleared before transitioning to unknown, or (b) accept that the transition fires unconditionally on any grounding-record clear and update the popup-side semantics accordingly. Pick one, write it down, regenerate the test list.

**C-3 — The journal-hook delete loop has wrong scoping.**

P7 (plan.md:284-287) says the journal handler "find[s] any records with that `(profileId, networkId, txHash)` triple; delete each + reconcile". `IncomingTransferRepository.listByTxHash(profile.id, network.id, tx.hash)` is the existing API (called at `service.ts:374`). But journal records carry `(profileId, networkId, accountAddress)` triples. A record matching the journal's txHash but belonging to a DIFFERENT accountAddress would still be deleted under the plan's pseudo-code — even though the journal op was fired by account A and the matching incoming record belongs to account B.

The journal hook should iterate records and filter by `record.accountAddress === op.accountAddress` BEFORE deleting. The plan omits this filter. The `service.ts:366-379` existing `onTransactionAdded` handler has the same bug pre-existing — fixing it under P7's journal hook without fixing the parallel `onTransactionAdded` path leaves a hole.

Fix direction: add an explicit `accountAddress` filter to the journal hook's delete loop AND ensure `onTransactionAdded` does the same. Add a test scenario: same profile, two accounts A & B, same contract, A sends a self-note that lands at B's PXE — verify A's outgoing journal entry deletes only A-scoped records.

### High

**H-1 — The "single PR with 14 phases" rollback story is broken.**

The phases form a DAG, not a sequence. The plan flattens them. Critical risk: if codex post-impl audit rejects (again) some phase, reverting that one phase will fan out to dependent phases. Either (a) explicitly mark which phases are revertable-as-a-unit (e.g. P5+P9 together) or (b) split into 3-4 PRs along the dependency boundaries.

Fix direction: in P14, add a per-phase rollback note. AND/OR split into 3 PRs along DAG edges.

**H-2 — P12's "write `appStore.profile` last" cascade is incomplete.**

`useProfileBootstrap.bootstrapActiveProfile` is one writer. But `auth.vue:101` is another (the plan addresses that one). The plan misses:
- `popup/app.vue:163`: `appStore.profile = lastActive ?? appStore.profiles[0]` — direct write in `loadProfile`.
- `popup/components/popups/SelectProfilePopup.vue:31`: `appStore.profile = profile` — direct write when switching via picker.
- `popup/components/popups/EditProfilePopup.vue:74`: `appStore.profile = await profileService.changeProfileName(...)` — rewrite after rename.

The `appStore.network` watcher at `app.vue:97-128` reads `appStore.profile.id` inline (`app.vue:120,122,123`). When the bootstrap's reverse-write-order writes `appStore.network` THEN `appStore.profile`, that watcher fires on the network write and reads `appStore.profile.id` — but `appStore.profile` is still the OLD profile at that point. The "reverse write order" makes the cascade WORSE for this watcher, not better.

Fix direction: reject the "reverse write order is surgical" framing. Audit all consumers; pick option 3 (atomic state object) or fall back to option 1 (isProfileSwitching gate).

**H-3 — C1 dApp auto-trust gate has an indirect path the plan dismisses.**

dApp `register_token` → `executeRegisterToken` → `tokenService.addToken(...{origin: "dapp"})`. Verified at `execution/service.ts:1090-1091`. But the security guarantee is a code-survey result, not structural. Future features could wire `addToken` from a popup-initiated UI flow that accepts dApp-influenced input.

Fix direction: add a TypeScript-level discriminator (`OperationContext` literal-narrow at the `addToken` signature) OR gate auto-trust on a stronger signal — e.g. a popup-only handler subscribed from `NewTokenPopup.vue` (popup → service round-trip), not a service-side event keyed by an origin string. Alternatively accept the soft contract and add a regression test that exercises every `addToken` call site.

**H-4 — `hydrateSchedulers` init-time reconcile sweep can fire BEFORE the data it needs.**

The init-time sweep iterates trust records in pending state + reconciles each. But `hydrateSchedulers` runs in `init()` at line 153, and `TransactionService` may not have populated its `txs` storage yet. The `dependencies` array guarantees TransactionService.init runs first, but "ran first" doesn't mean "everything inside finished." As long as TransactionService's init does `await this.txs.getValues()` before returning, the init-time sweep IS safe. Verify, don't assume. Add explicit ordering test (or doc).

**H-5 — P3 v-show change loses a subtle visual-behavior pin.**

With `v-show`, the child copy button + focus-ring rule are real DOM in the collapsed state. The collapsed copy_button could trap focus across opens. Also: aria-controls referencing a `display: none` node is still an a11y SC 4.1.2 violation per APG.

Fix direction: tighten P3. Use `v-show` + `inert` on the collapsed row, OR conditionally emit `aria-controls` only when `expanded === true`.

**H-6 — P5's "before-mount config replay" claim is over-claimed.**

The plan doesn't pin "exactly one onConfigUpdate registered after mount" across multiple mount/unmount cycles. Each remount adds another listener. Memory leak risk.

Fix direction: explicit listener-deregistration in `onBeforeUnmount` (`configService.onUpdate.remove(onConfigUpdate)`). Add a test that mounts → unmounts → mounts and asserts only one `replayPendingPrompts` call.

### Medium

**M-1 — P11 sanitize boundary documented but not test-pinned.**

No test pins that the new categorical chip + context are derived only from wallet-controlled fields. A future refactor could re-introduce a dApp-controlled path. Add a test: `categoricalLabel` called with `op.subtitle = 'http://evil.example'` returns strings that never contain `'evil.example'`.

**M-2 — Categorical copy needs user sign-off.**

The new copy changes user-facing assumptions (e.g. `sw_restart_post_prove` → "check the explorer"). Did the user sign off on each? Downgrade P10's table to "proposed copy, user-approve before squash."

**M-3 — P9a's deterministic seed is unspecified.**

Real network seeded note (flaky) vs fake repo-state injection (fast but doesn't exercise scanContract). Spell out which.

**M-4 — P13 test pins are unit-level only.**

Add at least one e2e scenario for the journal-hook reconcile (a self-note race repro). Otherwise the codex High closure is on test-mock paper.

**M-5 — `popup_bound` may never reach the terminal state machine.**

`journal-state.ts:105-107` already routes `stage === "cancelled" || error?.kind === "user_rejected"` to "Cancelled" (gray). `popup_bound` might be unreachable in `terminalAt === non-null` records. Trace `popup_bound` end-to-end before writing the categorical table.

### Low

**L-1 — P11 budget**: 200-300 LoC PR risk. Be explicit.

**L-2 — A1 em-dash decision** still open ("Defaulting to substitution"). Resolve BEFORE drafting P1.

**L-3 — "Asks" vs "Open questions"** naming muddles which decisions are in flight.

### Nit

**N-1 — `useProfileBootstrap.bootstrapActiveProfile` writes `appStore.profile = profile`** — actual line is `useProfileBootstrap.ts:64`, not "63-77."

**N-2 — Watcher key granularity**: actual reactive read at `PopupManager.vue:106` is `appStore.profile?.id && appStore.network?.id && appStore.account?.address`. Watch the granular fields, not the parent objects.

**N-3 — /loop seed**: add "after the next codex post-impl, if Reject again, surface to user with diff-of-findings against this transcript."

## 3) What's solid (after trying to break each)

- **The dual-hook reconcile design** (journal `submitting.txHash` + `onTransactionAdded` late-delete) is correct in spirit. Verified at `execution/service.ts:520` that `markJournal({stage: "submitting", txHash})` runs BEFORE `transactionService.addTransaction`. So the journal hook fires earlier and closes the race. The wrong scoping (C-3) is fixable; the architecture isn't.

- **The reentrancy-guard shape (P4)** matches the existing `polling` pattern in the same file. Low risk.

- **The C1 dApp gate verification** is sound at the level of "today's call graph." The discriminator is real. The risk is structural (H-3) — drift risk over time — but the current state is correctly characterised.

- **The visibility-replay fix (P5)** is the right shape. The race at `PopupManager.vue:122-160` is real. Combined re-order + gate is defense-in-depth.

- **"Trusted/blocked never auto-demote"** is a correct first principle and is implemented faithfully by `current.state !== "pending"` short-circuit.

- **The B1 sanitize-preservation guard** is correctly identified as load-bearing. The risk is in the restructure (M-1) but the awareness is there.

- **P4 → P6 → P7 ordering** is the right ordering for the trust state machine work. P9a-before-P9b is the right test-first discipline. The DAG-flattening problem (H-1) is real but the topological order within the DAG is correct.

---

**Bottom line**: the plan needs P9b rewritten with a verified hypothesis (not H2/H3), the reconcile invariant restated rigorously, the journal-hook scoping fixed to per-account, the E1 cascade audit completed rather than punted, and the rollback story (per-phase or split-PR) made explicit. After those, this is approvable.
