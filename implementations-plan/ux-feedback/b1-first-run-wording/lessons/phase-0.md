# Phase 0 · Plan, audit, round-5 additions

## Plan audit (codex, GPT-6 Astra at `high`, session `01a0d3d9-af15-7b92-a759-f080761204f6`)

- Round 1: **conditional approve**, 10 findings (two blockers). Ledger in
  [`../audit-codex.md`](../audit-codex.md). The two blockers were real and pre-existing in the
  code this batch rewrites: the full-backup restore never re-reads or validates the name, and a
  name of spaces around a control character sanitizes to spaces, trims to empty, and lets the raw
  embedded string reach `restore`.
- Round 2: **conditional approve**. Accepted the rejected half of finding 3 (no live
  re-classification); withdrew the direct fee-payer claim on finding 6 but raised a narrower one
  (a standing public authwit consumed during the sponsor call); new: a whole failed balance read
  looks like loading; a sentence on collisions was wrong.
- Decided without adopting codex's fix: a whole failed read stays "not known yet" (rows
  selectable, "— FJ", beside the card's retry notice). Disabling both Fee Juice rows would change
  gating the card deliberately withholds (`FeeSettingsCard.vue:121-125`), which is outside this
  batch's wording scope.
- Round 3: **conditional approve**. Accepted the whole-read handling ("selectable does not mean
  payable": keep `settingsForMethod()`'s refusal and the card's retry). My rebuttal of the
  reimbursement case fell to a caller-restricted FPC: the account's own entrypoint is the caller,
  so picking the contract is what satisfies the check. Conceded.
- Round 4: **approve**, confidence high, after "free" / "Nothing" were restricted to `isProtocol`
  sponsors and the hand-added case drawn as U16.
- Lesson: "this path creates no authwit" is not "no applicable authwit exists". A claim about
  what a third-party contract cannot do needs the contract's code, not the wallet's call shape.

## Round-5 additions (before P1) ✓

U14 (the fee menu before its balances arrive, or with one unreadable) and U15 (the spoken
sentence under a tenth of a cent) drawn into round 5 as block `i3-r5`, pickers `i3d` and `i3e`.

Gate:

- `python3 implementations-plan/ux-feedback/design/mocks/gen_r5.py` → wrote
  `src/r5/{i3,i5,i6,i8,tips}.html`.
- `python3 implementations-plan/ux-feedback/design/mocks/build.py` → exit 0 (1570 KiB page).
- Page check at 1400px and 400px: `overflowX` 0, no console errors, `i3d` 4/4 and `i3e` 3/3
  radios, the item-3 block first with rounds 4–1 folded.
- `node implementations-plan/ux-feedback/design/shots.mjs` → 39/39 shots (targets
  `03-menu-unknown-U14`, `03-spoken-U15` added).
- Artifact republished at its URL: Version 7; the owner notified.

U16 (a fee contract added by hand: "free" and "Nothing" only for Nulo's own sponsor) added to the
same block after round 3, picker `i3f`.

- `gen_r5.py`, `build.py` → exit 0; page check at 1400px and 400px: `overflowX` 0, no console
  errors, `i3d` 4/4, `i3e` 3/3, `i3f` 3/3 radios.
- `shots.mjs` → 40/40 (target `03-handadded-U16` added).
- Artifact republished: Version 8; the owner notified.
