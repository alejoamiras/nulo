# Bridge form-stepper round (`feat/bridge-ux-trust`, third UX amendment)

Blueprint tier: `mid`. Branch: continues `feat/bridge-ux-trust` (unmerged — same PR). Substrate: the journal engine + narration (`useBridgeJournal` runtime `step`/`stepDetail`), the flows (`useDepositFlow`/`useWithdrawFlow`), `BridgeForm`/`BridgeJournal`/`BridgeJournalCard`, and the wallet panels.

Driving feedback (user, testnet session) + Phase-0 decisions:
1. The actively-driven transaction must NOT appear as a Pending card — cards are for lost-track/reloaded records. The FORM guides the user through what's happening and what they're signing.
2. The form becomes a 3-step guided flow: form → live phase stepper → receipt with both explorer links. **Decided: the stepper TAKES OVER the form until the receipt; a "RUN IN BACKGROUND" action hands the bridge to a Pending card and frees the form. The receipt STAYS until "NEW BRIDGE".**
3. Ethereum + Aztec wallet connections share ONE row as compact chips with ✕-to-disconnect.
4. "IN-FLIGHT BRIDGES" renamed (user floated "Pending Transactions"; copy finalized below).

## Design decisions

### D1 — Active-flow ownership: `activeFlowId` + journal suppression
A module-level `activeFlowId = ref<string | null>(null)` owned by the flow layer: set the moment a flow creates its journal record, cleared by (a) "NEW BRIDGE" on the receipt, (b) "RUN IN BACKGROUND", (c) a flow-level abort before any tx. It is **in-memory only** — a reload clears it, so the record naturally surfaces as a Pending card (exactly the user's model: cards = lost track). `BridgeJournal` renders `visibleRecords` minus the `activeFlowId` record. Backgrounding does NOT pause the flow — the engine keeps driving; only the narration surface moves from stepper to card (the runtime `step` feeds both, no duplication).

### D2 — The stepper: flow-level legs + engine narration in one phase list
The flows today expose only `busy`/`error` — the L1 legs (seal, approve, deposit/exit) narrate only to the console. P1 adds a flow-level `flowStep` ref beside the engine's runtime steps; the stepper maps BOTH onto a direction-aware phase list (each phase: pending ▢ / active ● (pulsing) / done ✓ / skipped ⊘ / failed ✕):

- Deposit: `SEAL` (private only — "sign in your Ethereum wallet; first time signs twice") → `APPROVE` ("confirm the allowance" — rendered ⊘ SKIPPED when the allowance suffices) → `DEPOSIT` ("confirm the deposit; then waiting for Ethereum") → `SYNC` (engine `syncing`, poll detail) → `CLAIM` (engine `sending` — "confirm in your Aztec wallet"; private resumes show `unsealing` first) → `CONFIRM` (engine `confirming` + `verifying`, check counts).
- Withdraw: `EXIT` ("confirm in your Aztec wallet" — public shows "2 signatures: authorization + exit") → `PROVE` (the proven-block countdown from runtime) → `FINISH` (engine `confirming` pre-consume — "confirm in your Ethereum wallet") → `CONFIRM` (receipt wait).
- Step 3 (receipt): ✓ headline, amount + direction, BOTH explorer links (L1 + L2 legs from the record's hashes), "NEW BRIDGE" resets to step 1. The record is read by id (it stays in storage; the card auto-hide grace is irrelevant here since the journal never showed it).
- Errors/attention while active: the stepper marks the failed phase ✕, shows the engine note (funds-safety line included) + RETRY (re-invokes the engine action) + "RUN IN BACKGROUND". A wallet rejection before any tx resets to the form with the error inline (no record lingers — the flows already discard clean pre-tx rejections for withdraws; deposits abort before record creation only at the seal).

### D3 — One wallet row: chips with ✕
`BridgeView`'s `.wallets` becomes a flex ROW hosting both existing components restyled as compact chips (the components keep ALL their logic — connect, chain-switch, the Aztec verification modal):
- Connected: `[ETHEREUM · 0xef4d…f2d ✕]` / `[AZTEC · 0x1018…c0d ✕]` — the ✕ is the disconnect (testids `l1Disconnect`/`bridgeL2Disconnect` move onto it; `aria-label="Disconnect"`).
- Disconnected: the chip renders its connect button (`CONNECT ETHEREUM` / `CONNECT AZTEC`); wrong-chain keeps the switch affordance inside the L1 chip.
- Narrow viewports wrap to two rows naturally (flex-wrap).

### D4 — Rename + copy
- Section heading: **"PENDING BRIDGES"** (more precise than "Pending Transactions" — each card is a multi-transaction bridge), sub-line: "Bridges this browser started but isn't actively driving. Resume, finish, or discard them." Empty state: "Nothing pending."
- The stepper's phase labels + prompts are part of the copy review surface (frontend addendum). All existing card copy unchanged.

## Phases

### P1 — Flow steps + active-flow suppression ⬜
Files: `useDeposit.ts`, `useWithdraw.ts` (flow-level `flowStep` refs: deposit `sealing | approving | depositing | claiming`, withdraw `exiting`; set/cleared around the existing legs), `useBridgeJournal.ts` (export `activeFlowId`; `visibleRecords` additionally excludes it), tests.
Smallest proof: `activeFlowId` excluded from `visibleRecords` while set, included after clear (background) and after a simulated reload (`__resetJournalForTests` + re-add); deposit flow sets `sealing→approving→depositing` in order (fake wallet deps — extend the existing flow-level fakes or drive via the journal deps); allowance-skip surfaces `approving: skipped` (a `skippedApprove` flag); clean rejection resets `activeFlowId`.
Validate: `bun run --cwd packages/faucet test && bun run --cwd packages/faucet typecheck && bun run lint`.

### P2 — Stepper + receipt in BridgeForm ⬜
Files: `BridgeForm.vue` (the `formStage: form | stepper | receipt` machine; new `BridgeStepper.vue` + `BridgeReceipt.vue` children or inline sections — split if >~80 lines each), `testids.ts` (`stepper`, `stepperPhase` (+`data-phase`/`data-state`), `stepperBackground`, `stepperRetry`, `receipt`, `receiptNewBridge`, `receiptLink`), component tests.
Smallest proof: submit flips form→stepper and the journal hides the active record (mock journal); phase states render from flowStep+runtime combos (matrix: pending/active/done/skipped/failed); RUN IN BACKGROUND clears `activeFlowId` (card appears) and resets to form; completion flips to receipt with both links (hash-validated hrefs); NEW BRIDGE resets; error shows ✕ phase + note + retry.
Validate: P1 commands + `bun run --cwd packages/faucet test:e2e` (smoke extended: submit → no card while driving → background → card appears).

### P3 — Wallet chips row + rename + gates ⬜
Files: `L1WalletPanel.vue`, `BridgeWalletPanel.vue` (chip restyle, ✕ disconnect, logic untouched), `BridgeView.vue` (`.wallets` row), `BridgeJournal.vue` (heading/sub/empty copy), tests updated.
Smallest proof: chips render address + ✕ when connected (✕ fires disconnect with the existing testids); connect buttons when disconnected; wrong-chain switch still reachable; journal heading/empty copy pins.
Gates: `bun run audit:faucet` + `bun run audit:vue` → `/code-review max --fix` (separate commit) → codex post-impl audit → manual checklist.

### NEEDS MANUAL TEST (testnet, signature-gated)
1. Deposit (private, first-time wallet): the stepper narrates SEAL (×2 signs) → APPROVE → DEPOSIT → SYNC → CLAIM → CONFIRM → receipt with both links; NO Pending card at any point; NEW BRIDGE resets.
2. Repeat deposit: SEAL shows one signature; APPROVE shows SKIPPED when allowance remains.
3. RUN IN BACKGROUND mid-SYNC: the stepper yields, the card appears claiming/syncing and keeps narrating; the form is immediately usable for a second bridge.
4. Reload mid-DEPOSIT or mid-SYNC: form returns empty; the bridge appears as a Pending card (lost track) — resume from there.
5. Withdraw (public + private): EXIT → PROVE (countdown) → FINISH → CONFIRM → receipt; backgrounding during PROVE hands the countdown to the card.
6. Wallet chips: both on one row; ✕ disconnects each side; Aztec reconnect runs the verification modal; wrong-chain switch works from the chip.

## Decision ledger
| # | Decision | Source | Rejected / notes |
|---|---|---|---|
| S1 | `activeFlowId` (in-memory) + journal suppression; reload/background = the record surfaces as a card | main + user model | persisting the active id — rejected: reload MUST surface the card (the user's exact ask) |
| S2 | Stepper takeover + RUN IN BACKGROUND handoff; receipt stays until NEW BRIDGE | user (Phase 0) | concurrent in-form submissions; hard block; auto-return receipt |
| S3 | Flow-level `flowStep` beside engine runtime (no engine schema change) | main | pushing L1-leg narration INTO the engine — rejected: the legs live in the flows; the engine owns post-record work only |
| S4 | Keep both wallet panel components, restyle as chips (logic untouched) | main | a merged single component — rejected: the Aztec panel owns the verification modal lifecycle; merging multiplies risk for zero UX gain |
| S5 | "PENDING BRIDGES" heading | main (user delegated) | "Pending Transactions" — each card is a multi-tx bridge; "transactions" undercounts |
| S6 | Stepper/receipt as child components if size demands; testids per phase with `data-phase`/`data-state` | main | — |

## Security & Adversarial Considerations
- No engine/trust changes: `activeFlowId` and `flowStep` are display-routing state — never inputs to completion, hiding-from-the-journal does not alter record lifecycle (the engine drives identically whether the stepper or a card renders it).
- The suppression must fail OPEN: if `activeFlowId` points at a record the flow no longer drives (bug), the worst case is a missing card while the stepper shows the same record — never a hidden record with NO surface. P2 pin: the record is visible in exactly one surface at all times (stepper xor card xor receipt).
- Receipt links reuse the strict-hash helpers (no new URL surface). Chips render addresses via the existing `AddressDisplay` (no truncation-spoofing change).
- Copy: signing prompts must say WHICH wallet signs WHAT (anti-blind-signing, consistent with the seal-note pattern); the APPROVE phase must not imply value transfer ("allowance for the bridge portal").
- No new deps; no storage schema change.

## Assumptions
**Facts (verified):** flows expose only `busy`/`error` (`useDeposit.ts` `useDepositFlow` return); the L1 legs live in the flows and narrate via console only; engine runtime `step`/`stepDetail` exists and feeds the cards (`useBridgeJournal.ts`); `visibleRecords` filters `hidden`; both wallet panels are self-contained (~94/138 lines) with disconnect buttons + testids (`L1WalletPanel.vue:24`, `BridgeWalletPanel.vue:49`) and the Aztec one owns `VerificationModal`; the journal heading lives in `BridgeJournal.vue`; allowance-skip exists in the deposit flow (logged, not surfaced).
**Inferences (attackable):** the existing flow tests' fakes can drive the new `flowStep` assertions without a real wallet (the flows are thin over injected clients — if too coupled, P1 falls back to unit-testing the step mapping function in isolation); backgrounding mid-prompt (wallet popup open) is safe because the flow keeps running detached — the popup resolves into the engine regardless of which surface renders.
**Asks:** resolved at Phase 0 — takeover+background ✓, receipt-stays ✓. None open.

## Out of scope
Swap (next arc); engine/trust model; storage schema; CSP pass; Playwright real-browser flows.

## Audit verdicts
- Dual audit (codex + fable, both outlines): PENDING.
- Final fresh-context codex pass: PENDING.

## Seeds
Drafts in [eli5.html](eli5.html) after the audits; finalized post-approval.

---

## Competing outline (alternative angle: reuse the card AS the stepper)
Instead of a dedicated stepper, the form's step 2 mounts `BridgeJournalCard` for the active record (suppressed from the journal list, rendered in the form area), extended with a phase rail. Pros: one narration component, less new UI. Cons: the card is status-shaped, not flow-guiding (no upcoming-phases preview, no "what you'll sign next"), its actions (DISCARD/CLEAR) are wrong mid-takeover and need conditional surgery, and the form-level L1 legs (seal/approve/deposit) still need flow-step plumbing ANYWAY — so the savings are one template at the cost of overloading a component that two rounds of feedback shaped for a different job. Both outlines go to the auditors; main recommends the primary.
