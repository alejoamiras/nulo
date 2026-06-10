# Bridge UX feedback round (`feat/bridge-ux-trust`, post-journal amendment)

Blueprint tier: `mid`. Branch: continues `feat/bridge-ux-trust` (unmerged — same PR). Parent arc: [bridge-ux-trust](../bridge-ux-trust/plan.md) — its journal engine, envelope, and verified-only completion are the substrate this round polishes.

Driving feedback (user, testnet session):
1. The Aztec private balance is invisible until the PRIVATE toggle flips — picking Aztec→Ethereum is blind.
2. Clicking CLAIM on a rediscovered card gives no live status — "it just submits and I'm left for good."
3. A completed card sits in the list until manually discarded ("just make it done"), and a reload mid-bridge produced the alarming dead-end note "The claim's outcome couldn't be confirmed yet — Retry checks again" with no sense of where the flow stood or whether funds were safe.
4. Card headers ("→ AZTEC") don't read as a direction.
5. (Accepted add-on) Explorer links for every tx hash a card knows.

## Design decisions

### D1 — The engine narrates: a `step` runtime field
`RecordRuntime` gains `step?: "unsealing" | "syncing" | "sending" | "confirming" | "verifying"` plus `stepDetail?: string` (e.g. poll counts). The engine sets it at each transition inside `runDepositClaim` / `finishDepositByReceipt` / `runWithdrawConsume` (and clears it on exit), so the card renders a live one-line status with a spinner — the user watches the claim move instead of staring at a disabled button. Stages stay DERIVED from milestone facts (parent-arc D1 unchanged); `step` is ephemeral runtime narration, never persisted.

### D2 — Receipt waits never dead-end; `unknown-outcome` means REFUSED, not SLOW
Today `finishDepositByReceipt` dumps to `unknown-outcome` after a silent ~3-minute budget even when the claim is merely slow. Rework:
- While the receipt is `pending`: `step: "confirming"` with elapsed/attempt detail — the poll CONTINUES past the old budget (cap ~30 min like the sync gate), because a submitted claim resolves to success/dropped/reverted eventually; abandoning at 3 min created a false alarm.
- `unknown-outcome` is reserved for VERIFICATION refusals (probe false/null, consume-identity mismatch) — the cases where the engine genuinely cannot vouch.
- Every attention note gains a **funds-safety line** (D7) so a refusal is informative, not terrifying.

