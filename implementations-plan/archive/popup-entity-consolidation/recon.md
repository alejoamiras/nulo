# Recon — popup-entity-consolidation (inline pass on dev@2fb8a4d3)

Right-sized deviation from the usual agent fan-out: the surface is four watch blocks + one composable, and most of it was read (and partly re-tested) during the immediately-preceding re-entrancy arc — an inline verification pass covers it. Sources: the four popups' `watch(() => props.show)` blocks, `usePopupEntity.ts`, and a listener sweep of the remaining popups.

## The four hand-rolled watch blocks (migration targets)

| Popup | Hide order today | Show body | Fit |
|---|---|---|---|
| EditFpcPopup | removeListener FIRST, then disconnect+resets | client create+subscribe → await getFpc (may `emit("onClose"); return` on a missing row) → form fill → await getFpcs → addListener | exact `usePopupEntity` order match on hide; show becomes `onShow` |
| NewFpcPopup | disconnect+resets, removeListener LAST | client create+subscribe → await getFpcs → addListener | hide order INVERTED vs the composable — see divergence (b) |
| EditContactPopup | cache clear+disconnect+resets, removeListener LAST | awaits then listener | same |
| NewContactPopup | disconnect+resets, removeListener LAST | **reset BEFORE the await — load-bearing comment** (reset-after-await raced user typing and wiped v-model writes); then addListener after the await | same; the comment must survive verbatim inside `onShow` |

## The two ordering divergences the migration introduces — both pre-characterized

(a) **Listener installs BEFORE the async onShow** (the composable's order) instead of after the awaits. This is arc C's exact, pinned-safe divergence — and since the re-entrancy arc, every one of these four submit handlers is latch-guarded and validity-gated, so an Enter landing during the population await is provably inert or safe.

(b) **Remove-FIRST on hide.** Three of the four currently remove the listener LAST, leaving a (sync, so theoretical) window where the handler could run against a just-disconnected client. The composable's remove-before-onHide order is strictly safer. Divergence direction: improvement.

## Facts for the plan

1. `usePopupEntity` (13 pins) installs on show → then `onShow`; removes on hide → then `onHide`; no unmount/scope cleanup exists today — the listener survives component unmount (the latent-leak root).
2. Production popup shells never unmount popups (`PopupManager` renders them unconditionally) — the leak is test-only today; five test files hand-roll hide-before-unmount `dispose()` helpers to compensate (EditProfile, NewSender, NewEndpoint, NewAccount, EditAccount + the ChangeAuthwits hygiene added last arc).
3. All four target popups already import `isPopupSubmitKey` and their keydown bodies are exactly `if (isPopupSubmitKey(e)) handleX()` — the predicate needs no change; only the watch boilerplate migrates.
4. All four submit handlers are re-entrancy-latched + validity-gated as of #430 — the precondition that makes divergence (a) safe family-wide.
5. `onScopeDispose` fires when the owning component's effect scope stops (unmount included), and `@vue/test-utils`'s `unmount()` stops that scope — plain unmount becomes sufficient test cleanup.
6. The C1 convention bans composables owning `onUnmounted`; its stated rationale is parent-controlled service-disconnect ORDER. The listener removal has no ordering relationship to any client teardown (it is already the FIRST thing on the composable's hide path).
7. No popup outside the family registers document listeners (SelectProfile/IncomingTrust checked: none). The authwits pair keeps its deliberate any-Enter hand-rolled shape — its test hygiene landed last arc; unmount hooks there would be zero-production-value diff.
8. Base `2fb8a4d3` includes #430 (direct parent) + a CI-only workflow change (#428) — no interaction.
