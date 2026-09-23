# Plan 5 — sw-wallet-protocol — lessons (phase 1: both PRs)

Round-2 plan 5 of 7. Two BL/C PRs: PR-a `wallet/runtime.ts` (#510, 87 → 83), PR-b dispatcher + wallet-sdk background + schema patch + execute window (83 → 74). One resumed codex session for the whole plan (blueprint audit → PR-a review → PR-b review).

## Codex consults (one session, three turns)

| Turn | Ask | Verdict | Folded |
|---|---|---|---|
| 1 | Blueprint audit of the plan | conditional approve | blocked-class retry veto must run BEFORE the awaited blocked-status persist; post-start work (deletion resume → reaper → GC → probe) is one ordered helper with zero awaits, returning the instances `stop()` reads; the runtime keeps zero module-timing-sensitive `chrome.*` listeners, so the split must keep zero awaits on the handler's install path and exactly one `handler.initialize()`; dispatcher route helper must return the handler's exact promise (no wrapping await); capability negotiation keeps the single atomic `applyCapabilityDecision` in the caller; discovery popup block moves as ONE unit including popup-promise creation and map registration |
| 2 | PR-a review | conditional approve (gates) — no code change | pin blind spots noted (an await between `armPostStartWork()` and assignment; SDK-init → liveness → heartbeat order) — source-auditable, not present |
| 3 | PR-b review | conditional approve | (a) the awaited `checkExistingSessionAutoApprove` helper added a yield between the "existing session" lookup and the dedupe-map registration — a same-key discovery B whose lookup resolved right before popup A was denied resumed AFTER A's `finally` released the slot and opened a second popup. Fixed by keeping the lookup await in `handleDiscovery` with a SYNC `autoApproveExistingSession`; pinned by `background.discovery-race.pins.test.ts` (verified red on the pre-fix shape: two popups). (b) `grantedAt`'s `Date.now()` had moved from right after `approvedTypes` into `collectNewGrants` — restored at the original position and passed in |
| 4 | PR-b fix confirmation | see PR body | — |

## Lessons

- **Veto before persist.** A same-lifetime retry veto (`state.retrySafe = false`) must be applied before any awaited write whose REJECTION would otherwise leave the veto unset. The pre-refactor pin (`runtime.blocked-persist.pins.test.ts`) drives a rejected blocked-status write and asserts the single-flight memo stays rejected and the engine ran once.
- **Late-binding holders replace closure late-binding one-for-one.** `initWalletSdkHandler`'s callbacks referenced `handler` / `discoveryQueue` / `switchEpoch` that were assigned after the ctor; hoisting callbacks to module-level factories needs an explicit `late` holder read at call time. It is equivalent for every reachable path (callbacks cannot fire before `initialize()`), and `ConstructorParameters<typeof BackgroundConnectionHandler>[n]` types the factory returns without restating upstream's callback shapes.
- **Nesting rent on listener wrappers.** A validated content-listener wrapper nested inside `addContentListener` inside the ctor's options object scored its two guards at depth 3. Extracting the transport object to a factory drops each guard one level; no need to touch the guard logic.
- **"Awaited helper replacing an awaited span" has a second condition: nothing after the span may be register-immediately.** Wrapping the existing-session lookup in an async helper kept the await count but added a microtask between the lookup's resolution and the dedupe-map registration downstream — enough for a concurrent popup's `finally` to slip in. The rule from plan 3 (a helper that creates a cancellable resource owns create→register) generalizes: the lookup-to-registration span is one continuation, so the lookup await stays in the caller and the classification is a sync helper. `awaitPendingPopupDedupe` is fine (its caller returns right after); `checkDiscoveryPopupCaps` stays sync; the whole popup block — promise creation, map set, durable writes, inner `finally` — is one helper.
- **Route helpers return promises, never await them.** `routeHandlerMethod` returning the handler's exact promise (pinned by identity in `dispatcher.route.pins.test.ts`) keeps rejection timing and the `unwrapResult` path untouched; a bare `Object.create(WalletSdkDispatcher.prototype)` is enough to pin the seam without the service fakes.
- **Explicit clients beat closure capture.** `buildOperationsFromPayload(requested, accountService, networkService, profileId)` takes the transient clients `init` owns and disconnects in its `finally`; the helper never constructs or disconnects them (codex's PR-a-style ownership rule applied to the window).
- **Generator regen is the gate.** Zero inserted directives on both PRs; the post-rebase regen showed no diff (manifest entries are disjoint across plans, so squash-merge rebases stay clean).

## Gotchas (tooling)

- The PR watch script reads the rollup state, which goes stale after a job rerun — watch the specific pending job instead.
- The Bash tool's cwd persists across calls: a `cd packages/…` in one call makes later repo-relative paths fail (`ls apps/…: No such file`). Use absolute paths.
- Under zsh, a bare `echo ===` argument is treated as a glob (`== not found`); quote separators.
- The Monitor tool caps `timeout_ms` at 3,600,000 — a 27-spec e2e battery may outlive one monitor; re-arm on the marker file.
