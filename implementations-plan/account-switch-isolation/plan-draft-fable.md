# DRAFT (fable / Opus) — account-switch cross-account isolation

Independent plan draft #2 of 3 (fable role, Opus). Verbatim-faithful capture; consolidated into `plan.md`.

## Root-cause map (verified)

Feed = four flat active-view state sources mutated by broadcast events + async fetches keyed on
"whatever account is active NOW", not the account the data belongs to.

1. **Incoming transfers (privacy core).** Service emits `onIncomingTransferAdded` inside the locked commit
   of `scanContract` (`incoming-transfer/service.ts:684-686`); scan captured its `accountAddress` at poll
   start (`:555`,`:574`). `sendEvent` broadcasts to EVERY client, no scope filter
   (`packages/extension-messaging/src/background/service.ts:84-93`). Composable `onAdded`/`onUpdated`
   append with NO account check (`useIncomingTransfers.ts:61-69`). Composable NEVER reloads on switch
   (`refresh` wired only to `onConnected` + `incomingTransfersVisible` toggle, `:80-81`) → also retains A's
   history (stale, facet 1). View merges incoming rows with only a `props.token` filter
   (`RecentActivityView.vue:103-112`; `activity.vue` via `buildActivityRows`).
2. **Settled chain txs (facet 1).** `selectAccount` sets `account.value` + persists (`app.store.ts:71-76`);
   `app.vue:87-96` watcher calls async `syncTransactions()` which only replaces `transactions.value` after
   the fetch (`app.store.ts:153-157`). Between, A's txs show under B. No generation guard → rapid A→B→A
   lets A's late fetch clobber B.
3. **Journal + task (facet 3).** Journal rows DO have render scoping (`journalRecordInScope` :258-267) but
   no per-switch re-snapshot (mount + events only, :665-667,:553-565). `executingTask` NOT account-scoped
   for dApp tasks (`isExecutingTask` :568-580; only UI transfers check senderAddress :582-586).
   `clearExecutingTaskIfPendingCancelTerminal` matches jobId-only, NO account (:480-486). NB
   `clearExecutingTaskIfThisIsTerminalMatch` (:455-461) is ALREADY safe (re-checks isMatchingTask +
   op.accountAddress) → scope only the jobId-only path, don't blanket-rewrite.
4. **Data-model gap (root).** `awaitingTransactions`/`transactions`/`journalOps`/`executingTask`/
   `pendingCancelJobIds` are flat active-view state, not keyed by account. Component mounted with NO account
   `:key` (`general.vue:27`, `tokens/[id].vue:210`) → no remount on switch → all state persists.

## Chosen approach: STAGED-STRUCTURAL, guards-first

The de-risking realization: **the targeted guards ARE the first two phases of the structural migration**,
not an alternative. Phases 1–2 (additive guards, no rewrite) close every facet and are privacy-complete.
Phases 3–4 consolidate the guarded flat state into per-account slices → leak impossible by construction.
Explicit off-ramp: if the structural phases fail review against the invariant-dense 878-line component,
Phases 1–2 alone are a complete, correct fix.

