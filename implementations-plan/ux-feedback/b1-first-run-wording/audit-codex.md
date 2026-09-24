# Codex audit · batch 1 plan

Reviewer: codex, GPT-6 Astra at `high`, read-only, session `01a0d3d9-af15-7b92-a759-f080761204f6`.
Subject: [`plan.md`](plan.md) as committed in `68dda5c1`, with [`recon.md`](recon.md), the design
spec and the program plan. The prompt asked for design correctness, a defender-side adversarial
review, an assumption attack, an implementation critique, the test plan, the parity rule, and a
decision on each of the 11 Asks.

## Round 1 · response

**conditional approve — requires fixes to name resolution, backup sanitization, fee truthfulness, layering, and test gates; undrawn UI needs owner resolution.** Confidence: high on source findings; moderate on arbitrary-contract fee behavior.

1. **Blocker — Full-backup naming bypasses the proposed submit check.**  
   `useProfileImportFlow.ts` validates seed/passkey imports, but delegates backup restore directly to `useFullBackupImport.ts`. Restore has no fresh `getProfiles()` or name validation. Consequently, pending initialization, failed reads, and cross-tab changes can escape the proposed protection. Resolve the final name inside the backup restore latch, after backup validation and before creating the profile: explicit edited name, otherwise the current backup’s usable sanitized name, otherwise a fresh default. Keep that resolved string stable through retries.

2. **Blocker — Hidden backup names can still reach storage unsanitized.**  
   `useFullBackupImport.ts:377` accepts a sanitized string containing only spaces. At `:431`, trimming makes the override empty, so restore uses the **raw embedded name**. For example, spaces surrounding a bidi control survive the first check as spaces, then trigger the raw fallback. This is materially worse with an invisible field. Trim the sanitizer’s result before checking usability, and ensure the changed restore path always supplies a nonempty sanitized/default override. Test plain and encrypted backups with whitespace/control-only names.

3. **Major — One-time naming state becomes stale.**  
   Plan §First run handles another tab adding a profile only when state remains hidden/pending. If the page initially shows `Profile 2` and the last existing profile is deleted, it still creates the new first profile as `Profile 2`. A delayed initialization response can also compete with submit-time naming. Refresh classification through existing profile events, with cleanup in `dispose()`, and recheck at submission. Fence late initialization writes once submission resolves its name. Test deletion and both response orders; the acknowledged simultaneous cross-tab creation race remains a separate existing limitation.

4. **Major — Failed create-time reads strand submission.**  
   `useProfileCreateFlow.ts:79` sets `isCreating` before awaiting `getProfiles()`, **outside** its `try`. A rejected read, including worker-disconnect rejection, leaves the button latched. Move the read/name resolution inside error handling and release the latch on failure. Reuse the existing failure notification; test rejection followed by a successful retry. The new mount read must also settle out of `pending` on rejection.

5. **Major — Backup replacement needs stronger automatic-name tracking.**  
   `runPickBackupFile` and `runDecryptBackup` publish `parsedBackupName` only when sanitization produces a truthy result; they do not clear a previous backup’s name for an unusable replacement. The proposed “last value written” comparison also needs to include writes from the backup watcher. Otherwise backup A can name backup B. Clear/recompute the candidate on every selection, and track all automatic assignments together. Preserve actual user edits. Add one replacement test covering named → nameless → named.

6. **Major — `type === "fpc"` does not prove “Nothing” or “free.”**  
   `DefaultSponsoredFpcHandler.validateArtifact()` checks a function name and empty signature, not contract behavior. Hand-added contracts therefore lack the guarantee asserted by the plan. The normal public/private/sponsored distinction is correct, but the unconditional claim for arbitrary contracts is unsupported. Restrict guaranteed-free wording to verified protocol sponsorship; take the unverified-contract wording to the owner. Do **not** relabel it as self-pay. This is an owner-facing design gap, not permission to invent copy.

7. **Major — Unknown private balances still say “no balance.”**  
   `fee-helpers.ts:privateFeeJuiceOption` groups `null` with `"0"`. Because the proposed selector prioritizes `disabledReason`, the honest `— FJ` spend value never appears for that case. Split unknown from confirmed zero, using the existing public-row `"couldn't check balance"` treatment. Guard null/undefined before `formatGasBalance`, which otherwise formats them as zero. One table-driven test should cover loading, failed read, zero, positive balance, and missing private contract.

8. **Major — The new mark component violates the stated layer rule.**  
   `PublishStrip.vue` is L3; importing another L3 `PublishMark.vue` contradicts the L0–L2-only contract, even though current lint does not catch that relationship. The smallest compliant change is inline `Icon` rendering in the three consumers, retaining shared visibility CSS and the review spacer. Preserve `aria-hidden` because `Icon` renders `role="img"`. The naming composable should receive the connected client/getter and expose cleanup, without connection or lifecycle ownership.

