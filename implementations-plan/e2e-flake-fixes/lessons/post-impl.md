# Post-implementation codex loop

Session `01a0733f-1ef4-7c70-841b-93ae4ab17968` (fresh, gpt-5.6-sol xhigh, read-only) over the PR diff with
plan.md + lessons, the adversarial ask, and the no-over-engineering + comment-quality rules.

## Round 1 — `not converged` (0 High, 2 Medium, 1 Low) — response (verbatim, paths repo-relative)

High: none found.

- **Medium — the 15-second deadline no longer bounds the fallback** ([helpers.ts:1753](apps/extension/tests/e2e/fixtures/helpers.ts:1753)). **Confidence: high.** While `readWorkerTimeOrigin()` awaits attach/evaluate/detach, neither the deadline nor `destroyed` is checked. Those operations inherit the fixture’s 300-second protocol timeout. A newer origin returned after the deadline also succeeds without another deadline check. An isolated simulation using the actual helper remained pending at 20 seconds despite `targetdestroyed`, then accepted the late result. Keep destruction/deadline handling independently active and bound probe operations by the remaining budget. A stopped host retained without a runnable replacement also cannot supply the fallback witness; target survival alone still does not establish worker survival.

- **Medium — onboarding cleanup can leave its replacement popup behind** ([extension.ts:149](apps/extension/tests/e2e/fixtures/extension.ts:149)). **Confidence: high.** After the fixture sets completion true, a late onboarding mount can execute [app.vue:41](apps/extension/src/onboarding/app.vue:41): create a popup, remove `nulo:onboarding:tab-id`, then close itself. Cleanup subsequently finds no ID—or catches removal of the already-closed tab—and leaves the replacement popup alive. Executing both source snippets with mocked Chrome APIs reproduced that outcome after all 20 polls. Close the tracked first-run tab before flipping completion, or include its replacement in startup-page cleanup.

- **Low — comments need compression and correction.** **Confidence: high.** [helpers.ts:1704](apps/extension/tests/e2e/fixtures/helpers.ts:1704) spends two paragraphs on probe history where the host-reuse invariant and restart witness suffice. Its “cannot itself overlap” claim is too strong: two seconds is a heuristic; a delayed stop can overlap the fallback attachment and retain the host. That cannot fabricate a newer origin. Delete the redundant import explanations at [sw-resilience.test.ts:7](apps/extension/tests/e2e/sw-resilience.test.ts:7) and [sw-restart-network.test.ts:7](apps/extension/tests/e2e/sw-restart-network.test.ts:7), which incorrectly promise target destruction. The touched files also retain older forbidden workflow references, including [sw-resilience.test.ts:212](apps/extension/tests/e2e/sw-resilience.test.ts:212) and [sw-restart-network.test.ts:19](apps/extension/tests/e2e/sw-restart-network.test.ts:19).

What looks fine:

- **SW witness — high confidence:** successful pre-stop detach is awaited before closing. Within this browser’s single registration, newer `timeOrigin` proves replacement; the same global’s value stays fixed. [Specification](https://www.w3.org/TR/hr-time-3/#timeorigin-attribute). `getTargets` takes the first match, but Chromium excludes parked stopped hosts from enumeration and reuses them by version on restart; the proposed parked-plus-new ambiguity does not follow from ordinary recycling. [Chromium source](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/service_worker_devtools_manager.cc).
- **Popup identity — high confidence:** snapshot/listener registration has no asynchronous gap, and auth redirection preserves the popup document URL. Simulations correctly ignored existing-page navigation and rejected new same-URL popups, including one redirected to auth and closed. Observation ends when the result settles.
- **Fixture compatibility/budgets — high confidence:** onboarding tests open their own tabs or reset completion; later register mounts reload the true flag and skip opening. No existing timeout literal increased; cleanup adds polling, and the effective SW bound has the defect above. No E2E configs ran.

not converged

## Round 1 — triage

Adopted:
- M: the fallback probe was not bounded by the 15 s budget (a CDP round trip inside the loop inherits
  the 300 s protocol timeout, and a late witness was accepted after the deadline). `stopServiceWorker`
  is now ONE `Promise.race([destroyed, restarted, deadline])`; the probe loop exits on a `settled` flag.
- M: closing the first-run tab AFTER flipping `onboardingCompleted` let a late-mounting onboarding page
  replace itself with a popup window (`onboarding/app.vue` `openPopupWindowAndClose`) and drop the tracked
  id — the `#/popup/register` page the probes saw. `launchExtension` now closes the tab BEFORE the flip
  and sweeps any popup window on the popup URL after it.
- L: the helper doc compressed to the invariant + the witness; the "cannot itself overlap" claim
  replaced by what is true (a still-stopping worker met by the probe is parked, not resurrected, and
  cannot yield a newer origin); the two import notes deleted; two pre-existing plan references dropped
  from the touched specs.

Re-validated under `taskset -c 0,1`, retry 0: the SW-restart trio × 4 rounds, 4/4.
