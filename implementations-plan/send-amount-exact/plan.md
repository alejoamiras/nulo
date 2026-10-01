---
plan: send-amount-exact
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: none (the PR body and the owner's three questions carry it; the owner asked to keep credits low)
branch: fix/send-amount-exact
worktree: a harness-created agent worktree (lessons/phase-0.md records it)
base: dev @ a7b1ff62 (fast-forwarded from f51ec001 before the first commit; #717 edits none of the files this plan edits)
---

## Outcome

- **Date:** 2026-09-30. **Status:** delivered on `fix/send-amount-exact` on 2026-09-29, rebuilt
  that day for the owner's answers, then finished for the two decisions the owner delegated
  (§ Phase 0), which the owner confirmed on 2026-09-30 with the as-built captures. Nothing it
  waits on is open.
- **Shipped:** V, B, M and C. The validator drops every comma only from a whole part grouped in
  threes (`send-amount.ts`); leaving the amount field rests it through `restingAmount`
  (`components/composite/send/amount-field.ts`), grouped, every digit kept; token-mode Max writes
  the raw balance, and nothing without it; the balance beside Max is the raw balance cut at 8
  places; the fee estimate row gains `data-testid="fee-estimate"`. Then the owner's answers: a
  paste keeps only its digits and the point before the clamp (F-1); the token field at rest
  shrinks until the whole amount fits, with no floor, and is back at 40 px with focus (A-3); the
  review sheet's amount line shrinks to fit, down to 60%, then wraps (A-1). Both fits are #718's,
  moved to `src/utils/` (`hero-fit.ts`, and `hero-ruler.ts`, which gains `inputRoom`); `comma` is
  deleted (F-3). Then the delegated calls: the unit switch's label sits on the amount's baseline
  and its box fills the row's 53 px (A-4, option 2), and Max leaves the amount at rest, grouped
  and fitted, without taking the focus. P13 added two fixes: Refresh quote converts at the new
  quote instead of putting the old one back (the fourth codex round), and a wrapping review line
  keeps its symbol whole (the captures), both taken by the as-built panel. P0 to P13 as planned,
  plus the code review's commits and one for the declarations P9 left unbuilt.
- **Gates at delivery:** on `4d106e6c`, with `dev` at `4387b112` merged in (the docs commit after
  it changes no code): lint, `typecheck:all`, `test:all`, `test:ci-gating`, `build`,
  `build-storybook` and the plans gate exit 0; smoke green at retry 0 in two shards per browser,
  Chrome 159 passed and 7 skipped of 166, Firefox 155 and 11, every skip the suite's own;
  `fiat-send`, `send-amount-exact` and `send-amount-clamp` green at retry 0 on both browsers.
  Red first: P1 in Chrome; P2, P3, P6, P9 and P10 in vitest; P7 in Chrome and Firefox; P12 in
  Chrome and vitest; P13's refresh fix in vitest and its symbol fix in a Chrome capture. Codex, at
  confidence high: conditional approve, then approve, on the first delivery
  (`lessons/phase-4.md`); approve on the rebuild (`lessons/phase-11.md`); conditional approve on
  the delegated calls, its condition fixed (`lessons/phase-13.md`). Then round 5, for the as-built
  panel: approve, no new material finding (§ Code review ledger). Captures in
  `lessons/phase-11.md` and `lessons/phase-13.md`.
- **Dropped:** the input cap (A-2), declined by the owner as unrealistic. Residual: an amount the
  cap jumped to can now be sent.
- **Open items:** F-2 and F-4 to F-10 are in `follow-ups.md` § Send amounts. The lesson is in
  `lessons.md` § CI & gates, and the `e2e-testing` skill's hazards gained `e2e:agent`'s own.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# Send amounts kept exact

The Send page refuses every typed amount of 1,000,000 or more once the amount field has been
left, and says nothing; and leaving the field rewrites what the person typed. The two bugs hide
each other: once the refusal is fixed, the rewritten amount is what would be sent. Two more copies
of the float come out of the same code: token-mode Max fills a float copy of the balance, and the
balance beside it shows float digits. This plan makes all four exact, as one PR off `dev`:

- **V** · the validator removes only the first comma (`send-amount.ts:51`), so the field's own
  resting form of a million or more, "1,000,000", reads as invalid.
- **B** · leaving the field regroups the amount through `Number.parseFloat` and `toFixed`, capped
  at 8 places (`AmountCard.vue:96-107`, `utils/amount.ts:11-39`).
- **M** · token-mode Max writes `tokenBalanceByType`, a float (`AmountCard.vue:272-279`,
  `send.vue:130-135`).
- **C** · the balance corner formats that float (`AmountCard.vue:152-155`).

Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner answered three questions on 2026-09-29, quoted here
verbatim; they are this plan's UI sign-off, for exactly the after-states in § UI impact.

1. Answering "Fix the Send amount field now: large amounts (1,000,000 or more) become sendable,
   and the field keeps exactly what you typed after you leave it (still grouped, no rounding, no
   8-decimal cap)?": **"Fix now, own PR (Recommended)"**.
2. Answering "In token mode, Send's Max fills a float copy of your balance. On dev, a balance of
   1.123456789012345678 fills 1.1234567890123457, which is more than you hold, so Confirm stays
   off. Dust of 0.0000001 fills "1e-7", which is refused, and the planned exact blur would remove
   the accident that rescues it today. Make Max fill your exact balance, in the send-amount-exact
   PR?": **"Yes, same PR (Recommended)"**. The option read: "Max always fills and sends exactly
   what you hold, every decimal, grouped when you leave the field. Balances of 15 or fewer
   significant digits look the same as today."
3. Answering "The balance beside Max shows float digits: 124,457,554.4 TST reads
   "124,457,554.40000001", and 1.123456789012345678 reads "1.12345679", rounded up past what you
   hold. How should it read?": **"Exact, cut at 8 places (Recommended)"**. The option read:
   ""124,457,554.4 TST" and "1.12345678 TST": every digit true, never more than you hold, no
   wider than today."

Two notes on these answers, both passed to the owner by the driver on 2026-09-29:

- The option text of answer 2 overstates one thing: the page's float is not exact for every
  balance of 15 or fewer significant digits (1.00000000000012 fills "1.0000000000001201" on dev,
  measured). Such a balance now fills its exact digits, which is the after-state the answer chose.
- The balance beside Max is one element in both modes, so answer 3 covers fiat mode's corner too.

A fourth question, on the input cap (Ask A-2), was declined; the answer is quoted in the audit
ledger. With it the owner set the triage rule for this work, relayed by the driver: realistic
scenarios only. A finding is fixed when a real person could type, paste or hold its input, and any
money path that can send a wrong amount counts as realistic, a paste included; an unrealistic case
gets one line in the ledger, not a fix, a test or an owner question.

### The owner's answers to the post-build asks

The owner answered on the sign-off page (its `answers` db, 2026-09-29 UTC) and wrote in chat:
"Regarding send-amount-exact, I've answered on the document." Relayed by the driver, each answer
with the option it chose:

- `review` (Ask A-1), 14:36: **"fit"**. "Shrink to fit, then wrap: the review sheet's amount line
  shrinks until every digit fits, down to 60%, then wraps to a second line."
- `field` (Ask A-3), 14:37: **"every"**. "Shrink until every digit shows: once the field is left,
  its type shrinks until the whole amount fits, with no 60% floor. 1.123456789012345678 draws at
  about 58% and the million-plus Max at about 43%. While typing, the field scrolls as today."
- `paste` (F-1), 14:37: **"fix"**. "The field keeps only digits and the point, as it does for
  typing (clamp the purged value, not the typed text). So "1.234,5678901" on a 6-decimal token
  reads "1.234567" at once and sends exactly that."
- `rest`, 14:37: **"signed"**. "The four built fixes stand as built."

They sign UI impact rows 5 to 7, and `rest` keeps rows 1 to 4 as built. The driver set the
order: F-1 now, red first;
A-1 and A-3 reuse the hero fit of `feat/ux-owner-picks` (#718), `hero-fit.ts` and
`hero-ruler.ts`, never a copy, once #718 has merged into `dev` and `dev` is merged in here.
AmountCard is L3 and cannot import L4, so the fit and the ruler move down a layer in a refactor
commit of their own, with BalanceView's tests green.

Once #718 had merged, the driver added: "The `comma` follow-up (F-3) is now unblocked too, since
#718 rewrote amount.ts: delete it in this PR only if it stays within the plan's scope; otherwise
leave the follow-up." It does: `comma`'s last two callers are the ones B and C replaced, deleting
it changes no behaviour and nothing drawn, and this plan regenerates the auto-import declarations
for the move anyway.

- **Scope**: V, B, M and C above; then F-1, A-3 and A-1, as the owner answered them; and F-3.
- **Out**: new copy (an invalid amount keeps today's silent refusal); the 9,999,999,999,999 input
  cap (A-2, declined); the input's rewriting of an exponent or a comma-decimal (F-2); fiat mode's
  field and Max, already exact, and the fiat field's layout; anything else in the `ux-owner-picks`
  plan: this plan moves its fit and ruler, and deletes `comma` from `utils/amount.ts`, nothing
  else there.
- **Constraints**: pre-production, no migrations; no dependency change and no `@aztec/*` bump;
  complexity budgets hold with no new acceptance; existing testids verbatim.
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: lint, typecheck, unit and component tests, CI-gating scripts, build,
  Storybook build (a story's args change); smoke e2e on Chrome and Firefox (AmountCard is a popup
  surface); one new network spec on Chrome and Firefox, red on the unfixed code, then three
  retry-0 runs per browser; the two other network specs that read AmountCard's field or corner,
  once per browser.
- **Decisions**: UI and product questions go to the owner through the driver; technical ones are
  decided with `/codex high` and logged in `lessons/`.
- **Delivery**: single arc, one PR off `dev`, which the driver opens.

### The decisions the owner delegated

On 2026-09-29 the owner delegated the open decision pages, verbatim: "any chance your resolve
auditing with Codex and Opus5.5 subagents the open artifacts? Ask those subagents to be evaluators
on the ux/ui/copies. Use your knowledge about my previous decisions too." The driver convened a
panel, two Opus 5.5 evaluators (one on the interaction, one on the copy and the visuals) and a
Codex session, and relayed its calls, verbatim:

1. "**A-4 → option 2** (unanimous: the switch on the amount's baseline). Build it on
   `fix/send-amount-exact`: the baseline alignment as on `capture/send-amount-exact-a4-2`, plus a
   full-height (53 px) invisible hit area for the switch that stays inside the amount row, never
   covers Max, and never takes a click meant for the amount field. The look stays exactly as
   pictured. Tests: a click at the row's top edge over the switch still toggles it; a click on the
   field still focuses it."
2. "**Built → signed** (unanimous), with one fix folded in: pressing Max must not leave the field
   focused (the click bubbles to the card's `handleFocus`), so right after Max the amount rests
   grouped and fitted, every digit visible, as the owner picked. Red first. If it turns out bigger
   than a small handler change, stop and report instead."

Not adopted: the Codex evaluator's copy edits ("Extra decimals removed…", "Review transaction"),
outside this PR's scope; the switch and Max being mouse-only spans is a follow-up line (F-5). The
round-two decision page carries a "decided while you were away" box with both calls. They sign UI
impact rows 3 and 6 as amended, and clear P12 and P13.

On 2026-09-30 an as-built panel, under the same delegation, took the two nods P13 raised, relayed
by the driver: n1, Refresh quote converting at the new quote (`f3de30dc`), **taken, unanimous**,
both Opus evaluators at high confidence, and Codex's round 5 in this plan's review session
(`01a0eb09-0547-7610-b15e-ba1f8557c586`) approved the code with no new finding; n2, a wrapping
review line keeping its symbol whole (`4d106e6c`), **taken, unanimous**. Both evaluators signed the
as-built captures: the build matches option 2 (one evaluator's pixel diff of the amount row
against the capture branch's frames: 1 px in Chrome, 0 in Firefox) and the Max decision. They sign
UI impact row 5 as amended and the Refresh quote fix.

**The owner's sign-off, 2026-09-30.** On the round-two decision page
(https://claude.ai/artifact/CKsQddaKwuWZdYkRGAYF2u, its `answers` db) the owner answered
`toggle`: **"baseline"** (A-4, option 2) and `built`: **"built"** (Max at rest), then wrote:
"Okei, ive answered everything on the artifacts." The page's as-built section was left
unanswered, so the driver asked in chat: "After Max nothing is focused and the amount rests
grouped and shrunk to fit. A review line too long even at 60% wraps before "TST" instead of
splitting it into "T" / "ST". Refresh quote converts at the new price (no layout change). Sign
off?" The owner picked **"Looks right"** (the option read: signs off the as-built captures, Max at
rest, TST kept whole on a wrap, the Refresh quote fix). UI impact rows 3, 5 and 6 as amended and the
Refresh quote fix now carry the owner's own answers.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 0 | Every fix reuses an exact function already in the tree (`parseAmountToBaseUnits`, `formatBaseUnits`, `writeModelFromRaw`) |
| Blast radius | 1 | One component with one consumer (`send.vue`), one page helper, one testid |
| Irreversibility | 0 | Code and tests only; nothing persisted changes |
| Migration cost | 0 | Pre-production: nothing to migrate |
| External coupling | 0 | No wire, dApp or service change |
| Security sensitivity | 3 | The amount a person sends |

`light`: two functions and their tests, on known patterns; the one high dimension is what the
single `/codex high` audit is pointed at.

## Outcome & Quality Bar

For whom: a person sending a large amount, an amount with many decimals, or everything they hold
with Max, who reads the field and then presses Confirm.

Excellent means:

1. **What the field shows is what is sent.** After leaving the field, a typed or Max-filled
   amount shows every digit, the whole part grouped, and the send uses exactly those base units;
   nothing the field shows at rest is read as a different amount. One table test drives each case
   through AmountCard's real input handler and blur, then the real validator, and states the exact
   base units or the refusal; one page test proves the review sheet and the submitted amount agree.
2. **Any amount the balance covers can be sent.** An amount of 1,000,000 or more estimates and
   turns Confirm on, proven in Chrome and Firefox by a spec that is red on the unfixed code.
3. **Max sends exactly the reported balance, and the corner never shows more than it.** Max fills
   the raw balance, every decimal; the corner truncates at 8 places, never rounding up.
4. **A paste reads as typing does.** A paste past the token's decimals keeps only its digits and
   the point before the clamp, so what the field shows at once is what is sent (F-1).
5. **Every digit of the amount is on screen before it is sent.** The field at rest and the review
   sheet's amount line both show the whole amount, proven in Chrome and Firefox by assertions that
   are red on the code before the fit.

Good enough: an invalid amount still turns Confirm off with no message (no new copy); an exponent
or a comma-decimal is still rewritten by the input as it is typed (F-2); while the field has
focus, a long amount scrolls inside it as today.

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | The amount field, after leaving it | A typed amount is rounded to at most 8 places, sometimes upward, with float drift from about 16 significant digits: "1.123456789" → "1.12345679", "999.999999999" → "1,000", "12345678901.123456" → "12,345,678,901.123455" → every digit kept, the whole part grouped: "1.123456789", "999.999999999", "12,345,678,901.123456". Unchanged: trailing zeros and a trailing "." dropped, leading zeros dropped, ".5" shown as "0.5"; a value holding a comma is left as it is. Also kept as typed now: a value that is not a plain decimal, which only a paste past the token's decimals can leave in the field ("12ab.123456" on a 6-decimal token): dev turned it into its leading number ("12"), which it then sent, or into "NaN" | Owner answer 1 |
| 2 | The Send page with 1,000,000 or more typed, after leaving the field | The fee stays "Fee estimated after simulation", Confirm stays off, no message → the fee is estimated and Confirm turns on | Owner answer 1 |
| 3 | Max, token mode | Fills a float copy: 1.123456789012345678 → "1.1234567890123457" (more than held, Confirm off); dust 0.0000001 → "1e-7" (refused); 99.876543210987654321 → "99.87654321098765", and after leaving the field "99.87654321"; 1.00000000000012 → "1.0000000000001201" → the exact balance, every decimal, at rest at once: grouped and fitted, the field not focused (a click on Max used to focus it, showing the plain form at 40 px until it was left). A balance the float carried exactly looks the same as today. In fiat mode Max no longer focuses the USD field either | Owner answer 2; delegated decision 2, the owner's `built` (2026-09-30) |
| 4 | The balance beside Max, in both modes (one element) | Float digits cut at 8 places, rounding up: "124,457,554.40000001 TST", "1.12345679 TST", "0.12345679 TST" for 0.123456789 → exact digits truncated at 8 places: "124,457,554.4 TST", "1.12345678 TST", "0.12345678 TST". Unchanged: a balance below 0.00000001 reads "0 TST"; hidden while the selected side's balance is zero or loading | Owner answer 3 |
| 5 | The review sheet's amount line | Shows the field's string (`send.vue:287`, unchanged rule), so it now shows the digits of rows 1 and 3: up to 13 whole digits and 18 decimals, and at 30 px with no wrap rule the popup clips a long one (P5: Max's "1,235,567.123456789012345678" loses its last six digits and the symbol) → the line's type shrinks until the amount and its symbol fit on one line, down to 60% (18 px); below that it stays at 60% and wraps onto a second line, breaking before the symbol, never inside it (P13). The symbol keeps its 11 px. An amount that fits at 30 px is drawn as today | Owner answer `review` ("fit"); the whole symbol, the as-built panel's n2 and the owner's "Looks right" (2026-09-30) |
| 6 | The amount field at rest, token mode | Once the field is left, an amount wider than it scrolls: Chrome shows its head, Firefox its tail ("1.123456789012345678" rests as "89012345678", P5) → the type shrinks until the whole amount fits the field, with no floor: 1.123456789012345678 draws at about 58% and the million-plus Max at about 43% (P11: 57% and 42% beside the unit toggle, 73% and 54% where no price shows it). The field's line keeps the full size's height, so nothing below it moves. With focus the field is back at 40 px and scrolls as today. An amount that fits at 40 px is drawn as today. The unit toggle's label sits on the amount's baseline at every size, where dev drew it at the top of the 40 px line, and its press target fills the row's 53 px beside the field | Owner answer `field` ("every"); A-4 option 2, delegated decision 1 and the owner's `toggle` "baseline" (2026-09-30) |
| 7 | A paste into the amount field past the token's decimals | The clamp cuts the pasted text, so its other characters stay: "1.234,5678901" on a 6-decimal token reads "1.234,56" and sends 1.23456; "12ab.1234567" reads "12ab.123456" and is refused → the field keeps only digits and the point, then clamps: "1.234567", sent exactly, and "12.123456". The clamp hint shows when decimals were cut, as today. Row 1's "kept as typed" case is no longer reachable from the field | Owner answer `paste` ("fix") |

Nothing else a user sees changes but one fix the code review found, taken by the as-built panel
(n1, § Phase 0): Refresh quote, in fiat mode once the price has moved, put the old quote back, so
the notice stayed, the amount stayed derived at the old quote and Confirm stayed off; it now
re-freezes at the current quote and re-derives, as its code and its test always said (§ Code review
ledger, round 4). The fee readout's estimate row and the amount row gain a `data-testid` and
nothing drawn; fiat mode's own field keeps its type and layout.

## Architecture & Implementation

**Where the code goes.** One new pure helper, `restingAmount(value, decimals)`, in
`apps/extension/src/components/composite/send/amount-field.ts` with its test beside it, next to
AmountCard as `publish-facts.ts` and `masked-address.ts` already are. Not in `utils/amount.ts`
(`feat/ux-owner-picks` rewrites it) and so not auto-imported (the auto-import dirs are
`src/composables/`, `src/stores/`, `src/utils/`), which keeps the generated declarations out of the
diff.

**The resting form.** It composes two exact functions that already exist:
`parseAmountToBaseUnits` (`utils/amount.ts:158-179`, the validator's parser) and `formatBaseUnits`
(`:238-278`, with `thousandsSep: ","` and `decimalSep: "."` passed explicitly, as
`derivedTokenLabel` does at `AmountCard.vue:161`).

```ts
export function restingAmount(value: string, decimals: number): string {
	try {
		return formatBaseUnits(parseAmountToBaseUnits(value.trim(), decimals), decimals, { thousandsSep: ",", decimalSep: "." })
	} catch {
		return value
	}
}
```

Anything that is not a plain decimal the token can hold comes back unchanged: letters, a sign, an
exponent, a second ".", more decimals than the token has, and any comma. The comma case makes a
second blur a no-op (its own grouped output does not parse), and leaves a paste the decimals clamp
kept verbatim exactly as dev leaves it. `formatBaseUnits` drops trailing zeros and the ".", strips
leading zeros and renders ".5" as "0.5", so the rules that keep the value (UI impact row 1) come
for free.

**The validator reads grouping, not stray commas.** Removing every comma would also accept a
malformed paste dev refuses: "1.234,5,678901" on a 6-decimal token reaches the model as
"1.234,5," (the clamp keeps the raw text), which every-comma removal reads as 1.2345 (codex
round 1, reproduced). So only a whole part grouped in threes loses all its commas; any other
string keeps today's reading, the first comma dropped:

```ts
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/
const trimmed = GROUPED.test(raw) ? raw.replaceAll(",", "") : raw.replace(",", "")
```

The newly accepted set is exactly the grouped strings with two or more commas, which is what the
field rests at for a million or more. Everything dev accepted, it still accepts the same way.

**Changes, file by file.**

| File | Change |
|---|---|
| `apps/extension/src/popup/pages/send-amount.ts:51` | the grouped-or-first-comma rule above, one sentence of comment on why a stray comma is not stripped |
| `apps/extension/src/components/composite/send/amount-field.ts` (new) | `restingAmount`, one TSDoc sentence: a plain decimal comes back grouped with every digit, anything else as typed, so the validator sees what it saw before |
| `apps/extension/src/components/composite/send/AmountCard.vue` | **Blur**: `if (!model.value \|\| tokenDecimals.value === undefined) return`, then `model.value = restingAmount(String(model.value), tokenDecimals.value)`; the comma early return (`:100`), the 8-place cap and its stale comment (`:102-105`) go. **Token-mode Max**: after the fiat branch, `if (props.balanceRawByType == null \|\| tokenDecimals.value === undefined) return`, then `writeModelFromRaw(BigInt(props.balanceRawByType))`, the fiat path's guard and writer (`:164-168`, `:285`). **Corner**: `formatBaseUnits(props.balanceRawByType, tokenDecimals.value, { maxDecimals: 8, thousandsSep: ",", decimalSep: "." })`, keeping today's hide rule and returning `null` also when the raw balance or the decimals are missing. **Prop TSDoc** (`:12-14`) says the float path stays for token mode; it becomes the prop's units and nullability. The `comma` import goes |
| `apps/extension/src/popup/components/modules/send/FeeCostReadout.vue:29` | `data-testid="fee-estimate"` on the landed-estimate row |
| `apps/extension/src/components/composite/send/AmountCard.stories.ts` | the default args gain `decimals: 6` on the token and `balanceRawByType: "1000000000"`, so the story keeps its corner |
| tests | `send-amount.test.ts`, `amount-field.test.ts` (new), `AmountCard.test.ts`, `send.test.ts` (one test, placed away from `feat/ux-owner-picks`' hunks), `tests/e2e/network/send-amount-exact.test.ts` (new), per the phases |

**Critical flow.** Typed or pasted text → `handleAmountInput` (unchanged) → the model → blur →
`restingAmount` (the same base units, grouped) → `validateSendAmount` (grouping commas removed) →
`integerized` → the estimate and the submit (`send.vue:484`, `:405`). Max → `writeModelFromRaw`
(plain, exact) → the same path.

**Why the missing-raw guards change nothing visible.** `tokenBalanceByType` and `balanceRaw` both
come from `tokenBalance` (`send.vue:127-135`, `:199-202`): when the row is missing the float is `0`
and Max and the corner are already off. Undefined decimals make the float `NaN`, which is falsy,
so the input is disabled (`AmountCard.vue:316`) and cannot be focused or left. The guards stop
`formatBaseUnits` from throwing on a mount that does not come from the page.

**Alternatives not taken.**

- *Remove every comma in the validator.* It accepts malformed pastes dev refuses (above).
- *Remove every comma in the helper too.* It would regroup a paste the decimals clamp kept
  verbatim, so "1.234,56" would rest as "1.23456": a visible rewrite of what was typed that the
  sign-off does not cover. F-1 holds that case.
- *A string-only regrouper* (a regex over the typed text, no decimals needed). It works, but its
  value preservation rests on an argument; the round trip proves it by construction, reuses the
  formatter every balance goes through, and refuses exactly what the parser refuses.
- *`modelRaw` as the parser* (`AmountCard.vue:119-128`). It runs `purgeNumber`, which drops any
  non-digit ("ab12.5" reads 12.5), and slices a long fraction without a word: display-grade.
- *Keep the float for Max and make only typed strings exact.* It would keep dev's accidental
  rescue of dust, and keep a float in a value that is sent. The owner chose exact Max (answer 2).

### The rebuild: F-1, A-3 and A-1

**F-1, the paste.** `handleAmountInput` clamps `purgedAmount` instead of the typed text, and the
hint compares the clamp with `purgedAmount`. Nothing else in the handler moves: the first-"0" rule
and `normalizeAmount` run as before, and the "0" pin (`AmountCard.test.ts`) still holds, since a
lone "0" is its own purge. Only digits and "." now reach the model from the keyboard or the
clipboard, so the validator's stray-comma reading stays only as a guard.

**The fit moves down a layer.** `hero-fit.ts` and `hero-ruler.ts` move, as they are, from
`popup/components/modules/general/` (L4) to `src/utils/`, where every util of the app lives (flat,
auto-imported; the generated `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` gain
their exports in the same commit). BalanceView imports them from there, its test mocks
`@/utils/hero-ruler`, and `utils/amount.callers.test.ts` renames its key. A C0 composable was not
chosen: neither file holds reactive state.

**A-3, the field at rest.** One `fieldScale` ref drives `--hero-scale` on the token input, whose
type becomes `calc(40px * var(--hero-scale, 1))`. A hidden ruler beside the input holds the model
in the same type, and the fit is `fitHero(1, (_, scale) => rulerWidth(ruler, scale), room)`: with
one form its floor is 1%, so the owner's "no floor" needs no new rule. `room` is the input's box
less its padding and border (`inputRoom`, a new function beside `rulerWidth`), since an input's
text lives inside its padding. The fit runs after each render that changes the model, on leaving
the field, when the fiat toggle appears or goes (it takes width from the field) and on
`document.fonts` `loadingdone`; with focus the scale is 1. The input and the ruler move into a
wrapper that takes the input's flex place and ends in a zero-width inline strut in the full type,
with the input's own vertical padding, so the line keeps the full size's height and baseline while
the type shrinks, and the unit toggle beside it stays put. Fiat mode's input keeps 40 px.

**A-1, the review sheet.** The same fit over a ruler copy of the amount line (the amount and its
`<small>` symbol), with `heroRoom` of the summary block as the room; the drawn scale is
`max(fit, HERO_MIN_SCALE)`, and the line gets `overflow-wrap: anywhere`, which breaks only a line
that does not fit, so it wraps exactly when the fit is below 60%. The sheet's content mounts with
the popup, so the fit watches the summary's template ref as well as the amount and the symbol.

**Alternatives not taken (rebuild).**

- *Scroll the field back to its start on leaving it* (this plan's first recommendation for A-3):
  the owner chose "every" on the sign-off page; likewise "fit" over a plain wrap for A-1.
- *Let the input's height follow its type*: at 43% the field's line drops about 29 px, and the
  page below it jumps on every blur.
- *`transform: scale()` on the input*: exactly linear, but the ruler measures font sizes and the
  two would disagree by a pixel at some scales; it also leaves the layout box at full width.
- *A copy of the fit in `components/composite/`*: the driver's rule is reuse, never a copy.

| File | Change |
|---|---|
| `apps/extension/src/components/composite/send/AmountCard.vue` | F-1's clamp; `fieldScale`, the ruler, the wrapper and its strut, the fit and its triggers |
| `apps/extension/src/utils/hero-fit.ts`, `hero-fit.test.ts`, `hero-ruler.ts` | moved from `popup/components/modules/general/`; `inputRoom` added to `hero-ruler.ts` |
| `apps/extension/src/popup/components/modules/general/BalanceView.vue`, `BalanceView.test.ts` | the imports and the mock follow the move |
| `apps/extension/src/utils/amount.callers.test.ts` | the moved file's key |
| `apps/extension/src/utils/amount.ts`, `src/types/auto-imports.d.ts`, `.eslintrc-auto-import.json` | F-3: `comma` deleted, and its declarations with it |
| `apps/extension/src/popup/components/modules/send/SendReviewSheet.vue` | the ruler, the fit, `--hero-scale` and `overflow-wrap` on the amount line |
| tests | `send-amount.test.ts` and `AmountCard.test.ts` (F-1); `AmountCard.test.ts` and `SendReviewSheet.test.ts` (the fits, with the ruler mocked as BalanceView's test does); `tests/e2e/network/send-amount-exact.test.ts` (both fits in the browser) |

## Security & Adversarial Considerations

**Threat model.** The asset is the amount sent. The input is the person's typing or clipboard,
and the wallet's balance rows. No dApp writes the Send page's field; a token contract the person
imported does supply the decimals and the balances Max and the corner read
(`wallet/services/token/service.ts:736-785`, `token-balance/balance-projector.ts:243-251`), so
Max's guarantee is "no more than the reported raw balance", not proof of honest holdings. The
risk is a person who sends something other than what the field and the review sheet showed them.
The service worker's `coerceAmount` (`wallet/services/execution/coerce-amount.ts:23-43`, called at
`execution/service.ts:482`, `:502`) checks only that the amount is a non-negative integer, so the
page is the only place that knows what was typed.

- **Sent equals shown.** The sent base units are `validateSendAmount(model).integerized`. The
  field at rest is either the model as it was (a value the helper cannot parse: read as dev reads
  it, unless its commas group the whole part in threes, when it reads as the amount it shows) or
  `formatBaseUnits` of the units the parser read from it, whose commas group the whole part in
  threes and so match `GROUPED`. P2's path table states the exact result for each case through
  the real handler, blur and validator.
- **No malformed paste becomes sendable.** Only grouping is newly stripped; "1.234,5," stays
  refused (P2 pins it).
- **dev's float blur invents amounts, and this removes it.** A paste past the token's decimals
  reaches the model with its raw characters (the clamp works on the raw text,
  `AmountCard.vue:66-68`). dev's blur then parses a prefix: "12ab.1234567" on a 6-decimal token
  rests as "12" and sends 12; "1.5.1234567" sends 1.5 (measured, recon). After the fix such a value
  stays as typed and is refused.
- **The input cap rounds up** (A-2, declined by the owner as unrealistic). `normalizeAmount`
  compares with `Number.parseFloat` (`utils/amount.ts:59`), so "9999999999998.999999" becomes
  "9999999999999" as it is typed. dev's blur then made the cap unsendable; after this PR an amount
  the cap jumped to can be sent. The jump is visible in the field before any blur, and sending it
  needs a balance of 9,999,999,999,999 or more.
- **A paste.** `purgeNumber` keeps only digits and "." on every keystroke. Before the rebuild,
  what survived into the model with other characters (the raw clamp above) was refused, read as
  the amount it shows when its commas group the whole part in threes ("1,234,567.123456"), or read
  exactly as dev reads it: "1.234,5678901" (a comma-decimal paste past 6 decimals) showed
  "1.234,56" and sent 1.23456. After F-1 the clamp cuts the purged value, so the model holds only
  digits and "." until the blur groups it; what the field shows at once is what is sent. An
  exponent "1e5" becomes "15" as it is typed, visible before any blur; F-2.
- **A switch between tokens with different decimals.** The page clears the amount when the token
  changes (`send.vue:444`). A decimals change for the same selection re-clamps the model
  (`AmountCard.vue:79-90`), and grouping commas do not move `clampDecimals`' cut. The blur parses
  with the current token's decimals; a fraction longer than them does not parse, so it is left as
  typed and refused (`tooManyDecimals`).
- **Max.** Exact from the raw row; it does nothing without the raw balance or the decimals (fails
  closed). The raw balance, the float gate and the decimals all derive from the active token and
  the selected side (`send.vue:127-135`, `:199-202`), so a switch updates them together.
- **The corner** truncates and never rounds up; it is display-only.
- **The review sheet** shows the same string as the field. Before the rebuild it clipped a long
  amount (P5, Ask A-1) and the field at rest hid a long amount's head in Firefox (P5, Ask A-3),
  hiding digits without altering them. After it, both show every digit: the fit changes only the
  type's size, and the rulers are aria-hidden copies of the same string, never read back.
- **Rendering.** Every value is Vue text interpolation or an input's `value`; nothing uses
  `v-html`.
- **Least privilege, supply chain, cryptography.** No permission, dependency, lockfile, secret or
  cryptographic change; `@aztec/*` untouched. No new log line.

## Assumptions

### Facts (verified at `a7b1ff62` by reading the file, and measured where marked)

1. `validateSendAmount` removes only the first comma (`send-amount.ts:51`); measured: "1,000,000"
   and "123,456,789.5" → `invalid`, "1,234.5" and "1,000" → valid. The one comma test is
   `send-amount.test.ts:115-122`.
2. The blur returns early on a comma, else calls `comma(model, ",", Math.min(tokenDecimals, 8))`
   (`AmountCard.vue:96-107`); `comma` goes through `Number.parseFloat` and `toFixed`
   (`utils/amount.ts:11-39`) and returns "NaN" for a string that does not start with a number.
   Measured values: recon § Measured.
3. `handleAmountInput` purges every character but digits and "." (`AmountCard.vue:55`), but when
   the typed text has more decimals than the token it replaces the purged value with the clamped
   raw text (`:66-68`), commas and letters included (measured: "1.234,5,678901" at 6 decimals
   becomes "1.234,5,"). This corrects the brief's fact 3.
4. `normalizeAmount` caps at 9,999,999,999,999 through `Number.parseFloat` (`utils/amount.ts:59`),
   so a value within about 0.001 below the cap becomes the cap (measured).
5. Token-mode Max writes `props.tokenBalanceByType` (`AmountCard.vue:278`), a `Number` prop
   (`:11`) the page computes as the raw string divided by `10 ** decimals` (`send.vue:130-135`);
   fiat-mode Max is exact (`AmountCard.vue:283-291`). `AmountCard.test.ts:59-65` pins the float
   Max. A click on Max bubbles to the card's click handler, which focuses the input
   (`AmountCard.vue:268-270`, `:295`, `:351`).
6. The corner is `comma(props.tokenBalanceByType, ",", 8)`, hidden when that prop is falsy
   (`AmountCard.vue:152-155`, `:350`), in both modes.
7. `comma` has two callers, both in AmountCard (`:106`, `:154`): `git grep -nw comma` over `apps`
   and `packages`. AmountCard's one consumer is `send.vue` (`:647-656`).
8. `isAllowedToSend` needs a valid amount and fee settings but no estimate (`send.vue:256-264`);
   `schedule` and `cancel` both clear the landed estimate
   (`composables/internal/fee-estimation-engine.ts:108`, `:120`); the estimate watcher schedules
   on every change of the amount string and cancels on an invalid one (`send.vue:459-489`).
9. `tokenBalanceByType` and `balanceRaw` both derive from `tokenBalance` (`send.vue:127-135`,
   `:199-202`), passed at `:653-654`.
10. The page clears the amount on a token switch (`send.vue:437-446`) and at unmount (`:595`).
11. The review sheet shows `String(amountTerm)` (`send.vue:287`, `SendReviewSheet.vue:91-93`) in a
    30 px line with no wrap rule (`:179-186`); the popup is 360 px wide
    (`packages/design/src/base.css:75`) and its wrapper clips (`popup/app.vue:502`); a click on the
    publish strip opens the sheet (`send.vue:687`).
12. Leaving the destination field selects a matching contact or account, whose card then replaces
    the input (`popup/components/modules/send/RecipientField.vue:53-56`, `:99-108`; accounts are
    candidates, `send.vue:190`).
13. `formatBaseUnits` truncates on `maxDecimals`, trims trailing zeros by default, omits the
    separator for an empty fraction, takes explicit separators and puts `thousandsSep` only in the
    whole part, in threes (`utils/amount.ts:238-278`); `parseAmountToBaseUnits` throws on "", ".",
    any character but digits and one ".", and too many decimals (`:158-179`).
14. The `tokenReadyExtension` fixture mints 1,000 TST public, 18 decimals
    (`tests/e2e/fixtures/extension.ts:731-790`, `fixtures/aztec.ts:148-167`); file-scoped fixtures
    set up under the 300 s hook timeout (`vitest.e2e.network.config.ts:22`).
15. The PR gates run network e2e at retry 0 (`.github/workflows/pr-extension-network-e2e.yml:165`,
    `:194`), a new spec lands in the proverless pool (`:166-173`), the config default is 2 retries
    (`vitest.e2e.network.config.ts:46`), and `e2e:agent` sets `E2E_REQUIRE_SETUP=1`, so a network
    setup failure fails the run instead of skipping it (`apps/extension/scripts/e2e/agent.sh:195-204`).
16. `feat/ux-owner-picks` (at `33b19cb3`) edits none of the code this plan edits; it shares
    `send.test.ts` (its hunks at dev's lines 121-203 and past 732),
    `implementations-plan/index.md` and `follow-ups.md`; it rewrites `utils/amount.ts` from line
    62 on, which this plan does not edit (recon § Overlap).

Facts for the rebuild, read on `feat/ux-owner-picks` at `48a97f4a` (#718, open) and on this branch
at `c3c096ed`:

17. With `count` 1, `fitHero` skips its loop over the longer forms and gives the one form the
    largest hundredth from 1 to 100 at which it fits, or 100 when none does; a `room` that is not
    positive returns full size (`hero-fit.ts`). `rulerWidth(form, scale)` sets `--hero-scale` on
    the form, reads its rect width and removes the property; `heroRoom(section)` is the section's
    rect width (`hero-ruler.ts`).
18. BalanceView draws its hero at `calc(1em * var(--hero-scale, 1))` inside a line that keeps the
    full size, measures a ruler clipped to nothing, and refits after each render that changes its
    forms (`flush: "post"`), on a `ResizeObserver` and on `document.fonts` `loadingdone`; its test
    mocks `./hero-ruler` with widths from the text's length. `utils/amount.callers.test.ts` pins
    `popup/components/modules/general/hero-fit.ts` as a caller of `utils/amount.ts`.
19. The token input is a flex item of a baseline-aligned row shared with the unit toggle
    (`AmountCard.vue:293-328`); its type is 40 px with `line-height` normal (`input { font:
    inherit }` in `packages/design/src/base.css`) and the browser's own padding, and nothing sets
    its height, so the row is as tall as the input's type. Corrected in P11: the row asks for
    `align="baseline"`, a value the design `Flex` does not have, so it stretches (Ask A-4).
20. `src/utils/` is flat, and every top-level module in it is auto-imported (`vite.config.ts:126`),
    with the declarations committed in `src/types/auto-imports.d.ts` and
    `src/types/.eslintrc-auto-import.json`.
21. The review sheet's content renders only while it is open (`Popup.vue:104-121`, `v-if` inside
    a teleport). Its amount line is a 30 px, `line-height: 1` span holding an 11 px `<small>`
    symbol, in a flex column inside a body padded 20 px a side (`SendReviewSheet.vue:89-95`,
    `:166-196`).

### Inferences (unverified; the audit attacks these)

1. No writer outside recon's table puts a comma or a `Number` into the model. P2's path table
   covers the handler, the blur and Max, not a future writer.
2. On the local network, a public-to-public TST transfer to the account itself estimates, as
   `network/fee-methods.test.ts:301` fills and sends one.
3. Moving focus off the amount field fires its blur in both browsers. P1's red run tests it on
   Chrome: dev's blur turns the amount invalid, so the estimate never lands and the field reads
   "1,234,567.12345679".
4. The review sheet clips an amount past about 18 characters. P5's capture measures it.
5. A text input's own vertical padding is 1 px in Chrome and in Firefox, so a strut with that
   padding keeps today's line to the pixel. P9 measures it in both browsers before the strut lands,
   and its spec asserts that the line under the field does not move when the field is left.
6. The ruler's width at a scale is the width the input draws its text at that scale: same font,
   size, weight and letter-spacing, no wrap. P9's spec checks the result, not the premise: at rest
   the field cannot scroll.

### Asks

- **A-1 · owner (answered 2026-09-29: "fit", § Phase 0; built in P10).** If the review sheet
  clips a long amount: let the amount line wrap (`overflow-wrap: anywhere` on the sheet's
  `.amount`), so every digit of what is about to be sent stays visible. Recommended. The
  alternative is to leave it: a long amount's tail is hidden in the review but shown in the field.
  P5: it clips, in both browsers; Max's "1,235,567.123456789012345678" shows as
  "1,235,567.123456789012", its last six digits and the symbol off the popup
  (`lessons/phase-5.md`, capture 4).
- **A-2 · owner (declined, 2026-09-29).** Whether to make the input cap's comparison exact in
  this PR. Declined; the question and the answer are in the audit ledger, finding 2.
- **A-3 · owner (answered 2026-09-29: "every", § Phase 0; built in P9).** In Firefox a long
  amount rests showing only its tail: Firefox leaves an input scrolled where it was (here, at its
  end) when it is left, while Chrome scrolls back to the start, so "1.123456789012345678" rests as
  "89012345678" in view, and Max's "1,235,567.123456789012345678" as "78901234567" (captures 2
  and 3). The input does this for any amount wider than the field, dev's included; keeping every
  decimal makes such amounts common. Recommended: scroll the field back to its start when it is
  left, so both browsers show the whole part. The alternative is to leave it.
- **A-4 · owner, delegated (decided 2026-09-29: option 2, § Phase 0; built in P12).** Found in
  P11. Where the TST/USD unit toggle sits once the field's
  amount shrinks. Dev draws it at the top of the field's line, level with the top of the 40 px
  digits: the row asks for `align="baseline"` (`AmountCard.vue:314`), but the design `Flex` has
  no baseline value, so the row stretches and the toggle's text sits at its top. With A-3, a
  priced token's long amount rests smaller on the digits' baseline, so the toggle now sits above
  the amount's end (`lessons/phase-11.md`, the quote-seeded captures 2 to 4). Options: (1) leave
  it, as built; (2) put the toggle on the amount's baseline in every state, which the row already
  asks for, by an `align-items: baseline` on that row: with focus the toggle then moves from the
  top of the digits to their baseline; (3) raise the resting amount to the top of
  its line, level with the toggle, leaving the space under it empty. Recommended: (2), confidence
  moderate: the toggle reads with the amount at every size, and an unpriced token's field stays
  as built. The panel chose (2) with a full-height press area. P12 builds its look with a strut,
  not `align-items: baseline`, which shrinks the toggle's box to 16 px (`lessons/phase-12.md`).

### Plan audit ledger

- `/codex high` round 1 (GPT-6 Astra, session `01a0eb09-0547-7610-b15e-ba1f8557c586`): **reject**,
  confidence high. Its matrix of 91 cases confirmed the resting form keeps the validator's reading
  and is a fixed point across decimals 0, 6, 8 and 18, near the cap and past 2^53; exact Max
  equals the raw balance; the corner never exceeds it.

| # | Severity | Finding (one line) | Resolution |
|---|---|---|---|
| 1 | major | removing every comma makes a malformed paste sendable: "1.234,5,678901" (6) rests as "1.234,5," and reads as 1.2345 | accepted: only a whole part grouped in threes loses its commas; any other string keeps dev's first-comma reading (§ Architecture); P2 pins the paste refused |
| 2 | major | the input cap rounds a value just below it up to it, and the fix makes that sendable (one base unit over at 6 decimals) | reproduced; declined by the owner as unrealistic (below). Residual: after this PR, an amount the cap jumped to can be sent |
| 3 | major | after Max the destination turns into a recipient card, so focusing its input cannot leave the amount field | accepted: the spec blurs the amount input by its testid (P1) |
| 4 | minor | "15 or fewer significant digits look the same" is false; "dev never showed past 16 characters" is false for a paste; "every amount of a million or more" is overbroad; the corner changes in fiat mode too; the base and overlap notes are stale | accepted: each corrected (Phase 0 note, UI impact rows 3 to 5, the intro, Facts 6 and 16, recon § Overlap). The corner in fiat mode is the same element answer 3 signed |
| 5 | major | the before-and-after invariant test can pass on dev; the tests do not prove typed equals sent end to end | accepted: P2's path table drives the real handler and blur into the real validator and states each exact result, with decimals 0, 6, 8 and 18, a grouped re-edit, a second blur and the pastes of findings 1 and 2; pins are labelled; one `send.test.ts` case proves the sheet's text and the submitted units; P1's failure message carries the field and Confirm state; P4 names `e2e:agent` |
| 6 | minor | Max's guarantee is the reported balance, not honest holdings; P5 only proves the files exist | accepted: the threat model says so; P5 records, per capture, whether every digit is visible |

Finding 2 went to the owner (Ask A-2) on 2026-09-29, asked as: "Send's amount cap
(9,999,999,999,999) uses float math. Typing 9999999999998.999999 on a 6-decimal token turns into
9999999999999 as you type the last digit. Today that amount is refused anyway; after the
send-amount-exact fix it becomes sendable, one base unit more than typed (the field does show the
jump). Make the cap exact in the same PR? It only matters with a balance of about 10 trillion
tokens or more." The owner answered: **"Don't even care with a balance of 10 trillion tokens my
friend. let's cover realistic scenarios lol."** So `utils/amount.ts` stays untouched, with no fix
and no test for the cap.

### Code review ledger

- `/codex high` round 1, resuming the plan audit's session, on `a7b1ff62..d0a6c0a8`:
  **conditional approve**, confidence high, conditions 1 and 2. The plan audit's findings
  re-checked on the built code: 1, 3, 4 and 5 resolved; 2 the owner's declined residual; 6 open
  until P5's captures and Ask A-1.

| # | Severity, bucket | Finding (one line) | Resolution |
|---|---|---|---|
| 1 | minor, realistic | the spec reached the recipient input through a descendant `input` selector, which the e2e selector rule forbids | accepted: the testid alone, since `replaceInputValue` descends to the input (`248970ac`) |
| 2 | minor | four comments narrated their code | accepted: three deleted, the regex's and the comma rule's comments cut to their constraint (`95f3aae9`) |
| — | suggestion | a grouped paste past the token's decimals through the input-to-validator table | accepted: one row, whose resting form dev's validator refuses (`5f9450fd`) |
| — | noted | F-1 and F-2 are realistic and pre-existing, not regressions | not acted on: owner calls, moved to `follow-ups.md` |

- Round 2, same session, on the three fix commits: **approve**, confidence high, no new material
  finding. The loop converged in two rounds of three (`lessons/phase-4.md`).
- Round 3, same session, on the rebuild (`dd74c6cd` to `919892b6`, the merge skipped), with the
  owner's four answers verbatim: **approve**, confidence high, no new material finding
  (`lessons/phase-11.md`). It reproduced F-1's example, found the moved files byte-identical and no
  `comma` caller left, and the fits writing presentation state only.

| # | Severity, bucket | Finding (one line) | Resolution |
|---|---|---|---|
| 1 | minor, realistic (maintenance) | `fitHero`'s doc names a too-long symbol as the only way below 60%, false for its one-form callers; the rulers' comments describe the element, not the invariant | accepted: the clause dropped, each ruler's comment states what it must share (`d8e084c8`) |
| — | noted | the declarations for `inputRoom` were uncommitted | committed (`0fa4df32`) |
| — | noted | the specs prove the line under the field stays put between focus and rest, not that it sits where dev had it | the captures read the line's height at focus against the input's own (`lessons/phase-11.md`) |

- Round 4, same session, one more round the driver authorised for the delegated decisions, on
  `612b52df` and `8b7b68aa` with both calls verbatim: **conditional approve**, confidence high,
  one condition (`lessons/phase-13.md`). It found the switch's box inside the row and off Max's
  line in every mode, the fit included, and no read of the amount after Max's one write.

| # | Severity, bucket | Finding (one line) | Resolution |
|---|---|---|---|
| 1 | minor, realistic | Refresh quote writes the new guard, then the conversion reads `fiatGuard.value` in the same tick; the page owns the guard, so the old quote comes back and the amount is derived at it again ($120 at $1.20 derived 120 tokens, not 100, with Vue's own `useModel`). The send gate stays shut | accepted, the condition: the fresh guard is handed to the conversion, and the refresh test binds the guard back as the page does, red on the old code (`f3de30dc`). Dev's behaviour, in fiat mode, which this plan had left out; its own commit, flagged to the driver |
| 2 | minor, maintenance | the moved plain-format comment says the plain string is what the page validates, and Max now writes the grouped form | accepted: deleted (`1aaa0958`) |

- Round 5, same session, run for the as-built panel on `f3de30dc`, `1aaa0958` and `4d106e6c`:
  **approve**, no new material finding; its prompt asked for no confidence. It reproduced the old
  refresh path (quotes 1.20 → 1 → 1, 120 tokens) against the fixed one (1.20 → 1.20, 100), found
  the refresh test red on the old code and no other scheduler caller writing the guard first, and
  the drawn line and its ruler sharing the whole-symbol rule.

## Follow-ups

Moved to `implementations-plan/follow-ups.md` § Send amounts at close-out; the records stay here.

- **F-1 · A paste over the token's decimals keeps its raw characters.** Resolved in the rebuild
  (P6), by the owner's `paste` answer. `handleAmountInput`
  clamps the typed text, not the purged value (`AmountCard.vue:66-68`), so "1.234,5678901" on a
  6-decimal token shows "1.234,56" and sends 1.23456, before and after the field is left; the
  validator still reads one stray comma as a separator. Clamping the purged value, or refusing a
  stray comma, changes what the field shows or accepts: an owner call.
- **F-2 · The input rewrites a paste into another amount.** `purgeNumber` turns "1e5" into "15"
  and "1.234,56" into "1.23456" (`utils/amount.ts:11-14`). Visible at once, but not what a reader
  of that notation meant; refusing such text is a product call.
- **F-3 · `comma` has no caller after this PR.** Resolved in the rebuild (P8), on the driver's
  note. Delete it from `utils/amount.ts` (the
  auto-import declarations follow at the next build) once `feat/ux-owner-picks`, which rewrites
  that file, merges.
- **F-4 · `shotSend` takes its second theme mid-transition.** It flips the theme and shoots at
  once (`tests/e2e/fixtures/send-page.ts:224-230`), while `PopupCard` and `Button` transition
  their colours over 0.2 s, so a sheet's or a button's flipped capture reads washed out or dimmed
  (P5). Wait for the flip's transitions to end before the second shot; until then, read sheets
  and buttons in the first theme.
- **F-5 · The unit switch, Max and Refresh quote are mouse-only.** Each is a `<span @click>` with
  no role, `tabindex` or key handler, so the keyboard cannot reach or press them (CLAUDE.md §
  Keyboard & focus order). Raised by the delegated panels; their place in the Tab order is an
  owner call.
- **F-6 · A press on Max while the destination holds the focus is lost.** The press's `mousedown`
  blurs the destination, which turns into the account's card 22 px taller, so Max moves before
  `mouseup`, the `click` lands on a common ancestor and Max never runs; a second press works.
  Dev's behaviour, found by P12's probe (`lessons/phase-12.md`). Keeping the card's height or
  acting on `pointerdown` changes the page or the press: an owner call.
- **F-7 · In USD mode a long derived amount wraps the line under the field.** The derived token
  amount keeps every decimal and shares its line with the balance; at a price that is not round
  an everyday dollar amount derives 18 decimals ("≈ 100.014302045192462522 TST" for $100 at
  $0.999857), so beside a large balance the line breaks over three rows, "≈" alone on the first
  (P13's `usd-max` captures). Dev's behaviour; shrinking, cutting or moving it is an owner call.
  In the same frames the long word also pushes MAX past the popup's gutter, cut at its right
  edge. This PR's exact Max reaches that from token-mode Max then the switch; dev's float copy
  ("1235567.123456789", rested as "1,235,567.12345679") does not, and dev reaches it through
  USD-mode Max, which was already exact.
- **F-8 · At rest the USD field hides its tail.** It keeps 40 px and no grouping, so after Max it
  shows "1235567.1234" of 1,235,567.123457 (the `usd-max` captures), where the token field shows
  every digit. Dev's behaviour; an owner call.
- **F-9 · A wrapped review line indents its symbol 4 px.** The symbol's `margin-left` moves onto
  the second line with it; a gap on the number's end would fix it. Cosmetic, and only on a line
  that wraps, which takes a billion-plus 18-decimal amount (the `billion-review` captures).
- **F-10 · The fiat notice can say the price moved when it did not.** Its text depends only on
  whether a live quote exists, so a session frozen 15 minutes ago (the gate's `stale-snapshot`)
  at an unmoved price reads "The price moved since you started typing."; a stale-snapshot wording
  is a copy call. Dev's behaviour.

## Approval

Cleared to build by the driver on 2026-09-29, after the owner's answer to A-2. The plan audit was
light's single audit (round 1, reject; each finding resolved or declined in the ledger). The first
code-review round resumes the same session and re-checks findings 1 to 6 against the built code;
the code-review loop has up to three rounds of its own.

**Delivery boundary** (the same rule in Delivery): the PR may open and run CI while Asks A-1 and
A-3 are pending; it does not merge until the owner's answers to both are quoted in this plan.

**The rebuild** (P6 to P11) is cleared by the owner's four answers (§ Phase 0), relayed by the
driver on 2026-09-29 with the order of work: F-1 first and red first; A-1 and A-3 on #718's fit
once #718 is in `dev` and `dev` is merged in here, never a copy; P4's gates; one codex round in
the resumed session; captures in the light theme on both browsers at 360×600; then close-out. The
answers are quoted, so the boundary above is met once the rebuild's gates pass. The driver opens
the PR. P11's captures found one more layout call, Ask A-4 (the unit toggle's place beside the
smaller amount): the PR may open and run CI, and it does not merge until A-4 is answered and
quoted here.

**The delegated decisions** (P12 and P13) are cleared by the owner's delegation and the panel's
two calls (§ Phase 0), relayed by the driver on 2026-09-29 with the order of work: option 2 and
the Max fix, red first; one codex round on the diff; the gates; the captures; `origin/dev` merged
before the final gate. A-4 is answered and quoted, so the boundary above is met; the owner's own
answers of 2026-09-30 are quoted in § Phase 0.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/send-amount-exact/lessons/phase-N.md`. Unit and component
commands run from `apps/extension`. Every new test is run red on the unfixed code first, and the
red run is recorded in the phase's lessons file before the fix; a test named a pin is green before
and after.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/send-amount-exact/` (`plan.md`, `recon.md`,
   `lessons/phase-0.md`) and one line in `implementations-plan/index.md`, after
   `grant-check-address-case` (where it merges clean with `feat/ux-owner-picks`' own line).
2. Fetch, then probe `git merge-tree --write-tree HEAD origin/feat/ux-owner-picks` and record the
   result; the probe repeats before the first code commit.

Gate: `bun scripts/ci-cd/plans/check.ts` and `bun run lint` exit 0.

### P1 · Red in the browser ✓

1. `data-testid="fee-estimate"` on `FeeCostReadout.vue`'s estimate row (`:29`).
2. `tests/e2e/network/send-amount-exact.test.ts`, one test, `{ timeout: 420_000, retry: 0 }`, its
   header saying why (it mints into the file-scoped fixture). Selectors are testids only; every
   wait stays under the connection's 300 s protocol timeout. When an estimate or Confirm wait
   fails, the error carries the field's value and whether Confirm is disabled.
   - Mint 1,234,567.123456789012345678 TST public to the account (`mintPublicTokensForAccount`),
     then `waitForFreshBalanceRow` on 1,235,567.123456789012345678 TST
     (`1235567123456789012345678`).
   - Open Send, set both sides to public (`setActiveSendType`), wait for the amount input to be
     enabled.
   - Typed: `replaceInputValue` the amount "1234567.123456789012345678", then the destination
     (the account's own address), which moves focus and so leaves the amount field. Wait for
     `fee-estimate` (120 s) and for `send-submit` to be enabled; `readSendInputs` shows the amount
     "1,234,567.123456789012345678".
   - Max: click `send-amount-max`, which focuses the amount field (and so turns the destination
     into its recipient card), then `blur()` the `send-amount-input` element. Wait until it reads
     "1,235,567.123456789012345678"; the schedule for that string cleared any earlier estimate in
     the same update, so then wait for `fee-estimate` and for `send-submit` to be enabled.
     `send-amount-balance` reads "1,235,567.12345678 TST".
   - `pageErrors` is empty.
3. Red: run the spec on this commit's unfixed code, Chrome, retry 0. Expected: the typed step
   fails its estimate wait with the field reading "1,234,567.12345679" and Confirm disabled.
   Record the output.

Gate: `bun run lint` and `bun run typecheck:all` exit 0; the red run recorded, failing at the typed
step's estimate wait with that field value and Confirm disabled.
Layers: lint, typecheck, e2e-live-network.

### P2 · A typed amount keeps its value (V, B) ✓

1. Red, `send-amount.test.ts`: the comma test becomes one `test.each` at 6 decimals: "1,000" →
   `1000000000n` (pin), "1,000,000" → `1000000000000n`, "123,456,789.5" → `123456789500000n`;
   "1.234,5," → `invalid` (pin: every-comma removal would accept it); "12,34.5" →
   `1234500000n` (pin: dev's reading kept). Its first-comma comment goes.
2. Red, `send-amount.test.ts`, "what the field sends": mount AmountCard (the stubs and focus mock
   of `AmountCard.test.ts`), `setValue` the typed text, blur, blur again, then run the last model
   through `validateSendAmount` (balance 10^40). Each row states the model at rest, that the second
   blur changed nothing, and the exact result:
   - "1234567.123456789012345678" (18) → "1,234,567.123456789012345678" → its base units;
   - "12345678901.123456" (6) → "12,345,678,901.123456" → `12345678901123456n`;
   - "1234567890123.12345678" (8) → "1,234,567,890,123.12345678" → its base units;
   - "1234567" (0) → "1,234,567" → `1234567n`;
   - "1,234,567.55" (18, a grouped amount edited) → "1,234,567.55" → its base units;
   - "12ab.1234567" (6) → "12ab.123456" → `invalid` (dev rests it as "12" and sends 12);
   - "1.234,5,678901" (6) → "1.234,5," → `invalid` (pin).
3. `amount-field.test.ts` (new; check the path is free first), one `test.each` of input, decimals
   and resting form, each also a fixed point: "1.50" → "1.5", "1." → "1", "007" → "7", ".5" →
   "0.5", "0.00" → "0", " 12.5 " → "12.5"; unchanged: "1,234,567.5", "1.234,56" (6), "abc",
   "1.2.3", "-1", "1e-7", "1.1234567" (6).
4. Red, `send.test.ts`, inside "the submit tail" (away from `feat/ux-owner-picks`' hunks): with a
   private balance of 2,000,000 TST, the amount "1,234,567.123456" sends
   `1234567123456n`, and the sheet opened from the strip shows "1,234,567.123456"
   (`send-review-amount`). Pin: the token-switch test (`:649-659`) also expects the amount
   cleared, so no grouped amount outlives its token's decimals.
5. Fix: `send-amount.ts:51`, `amount-field.ts`, the blur.

Gate: `bun --bun vitest run src/popup/pages/send-amount.test.ts src/popup/pages/send.test.ts
src/components/composite/send/` exits 0 with the new tests passing; `bun run lint` exits 0.
Layers: lint, unit, component.

### P3 · Max and the corner read the exact balance (M, C) ✓

1. Red, `AmountCard.test.ts`, replacing `:59-65` deliberately: token-mode Max, one `test.each`
   over the raw balances `1123456789012345678`, `99876543210987654321` and `100000000000` (18
   decimals), with `tokenBalanceByType` computed as the page does: the emitted model is
   "1.123456789012345678", "99.876543210987654321" and "0.0000001", and `parseAmountToBaseUnits`
   of the emitted value is the raw balance. Max with no raw balance, or with no decimals, emits
   nothing.
2. Red, `AmountCard.test.ts`: the corner, one `test.each`: `124457554400000000000000000` →
   "124,457,554.4 TST", `1123456789012345678` → "1.12345678 TST". Pins: `1000000000` (below
   0.00000001) → "0 TST"; no segment when `tokenBalanceByType` is `0`. No segment without a raw
   balance or without decimals. The corner test at `:79-89` gains `decimals: 6` and
   `balanceRawByType: "42000000"` and still reads "42 USDC".
3. Pin, `AmountCard.test.ts`: a grouped model "1,234,567.123456789" (18) re-clamps to
   "1,234,567.123456" when the decimals drop to 6.
4. Fix: Max, the corner, the prop's TSDoc, the story's args.

Gate: the P2 vitest command exits 0; `bun run lint` exits 0.
Layers: lint, component.

### P4 · Gates and browser proof ✓

1. `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`,
   `bun run build`, `bun run --cwd apps/extension build-storybook`.
2. Smoke e2e on Chrome and Firefox: `bun run test:e2e`, and with `NULO_E2E_BROWSER=firefox`.
3. Network through the isolated runner, as CI's pool runs it:
   `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent <file>`,
   and with `NULO_E2E_BROWSER=firefox`: `send-amount-exact.test.ts` three consecutive runs per
   browser; `fiat-send.test.ts` (reads the corner) and `send-amount-clamp.test.ts` (the clamp)
   once per browser.
4. Fetch and probe `git merge-tree --write-tree HEAD origin/feat/ux-owner-picks` again;
   `bun run e2e:reap`.

Gate: every command exits 0; each e2e run's executed, passed and skipped counts in
`lessons/phase-4.md`. A skipped spec is not a pass.
Layers: lint, typecheck, unit, component, CI-gating, build, e2e, e2e-live-network.

### P5 · Captures for the PR (never committed) ✓

A throwaway spec (deleted after the run, never staged) takes `shotSend` captures, both themes, on
Chrome and Firefox: (1) 1,234,567.5 typed and left, fee estimated, Confirm on; (2) an 18-decimal
amount past 8 places, typed and left; (3) Max on the long-decimal balance, filled exactly, with
the corner cut at 8 places; (4) the review sheet, opened from the publish strip, holding the
amount of (3), for Ask A-1. The capture paths go to the driver; `lessons/phase-5.md` names the
files without any machine path and records, for each, whether every digit of the field, the
corner and the sheet's amount is visible.

Gate: eight captures per browser exist (four shots, two themes), each inspected and recorded;
`git status` shows no spec left.

### P6 · A paste reads as typing does (F-1) ✓

1. Red, `send-amount.test.ts`, "what the field sends": "12ab.1234567" (6) rests as "12.123456" and
   sends `12123456n`; "1.234,5,678901" (6) as "1.234567", `1234567n`; a new row, the owner's
   "1.234,5678901" (6), as "1.234567", `1234567n`. The grouped paste "1,234,567.1234567" keeps its
   result; its comment changes.
2. Red, `AmountCard.test.ts`: "1.234,5678901" at 6 decimals reads "1.234567" in the input at once,
   emits "1.234567" and shows the clamp hint.
3. Fix: the clamp cuts `purgedAmount` (§ The rebuild). The comments that name a paste's stray
   commas follow.

Gate: the P2 vitest command exits 0 with the new rows passing; `bun run lint` exits 0.
Layers: lint, unit, component.

### P7 · Red in the browser for both fits ✓

1. `send-amount-exact.test.ts`, in its one test, with `expect.soft` so one red run shows every new
   check: after the typed leg, the field at rest cannot scroll; after Max, with focus, the field is
   at 40 px; once it is left, it cannot scroll and `send-amount-meta` has not moved; the review
   sheet opened from the strip holds "1,235,567.123456789012345678" and "TST", at 18 px or more,
   and its amount line does not overflow. The sheet is closed again; nothing is sent.
2. Red: Chrome and Firefox, retry 0, on this commit. Expected: the three "cannot scroll" and
   "does not overflow" checks fail, the others pass. Record.

Gate: `bun run lint` and `bun run typecheck:all` exit 0; both red runs recorded as expected.
Layers: lint, typecheck, e2e-live-network.

### P8 · #718 in, and the fit a layer down ✓

1. After the driver reports #718 merged: fetch, `git merge origin/dev` (a merge commit, never a
   rebase), resolve and record any conflict; the P2 vitest command and `bun run lint` stay green.
2. Refactor, a commit of its own: `git mv` `hero-fit.ts`, `hero-fit.test.ts` and `hero-ruler.ts`
   to `src/utils/`; BalanceView's imports, its test's mock and the callers test's key follow; a
   build regenerates the auto-import declarations. No behaviour changes.
3. F-3, a commit of its own: delete `comma` from `utils/amount.ts` once `git grep -w comma` finds
   no caller, and rebuild; the generator keeps a removed export's global in `auto-imports.d.ts`,
   so that line goes by hand, and a second build must leave it gone.

Gate: `bun run lint`, `bun run typecheck:all` and `bun run test:all` exit 0, BalanceView's tests
and `hero-fit.test.ts` among them, after step 2 and again after step 3.
Layers: lint, typecheck, unit, component.

### P9 · A-3: the field at rest shows every digit ✓

1. Probe (a throwaway spec, never staged): the token input's computed padding in both browsers
   (Inference 5). Record.
2. Red, `AmountCard.test.ts`, the ruler mocked as BalanceView's test mocks it: a long amount left
   draws at the stand-in's fit, below 1, and with focus again at 1; a short amount rests at 1; a
   font load and the fiat toggle's arrival fit it again, and unmounting stops the font listener.
   Max's path is the e2e's.
3. Fix: § The rebuild, A-3.
4. P7's field checks pass in Chrome and Firefox (the sheet's may still fail).

Gate: the P2 vitest command and `bun run lint` exit 0; step 4's runs recorded.
Layers: lint, component, e2e-live-network.

### P10 · A-1: the review sheet fits, then wraps ✓

1. Red, `SendReviewSheet.test.ts`, the ruler mocked: an amount that fits draws at 1; one that fits
   between 60% and 100% draws at that fit; one that needs less draws at 0.6.
2. Fix: § The rebuild, A-1.
3. The spec passes in Chrome and Firefox.

Gate: `bun --bun vitest run src/popup/components/modules/send/` and `bun run lint` exit 0; step
3's runs recorded.
Layers: lint, component, e2e-live-network.

### P11 · Gates, review and captures ✓

1. P4's gates, all of them, on the final tree: static; smoke on both browsers at retry 0;
   `send-amount-exact` three times per browser, `fiat-send` and `send-amount-clamp` once per
   browser, all at retry 0; `bun run e2e:reap`.
2. One `/codex high` round in the resumed session on the rebuild (the loop's third and last
   round); fixes in their own commits, then the gates they touch again.
3. Captures (a throwaway spec, never staged), light theme, 360×600, Chrome and Firefox: the review
   sheet after the million-plus Max; the field at rest with 1.123456789012345678; the field at
   rest with the million-plus Max; a paste past the token's decimals. `lessons/phase-11.md`
   records, for each, whether every digit is on screen.
4. Merge `origin/dev` again if it moved, and probe the merge before the push.

Gate: every command exits 0; e2e counts in `lessons/phase-11.md`, no skipped spec; eight
captures; `git status` shows no spec left.
Layers: lint, typecheck, unit, component, CI-gating, build, e2e, e2e-live-network.

### P12 · The delegated decisions: A-4's option 2, and Max at rest ✓

1. Red, Chrome, retry 0: `fiat-send` presses 1 px inside the amount row's top edge over the
   switch, then the field's right end beside it. With the capture branch's `align-items:
   baseline` the first press landed on the row and focused the token field. Red, vitest: a press
   on Max, the field blurred first as a pointer press blurs it, left the field focused.
2. Fix, the switch: `.unit_pair::before` holds the field's zero-width strut, so its label sits on
   the amount's baseline and the row's stretch keeps its box 53 px; the inert `align="baseline"`
   goes, and the row gains `data-testid="send-amount-row"`. Fix, Max: `@click.stop`, and the
   resting form in one write, since the page owns the model.
3. `send-amount-exact` presses Max as a pointer does, after leaving the destination through the
   amount field (F-6), and checks that the field is left grouped, fitted and unfocused.

Gate: `bun --bun vitest run src/components/composite/send/` and `bun run lint` exit 0;
`fiat-send` and `send-amount-exact` green in Chrome at retry 0; the red runs in
`lessons/phase-12.md`.
Layers: lint, component, e2e-live-network.

### P13 · Review, gates, captures and close-out ✓

1. One `/codex high` round, the fourth, in the resumed session on P12's commits with both calls
   verbatim; fixes in their own commits, red first.
2. `origin/dev` merged with a signed merge before the final gate; lint, `typecheck:all`,
   `test:all`, `test:ci-gating`, `build`, `build-storybook` and the plans gate; smoke on both
   browsers at retry 0, in two shards each; `fiat-send`, `send-amount-exact` and
   `send-amount-clamp` on both browsers at retry 0; `bun run e2e:reap`.
3. Captures (a throwaway spec, never staged), light theme, 360×600, Chrome and Firefox: the switch
   in token mode at full size and shrunk, in USD mode, the field right after Max at rest, and the
   review sheet of a billion-plus 18-decimal Max, which wraps; no snackbar in any frame. Its first
   Chrome capture wrapped inside the symbol, "T" over "ST": the symbol became an atomic inline
   (`4d106e6c`), and every browser gate the fix touches ran again on the fixed tree.
4. Close-out: the Outcome, the promoted lessons within the budget, the follow-ups, the index line.

Gate: every command exits 0; counts in `lessons/phase-13.md`, no skip but the suites' own; the
captures measured there; `git status` shows no spec left.
Layers: lint, typecheck, unit, component, CI-gating, build, e2e, e2e-live-network.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P4 is green and before any PR, called through the program's lock script on
account `alejo-gmail`:

1. **Codex audit**: resume the plan audit's session with the diff, this plan, the adversarial ask
   ("What could go wrong? What would an attacker target? What are we trusting that we
   shouldn't?"), a re-check of findings 1 to 6 against the built code, and these two rules,
   verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting, and triage it by the owner's
   realistic-scenarios rule (Phase 0); apply the accepted ones, commit each fix separately, log the round (consult and verdict) in `lessons/phase-4.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it.
3. Rerun P4's gate on the final commit.
4. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope, and UI
   decisions stay the owner's.
5. **Delivery** (below).

The rebuild gets one round (P11), resuming the same session with the rebuild's diff, the owner's
answers and the same two rules, triaged the same way. It is the loop's third round, so a finding
still material after it is surfaced, not looped on. The delegated decisions get one more round,
the fourth, which the driver authorised (P13), under the same rules; the as-built panel ran a
fifth on P13's fixes.

## Delivery

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| `fix/send-amount-exact` | P0 to P13 | `dev` | off |

- Single arc, pushed after the loop converges. The driver opens the one PR off `dev`
  (`gh pr create`) and watches its checks; it does not merge until Asks A-1 and A-3 are answered
  and quoted here (§ Approval). They are; the rebuild (P6 to P11) is pushed on the same branch,
  with `dev` merged in after #718 and #719, then the delegated decisions (P12, P13), with `dev`
  merged in after #720. The PR waits only for the driver.
- Title: `fix(send): keep typed and max amounts exact, and send a million or more` (71 characters).
- PR body: the UI impact table with the owner's answers, the captures, the red-first evidence, the
  e2e counts.
- **Overlap**: `feat/ux-owner-picks` shares `send.test.ts` and the curated `index.md` and
  `follow-ups.md`; it is being rebuilt, so `git merge-tree` probes it, freshly fetched, before the
  first code commit and before the push.
- Closing the plan, in the same branch: the `## Outcome` block after the front matter, the
  generalizable lessons promoted to `implementations-plan/lessons.md` (under 8 KiB), the open
  follow-ups moved to `implementations-plan/follow-ups.md`, and the index line reading "closed,
  awaiting archive". Merge `origin/dev` before the push if it moved (merge, never rebase).

## Seeds

Retired at close-out.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/send-amount-exact/plan.md. Done when the transcript shows every phase ✓ in plan.md with its gate passing, each red run recorded before its fix, LESSONS_FILE=implementations-plan/send-amount-exact/lessons/phase-N.md printed per phase, P4's e2e counts with no skipped spec, a resumed /codex high pass quoted with no new material finding, and the branch pushed; bun run test:all and bun run lint exit 0 in the transcript. /code-review is off and was not run. Never open or merge the PR; the driver does. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/send-amount-exact/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; run its red test first and record it; after each edit run bun run lint and the phase's vitest command; commit. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skipped spec is not a pass. All phases ✓: the Post-implementation loop, then push and report. Never open or merge a PR; hard limits stay hard.
```

Use exactly one per session.
