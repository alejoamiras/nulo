# Phase 6 — docs, the dev merge, the codex fix loop, the PR

Date: 2026-09-21.

## Docs

- `ARCHITECTURE.md` § 12: the notice sentence is gone; one paragraph states the publish ledger — one reading (`publishFacts`), three renders (strip, sheet, tag), the one gated send, the payer kinds and why `unvouched`/`null` never read HIDDEN.
- `e2e-testing` skill: the "method in effect" wait targets are the strip and the footer's action (`waitForFee` / `waitForTag`); send helpers name what they `expect`; focus after a close is waited for (`waitForFocus`), never read — the focus-trap timer lesson from phase 5.
- `tests/e2e/README.md`: rows for the pointer probes, `settleClosedPopup`, `sendTransfer`'s `expect` + `fillSendForm`, the send-page helpers.
- A repo-wide search for `send-fee-privacy-notice` outside `implementations-plan/` finds only the two lines that describe the tag.

## The dev merge

`origin/dev` moved one commit while the branch was open: `25062c06 chore(deps): bump biome 2.5.13, playwright 1.63.0 and fake-browser 2.0.1 (#657)`. `git merge-tree` reported it clean; merged as a signed merge commit (`519cc06d`), `bun install --frozen-lockfile` (11 packages), and the complexity manifest's pin (now 2.5.13) matched the tree without a regen — no new function crossed a budget under the new Biome.

Gates on the merged tree, all green: `audit:vue` (typecheck ∥ 6 993 unit + component tests in 551 files ∥ lint, then the Chrome build) · `test:ci-gating` 132/132 · the phase-5 smoke and network runs were taken on the pre-merge tree; the merge touched no source file.

## Codex fix loop

Fresh session, GPT-6 Astra at `high`, read-only (this host runs approve-for-me; nothing was written). Brief: the net diff against `origin/dev`, the plan and its ledger, the adversarial ask and both rules verbatim.

### Round 1 — conditional approve, no High

| Finding | Severity | Verdict | What was done |
|---|---|---|---|
| An armed sheet can submit underneath another visible popup: a popup opened over it whose trap releases on Escape without closing (`IncomingTrustPopup` does not opt into `closeOnEscape`) hands the keyboard back to the sheet's trap beneath; Enter fires "Send now" under a visible prompt. Codex reproduced the focus-trap stack behaviour in memory. | Medium | **Accepted.** The one-tap path had the same exposure before this plan (Escape on that popup, Enter on the page's button), but the sheet exists to make the send that names the account deliberate, so it must not accept a covered consent. | `8bcf492e` — `useSendReview` takes `isTop` (the sheet's slot is `popupStore.len - 1`); `ready = open ∧ top ∧ (¬gated ∨ armed)`, the arm restarts once the sheet is back on top; CTA and `authorises` both derive from `ready`, so nothing else changed. Two composable tests + one page test (a popup over the armed sheet: not ready, disabled, a click sends nothing; closed again, the wait starts over, then one send). |
| `readSendInputs` reads the recipient through `field.querySelector("input")` — not a testid. | Low | **Rejected.** The design system's `Input` binds nothing to its native `<input>`; a testid lands on the wrapper. The descendant selector is the repo's idiom for it (four pre-existing sites in `helpers.ts` and `fee-methods.test.ts`), the wrapper holds one input, and editing `@nulo/design` for a selector is out of scope. | — |
| The extracted submit keeps five lines about a removed 700 ms sleep. | Nit | **Accepted.** | Same commit — one live sentence. |

Looked for and not found (codex): a footer bypass of the gate, a double submission before the button patches disabled, closed-sheet event acceptance, arm-timer reuse across opens; HIDDEN from mismatched ids, missing provenance, pending init, the FPC edit/delete and network-switch paths; independent tag/action/strip predicates; L3 upward imports, composable lifecycle ownership, teardown reordering, complexity suppressions, sensitive log payloads; execute-window files untouched.

### Round 2 — approve, no new material findings

Same session, the fix diff and the three dispositions. Codex accepted the selector rejection (the wrapper-scoped descendant lookup follows the existing `Input` convention) and probed the new `isTop` source with file-free assertions against the composable and the store: compaction when a popup beneath the sheet closes keeps the final order right and the transient state only restarts the arm (never grants early); a covering popup opened and closed in one tick cancels the old arm and requires the full wait; a closed sheet's default order can never make `ready` true because `isOpen` gates it; `closeAll` clears readiness and the timer; the CTA and `authorises` consume the same state. Loop closed at two rounds.

**Follow-up (owner, 2026-09-21):** after Escape closes the sheet, focus returns to "Review send" and the design system's keyboard-focus ring (`Button.vue` `.wrapper:focus-visible`, `outline: 2px solid var(--nulo-accent)`) paints white over the orange CTA on the dark theme — correct a11y behaviour (only a keyboard close shows it; a mouse close returns focus silently), but the owner wants the ring restyled. That is a `@nulo/design` token/variant decision touching every button, not this plan.

**Follow-up (not this plan):** registry popups without `closeOnEscape` release their trap on Escape and stay visible with the keyboard on whatever is beneath — a product decision on every popup, for the owner.

## Delivery

Pushed `worktree-send-publish-ledger`; `gh pr create` into `dev` with no labels, title `feat(send): say what a send publishes; review the one that names you`, the UI-impact table, the sign-off quotes, the 14 screenshots (raw links into the branch), the codex summary and the two owner items. PR [#660](https://github.com/alejoamiras/nulo/pull/660). The path filters tripped both extension e2e suites on their own (`Detect changes` ×5 queued), so no label was added.

## Owner review in a real Chrome (post-PR)

Three observations, all on the sheet:

1. **Escape closes the sheet and the popup stays** — I1 verified, A6 stands.
2. **The sheet is far taller than its content.** Not the sheet's layout: `PopupCard` takes `flex: 10` whenever `showPopupFullscreen` is on, which is the config default and is forced on any window taller than 600 px (`fullscreenPopupSetting.start`), so the card stretches to the popup's bottom with an empty band under "Send now" — visible in `sheet-gated.png` all along, read as "room under the CTA" in phase 5 (I4) instead of as a defect. Fix: `PopupCard` gains `fit` (content height; the handle still expands it for that open) and the sheet is its only user. The lesson for the next sheet: a bottom sheet on this stack must opt out of the fullscreen fill explicitly, and a screenshot's empty band is a question, not a margin.
3. **`to — · 0x…` for a recipient without a name.** The line composed name and address with fixed separators; it now reads `to 0x…` when there is no name (`toLine`).

Plus the focus-ring follow-up above. Sheet screenshots regenerated from the walks (`-t gas`); the PR body carries the two rows and the owner's words.
