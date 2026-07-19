# bridge-journal-ux — plan (v3 — final-pass REJECT folded; at the user approval gate)

Journal-UX overhaul for the faucet bridge/fuel flows, from the 2026-07-19 live smoke: a flow that
died at the APPROVE receipt wait rendered as "the deposit never confirmed", with no funds-moved
verdict and no re-engage affordance. The engine is already fund-safe (#290/#291/#292); this arc
makes the narration and affordances match — and adds true, safe, click-only RESUME.

**Audit trail**: v1 dual-audited — [audit-fable.md](audit-fable.md) (MAIN + two grafts) and
[audit-codex.md](audit-codex.md) (HYBRID, same shape); v2 folded every HIGH/CRITICAL. The final
fresh-context pass ([audit-codex-final.md](audit-codex-final.md)) REJECTED v2 — deposits have no
protocol nullification, and secretHash==id does not authenticate spending intent. v3 folds all
six findings (ledger L15–L19; L5/L7/L8/L9 revised). **Homing**: session worktree adopted (Phase 0.75); the slug names
the plan, not the worktree — deviation deliberate, worktree predates the plan.

## Locked decisions (user, 2026-07-19)
- **Blocks R** · **RESUME click-only** · **gates: vitest unit/component + typecheck + lint +
  build per phase; user rig smoke is the FINAL gate** · **production-shaped quality**.

## Scope (v3)
- **A** persist structured failure facts on the record: `failedLeg`
  (`"sealing"|"signing"|"approving"|"depositing"`), `failedOutcome`
  (`"no-funds-moved"|"unknown-outcome"|"recoverable"`), `failedAt` (epoch ms), `approveTxHash`.
- **B** leg-aware card: failed-leg marking + consequence copy + per-leg tx links (approve joins
  deposit/claim); fix the post-reload `activeKey` fallback (the APPROVE phase already exists).
- **C** honest terminal errors derived from the structured failure (persisted, not runtime-only).
- **D** true in-place RESUME for pre-deposit deaths — behind a shared safety substrate
  (validator + origin-wide locking + a WRITE-ONCE attempt token), variant-gated: direct fuel
  (public+private) + plain token this arc; fueled PUBLIC with persisted-nonce Permit2 reuse;
  fueled PRIVATE **redo-only this arc** (seal gap — follow-up filed); sealing-death records
  WITHOUT an envelope **redo-only** (a re-seal would authenticate tampered values); pre-hash
  unknown-outcome records **review-only + paste-hash** (never RESUME, never redo).
- **Grafts from COMPETING**: render-time allowance probe as chain-truth assist — for legacy
  records (no persisted facts) and as the cross-check behind any "no funds moved" claim (copy:
  "allowance currently sufficient", never "this approval confirmed"); redo-as-fallback affordance
  for records the RESUME validator rejects.

Out of scope: auto-resume; withdraw-side narration; faucet e2e harness; FPC balance-reclaim;
fueled-PRIVATE resume (redo-only + tracked follow-up).

## Policy decisions (from audit Asks — decided, with rationale)
- **Pre-hash unknown outcome** (died between wallet-confirm and hash return): permanent
  REVIEW-ONLY — no RESUME, and NO redo either (the broadcast may have landed; a redo would
  double-spend). Copy hedges honestly ("the deposit may have been sent — check your wallet
  activity") and the card offers a **paste-hash affordance**: the user pastes the tx id from
  their wallet, and the ENGINE validates it against chain truth (receipt to == portal + the
  deposit event parses) before recording it — a wrong hash simply fails; a right one unlocks the
  normal recovery. (Final pass: the previous "this card will recover it" copy was false —
  recovery requires a hash.)
- **One resume attempt per record (fail-closed)**: `resumeAttemptAt` is a WRITE-ONCE token set
  journal-first BEFORE the wallet prompt. If the attempt ends without a persisted result, the
  record becomes permanent unknown-outcome (review-only + paste-hash) — the token never ages out
  and never clears without chain proof. Deposits have no protocol nullification (a double claim
  reverts; a double deposit double-spends), so ambiguity must terminate resumability.
- **Funder binding**: RESUME spends the CONNECTED L1 wallet (no original-funder pin — deposits
  are recipient-bound, funder-agnostic). Guards: private records require connected Aztec ==
  `record.recipient` (mirrors the claim guard); every RESUME renders a review line (amount,
  recipient, variant) above the wallet prompt.
- **Legacy records** (pre-A history, incl. the smoke-test remnants): no persisted facts → the
  card uses the allowance probe + output-derived stage with hedged copy; RESUME stays hidden
  (validator requires the v2 fields); discard+redo remains their path.

## Assumptions

**Facts (verified; line refs corrected per fable audit):**
- Step/error narration is runtime-only (`useBridgeJournal.ts:432-444`); nothing survives reload.
- `deriveDepositStage` derives from outputs only (`packages/bridge-core/src/journal.ts:259-264`).
- The stepper ALREADY has an APPROVE phase (`apps/faucet/src/lib/bridge-steps.ts:52-58`); the
  post-reload bug is the `activeKey` fallback to `"deposit"` (`bridge-steps.ts:71`).
- `useL1FeeAsset.approve()` returns void AND swallows errors into `error.value`
  (`useL1FeeAsset.ts:90-121`) — hash exposure must be an `onSubmitted(hash)` callback that fires
  BEFORE the receipt wait (a return value is lost exactly on the failure path).
- Public fuel plan fully derivable from the record (`fuel.ts:39-43`); private DIRECT fuel seals
  its salt (`useFuel.ts:122-149`); fueled-token records journal fuel pre-fields at creation
  (`useDeposit.ts:731-743`) but their envelope does NOT authenticate the fuel fields.
- `withRecordLock`/`inFlight` is a tab-local Set (`useBridgeJournal.ts:151`); the storage
  listener only reloads records. No cross-tab mutual exclusion exists today — acceptable so far
  because nothing but the user-driven flows ever SENDS, and they're foreground-singular; RESUME
  changes that calculus.
- Record loader gates only id/direction (`journal.ts:169-175`) → additive optional fields need
  no migration.
- The engine's `runDepositClaim` under the SAME record lock no-ops as already-in-flight — resume
  must hand off AFTER releasing, not nest (codex).

**Inferences (updated per audits):**
- ~~fresh permit nonce/deadline~~ REJECTED: the old signed permit may still execute. Fueled
  PUBLIC resume persists the Permit2 nonce BEFORE first signing and REUSES it (at-most-once by
  bitmap); probe the bitmap before re-sign; a new nonce only if the old is provably unusable.
- ~~three-layer guard ≈ claim-latch guarantees~~ REJECTED by the final pass: claims are
  protocol-nullified, deposits are not, and no layer is atomic with the wallet broadcast. The
  binding guarantee is the WRITE-ONCE `resumeAttemptAt` token (set before the prompt; ambiguity
  → permanent review-only), with locks/re-reads as best-effort serialization on top; the
  ORIGINAL send paths take the same origin lock once crash-derived records become resumable.
- Re-quote on fueled resume patches `fuel.minOutput` (+ provenance note) ONLY after the old
  same-nonce signature is provably unusable — never while it might still execute (the floor must
  describe the signature that can land).
- Resumed private deposits post-reload cannot re-run the finalized-envelope re-seal (sealKeys are
  memory-only) — ACCEPTED degradation: `envelopeMatchesRecord` tolerates the missing leafIndex;
  documented in code where the skip happens.

**Asks:** none open — decided above: unknown-outcome = review-only + paste-hash (no redo);
funder-agnostic with connected-recipient equality (public AND private) + review consent;
signing-death resumable via persisted-nonce reuse; sealing-death resumable ONLY with an existing
envelope (else redo-only); legacy redo-only.

## Security & Adversarial Considerations
- **Hostile journal → on-chain writes** (final-pass correction: `secretHash == id` does NOT
  authenticate intent — public/plain-token secrets are random and recipient/amount ride as
  separate call args). The validator gates every resume with: zod-shaped schema;
  `fromStringUnsafe` + `await address.isValid()`; the secretHash recompute (still required — it
  binds the SECRET, catching secret/salt tamper); amounts BigInt-parsed with bounds;
  portal/bridge/asset/router re-pinned to the CURRENT deployment + the L15 FPC fail-stop. Intent
  authentication comes from the layers the hash can't give: **connected Aztec == record.recipient
  for PUBLIC resumes too** (not just private); private fields validated against the UNSEALED
  envelope where one exists; and a **load-bearing review-consent step** (amount + recipient +
  variant rendered, explicit confirm) before any wallet prompt. Records whose intent cannot be
  authenticated or guarded — sealing-death BEFORE an envelope exists — are REDO-ONLY. Validator
  rejection → redo affordance ONLY when the outcome is provably no-funds-moved; otherwise
  review-only.
- **At-most-once send**: (1) WRITE-ONCE `resumeAttemptAt` token journal-first before the prompt
  (ambiguity terminates resumability — see policy); (2) origin-wide `navigator.locks`
  (fail-closed) around the critical section — and the ORIGINAL deposit send paths take the same
  lock once crash-derived records become resumable; (3) re-read immediately before
  `writeContract`, abort to recovery if `depositTxHash` appeared; (4) Permit2 persisted-nonce
  reuse (fueled): nonce unused+expired → SAME nonce, fresh deadline; nonce USED → the deposit
  happened → recover, never re-authorize; `fuel.minOutput` is patched only after the old
  signature is provably unusable; (5) unknown-outcome cells excluded from RESUME and redo.
- **Approve narration integrity**: persist `approveOwner` alongside `approveTxHash`; "approval
  confirmed" renders only after validating the receipt identity (owner, token, spender,
  amount ≥, status success).
- **No secret leakage** in logs; **click-only**; one prompt lane; supply chain unchanged.

## Phases (v2 — re-split per codex)

### J1 — Persisted failure facts (A)
Record fields `failedLeg`/`failedOutcome`/`failedAt`/`approveTxHash` (+ clear-on-successful-
reentry, incl. the engine recovery clearing them). `useL1FeeAsset.approve()` gains
`onSubmitted(hash)` (fires pre-wait; error path defined). Flow catches classify the leg +
outcome journal-first. Unknown-outcome classification for the pre-hash depositing cell.
**Gate**: vitest pins — (leg × outcome) classification table incl. unknown-outcome; clear-on-
reentry; approve onSubmitted persist-before-wait. typecheck/lint/build + bridge-core suite.

### J2 — Resume safety substrate (no UI)
`resume-validator.ts` (pure): the full hostile-field gate, unit-fuzzed (tamper each field →
reject; secretHash recompute binds the secret; connected-recipient equality public+private;
envelope-authoritative where one exists; eligibility matrix incl. sealing-death-without-envelope
→ redo-only). WRITE-ONCE `resumeAttemptAt` token helper (journal-first; ambiguity → permanent
review-only). Origin-wide lock wrapper (`navigator.locks`, fail-closed) — applied to the ORIGINAL
deposit send paths in the same phase. Pre-send re-read helper. Permit2 nonce persistence fields.
**Gate**: hostile-fuzz table; one-shot-token pins (second resume on an ambiguous record refuses;
token never clears without chain proof); simulated two-runner race; lock fail-closed pin;
send-boundary fault injection (throw between prompt and hash-persist → record lands review-only).
typecheck/lint/build.

### J3 — Honest errors + leg-aware card (B + C)
Terminal copy derived from persisted failure facts (single `describeLegFailure` table, every
(leg × outcome) cell pinned — "no funds moved" only for approve/seal/sign deaths, hedged copy for
unknown-outcome). Card: failed-leg marking (activeKey fix), per-leg links, approve-receipt
identity check behind "approval confirmed", allowance-probe fallback for legacy records,
RESUME/CLAIM/redo/paste-hash affordances per shape — RESUME is NOT CLICKABLE for any variant
until that variant's runner lands (J4/J5); redo renders ONLY on provably no-funds-moved records;
unknown-outcome renders review-only + the paste-hash input (engine-validated against the receipt
identity before recording).
**Gate**: component-state table (pre-approve / approve-death / sign-death / unknown-outcome /
deposit-death / claim-limbo / legacy / done); full faucet suite; typecheck/lint/build.

### J4 — RESUME: direct fuel (public + private) + plain token
`resume(recordId)` per flow: under the origin lock — validate (J2: eligibility + guards), REVIEW
CONSENT (amount/recipient/variant, explicit confirm), write-once token, rebuild plan from record
(private direct fuel from salt; seal skipped when `sealedEnvelope` exists; sealing-death without
envelope already rejected), allowance check (skip when sufficient), re-read, deposit, release,
then hand to `runDepositClaim` (after lock release — the nesting no-op footgun).
**Gate**: per-variant flow tests (happy, hostile-reject, race-abort, allowance-skip, seal-skip,
one-shot-token refusal, consent-decline aborts pre-token); full faucet suite; typecheck/lint/build.

### J5 — RESUME: fueled PUBLIC (Permit2 nonce reuse); fueled PRIVATE redo-only
Persist the nonce before FIRST signing (J2 fields). Resume probes the bitmap: nonce USED → the
deposit happened → route to recovery, never re-authorize; UNUSED + old permit expired → re-sign
with the SAME nonce, fresh deadline; UNUSED + old permit still live → wait/review (both
signatures must never be able to land). `fuel.minOutput` patched only once the old signature is
provably unusable. Fueled PRIVATE: RESUME hidden, redo only on provably no-funds-moved; follow-up
issue for the authenticated-intent (seal the fuel fields) upgrade.
**Gate**: nonce state-machine pins (used/unused×expired/live table; no path re-authorizes a
usable old permit), minOutput timing pin; full faucet suite; typecheck/lint/build.

### J6 — Rig smoke (FINAL gate) → merge → unblock R
Rebuild + restart the tailnet rig. MANDATORY checklist (final-pass): legacy record honest copy;
forced approve-death → RESUME → claim; one full happy path; TWO-TAB resume race (second tab must
refuse); kill-after-wallet-acceptance → record lands review-only + paste-hash recovers it; lock
unavailability fail-closed; storage-failure surface; **fueled-public resume incl. Permit2
used/expired states (mandatory since J5 ships)**.
**Gate**: user go on the full checklist; PR squash-merged to dev, quality green; R unblocks.

## Validation commands (every phase)
`cd apps/faucet && bunx vitest run && bunx vue-tsc --noEmit` · `bun run lint` ·
`bun run --cwd apps/faucet build` · bridge-core suite when journal.ts changes.

## Decision ledger (v2)
| # | Decision | Source |
|---|---|---|
| L1 | Persist STRUCTURED failure facts (leg+outcome+at), not just a step string | codex ASSUME-HIGH on v1-J2 |
| L2 | RESUME re-enters the SAME record; discard-and-redo rejected as primary (audit-trail + leg-blindness) | both audits |
| L3 | Click-only resume | user (locked) |
| L4 | Allowance probe = chain-truth assist + legacy fallback ONLY, never leg provenance | fable graft (a) + codex |
| L5 | Redo-as-fallback ONLY on provably no-funds-moved records (v3: never on unknown-outcome/attempt-latched) | fable graft (b) + final-pass contradiction |
| L6 | Unknown-outcome (pre-hash) cell: review-only, hedged copy, no RESUME | codex CRITICAL #2 / fable #2 |
| L7 | secretHash-recompute binds the SECRET only (v3: intent-authentication overclaim withdrawn); intent = connected-recipient equality (public+private) + review consent + envelope where present | fable #3 + codex #1 + final-pass #2 |
| L8 | WRITE-ONCE resumeAttemptAt token (ambiguity → permanent review-only) + navigator.locks (orig. send paths included) + pre-send re-read | codex CRITICAL / fable #1 / final-pass #1 |
| L9 | Permit2 nonce state machine: used→recover; unused+expired→same nonce fresh deadline; unused+live→wait; minOutput patched only post-unusability | codex CRITICAL + final-pass #4 |
| L10 | Fueled PRIVATE resume deferred (seal gap) → redo-only + follow-up issue | codex CRITICAL #3 |
| L11 | approve hash via onSubmitted callback pre-wait; receipt identity check before narration | codex HIGH ×2 |
| L12 | failedLeg union includes "signing" | fable #4 / codex |
| L13 | Phase re-split: substrate (J2) before any resume UI wiring | codex PHASE-HIGH |
| L14 | Funder-agnostic resume + LOAD-BEARING review consent + connected-recipient equality (public AND private) | codex Ask + final-pass #2 |
| L15 | One resume attempt per record: write-once token, never ages out, chain proof only | final-pass #1 |
| L16 | Paste-hash affordance for unknown-outcome (engine validates receipt identity) | final-pass #3 |
| L17 | Sealing-death without envelope = redo-only (re-seal would authenticate tamper) | final-pass #2 |
| L18 | approveOwner persisted with approveTxHash | final-pass #5 |
| L19 | J6 checklist mandatory incl. two-tab, kill-after-acceptance, lock absence, Permit2 states | final-pass #6 |

## Rejected alternatives
- COMPETING standalone (derive-at-render + redo): leg-blind, destroys audit trail, RPC-per-render.
- Fresh Permit2 nonce/deadline on resume: double-authorization window (L9).
- Auto-resume of sessionLive records: races + surprise prompts; click-only locked by user.
- Faucet e2e harness this arc: cost disproportionate; manual rig smoke is the final gate (user).