9. **Major — Fixture inventory and arc gates are incomplete.**  
   `tests/e2e/fixtures/extension.ts:953` independently creates the first profile in `feeJuiceImportedExtension` and unconditionally fills `import-name-input`; the plan misses it. Route it through the updated import helper. Add `price-fixture`, which consumes it, and execute-window `tx-sendTx-selfPay` / `tx-sendTx-sponsoredFpc` coverage. Include a wire-shaped execute component assertion connecting payer settings to the readout. P5’s three-run requirement must cover changed **network** files too, as the program requires—not only smoke files. Keep `fee-estimate-usd` on priced sponsored output as well.

10. **Major — “Sign-off pending” is being extended beyond drawn recommendations.**  
    The program explicitly permits building round-5 recommendations while their picks are pending. It does not clearly authorize inventing additional undrawn states. The three proposed derivations are minimal: `— FJ` follows existing unknown-balance display; retaining skeleton/hint behavior avoids new loading behavior; interpolating `<$0.001` preserves formatting. No supplied shot draws their exact states. Present these specific choices to the owner; listing them in the PR alone does not resolve the spec’s stop rule. U11/U12/U13A themselves have drawn recommendations and are fine under the program exception.

The 11 Asks:

- **Ask 1: Amend** — submit-time resolution is sound only across every import path, with stale-read fencing and deletion handling.
- **Ask 2: Approve** — root testids plus an explicit terminal state work across browsers; wait for `hidden`/`shown`, then assert actual field presence and prefill.
- **Ask 3: Amend** — equality is sufficient for this limited policy only when every automatic writer updates the same tracked value and backup replacement resets its candidate.
- **Ask 4: Approve** — keep the visually hidden utility local until another consumer needs it.
- **Ask 5: Reject as sufficient proof** — interface classification cannot establish arbitrary contract behavior; use verified sponsorship and escalate unknown wording.
- **Ask 6: Approve with correction** — reuse the formatter and reason precedence, but distinguish unknown private balance from zero.
- **Ask 7: Prefer inline icons** — three small render branches avoid the L3 dependency violation.
- **Ask 8: Approve** — no migration or display-time rename; existing stored names remain intentional.
- **Ask 9: Approve with additions** — loud failure is correct; include the missed fixture and assert terminal state before typing.
- **Ask 10: Approve, though unnecessary** — ref focus works, but `Input` already implements `autofocus` through `onMounted().focus()`; either is deterministic.
- **Ask 11: Approve** — use an isolated network capture run with deterministic priced/unpriced setup; temporary capture code must not replace committed assertions.

**Facts checked and wrong/incomplete:** Fact 2 excludes full-backup restore. Fact 4’s “every suite” is false: onboarding, passkey, and `feeJuiceImportedExtension` have independent first-profile paths. Fact 3’s collision suffixing is exact-string only, not NFKC/case-folded. Facts 1 and 5–10 verified.

**Looks fine:** account numbering and initials; unchanged selector keys; public-only dApp lock; protocol-aware privacy classification; V4 estimated-state geometry; lock-chip dimensions; preserving later-arc seams. Exact complexity scores require the implementation—nothing here warrants new budget exceptions.

## Round 1 · adopt / reject

| # | Finding | Call | What changed in the plan |
|---|---|---|---|
| 1 | Full-backup naming bypasses the submit check | adopt | The restore asks the flow's resolver for the name inside its latch, after validation, stable through the duplicate-confirm retry |
| 2 | Hidden backup names can reach storage raw | adopt | `sanitizedBackupName` trims and treats empty as no name; the restore name is always resolved (typed, sanitized backup, or default); tests for whitespace- and control-only names, plain and encrypted |
| 3 | One-time naming state goes stale | adopt, partly | Submit-time resolution from a fresh read for every automatic name (covers deletion and addition); late setup reads fenced. Live re-classification through profile events rejected: it would make the field appear or vanish mid-edit, a UI behaviour no drawing covers, and submit-time resolution already carries correctness |
| 4 | A failed create-time read strands the latch | adopt | The read moves inside the create flow's error handling; test for rejection then retry |
| 5 | Backup replacement keeps the previous name | adopt | One tracked automatic value for every writer; each selection and decrypt recomputes the candidate; named → nameless → named test |
| 6 | "Nothing" / "free" unproven for hand-added contracts | hold, re-review | The FPC path builds the account payload with `EXTERNAL`, so the account never sets itself as fee payer and `set_as_fee_payer` can only name the calling contract; sent back to codex with the evidence |
| 7 | A failed private read says "no balance" | adopt | Split from a confirmed zero; "couldn't check balance" like the public row; drawn for the owner as U14 |
| 8 | L3 → L3 import; composable wiring | adopt | Inline icons with a pure `publishGlyph`; `useProfileNameDefault` receives a getter and owns no lifecycle |
| 9 | Fixture inventory and gates incomplete | adopt | `feeJuiceImportedExtension` routed through `importSeed`; `price-fixture`, `tx-sendTx-selfPay`, `tx-sendTx-sponsoredFpc` in the gate; wire-shaped execute test; three retry-0 runs for changed network files too; `fee-estimate-usd` kept on sponsored output |
| 10 | Derived states need the owner | adopt | The two genuine new states (U14 menu with an unknown balance, U15 the sub-cent spoken sentence) are drawn into round 5 with pickers before P3; the estimating and idle readouts are the spec's label rename, not new states |

