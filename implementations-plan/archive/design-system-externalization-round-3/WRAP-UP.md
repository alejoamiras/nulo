# Round 3 — implementation wrap-up

**✓ COMPLETE.** `/blueprint light`, 4 phases, one PR (#127 → dev). Codex pre-audited the plan
(conditional-approve, conditions folded) + post-audited the impl (ship-with-fixes, 1 MEDIUM fixed);
`/code-review max` found nothing. Network e2e green on #127 + user visual no-deltas sign-off
(2026-06-21), confirmed on a fresh **v5/aztec-5.0.0-rc.1** rebuild with a v5-testnet smoke pass.

## What shipped
| Phase | Commit | What |
|------|------|------|
| P1 | `d5ddb53` | Toast: recorded the **keep-separate** decision (not unified) across backlog/wrap-up/index. |
| P2 | `888479e` | Dropped the `dark` color name; repoint split — `tertiary` for the 2 `•••` dots, `secondary` for the 6 mono metadata values. Removed from `token-contract.ts` (regen `utilities.css`) + the still-live `_text.scss`. |
| P3 | `c286bcd` | Retired `AppButton`; migrated `DripButton` → `Button` (`outline`→`primary_outline`), with **mandatory** `:disabled="disabled \|\| loading"`. |
| P4 | `2753a31`, `6ece24d` | Deleted the 9 round-1 local SFC shadows so the resolver finally takes effect; reconciliation pins (Checkbox guard already present, Toggle `color` added); no-shadow guard (widened to `src/onboarding/components` per codex). |

Gates: `audit:vue` 0 (2380 tests), `@nulo/design` 244, lint 0, storybook 0, smoke 70/0, typecheck:all 0
on aztec 5.0, network e2e green on #127.

## Contentious decisions (with ELI5 context)
- **Toast: don't unify (the round-2 backlog said to).** *Question:* should the faucet + extension share
  one toast system? *Options:* unify vs keep separate. *Why separate:* the faucet toast is a 4-deep
  QUEUE with explorer links (a web app surfacing several async results); the extension's is a SINGLE
  transient (a 360px popup showing one quick confirmation). Different *state models* driven by different
  host contexts. The faucet already shares the package's `Toast.vue` *card* (codex), so unifying
  wouldn't even save the visual — only the queue state + layout differ, and those should stay apart.
  Forcing one would bloat the popup or strip the faucet's queue. **Cut it.**
- **P4: keep in this light arc vs split out.** Codex flagged it heavier than a "delete dead code" job —
  the shadows DRIFTED (Checkbox gained a disabled-click guard, Toggle a `color` prop), so it's a
  *reconciliation*. *Chosen (A):* keep it here with per-component port-vs-reconciliation classification +
  targeted unit pins for the 2 reconciliations + network e2e + visual sign-off. (B) split-out was the
  lower-risk alt; (A) honored the "full round-3 close" goal with the rigor codex required.
- **`dark`→which token.** *Question:* the 8 `color="dark"` sites render inherited full-color (the bug);
  what should they become? *Decided from a rendered mockup (`dark-color-options.html`):* SPLIT —
  `tertiary` for the recede-y `•••` dots, `secondary` for the readable-but-muted metadata values.

## Open / deferred
- The `smoke-fixture FPC flake` (pre-existing) remains its own follow-up.
- Round-3 fully empties the design-system round-2 backlog; no round-4 planned.

## Note
A local-only extension version bump to `0.25.0-rc.1` was made for the user's v5 test build (to
distinguish it in chrome://extensions) and **reverted** — release-please owns the version; round-3 is
design cleanup, not a release.
