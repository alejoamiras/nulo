# Cluster F4a — popup form lifecycle + submit gates (enter/latch/double-submit lens)

> Scanner: general agent, 2026-08-22. Verified against source: usePopupEntity, useFormState, useProfileCreateFlow/ImportFlow, all 12 consumers, auth.vue, send.vue, notification.js, PopupManager.vue, popup.store, notification.store, NotificationManager.vue, ConfirmPopup.vue, IncomingTrustPopup.vue, SelectProfilePopup.vue, useProfileBootstrap.ts, account-state/service.ts.

## F4a-1 — `aztecReset` notification deletes whichever profile is active AT CLICK TIME (permanent wrong-profile keystore deletion)

**Severity:** Critical | **Repro confidence:** moderate | **Type:** stale-closure / click-time store read

**Counter-example (exact steps, single context, no devtools):**
1. Extension updated → build-time __SENTINEL__ changed; stored nulo:ui:sentinel stale (utils/core.ts:181-182). Only create/import flows call setSentinel (onboarding/pages/create.vue:53, profile/new-profile-helpers.ts:41), so every mere-unlock user has checkSentinel() === false.
2. User unlocks profile A → routed general → checkNotificationsForShow creates the modal (auth.vue:120 → notification.js:62-63). autoDestroy: false (:22) — sits until clicked.
3. User walks away. Default sessionTtl (30 min) expires → background lock → onActiveProfileChanged(null) fires (popup/app.vue:136-145): closes popups, routes /popup/auth, refetches profiles — NEVER touches notificationStore, so the full-screen modal (z-index 9999) survives the lock.
4. User returns, unlocks profile B → appStore.profile = B.
5. User clicks "Delete Profile" on the still-displayed modal → onConfirm runs managers.profile.deleteProfile(appStore.profile.id) reading the id AT CLICK TIME (notification.js:28) → deletes B — the currently-shown profile — not the A whose reset was requested.

Cross-context variant: another extension context (side panel/full-page window) activates B while popup's modal open; broadcast event re-points appStore.profile behind the modal identically.

**Violated invariant:** destructive confirmation must act on the entity it displayed when rendered.
**Failing path:** composables/notification.js:27-32; render site auth.vue:120; persistence gap app.vue:136-145 (falsy branch clears popups/activity, not notifications).
**Expected vs actual:** "Delete Profile" deletes the profile active when warning appeared; actually deletes currently-active profile (keys + accounts, irreversible).
**Smallest safe fix:** capture id at template build (close over it in onConfirm); belt: purge notificationStore in onActiveProfileChanged(null) branch.
**Instances:** notification.js:28 (delete target), :31 (filter predicate re-reads live id), :32 (profiles[0] falsy wart).

## F4a-2 — `auth.vue` busy-wait has no identity guard: an abandoned unlock continuation hijacks the session to a stale profile

**Severity:** Major | **Repro confidence:** moderate | **Type:** unguarded async resumption / wrong-entity post-await write

**Counter-example:**
1. Auth page, profiles A and B. Type A's password, Enter. unlockProfile(A) resolves; event → bootstrapActiveProfile(A) starts (gen1, ~0.5–2 s). Busy-wait spins (auth.vue:82-84).
2. While A's bootstrap in flight, user clicks profile pill (still rendered above loading button, auth.vue:161-163), picks B in SelectProfilePopup — pure UI preselect, appStore.profile = B, NO service call (SelectProfilePopup.vue:51-58) — types B's password, Enter.
3. unlockProfile(B) resolves → event → bootstrapActiveProfile(B) bumps generation (useProfileBootstrap.ts:117); A's core aborts at its fences; A's stillActive re-read returns B → A's bootstrap never flips isLogined (:160-164).
4. B's bootstrap completes → isLogined = true. BOTH sleep-loops wake (independent 100 ms ticks — order nondeterministic).
5. A's abandoned continuation resumes (auth.vue:107-118): appStore.profile = A (stale object captured pre-await), setLastActiveProfileId(A.id), REPLACES managers.account, re-inits transaction service, router.push(general) — while background's unlocked session is B, and appStore.accounts/appStore.account still hold B's rows (A's tail never refetches them).

Result: header says A, account list and send targets are B's addresses, activity journal fetched under A's id, next-launch preselect poisoned to A. If A's continuation runs last, divergence persists indefinitely; sends execute under B's session from a UI claiming A.

Additional infinite-spin triggers beyond documented SW-restart case: any rejected RPC inside bootstrapActiveProfile (e.g. getProfiles() port error) propagates out of the un-try/caught onActiveProfileChanged listener (app.vue:133-135) → isLogined never set → spinner + isAwaitingResponse stuck forever (finally unreachable at :103-105); likewise lock landing mid-bootstrap leaves stillActive=false with same stuck-loading outcome.

**Violated invariant:** a waiter on a shared readiness flag must re-validate WHICH entity satisfied it before writing entity-scoped state.
**Failing path:** auth.vue:82-84 (wait), :107-118 (unguarded writes).
**Smallest safe fix:** after loop: `if (appStore.profile?.id !== activeProfile.id || !appStore.isLogined) return` before tail; wrap bootstrapActiveProfile call-site in try/catch and release isAwaitingResponse on rejection.
**Instances:** auth.vue:82-84, 107-118; contributing app.vue:133-146, useProfileBootstrap.ts:139-165.

## F4a-3 — `EditProfilePopup` swallows rename failures with zero feedback

**Severity:** Minor | **Repro confidence:** high (needs RPC failure to trigger) | **Type:** silent error-path
Empty catch (err) {} (EditProfilePopup.vue:86-87) releases latch in finally, returns — no toast, no inline error; family convention (EditAccount :63-65, EditNetwork :75-77) shows standard "Something went wrong" toast. Only silent catch among 12 consumers.
**Fix:** catch { openToast({label:"Something went wrong", icon:"warning"}, TOAST_DURATION.LONG) }.

## Verified clean

- Double-fire windows: all 12 consumers + handleSend set latch synchronously before any await; held-Enter auto-repeat dead after first fire.
- usePopupEntity token gate: fast hide→show interleavings, rejecting populations, stale settles all token-guarded.
- Pinned NewContact listener-before-population confirmed identical to documentation; no ADDITIONAL wrong result. NewSender premature duplicate harmless (registerSender idempotent, account-state/service.ts:117-129).
- send.vue submit path: snapshot-before-await args, UUID-scoped placeholder, submitInFlight teardown ownership — no wrong-entity window.
- PopupManager trust queue races closed by ingress/dequeue/purge guards + generation-tokened closures.
- cacheStore.confirm slot clobbering: every writer user-gesture-gated behind blocking modal; settle-once watch + reset-on-hide leave no reachable concurrent-writer sequence.
