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

## Round 2 — same session, resumed with the fix commit `28782ba3`

Verdict, verbatim: `approve` — "no new material findings". The loop converged in two rounds; nothing was rejected at any point.

After the fixes: `build:chrome` then `bun run test:e2e tests/e2e/popup-stack.test.ts` → 2/2 (the network runner had rebuilt `dist/chrome` with its own flavour, so the smoke build was redone first).

## Delivery — CI (PR #675, first run)

Four of the five aggregators went green on the first run: `quality-status`, both smoke lanes (the Firefox smoke job ran `popup-stack.test.ts`, 2/2) and the Firefox network lane, which ran the layered test and passed it. `extension-network-e2e-status` went red on one Chrome shard: `popup-escape-layered.test.ts:35`, `TimeoutError: Waiting failed: 5000ms exceeded` waiting for the fee menu's items after `pointerClick(page, "send-fee-method-trigger")`.

**First hypothesis, refuted.** The registry popup adds a banner above the fee card once the node read returns, so a trigger that moved when the banner landed looked likely. A throwaway sampler of the trigger's top while the popup opened (`tests/e2e/network/zz-diag-trigger-shift.test.ts`, never committed) refuted it: 323 → 283 over the first ~270 ms, then still through the node read and at the moment the submit went live (283 → 283). The 40 px it did move is the enter transition: `.slide-enter-from { transform: translateY(40px) }` over `0.3s` (`packages/design/src/base.css`).

**Mechanism.** `pointerClick` read the trigger's centre as soon as the trigger was visible, which is mid-slide, and pressed a CDP round trip later. The trigger is 16 px tall, so any move over 8 px between the read and the press lands off it. The hit test passes at read time, so nothing fails until the menu never opens.

**Reproduced, then fixed.** The same throwaway file, rewritten: open the popup and press the trigger at once, sixteen times alternating the old helper and the new one, under `page.emulateCPUThrottling(6)`, with capture-phase listeners recording each press against the trigger's box at that instant. One `e2e:agent` run (proverless, retry 0):

| Helper | Menu opened | Missed |
|---|---|---|
| old: read the centre, then press | 4 / 8 | 4 / 8 |
| new: wait until still, then read and press | 8 / 8 | 0 / 8 |

Every miss has one shape: the centre was read while the trigger sat at 292–308 (y = 300); by the press it had settled at 283–299, so the press landed 1 px below it, on `fee-settings-card`.

**Fix.** `pointerClick` now reads the centre only once three reads 50 ms apart give the same box (`waitUntilStill` in `helpers/legal-drivers.ts`), polled from the test rather than on animation frames. The fix sits in the helper, not the test, because every caller that presses a control in a popup still entering has the same race: `popup-stack.test.ts` presses `accounts-popup-new` right after the accounts popup appears. The layered test keeps its wait for the submit to go live before it opens the menu; its comment no longer claims the node read moves the trigger. A first draft sampled inside the page and scored 16 on Biome's cognitive-complexity cap of 15; the loop moved to the test side instead of taking a suppression.

Same run: `popup-escape-layered.test.ts` ✓ (12.7 s) and `legal-acceptance-wall.test.ts` ✓ (24.9 s, a network caller of the helper). The throwaway file was deleted afterwards (`git status` shows only the two intended files); the sandbox stopped and its ports left the registry.

**Final shape and its runs.** The diagnostic ran a draft that scrolled before the wait and measured without scrolling. The committed helper keeps the original measure-and-press step, scroll included, and only adds the wait in front of it. The trigger never scrolled in the diagnostic (its box at every press was the settled 283–299), so both shapes press the same point here. On the committed shape: `legal-acceptance.test.ts` 13/13 and `popup-stack.test.ts` 2/2 on the smoke build, static e2e scans 91/91. The network callers ran on the draft (above) and run again in CI.