- Pure targeted-guards as END state = correct but fragile-by-construction (every future handler must
  remember to scope; the component's audit-scar history proves it accretes regressions).
- Big-bang structural = high blast radius, gates the PRIVACY fix behind HARDENING → unacceptable ordering.

Risk: Phase 0 Low (test-only), Phase 1 Low, Phase 2 Medium, Phase 3 Medium, Phase 4 Medium-High
(optional, gated on Phase 3 review, clean revert boundary). **Overall: Medium, capped.**

## Phases + validation gates

Real commands: `bun run lint`, `bun run typecheck`/`typecheck:all`, `bun run test`, component tier
`bun run --cwd apps/extension test:components`, smoke `bun run test:e2e`, network `bun run e2e:agent`
(serial `fileParallelism:false`, worktree-isolated sandbox).

**Phase 0 — Test scaffold.** (a) e2e `switchToAccount(page,{name|address})` + `createSecondAccount`
(rows already expose `data-account-address`/`data-account-name`, `AccountsPopup.vue:72-74`; assert
`nulo:ui:activeAccount` flips, pattern of `accounts.test.ts:68-76`). (b) **e2e-only incoming-poll gate**
modeled EXACTLY on the proof gate (`src/e2e/chrome-storage-proof-gate.ts`, `tests/e2e/fixtures/proof-gate.ts`):
a `chrome.storage.session` key awaited inside `scanContract` after `getNotesRaw` and before the locked emit
(`service.ts:586`→`:610`), constructed strictly inside `if (E2E_PROVERLESS)` (`src/e2e/config.ts:29-40`) so
DCE drops it from prod, covered by the existing negative bundle-grep in `_build-extension.yml`; fixture
`holdIncomingPoll`/`releaseIncomingPoll`. (c) reactive appStore harness (current
`RecentActivityView.test.ts:101-109` mocks a STATIC store; add a `reactive()` factory whose account/txs
reassign mid-test). Gate: lint + typecheck:all clean; `bun run test` green; one network smoke
(`incoming-transfers.test.ts`) still green with gate inert; gate provably absent from non-proverless bundle.

**Phase 1 — Incoming leak at ingest + render (privacy-critical).** Composable `onAdded`/`onUpdated`
(:61-69) DROP any record whose `(profileId,networkId,accountAddress)` ≠ current `scope()`. Key on
`record.accountAddress` (wallet-derived), NEVER `record.owner` (attacker-set). Scope-change reset:
`incomingTransfers.value=[]` sync then `refresh()`, with a captured-generation check so A→B→A can't clobber.
Render-guard (defense-in-depth) in `RecentActivityView.vue:103-112` + `utils/activity-rows.ts`. Gate: lint +
typecheck:all; unit `useIncomingTransfers.test.ts` (drop non-active onAdded; scope-change clears+refreshes;
rapid re-switch no clobber) + `activity-rows.test.ts`; component (no incoming row for non-active); network
`account-switch-isolation.test.ts` (gated leak test) RED before / GREEN after. Layers: unit, component, network.

**Phase 2 — Async ordering for settled txs + journal/task reset (privacy-completing).** `app.store.ts`
`accountGeneration` ref bumped at the single choke point (the `app.vue:87-96` watcher every path funnels
through) + expose `resetActiveFeedState()`; `syncTransactions` captures generation before await, only
assigns if unchanged, and clears `transactions.value=[]` on switch. `RecentActivityView.vue` on account
change resets `journalOps/executingTask/executingSubtasks/pendingCancelJobIds` + re-snapshots journal
(reuse `resnapshotJournal`). Account-scope the jobId-only `clearExecutingTaskIfPendingCancelTerminal`
(:480-486); account-scope dApp `executingTask` by correlating to the journal op's `accountAddress`. Gate:
lint + typecheck:all; unit (generation guard; switch-reset; cancel-clear account-scoped); component; smoke
`test:e2e`; network (start a send on A under held proof gate, switch to B, assert no A awaiting/settled/task
under B; release; A's card lands only on A). **Milestone: after Phase 2 the privacy promise is fully met.**

**Phase 3 — Structural: per-account incoming slice.** `Map<accountAddress, IncomingTransferRecord[]>`;
active feed reads active slice; events route to `record.accountAddress`'s slice → wrong-account event is
structurally inert, switch = O(1) slice swap, no refetch race. Gate: full fast layers + network; add
rapid-switch fuzz (A↔B ×N under held poll). **Proof-of-structure: Phase-1 leak test stays green with the
ingest filter REMOVED** (slice alone must isolate).

**Phase 4 — Structural: per-account journal/task slice (optional, gated on Phase 3 review).** Same keyed
treatment for journal/task, and move `awaitingTransactions`/`transactions` to per-account slices in
`app.store.ts`. Gate: FULL network suite (catch regressions in `concurrent-sendtx*`, `cancel-mid-prove`,
`transfers`, `multi-account-from`); isolation test green with all Phase-1/2 GUARDS DELETED. **Off-ramp:
stop after Phase 3 if blast radius too high; 1–2 already guarantee correctness.**

## Security & Adversarial

Asset = account unlinkability WITHIN a profile (B's view must not reveal A's activity, especially RECEIVED
funds whose sender is a third party). Threat actors: (1) **the note sender** — in Aztec anyone can author a
note to any account; controls amount/owner/txHash/contract AND decrypt TIMING → can try to land an emission
in the switch window; provenance untrusted end-to-end. (2) **malicious dApp** — can time `send_transaction`
to occupy `executingTask` across a switch; `register_token` spam gated by the trust FSM. (3)
**shoulder-surfer/screen-share** — the concrete exploit: reads A's incoming amount/token/hash under B.

**Trust boundary = `scanContract` ingest.** TRUSTWORTHY: `record.accountAddress` (the PXE account the wallet
chose to scan, stamped from the param `service.ts:778`) — ALL scoping keys on it. UNTRUSTED: `note.content.owner`
(sender-set, `service.ts:780`), `amountRaw`, `txHash`, `contract` — scoping MUST NOT use `owner` (a note author
could set owner=B to force cross-account render). Keep existing input validation (contract watched AND trusted,
FSM read fresh in lock `:647`; `parseNoteAmount` null-guards). New attack surface = the e2e poll gate: mitigated
by the exact proof-gate envelope (double-opt-in `E2E_PROVERLESS`, DCE, positive/negative bundle greps).

## Assumptions

**Facts:** broadcast emit no filter (`background/service.ts:84-93`); composable ingest unfiltered
(`useIncomingTransfers.ts:61-69`); no reload on switch (:80-81); view merges incoming with only token filter
(:103-112); scan captures accountAddress at start, emits in lock (`service.ts:555,574,684-686`);
`record.accountAddress` wallet-derived, `owner` note-derived (:778-780); `selectAccount` persist-only
(`app.store.ts:71-76`), `syncTransactions` no generation guard (:153-157), switch watcher async (`app.vue:87-96`);
journal render-scoped (:258-267) but no per-switch re-snapshot; `clearExecutingTaskIfPendingCancelTerminal`
jobId-only (:480-486); dApp `executingTask` not account-scoped (:568-580); no account `:key` on the component
(`general.vue:27`); proof-gate pattern exists (`chrome-storage-proof-gate.ts`); network suite serial+isolated;
30s default poll (`service.ts:30`); rows expose `data-account-address` (`AccountsPopup.vue:72-74`).

**Inferences:** [high] leak is reproducible for ANY trusted-token incoming for A while B active + persistent
(no reload). [high] captured-generation is NECESSARY for settled-tx path (overlapping async on rapid switch).
[med] dApp task correlatable to owning account via journal op's accountAddress — needs confirm every dApp task
has a matching journal op at switch time (pre-W5 stragglers may not, :426-431). [med] structural slice testable
by deleting the Phase-1 filter and re-running the leak test.

**Asks:** [A1] popup + side panel both open → two Pinia stores sharing one global `nulo:ui:activeAccount`;
confirm no divergence path (whole fix rests on single-global-account). [A2] is the e2e poll gate acceptable
given it touches the real `scanContract` hot path (behind DCE)? fallback = short-poll timing test, rated
flaky/not-worth-having. [A3] Phase 4: move `awaitingTransactions`/`transactions` to per-account slices in THIS
PR or a follow-up? [A4] on switch, show B's records immediately from cache (Phase 3 slice) or accept brief
empty-then-refresh (Phase 1)? UX call. [A5] confirm the gate (not a shortened interval) is the intended e2e
mechanism.

## Network-e2e design (deterministic)

`tests/e2e/network/account-switch-isolation.test.ts`, `skipIf(!hasConfig)`. Deterministic BECAUSE of the
e2e-only poll gate (same mechanism as the existing mid-prove cancel test). **Facet-2 core proof:** fresh
profile; create A+B; trust a token; deliver a note to A, wait mined; `holdIncomingPoll` (park A's scan after
getNotesRaw, before emit); switch to B (wait `activeAccount===B`); `releaseIncomingPoll` (A's emit fires while
B active — the exact race); assert B's feed shows ZERO rows carrying A's txHash; switch back to A → A's row
appears (no false-negative). **Facet-1/3:** start a UI transfer on A, `holdProofGate`, switch to B, assert no
A awaiting/settled/task under B; release; switch back → resolves on A only. **Primary regression pin (zero
timing):** `useIncomingTransfers.test.ts` component-tier (scope=B, onAdded(recordForA) dropped; scope-change
clears+refreshes; A→B→A no clobber). Residual flake (PXE decode, SW restart) is OUTSIDE the race window →
mitigated by pre-seeding + waiting mined before arming + asserting stable hash-absence with bounded wait.

## Adversarial answers

- Never scope on a note-content field; `record.owner` sender-settable → only `accountAddress` is safe. Don't
  trust ordering ACROSS onConnected-refresh vs onAdded-event (scoped refresh authoritative; late wrong-account
  events dropped). PXE timing assumed adversary-influenceable; gate/generation don't depend on it.
- Generation token NOT sufficient alone — must pair with scope-filtering at EVERY event ingress (it orders
  fetches, doesn't gate broadcast events). Ingress enumerated: incoming onAdded/Updated (Phase 1); onConnected
  refresh (already scoped); journal events (render-scoped + Phase-2 reset); task events (Phase-2 scope); async
  syncTransactions (Phase-2 generation). Service NEVER mutates the store directly (only emits) → no
  store-mutation bypass; sole ingress is event handlers, all covered. Slices (3–4) make it correct-by-construction.
- Mid-migration leak: Phase 1 closes RECEIVED-funds leak but A's OUTGOING settled txs still flash in B until
  Phase 2 → **Phases 1+2 are ONE privacy-complete unit; do not ship Phase 1 as "done."** Phases 3–4 leak
  nothing new vs 1–2 (guards→structure); their risk is REGRESSION, gated by delete-guards-rerun-green.
