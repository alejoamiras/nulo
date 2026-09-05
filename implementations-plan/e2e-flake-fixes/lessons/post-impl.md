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

## Round 2 — `not converged` (2 Medium, 1 Low) — response (verbatim)

- **Medium — CDP work still escapes the deadline** ([helpers.ts:1746](apps/extension/tests/e2e/fixtures/helpers.ts:1746), [helpers.ts:1769](apps/extension/tests/e2e/fixtures/helpers.ts:1769)). **Confidence: high.** `Promise.race` does not cancel the losing probe; `settled` cannot interrupt its pending evaluation, leaving its worker session attached after rejection. Detaching the browser session does not detach that separately created session. Furthermore, the awaited browser-session detach remains outside the deadline. Source-based simulations confirmed rejection at 15 seconds with a worker session still attached, and a stalled browser detach keeping the helper pending beyond 20 seconds. Bound probe operations, clean up their sessions when the race settles, and bound final cleanup.

- **Medium — the popup sweep misses a later mount** ([extension.ts:165](apps/extension/tests/e2e/fixtures/extension.ts:165)). **Confidence: high.** In the explicitly anticipated case where the tab ID misses the five-second poll, `windows.getAll()` can complete before onboarding mounts and creates its replacement popup. The fixture then returns with cleanup finished; the popup appears afterward. Executing the actual cleanup and redirect snippets in that order reproduced this. Cleanup must synchronize with startup-page completion or closure; one window snapshot cannot cover future creation.

- **Low — two comment violations remain.** **Confidence: high.** [sw-restart-network.test.ts:13](apps/extension/tests/e2e/sw-restart-network.test.ts:13) still promises the old *target* is gone; change that to worker instance. Remove “codex audit catch” from [sw-resilience.test.ts:205](apps/extension/tests/e2e/sw-resilience.test.ts:205).

not converged

## Round 2 — triage

Adopted:
- M: the losing probe kept its worker session attached past the deadline and the browser-session
  detach was awaited outside it. Each probe now races `Runtime.evaluate` against a 2 s budget and
  releases its session without awaiting; the browser session's detach is fire-and-forget too.
- M: the popup sweep could run before a late onboarding mount. Rather than synchronize with a page we
  are trying not to have, the fixture states the invariant it relies on — the tab id is stored during
  the worker's boot, which the liveness wait has already seen complete — and reports a miss with a
  `console.warn` instead of pretending a one-shot window snapshot covers the future. The sweep is gone.
- L: "old target to be GONE" → "old worker INSTANCE"; the "(codex audit catch)" review reference
  dropped from a pre-existing comment in the touched file.

Re-validated under `taskset -c 0,1`, retry 0: the SW-restart trio × 3 rounds, 3/3; no warning fired.

## Round 3 — `not converged` (2 Medium) — response (verbatim)

- **Medium — attachment remains outside the probe budget** ([helpers.ts:1695](apps/extension/tests/e2e/fixtures/helpers.ts:1695)). **Confidence: high.** The two-second timer starts only after `createCDPSession()` resolves. Puppeteer’s attachment therefore retains the 300-second protocol timeout. The initial read also precedes the outer 15-second race; a fallback attachment can finish after that race settles and still start evaluating. A source-based simulation remained pending after five seconds with **no probe timer started**. Include attachment in the budget and detach any session arriving after cancellation. Fire-and-forget detach requests release; it does not establish that release has completed.

- **Medium — the onboarding “invariant” is not enforced** ([extension.ts:132](apps/extension/tests/e2e/fixtures/extension.ts:132)). **Confidence: high.** `onInstalled` invokes `void openOrFocusOnboardingTab()` independently of runtime startup. The liveness write never awaits that promise. A simulation using the actual functions published liveness while `tabs.create` remained pending, exhausted the poll, logged the warning, flipped completion, then stored the late tab ID. The replacement-popup race therefore remains; the comment incorrectly claims synchronization. A small deterministic alternative is to require the existing tab-ID wait to succeed on fresh installs and fail setup on expiry, while allowing persisted-profile launches without an install tab. That preserves the timeout and avoids returning a contaminated fixture.