Facts corrected: 2 (the full-backup path neither validates nor re-reads; the create read sits
outside its `try`), 3 (`sanitizedBackupName` can return spaces; the service suffix is exact
string), 4 (three more independent first-profile paths).

## Round 2 · prompt summary

Sent the revised plan and the ledger above. Held two positions: finding 3's live
re-classification (submit-time resolution already stores the right name; a field appearing or
vanishing mid-edit is undrawn UI), and finding 6, with the evidence that the FPC path builds the
account payload with `EXTERNAL` and the sponsored payload is the argument-free
`sponsor_unconditionally()`, so the account never names itself fee payer.

## Round 2 · response

**conditional approve — resolve finding 6’s reimbursement counterexample and cover whole-read failures in U14.** Confidence: high from source inspection; the counterexample was not executed.

1. **Finding 3: accept your position.**  
   Fresh submit-time resolution fixes the stored-name problem without subscriptions. A stale, untouched prefill after another tab changes the profile list is not sufficient reason to introduce fields appearing/disappearing mid-edit. I withdraw that requirement. Keep the stated guarantees that edited names survive and late setup results cannot overwrite the resolved name.

2. **Finding 6: withdraw the direct network-fee allegation; retain a narrower, concrete counterexample.**  
   `EXTERNAL` supports your argument: this account entrypoint does not appoint itself payer, and the sponsored handler supplies no reimbursement authorization.

   However, **“this path creates no authwit” does not imply “no applicable authwit exists.”** Consider:

   - The account previously granted an unused public authorization for `Token.transfer_in_public(account, FPC, amount, nonce)`, with that FPC as caller.
   - The hand-added FPC exposes the accepted argument-free `sponsor_unconditionally()`.
   - That function appoints itself network-fee payer, ends setup, and enqueues that exact token transfer. Token address, amount, and nonce can be constants or stored configuration; the account comes from the caller.
   - The token consumes the **existing** authorization and debits the account. No new authwit is needed in this transaction.

   The installed `token_contract-Token.json` source uses `authorize_once` for that transfer; `auth_registry_contract-AuthRegistry.json`’s `consume` reads and consumes persisted approval. `DefaultSponsoredFpcHandler.validateArtifact()` permits this interface.

   This is an **authorized reimbursement**, not an authorization bypass. Nevertheless, the account pays something specifically through the selected fee contract while the menu says “free.” Your narrower network-payer claim holds; the broader zero-cost conclusion does not. Keep the protocol-only guarantee or ask the owner whether these labels intentionally exclude such reimbursement. Do not silently substitute self-pay wording.

3. **New major — U14 misses a failed whole-balance read.**  
   Plan §Fee wording addresses per-leg `null`, but `FeeSettingsCard.vue:104` passes `undefined` both during loading and after an entire read fails. Its own comments explicitly document the latter. `buildFeeMethods` therefore cannot implement U14’s promised distinction: the failed rows remain enabled with `— FJ`.

   **Smallest fix:** at this presentation call site, when initialization is complete but balances are unavailable, pass an unknown-leg object—`publicFeeJuice: null`, `privateFeeJuice: null`—to `buildFeeMethods`. Keep the underlying balance/selection state unchanged. Extend the existing table-driven coverage to distinguish loading from completed whole-read failure.

4. **Minor — correct the backup collision sentence.**  
   Plan §First run says a case/NFKC variant “still reaches the service’s suffix.” It reaches restore, but **does not receive a suffix** unless an exact-string collision exists. State that automatic defaults use normalized uniqueness while backup names retain existing exact-match suffixing. No service change is required.

