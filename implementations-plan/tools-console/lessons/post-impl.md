# Post-implementation — the codex fix loop

`code_review: off` — `/code-review` was not run. Codex xhigh (gpt-6-astra), fresh session over the net diff from `91074a74`, plan.md, the ledger, the two rules, an explicit adversarial ask.

## Round 1 — session `01a07273-63f8-7c92-bc4e-bf91007c0ff6`

VERDICT: request changes. 0 HIGH · 5 MED · 6 LOW · 1 NIT. Every claim verified against the repo before acting; all twelve held.

| # | Finding | Action |
|---|---|---|
| 1 | MED — the CLAIM GAS dedup lived in the dock; unmount (open Activity, switch section) drops it and `claimFuelStandalone` has no record lock | **Fixed.** The join moved to the entry point: `fuel-recovery.ts` keeps a per-id in-flight promise; a second call from any surface returns it. The dock's set only drives the CLAIMING… label. Test: a second call joins the first, one send. |
| 2 | MED — the overlay's window keydown handler treats focus inside a wallet dialog as "outside": Tab redirected behind the modal, Escape closing both | **Fixed.** The handler yields when the active element sits inside an `[aria-modal="true"]` that is not the dock (the picker, chooser and verification modals all carry it). Test: a modal on top keeps Tab and Escape. |
| 3 | MED — persisted amounts have no bound before `BigInt`; the feed recomputes every tick | **Fixed.** `formatStoredAmount(raw, decimals)` in `lib/format.ts` (`/^\d{1,78}$/`, a uint256's width; otherwise `—`), used by the row strings, the card amount and the card's fuel line. Tests in `format.test.ts` and the card display suite. |
| 4 | MED — the recipient reaches the card's text and tooltip raw | **Fixed.** `safeAddressText` (the same strip, capped at 80) on `shortAddr` and the `title`; matching keeps the raw string. Test: a bidi-carrying recipient renders without it. |
| 5 | MED — header chips cannot fit phone widths | **Fixed.** Under 760px the header wraps, the wallet row takes its own line and wraps, padding drops to 12/16. |
| 6 | LOW — reduced-motion block declared before the stamp rules it cancels; dock rows pulse beside the stepper | **Fixed.** The media block is last in `BridgePhaseRail`; the dock's running dot is static ink. |
| 7 | LOW — `hide()` prunes the seen set against this tab's possibly stale record list | **Fixed.** `writeSeen` also keeps ids the stored journal holds at write time (`JOURNAL_KEY` read directly, shape-checked). Test: an id only in storage survives. |
| 8 | LOW — the strip badge shows beside an open overlay; its label says "Show" while it hides | **Fixed.** `DockStrip` takes `open`: no badge, `›`, "Hide activity". Tested in the overlay case. |
| 9 | LOW — the rail keeps `aria-orientation="vertical"` as a top row | **Fixed.** Bound to `useMediaQuery("(max-width: 760px)")`. Test with a stubbed `matchMedia`. |
| 10 | LOW — needs-you rows omit the age criterion 4 lists | **Fixed.** Every row carries `· age`; the mock's omission was a space concern the ellipsis handles. |
| 11 | LOW — dock tests cleared the DOM without unmounting | **Fixed.** `enableAutoUnmount(afterEach)`. |
| 12 | NIT — stale 48px comments on the chips, a plan reference in `AccountSwitcher`, narration on `SectionHeader`/`ActivityRow` | **Fixed.** Deleted or cut to one sentence. |

Gate after the round: lint 0 · typecheck 0 · unit 96 files / 1234 · smoke 3 files / 28 · frozen diff exit 0.

### Between rounds — the preview walk

Screenshots of the branch preview (`worktree-tools-console.nulo-faucet.pages.dev`, build `0.1.0+6af0d1bb`) at 1280 / 1000 / 700px, with a seeded journal. Two defects only the pixels showed: `RailNav`'s root class `.rail` matched the shell's scoped `.rail` rule (a child's root inherits its parent's scope attribute) and drew a border and padding on the nav — renamed `.nav`; and the row's meta line lived inside the body button in column 2, so `· 26m ago` truncated at 300px — the row is a grid again with the meta spanning under the side slot, the amount as the keyboard's button and the whole row the mouse's, and a button in the side slot drops the age (the mock's rule; criterion 4's age holds on every row that has the room). Commit `a688e1f9`.

## Round 2 — resumed, over `6af0d1bb` + `a688e1f9`

VERDICT: request changes. 0 HIGH · 5 MED · 0 LOW · 1 NIT — every one a sibling site of a round-1 fix. All verified.

| # | Finding | Action |
|---|---|---|
| 1 | MED — the claim lane's automatic `launchStandaloneFuelClaim` sends outside the new join, so a manual CLAIM GAS while it runs sends twice | **Fixed.** One `joinStandalone(id, start)` around both paths. Test: an automatic start joined by a manual one sends once. |
| 2 | MED — `VerificationModal` does not take focus, so the activeElement guard misses it | **Fixed.** The handler stands down while any other `[aria-modal="true"]` is in the document, focused or not. Test: an unfocused modal keeps Escape. |
| 3 | MED — the recipient reaches the mismatch note and the gas-claim error raw | **Fixed.** `safeAddressText` in both messages; comparisons keep the raw string. Test on the fuel path. |
| 4 | MED — the stepper headline and the restore toast still parse amounts unbounded | **Fixed.** `formatStoredAmount` at both. |
| 5 | MED — the stepper headline renders the stored symbol raw | **Fixed.** `safeDisplay`. Test: a bidi symbol and a 120-digit amount in the headline. |
| 6 | NIT — `formatBigInt` lost its JSDoc to the inserted helper; the rail's media-query comment narrates | **Fixed.** |

Gate after the round: lint 0 · typecheck 0 · unit 96 files / 1237 · smoke 3 files / 28 · frozen diff exit 0.

