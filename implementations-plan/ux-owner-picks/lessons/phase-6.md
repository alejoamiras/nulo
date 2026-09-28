# Codex fix loop

One codex session (GPT-6 Astra, high, account `alejo-icloud`) over the whole diff against the base
`b172f0ca`, with the plan's adversarial ask, the parity rule and the two verbatim rules. The C7
deviation and the callers scan were flagged for extra care. It ran once P5's local gates were
green, before the browser runs, so the e2e battery and the captures run once, on reviewed code.

Session `01a0ea16-9c46-7c92-8ec6-cbb8efaccd88`.

## Round 1 (HEAD `8e864ead`): request changes, 4 findings, all accepted

Each was checked against the code before it was accepted.

1. **Major**, `FeeSettingsCard.vue` `onFpcUpdated`: outside Send, a card that chose Nulo's sponsor
   unasked kept it after its address was edited in another window (`updateFpcAddress` is allowed
   on protocol rows and emits the row decorated `isProtocol: false`), so a custom sponsor paid
   without a pick. Send re-derives its payer from the edit and was already right. Fixed: the card
   records whether its selection is its own default (`chosenUnasked`, set by the reconcile, cleared
   by a pick or a lock) and drops a default whose row stops being the protocol's; a saved or live
   pick still follows the edit. Red first: `expected { Object (paymentMethod) } to deeply equal
   undefined` for the unasked case, the saved-pick case green. Commit `b5eb7c81`.
2. **Minor**, `amount.callers.test.ts`: an options variable, a quoted key or `{ compact: false }`
   counted as a plain call. Fixed: a call is read by its top-level arguments; three or fewer is
   plain, a fourth that is exactly `{ compact: true }` is compact, anything else throws. Red first:
   the three forms did not throw. Kept textual (the header says a parenthesis inside a string or
   comment within the arguments defeats it); a TypeScript parse would miss template calls in
   `.vue` files. Commit `d0e2ecd0`.
3. **Minor**, `plan.md` P2 step 4: it still described C7 as a held, cold-open test. Fixed: an
   "As built" line says the block pins chain-id-0 naming, and the identity race lives in
   `activity.test.ts`.
4. **Nit**, `incoming-public-transfers.test.ts`: the header touched in P2 kept a plan path, a phase
   and design-item tags. Fixed in the header and one body comment; the log strings are untouched.
   Commit `a442d5aa`.

## Round 2 (HEAD `e3942dde`): request changes, 2 new findings on the round 1 fix, both accepted

1. **Major**, `FeeSettingsCard.vue`: outside Send the address edit cleared the selection but never
   reached the card's FPC list, so when a failed gas read recovered, the recommit ran the default
   over the store's stale list and re-selected the old protocol row, whose id now names the custom
   contract. Fixed: `onFpcUpdated` records the edit in `fpcEdits` for every origin, as Send
   already did. Red first: after the recovery the card emitted `{ kind: "fpc", fpcId: "s1" }`.
2. **Minor**, `FeeSettingsCard.vue`: `chosenUnasked` survived an account switch, so an edit that
   landed while the next account loaded dropped that account's saved pick, and the reconcile then
   took the drop for a user pick. Fixed: a saved or locked prefill clears the mark. Red first: the
   card emitted nothing where the saved pick was due.

Both in commit `2d0b5e88`. Deletions outside Send are left as they were: a deleted row is never a
default (protocol rows cannot be deleted), so the default rule does not reach them.

## The merge of dev

The coordinator asked for `origin/dev` (`0fa5a2cb`) to be merged after round 2: merge commit
`9454664e`. `implementations-plan/index.md` conflicted (dev closed ux-feedback's line); dev's line
stays with this plan's under it. The five `ux-owner-picks` entries in `follow-ups.md` § "ux-feedback:
taken by a follow-up plan" are deleted in the merge: D1 to D5 resolve each. `fee-helpers.ts`
merged cleanly; dev's change there is `FEE_JUICE_BRIDGE_URL`'s default, which the sponsor default
does not read (the get-gas nudge's conditions are unchanged).