The inline icons, shared glyph mapping, expanded network gate, and retry-zero requirements address the earlier findings. U14/U15 now have a concrete draw/publish/notify step before implementation. The backup resolver placement and setup-write fence introduce no further material problem in the stated design.

## Round 2 · adopt / reject

| # | Finding | Call | What changed in the plan |
|---|---|---|---|
| 1 | Finding 3 withdrawn | accept | Kept the guarantees: an edited name survives; late setup reads cannot overwrite the resolved name |
| 2 | Reimbursement through a standing public authwit | hold, re-review | Argued the exposure exists from the moment the grant exists, whichever fee method the user picks |
| 3 | U14 misses a whole failed balance read | adopt the case, not the fix | U14 now separates "not known yet" (loading, or retrying after a whole failed read: "— FJ", rows selectable as today) from one unreadable leg (that row disabled, "couldn't check balance"). Disabling both rows on a whole failure would change gating the card deliberately withholds (`FeeSettingsCard.vue:121-125`) |
| 4 | Backup collision sentence wrong | adopt | Automatic defaults are unique under `normalizeProfileName`; a backup's own name keeps the service's exact-string suffix |

## Round 3 · prompt summary

Reported the collision sentence applied and the whole-read case handled as wording, not gating.
Held the reimbursement position: a public authwit naming the FPC as caller is consumable by that
caller in any transaction, so choosing the fee method neither creates nor widens the loss.

## Round 3 · response

**conditional approve — the remaining condition is owner resolution of “free” / “Nothing” for unverified fee contracts.** Confidence: high from source inspection; no contract execution test performed.

1. **Whole-read failure: accepted.**  
   Revised U14 explicitly covers `undefined` with selectable rows and `— FJ`, so the previous specification mismatch is resolved. One factual correction: selectable does not mean payable. `settingsForMethod()` already rejects self-payment with unknown balances; `FeeSettingsCard.vue` documents that behavior. Preserve both existing behaviors.

2. **Reimbursement: your rebuttal does not cover a caller-restricted FPC.**  
   Add this condition to the previous counterexample’s argument-free `sponsor_unconditionally()`:

   ```text
   require immediate caller == account A
   set this FPC as fee payer
   end setup
   enqueue the previously authorized token transfer from A
   ```

   Give the contract no alternative entrypoint that triggers the transfer. An attacker’s own transaction cannot satisfy the caller check. Choosing this FPC causes **A’s authenticated account execution** to call it, satisfying the condition and enabling the charge.

   This fits the existing path: `DefaultSponsoredFpcHandler` accepts the signature, supplies that call, and omits `hideSender`; `tx-request-builder.ts:newCallFunctionCall` therefore preserves caller identity. The token authorization itself need not depend on transaction sender—the FPC’s additional check does.

   This remains an authorized reimbursement, not unauthorized theft. It nevertheless defeats the assertion that choosing the fee method cannot enable or trigger the debit. The network-fee-payer argument remains correct. Take this narrower counterexample to the owner; restrict guaranteed-free wording to verified sponsorship unless the owner explicitly decides that the wording excludes reimbursement.

The collision sentence is corrected. I found no additional material problem in the revised resolver plan, inline icons, U14/U15 drawing source, or enlarged network gate.

## Round 3 · adopt / reject

| # | Finding | Call | What changed in the plan |
|---|---|---|---|
| 1 | Selectable is not payable | adopt | `settingsForMethod()`'s refusal to self-pay with unknown balances and the card's retry behaviour are named as preserved |
| 2 | A caller-restricted FPC makes the choice itself enable the debit | adopt | Conceded: the account's own entrypoint is the caller, so only picking the contract satisfies the check. "free" and "Nothing" are promised only for `isProtocol` sponsors; a hand-added one shows "—" in the menu and the line, spoken "Nulo can't tell what this fee contract charges you." Drawn for the owner as U16 (recommended `U16A`), sign-off pending; artifact Version 8 |

## Round 4 · prompt summary

Reported the condition applied: `buildFeeMethods` says "free" only for `fpc.isProtocol === true`,
`FeeCostReadout` takes `payer: "self" | "sponsor" | "unvouched"`, `FeeMethodOption.fpc` gains
`isProtocol`, the U16 drawing is published and the owner notified, and P3's tests cover protocol
against hand-added in the menu, the readout and the card.

## Round 4 · response

**approve.** Confidence: high.

The protocol-only “free”/“Nothing” guarantee, explicit unvouched state, U16 drawing, and tests resolve the remaining condition. Unknown-balance payment guards remain unchanged.

No new material findings. This approves the implementation plan; owner picks, implementation validation, and parity gates remain as recorded.
