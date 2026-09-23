# Phase 4 — post-implementation codex loop (2026-09-23)

`code_review: off`, so no `/code-review` pass. Pre-loop gate: `bun run audit:vue` exit 0 (555 files, 7 057 tests passed, 4 skipped, 7 todo; build ✓).

## Round 1 — fresh session, `gpt-6-astra` high, net diff from `a5374be2`

Verdict: `conditional approve (with conditions: strengthen the layered test so escaped focus cannot pass its containment assertion)`.

| Finding (severity) | Verified | Disposition |
|---|---|---|
| The layered test's containment walk can pass after focus escapes: ten Tabs can visit `registry-toggle-submit`, leave into the five header buttons and Back, and stop before `authwits-actions-btn`; a premature close with a stalled leave transition would then pass (Medium) | yes — the forbidden control sits after six header stops in Tab order | adopted: new probe `focusInPopupOf(page, testid)` in `helpers/pointer-probes.ts` (focus inside the `#popup` wrapper that holds the named control — the same wrapper lookup `settleClosedPopup` uses); the test asserts it after every one of ten Tabs. Mutation-checked, see below |
| Readiness overstated: `send-fee-method-trigger[data-fee-method]` can be prefilled from storage before discovery, and base fee entries exist before discovery; the separately loaded submit may still be disabled, and a disabled button is no Tab stop (Low) | yes — `FeeSettingsCard.vue:514` `prefillSelection`; `fee-helpers.ts:152` `buildFeeMethods` base entries; `ChangeAuthwitsRegistryPopup.vue:131` `:disabled="!isAllowedToExecute \|\| isLoading"` (`isLoading` covers the node read of the registry flag) | adopted: the `data-fee-method` wait is gone; the test waits for `registry-toggle-submit` to be enabled before the walk; the file header now names the real reason for the network suite (the registry state is read from a node) |
| CLAUDE.md's "captures it before a child can move focus" reinstates the wording round 2 of the plan audit narrowed (Low) | yes | adopted: "recorded before a child's queued focus runs; if that element is gone by the close, nothing receives focus" |
| Comment density: narration at the layered test's selector and second-Escape lines and the stack test's two Escape lines; compress `closeStuckPopup`'s comment to its constraint (Low) | yes | adopted: four comments removed; `closeStuckPopup` now reads as last-resort recovery that removes all popup DOM without touching the store, "so never while a lower popup must stay" |

Codex confirmed as fine: focus-trap 8.2.2 accepts any DOM node as `setReturnFocus` (body, SVG) and the `null → undefined` mapping avoids its invalid-option error; a literal `escapeDeactivates: false` skips both deactivation and `preventDefault`; the lower trap's delayed initial focus runs before the closing trap's delayed return, so the review sheet's title focus on unpause does not override the return; every registry close path matches the outside tap (`usePopupEntity` hide cleanup, Confirm clears without its callback, IncomingTrust never grants on dismiss, SelectToken invalidates pending loads, ForgotPassword resets nothing); the menu-item selector is testid-only; no scope drift.

### Mutation check of the strengthened walk

A temporary file (`tests/e2e/network/zz-mutant-escape-probe.test.ts`, never committed, deleted after the run) replays the layered flow but presses Escape twice before the walk — what a bug that closed both layers on the first press would look like. Test A runs the new walk and must fail; test B runs the old `tabAround`-only walk on the same premature close.

One `e2e:agent` run (proverless, retry 0) with the real file and the mutant:

| Test | Result |
|---|---|
| `popup-escape-layered.test.ts` (fixed) | ✓ 11.3 s |
| Mutant A (new walk) | ✗ as required — the popup DOM lingered after the double Escape; Tabs 1–4 landed inside it (`send-fee-priority-normal`, `-fast`, `-urgent`, `registry-toggle-submit`), Tab 5 escaped to `account-avatar-btn` and `focusInPopupOf` failed there |
| Mutant B (old walk) | ✗, but for a different reason — on its run the DOM did *not* linger, so `registry-toggle-submit` was unreachable. Its landings give the header order: `account-avatar-btn → account-selector → account-address-copy → network-button → header-lock → BUTTON (Back) → authwits-actions-btn` |

Put together: on mutant A's lingering state, the old walk's ten Tabs would have been four inside the popup plus the five header controls plus Back — `registry-toggle-submit` included, `authwits-actions-btn` one Tab away — so it would have **passed a premature close**, exactly as codex predicted. The new walk fails it at the first Tab that leaves. The mutant file was deleted after the run (`git status` clean of it); the sandbox's ports were released; static scans 91/91 afterwards.
