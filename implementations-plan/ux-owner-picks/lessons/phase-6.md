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