not converged

## Round 3 — triage

Both adopted (refinements of the two threads, not new scope):
- M: `createCDPSession()` sat outside the probe budget (Puppeteer's attach carries the 300 s protocol
  timeout). The whole probe — attach + evaluate — now races the 2 s budget, and a session that arrives
  after the race settled is released when it does (`probe.then(detach, detach)`).
- M: my "the tab id lands during boot" claim was wrong — `onInstalled` fires `void
  openOrFocusOnboardingTab()` and nothing in the boot awaits it, so liveness can precede the id.
  Codex's cheaper deterministic alternative adopted: on a fresh profile the id is REQUIRED within the
  existing 5 s poll and `launchExtension` throws otherwise (an untracked page is a setup failure, not a
  warning); a reused `userDataDir` was installed by an earlier launch, opens no tab, and keeps the poll
  as a courtesy.

Validated: the SW-restart trio × 3 rounds under `taskset -c 0,1` retry 0 → 3/3; full smoke on all cores
with `NULO_E2E_MIGRATION_FIXTURE=1` → 31/31 files (every fixture launches a fresh profile, so the
requirement held on every launch; the `userDataDir` specs `migration` and `import-dead-rpc` green).

## Round 4 (final verdict) — `not converged` (3 Medium) — response (verbatim)

- **Medium — timed-out probes still retain sessions** ([helpers.ts:1710](apps/extension/tests/e2e/fixtures/helpers.ts:1710)). `probe.then(detach, detach)` waits for evaluation to finish, even after timeout. A late attachment also starts evaluation before releasing its session. Both cases reproduced with **zero detach requests after timeout**, until evaluation eventually replied. Request detach immediately when an attached probe times out; skip evaluation and detach immediately when attachment arrives late.

- **Medium — `userDataDir` does not establish a reused profile** ([extension.ts:153](apps/extension/tests/e2e/fixtures/extension.ts:153)). `backup-roundtrip.test.ts:98` and `migration.test.ts:115` create empty directories before passing them here. Those fresh installs bypass the requirement and can still return with a late onboarding page. Determine whether the extension was previously installed rather than treating every supplied directory as reused.

- **Medium — the new setup failure leaks Chrome** ([extension.ts:154](apps/extension/tests/e2e/fixtures/extension.ts:154)). Throwing loses the browser handle before fixture teardown receives it. The failure-path simulation confirmed no browser closure. Close the browser owned by this launch before rejecting.

Confidence: high; verified through source inspection and isolated simulations. No E2E configs ran.

not converged

## Round 4 — triage

The loop's hard stop is round 3; round 4 was the final-verdict pass. It did not converge, but all
three findings are mechanical refinements of the two threads already under review, so they were
applied without a round 5 rather than shipped as open items:

- M (timed-out probes retained their session): the timeout handler now detaches an attached session
  immediately, and an attach that lands after expiry throws before evaluating and is released by the
  rejection handler. A session parked on a stopping worker is the exact hazard the helper exists to
  avoid, so this one was a correctness gap, not a nicety.
- M (`userDataDir` ≠ reused profile): `backup-roundtrip`, `migration` and `import-dead-rpc` all pass a
  freshly `mkdtemp`'d empty dir on first launch, so the requirement silently skipped them. Freshness is
  now read from the filesystem BEFORE Chrome writes the profile (`!userDataDir`, missing, or empty);
  the wallet's `onInstalled` listener opens the tab only for `reason === "install"`, which is exactly
  the never-installed case, so the two notions coincide.
- M (a failed settle stranded Chrome): the post-launch settle moved into `settleLaunchedExtension`,
  and `launchExtension` closes the browser it owns before rethrowing. This also covers the
  pre-existing leak paths (worker discovery / liveness timeouts), which used to rely on the next
  global-setup's pkill.

No further codex round: the residue is the owner's to re-open if they want a fifth pass.
