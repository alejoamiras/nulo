# Codex audit transcript — bridge-form-stepper

## Round 1 — dual audit (new session, xhigh, both outlines)

Verdict: **conditional approve** — all conditions folded (S3 runtime-channel rewrite, S7 formStage gating, S8 cleanup matrix, mid-prompt background + receipt sourcing pins). Outline: dedicated stepper.

Outline pick: primary. The dedicated stepper matches the Phase-0 UX better than extending `BridgeJournalCard`; the card is a recovery/status surface with resume/discard semantics, not a foreground signing guide, and reusing it would still require the same flow-step plumbing while adding conditional action surgery (`plan.md:93-94`, `BridgeJournalCard.vue:171-210`).

Critical:
- `RUN IN BACKGROUND` does not currently free the form under the proposed contract. `BridgeForm` disables the whole UI off `busy` (`BridgeForm.vue:31-32,134-213`), and both flows keep `busy=true` until the full bridge finishes (`useDeposit.ts:150-168,261-268`; `useWithdraw.ts:163-244`). Fix: P1 must split “prompt/foreground ownership” from “flow still running”, and explicitly decide whether concurrent bridges are supported. If yes, singleton `busy/error` refs are not enough.
- The `activeFlowId` fail-open story is underspecified for post-record, pre-tx failures. Deposits create records before approve/deposit (`useDeposit.ts:174-197`), but only withdraw clean rejects are discarded today (`useWithdraw.ts:239-241`). The plan’s “no record lingers” claim is false for approve rejection (`plan.md:22,38,78`). Fix: add a cleanup matrix: before first irreversible tx, clean reject discards record and clears active ownership; after a tx hash exists, never auto-discard; if no foreground owner exists, suppression must drop.

High:
- The stepper introduces dual source of truth. Cards derive stage from persisted facts + runtime only (`packages/bridge-core/src/journal.ts:189-201`, `BridgeJournalCard.vue:28-93`); the plan adds `flowStep` in the UI layer (`plan.md:16-20`). Fix: one tested mapper/view-model should produce phase states for both stepper and background card handoff.
- Backgrounding mid-wallet-prompt is not proven safe UI-wise. Chain execution may continue, but the card cannot faithfully narrate `SEAL`/`APPROVE`/public authwit prompts from record facts alone. Fix: either disable background during prompt-bound flow steps, or persist a prompt-stage summary into shared runtime that cards can render.

Assumptions:
- The “existing flow fakes” inference is weak. There are no real `useDeposit`/`useWithdraw` tests; `BridgeForm.test.ts:37-42` mocks those composables wholesale. Plan for pure mapper tests plus dedicated composable tests.
- The tab-navigation hidden-nowhere case is weaker in this app because `BridgeView` is `v-show`, not unmounted (`App.vue:45-48`).
- Receipt over a hidden record is fine only if it reads from `records` by id, never `visibleRecords`.

Plan quality:
- Phase split is mostly fine, but the detached/background concurrency contract belongs in P1, not implicitly in P2.
- Copy needs sharper anti-blind-signing wording: `APPROVE` must say “allowance for the portal; no funds move”, and private `CLAIM` resume must mention the Ethereum unseal signature before the Aztec confirmation.

conditional approve (with conditions: split detached-run state from `busy`; add an explicit active-owner cleanup/fail-open matrix; centralize step mapping in one tested VM; pin mid-prompt background behavior and receipt sourcing)

## Round 2 — FINAL fresh-context pass (new session, dir codex-6NT1y4Nh)

Initial verdict: **reject** — 3 blockers, all folded same-round (S13 UI-owned CAS foreground, S14 isUserRejection classifier, S15 approveOutcome runtime bit). Verdict-flip appended below.

- Critical: `activeFlowId` cannot stay “flow-owned”. [`deposit()`](</Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:261>) awaits [`runDepositClaim()`](</Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:409>), but that engine intentionally detaches later receipt rounds via fire-and-forget re-entry at [useBridgeJournal.ts:500](</Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:500>). So a long active deposit can hit the flow `finally` before receipt. Under D1/S8/P1, that either drops foreground ownership too early or, worse, bridge A’s `finally` clears the single global owner after bridge B has become active. S1 needs a compare-and-swap foreground token or UI-owned session state, not blind flow-finally clears.

- High: the cleanup matrix still over-classifies “clean reject”. “No tx hash yet” is not the same as “user explicitly rejected”; wallet/RPC failures can throw before a hash too. The only live classifier today is a loose regex in withdraw at [useWithdraw.ts:239](</Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useWithdraw.ts:239>). If S8 is implemented that way, you will auto-discard ambiguous records. Narrow it to explicit provider rejection signals; otherwise keep the record.

- High: S3/S10 overclaim what one scalar `step` can prove. The mapper can latch engine phases off facts, but pre-tx deposit history is not fact-backed. Once runtime advances to `depositing`, `(record, runtime)` cannot distinguish “APPROVE skipped” from “APPROVE completed”, yet P1 requires a tested skipped/done matrix. The current fact model in [journal.ts:189](</Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:189>) has no place to recover that truth. You need one extra ephemeral runtime bit/history latch.

Assumptions: the VerificationModal assumption is fine; “backgrounding mid-prompt is safe” is still unproven until owner lifetime is decoupled from flow lifetime. I would revise S1 as written, narrow S8, and widen S3’s runtime shape. The 3-phase split is still workable if P1 absorbs those changes; otherwise P2 will be forced to invent state it cannot derive.

reject (with blocking findings: flow-owned `activeFlowId` is race-prone/too short-lived for detached deposit completion; clean-reject discard is unsafe without explicit rejection classification; the mapper cannot truthfully render approve skipped vs done from `record + step` alone)

### Round 2b — verdict flip (resume, same session)

All three blockers confirmed resolved; one condition (scrub stale flow-finally wording) applied immediately — S8 + Security rewritten to the S13 ownership rule. Final verdict: **conditional approve** (condition met in the same commit).

1. `activeFlowId`: D1/P1/S13 now fix the ownership bug: UI/session-owned CAS `claimForeground`/`releaseForeground`, no flow-owned lifetime, and explicit pins for stale release, takeover, and settled-promise-no-release. That resolves my race blocker. One stale contradiction remains elsewhere: Security/S8 still mention flow-`finally` clears.

2. Clean reject: D1/P1/S14 now discard only on explicit `isUserRejection` (`4001` / `UserRejectedRequestError`) and keep ambiguous pre-hash failures as records with failure UI. That resolves the over-broad discard blocker.

3. Approve skipped vs done: D2/P1/S15 add ephemeral `approveOutcome` with honest degradation when undefined after reload. That resolves the underivable mapper blocker.

conditional approve (with conditions: scrub the stale pre-S13 wording that still says foreground clears in flow `finally`, so the plan has one ownership rule throughout)