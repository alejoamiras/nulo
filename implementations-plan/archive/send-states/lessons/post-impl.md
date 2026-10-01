# Post-implementation · the codex fix loop

`/codex high` (GPT-6 Astra) on the `alejo-icloud` account, read-only, one session resumed each
round. The prompt carries the plan's two rules verbatim, the adversarial ask and the out-of-scope
list (copy, F-1 and F-2, anything outside `git diff 4387b112 HEAD`).

## Round 1 · session `01a0ef44-7aef-7e71-83c8-6c28d0096323`, on `819874ef`

Verdict: **changes-requested**, three findings, each checked against the code.

1. *Medium, `FeeSettingsCard.vue`, the verdict watch.* Dropping the sponsor hides `FeePriorityRow`,
   which renders only with a payer (`v-if="effectiveMethod && !feeJuiceMissing"`), so on a card
   with no other payer a person who raised the priority cannot lower it again in place. **True in
   the code; not fixed.** The priority is not stored (`selectedPriority` starts at "normal" on every
   mount), and it bites only when the sponsor's balance sits between the "normal" and the raised
   fee limit (multipliers 2, 3 and 5 on base fees), a band a few fees wide; reopening the card
   starts at "normal". Showing the priority row without a payer is a UI change outside the UI
   impact table. The Decision ledger's "urgent" line now says so.
2. *Medium, `FeeSettingsCard.vue`, `onFpcUpdated`.* A rename emits `onFpcUpdated` too (`updateFpc`,
   `fpc/service.ts:309-321`), so it clears a short verdict meant for address edits, and the row is
   enabled again for the same transaction. **True; behaviour kept, comment fixed.** A pick of that
   row re-estimates and reads the balance again, so nothing sends on a short sponsor, and a rename
   needs Settings open in another extension page beside the card (the edit popup lives in the
   popup's Settings). The comment now says a rename clears it too. Ledger line added.
3. *Medium, `sponsor-funding.ts`, the comparison.* The node adds a setup-phase Fee Juice claim to
   the payer's balance (plan Fact 23), which the probe leaves out, so a hand-added
   `sponsor_unconditionally` contract that claims bridged Fee Juice to itself would read short
   while the node would admit it; the header's "claims nothing to the sponsor" is broader than
   what Nulo controls. **True; comparison kept, header fixed.** Nulo calls
   `sponsor_unconditionally` with no arguments, so such a contract would need claim secrets of its
   own, no known sponsor works that way, and the error only ever disables a payer. The header now
   names the claim term, why Nulo's own transactions leave it out, and the shape that reads short.
   Ledger line added.

Fixes: `660a0ac4` (the two comments). Gates after it: see round 2.

## Round 2 · the same session, on `c41852a8`

Verdict: **changes-requested**, one finding: finding 2 is material after all. The execute window's
`approve()` checks neither `estimatingOps` nor any pending estimate, and `handleFeeUpdate` hands
the new settings on at once, so a person who renames the sponsor in Settings, comes back and picks
its re-enabled row can approve before the new estimate lands; the background then proves and sends
on a payer already read as short, and the node refuses it. Checked in
`apps/extension/src/popup/windows/execute/index.vue` (`handleFeeUpdate`, `approve`): true. Findings
1 and 3 were not raised again.

**Accepted.** The fix is what the plan's § S1 card already specifies, an address edit clearing the
id: `onFpcUpdated` compares the row's address before the edit with the new one
(`sameFieldAddress`) and clears the short id only when they differ. Red first, the new case
"short, then renamed: the verdict still holds for the same transaction" in
`FeeSettingsCard.test.ts`, added on `c41852a8` before the fix:
`bun --bun vitest run src/popup/components/modules/send/FeeSettingsCard.test.ts -t "renamed"` from
`apps/extension` → exit 1, `expected 'false' to be 'true'` on the row's `data-disabled` after the
rename. After the fix, the whole file: 115 of 115 passed. The Decision ledger's rename line is gone.

Fix: `38b8f796`.

## Round 3 · the same session, on `1a785b08`

Asked to re-review the fix (a row the card does not list yet, an address in another spelling) and
anything else in `git diff 4387b112 HEAD`. Verdict: **approve**, "No new findings." The loop
converged in three rounds: two changes-requested, then approve.

## Round 4 · the same session, on `1284f741`

Asked to review `git diff 591973f6 HEAD`: the panel's copy change (`99635341`), whether the docs
state the code truly at the lines they cite, and anything else in `git diff 4387b112 HEAD` still
material. Verdict: **changes-requested**, three low findings, all in the docs, each checked:

1. *Low, `follow-ups.md`, the re-enabled row.* "A pick re-estimates and checks it first, so nothing
   sends on it" is false. A pick hands on fee settings at once, and neither Send's Confirm
   (`send.vue:755`, disabled only by `!isAllowedToSend || isSending`) nor the execute window's
   Approve waits for the estimate. **True; reworded.** The entry now points at the Confirm race,
   whose entry now covers a row picked again after a change, not only a first estimate.
2. *Low, `plan.md` § Decided while the owner was away.* "With no fee juice every row of the menu
   is disabled" overstates it: `sponsorOption` disables only short ids, so a sponsor added by hand
   stays enabled. **True; qualified.** The copy call stands, since "Select method" asks for the
   pick either way.
3. *Low, `plan.md` § Outcome.* The gates line cited a section of `lessons/phase-5.md` that did not
   exist yet. **True; written:** § The final gate after the panel, and the Outcome now summarizes
   it.

No code changed.

## Round 5 · the same session, on `bfa5b44e`

Asked to re-review the three doc fixes (`git diff 1284f741 HEAD`), and anything else in
`git diff 591973f6 HEAD` still material. Verdict: **approve**, "No new findings." After the
panel's change the loop converged in two rounds: changes-requested, then approve.