### D3 — Verified done self-resolves
The parent arc retained done cards until manual Clear (ledger L2) to insure the false-done case. The post-impl hardening made completion **verified-only** (the probe must prove THIS record's message consumed), which moots that insurance: a verified done's secret is spent and worthless. New behavior: on `completedAt`, the card shows its ✓ state briefly (~8s, with the explorer link) and then auto-clears from the journal; a toast confirms ("Bridged 100 USDC to Aztec ✓"). No Clear button needed in the happy path (kept for any pre-existing done records). **Ledger L2 amendment recorded below** — auto-clear fires ONLY off verified completion; unverified states never auto-clear.

### D4 — Direction reads as a journey
Card header becomes `ETHEREUM → AZTEC` / `AZTEC → ETHEREUM` (chain chips at both ends, mono, matching the form's chips), with the privacy tag and amount unchanged. `data-direction` attr unchanged (e2e stability).

### D5 — Both Aztec balances visible (codex arbitrates between)
Candidate options (exactly one ships):
- **(a) Stacked dual balance on the Aztec panel**: the panel always shows BOTH lines — `Public: 200.00` / `Private: 50.00` — with the ACTIVE one (per the toggle) highlighted and the inactive one dimmed. The toggle keeps selecting which balance funds/receives the bridge; visibility no longer depends on it.
- **(b) Single line + secondary hint**: keep one primary balance (per toggle) and render the other as a dimmed suffix — `Balance: 200.00 USDC · private: 50.00`. Minimal layout change, less scannable.
- **(c) Toggle-as-segmented-control with balances inline**: replace the switch with two segments `PUBLIC 200.00 | PRIVATE 50.00` — selection and visibility merge into one control. Boldest change; makes the toggle's meaning unmissable but restyles a shipped control.
Main's lean: (a) — it answers the exact complaint (can't see private before toggling) with zero interaction-model change. Codex decides (a)/(b)/(c) in the audit round; fable may dissent.

### D6 — Explorer links on cards
Every tx hash a record holds becomes a link: `depositTxHash`/`consumeTxHash` → Sepolia etherscan (`https://sepolia.etherscan.io/tx/<hash>`, new tiny helper); `claimTxHash`/`exitTxHash` → aztecscan via the existing `lib/explorer.ts` helper. Rendered in the card's status line and ✓ state. External links open `target="_blank" rel="noopener noreferrer"`.

### D7 — Reassurance copy (funds-safety lines)
Attention notes get a second sentence stating what is and isn't at risk, e.g.:
- unknown-outcome (deposit): "Your funds are not lost — the claim either landed or the deposit remains claimable from this card."
- unseal-failed: existing copy + "The deposit itself is untouched."
- The mid-flow reload case: the card's step/stage line states exactly where the flow stands ("Claim submitted — confirming on Aztec…"), replacing the void the user reported.
Copy is part of the review surface (frontend addendum).

## Phases

### P1 — Engine narration + receipt-wait rework ⬜
Files: `packages/faucet/src/composables/useBridgeJournal.ts` (+test).
- `RecordRuntime.step`/`stepDetail`; transitions set/cleared in `resolvePrivateSecret` (unsealing), the sync gate (syncing w/ poll count), send (sending), `finishDepositByReceipt` (confirming w/ attempt count → verifying), `runWithdrawConsume` (confirming).
- Receipt poll: pending continues to a ~30-min cap with `step` detail; `unknown-outcome` only on probe false/null, reverted handling unchanged; budget-exhaustion note rewritten ("Still confirming on Aztec — slow testnet. This card keeps checking; RETRY forces a check now. Funds are safe.") and is NOT `unknown-outcome` (a new soft note via `stepDetail`).
- Auto-clear on verified `completedAt` (a `doneAt` grace timer ~8s → `discard`), behind a small engine helper so the card stays dumb. Toast hook exposed (the faucet has `useToast`).
Smallest proof: step transitions observable in runtime during a fake claim (unsealing→syncing→sending→confirming→verifying→done); pending past the OLD budget keeps polling and never sets `unknown-outcome`; probe-refusal still does; verified done auto-clears after the grace timer (fake timers) while an unverified/attention record never auto-clears.
Validate: `bun run --cwd packages/faucet test && bun run --cwd packages/faucet typecheck && bun run lint`.

### P2 — Card UI: direction, live status, links, done state, copy ⬜
Files: `BridgeJournalCard.vue` (+test), `lib/explorer.ts` (+ etherscan helper +test), `testids.ts` (add `journalStep`, `journalTxLink`).
- Header: both-end chips (D4). Status line: spinner + step narration (D1) above the stage label; attention notes with funds-safety lines (D7); explorer links (D6); ✓ state with link + auto-clear (D3); toast on completion.
Smallest proof: header renders both chains per direction; step narration renders from runtime (each step → expected copy); tx links carry the right href per hash field; done card shows ✓ + link, then auto-clear is driven by the engine (mocked); attention note includes the funds-safety sentence.
Validate: same as P1 + `bun run --cwd packages/faucet test:e2e` (smoke still green — selectors unchanged except additions).

### P3 — Form balance visibility (codex-arbitrated option) + gates ⬜
Files: `BridgeForm.vue` (+test); `testids.ts` if the option adds nodes (e.g. `bridgeBalanceL2Public` / `bridgeBalanceL2Private` for option (a)).
- Implement the arbitrated D5 option; copy reviewed; over-balance validation reads the ACTIVE balance only.
Smallest proof: both balances visible without toggling; the active one switches with the toggle (or segment); validation still binds to the active source; flip keeps both visible on the Aztec side only.
Gates: `bun run audit:faucet` + `bun run audit:vue` → `/code-review max --fix` (separate commit) → codex post-impl audit → address high/critical → manual checklist hand-off.

### NEEDS MANUAL TEST (testnet, signature-gated)
1. Private deposit end-to-end watching the card narrate: unsealing → syncing (poll count) → sending → confirming (attempts) → verifying → ✓ → auto-clear + toast.
2. Reload mid-sync, click CLAIM: the card states exactly where the flow stands at every step; no dead-end notes; funds-safety line present on any attention state.
3. Reload right after the wallet confirm (claimTxHash persisted): card resumes at "confirming" prompt-free and completes (no 3-minute false alarm).
4. Withdraw: proving countdown → FINISH → confirming with the Sepolia link → ✓ → auto-clear.
5. Both Aztec balances visible before any toggle; toggling switches which is active; Aztec→Ethereum private withdraw picked with full knowledge of the private balance.
6. Every tx link opens the right explorer page.

## Decision ledger
| # | Decision | Source | Rejected / notes |
|---|---|---|---|
| F1 | Engine narrates via runtime `step` (cards stay dumb) | main | competing outline's card-side polling — rejected pending audits: duplicates engine knowledge, drifts |
| F2 | Receipt pending ≠ unknown-outcome; 30-min soft cap with live detail | main + user pain | the 3-min dump — removed; `unknown-outcome` reserved for verification refusals |
| F3 | Verified done auto-clears (~8s grace + toast); amends parent L2 — its insurance was mooted by verified-only completion | user ("just make it done") + main analysis | retain-until-Clear for verified dones — obsolete; unverified records still never auto-clear |
| F4 | Both-end direction chips | user + main | single-arrow header |
| F5 | Balance visibility option — **PENDING codex arbitration** among (a) stacked dual / (b) secondary hint / (c) segmented control; main leans (a) | user (delegated) | — |
| F6 | Explorer links (aztecscan + sepolia etherscan) | user (gate add-on) | — |
| F7 | Funds-safety copy on every attention state | user pain | — |

## Security & Adversarial Considerations
- No new trust surface: `step` is ephemeral display state (never persisted, never an input to completion logic); auto-clear triggers ONLY off the D4-verified `completedAt` — an attacker who could forge a tx hash still cannot reach verified-done (parent-arc probe), so auto-clear cannot be weaponized to destroy a live blob.
- Explorer links: hash-only URLs to fixed hosts; `rel="noopener noreferrer"`; no user-controlled URL parts beyond the hex hash (validated shape before interpolation).
- Copy: funds-safety lines must be TRUE per state (reviewed against the engine's actual guarantees — e.g. never claim "funds are safe" on a `tampered` record; phrase as "the sealed secret is intact").
- Longer receipt polling: bounded (~30 min) + per-record, no unbounded timer leak; polls are read-only node calls.
- No new deps.

## Assumptions
**Facts (verified):** the 3-min budget + note live in `finishDepositByReceipt` (`useBridgeJournal.ts`, 45×4s loop); done cards persist until Clear (`BridgeJournalCard.vue` stage matrix); the Aztec panel renders ONE balance keyed off `isPrivate` (`BridgeForm.vue` `l2Balance`); `lib/explorer.ts` exists with an aztecscan tx helper; completion is verified-only post-`5ed9831` (probe === true); `useToast` exists (faucet composables); the smoke + 176-test suite is green at `08385f7`.
**Inferences (attackable):** a pending Aztec claim receipt always terminalizes within ~30 min on testnet (if not, the soft cap re-arms RETRY — no dead-end either way); the ~8s done-grace doesn't race the storage event in a second tab (auto-clear is idempotent `discard`).
**Asks:** all resolved at Phase 0 — stuck card = retention semantics (auto-clear approved, "just make it done"); explorer links in scope; balance option delegated to codex arbitration (F5). No open asks.

## Out of scope
Swap (next arc); CSP/hardening pass (unchanged); Playwright real-browser flows; any engine trust-model change.

## Audit verdicts
- Dual audit (codex + fable, parallel, both outlines): PENDING.
- Final fresh-context codex pass: PENDING.

## Seeds
Draft in [eli5.html](eli5.html) once the audits land; finalized post-approval.

---

## Competing outline (alternative angle: card-first, minimal engine change)
Instead of the engine narrating, keep `useBridgeJournal` untouched except the receipt-budget fix, and make the CARD smart:
- The card derives a synthetic status from what it can observe: busy + missing claimTxHash ⇒ "working…"; claimTxHash present ⇒ its own lightweight receipt poll via a read-only node client for display; done ⇒ ✓.
- Auto-clear implemented as a card-local timer calling `discard`.
- Pros: zero engine churn; UI iterates freely. Cons: duplicates engine knowledge in the view layer (two receipt polls, drift risk), can't narrate engine-internal steps (unsealing/sync-gate polls are invisible to the card), violates the parent arc's "cards stay dumb, engine owns truth" altitude, and the display poll could disagree with the engine's verdict (a false "done ✓" display while the engine refused verification — exactly the class of lie this repo's plans keep killing).
Both outlines go to the auditors; main recommends the primary (engine-narration) plan.
