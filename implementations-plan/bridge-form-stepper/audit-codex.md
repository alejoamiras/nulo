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