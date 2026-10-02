# b07-popup-boot-state — codex

Scope read:

- Orientation: `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`; the supplied `_outer.md`, `extension-popup.md`, and handoff excerpts from `extension-shared-ui.md` and `extension-wallet.md`; quality-run leads; both prior bug reports and the August 24 adjudication.
- Popup boot: `apps/extension/src/popup/{index,route-guard,auth-guard,boot-session,apply-boot-outcome,reconcile-locked-boot,profile-bootstrap,network-switch,locked-state,lock-landing,scope-epoch,root-flags,should-advance-to-general}.ts`, and `app.vue`.
- Stores: `apps/extension/src/stores/{app,popup,cache}.store.ts`.
- Pages: `apps/extension/src/popup/pages/{auth,register,import,send}.vue`, `import-helpers.ts`, all production `send-*.ts` helpers, and `settings/advanced/index.vue`.
- Onboarding: `app.vue`, `index.ts`, `legal-guard.ts`, and script blocks in all onboarding pages and components.
- Immediate handoffs: `useProfileBootstrap.ts`; account/profile/trust popup handlers; `settings/accounts/index.vue`; `utils/{core,lastActiveProfile,storage,guarded-network-activation,in-flight-send}.ts`; relevant profile, account, network, journal, config, and logger handlers; messaging request/disconnect implementations.
- Regression coverage: relevant boot, auth, store, send, import, and onboarding test excerpts.

Validation used source inspection and source-extracted functions with inert, in-memory dependencies. No files were written or services started.

## b07-popup-boot-state-X-1: [Major] Late preference reads overwrite a newer profile selection

**Title:** Late preference reads overwrite a newer profile selection.

**Severity:** Major.

**Repro confidence:** High. Both affected assignment paths reproduced with source-extracted functions.

**Type:** race; state invariant violation.

**Counter-example:** Profiles A and B exist; the remembered profile is A. The auth page reads that preference and waits for `getProfiles()`. Another open wallet window unlocks B, and this popup’s activation handler establishes B. The older profile-list request then resolves. The auth mount callback assigns A, even if B’s activation has already set `isLogined=true` and navigated away. The resulting store contains profile A alongside B’s authenticated state. The route guard has the same failure when its initially empty-profile fallback is overtaken by B’s activation.

**Violated invariant:** Background services own authoritative session state (`ARCHITECTURE.md`, §4). A lock-screen preference must not replace an identity established by a newer activation. `auth.vue:177` already enforces this principle for the unlock continuation.

**Failing path:** `auth.vue:200` mount callback → remembered-profile read at `:205` → profile-list await at `:207` → unconditional assignment at `:208`. Separately, `lateDecision()` in `route-guard.ts:47` checks absence only before its awaits, then assigns at `:52`.

**Expected vs actual behavior:** Newer activation or user selection wins. Instead, an old preference response restores A without clearing or rebuilding the remaining authenticated state.

**Recommended fix:** Remove the redundant auth-page preference assignment and let boot/router selection own it. Fence the router fallback across its awaits so it commits only while the original unresolved identity remains current.

**Instances:** `apps/extension/src/popup/pages/auth.vue:200–209`; `apps/extension/src/popup/route-guard.ts:47–52`.

## b07-popup-boot-state-X-2: [Major] Pending account selections can install an account from a departed profile

**Title:** Pending account selections can install an account from a departed profile.

**Severity:** Major.

**Repro confidence:** High. The captured account was installed and persisted after the simulated profile transition.

**Type:** race; state invariant violation.

**Counter-example:** In profile A, select account A2. `commitScopeChange()` starts its journal refresh and waits. Another wallet window locks A and unlocks B; this popup completes B’s bootstrap and journal refresh, with no sends running. The older A journal read finally resolves. Its internal generation check correctly discards the stale rows, but returns normally. The original `commitScopeChange()` now checks B’s clear in-flight state and invokes the still-captured `selectAccount(A2)`. The popup remains on profile/network B while its active account becomes A2; A2 is also written to `nulo:ui:activeAccount`.

**Violated invariant:** Account selection must remain bound to its originating profile/network. The sibling `commitAccountTarget()` explicitly checks `superseded()` inside its commit callback at `app.store.ts:439`; the affected callbacks omit that check.

**Failing path:** `AccountsPopup.vue:37` → `commitScopeChange()` at `app.store.ts:252–258` → stale refresh exits at `:295` → caller proceeds at `:257–258` → `selectAccount()` assigns and persists the captured account at `:376–380`.

**Expected vs actual behavior:** A selection belonging to the departed scope is abandoned. Instead, the current scope’s lack of pending sends authorizes an obsolete selection.

**Recommended fix:** Capture the originating scope/epoch and recheck it inside each account-selection commit, following `commitAccountTarget()`. Alternatively, provide a shared scope-bound commit API; checking only for pending sends does not establish that the target still belongs to the displayed profile.

**Instances:** Shared await/commit boundary: `apps/extension/src/stores/app.store.ts:252–258`. Unfenced account commits: `app.store.ts:396–398`, `apps/extension/src/popup/components/popups/AccountsPopup.vue:37`, `apps/extension/src/popup/pages/settings/accounts/index.vue:40`, and `apps/extension/src/popup/components/popups/NewAccountPopup.vue:80–82`. The same missing post-await identity check affects profile/network callbacks at `SelectProfilePopup.vue:53–55` and `apps/extension/src/utils/guarded-network-activation.ts:62–64,76–78`.

## b07-popup-boot-state-X-3: [Major] A lock during boot can hide the unlock form behind a false startup failure

**Title:** A lock during boot can hide the unlock form behind a false startup failure.

**Severity:** Major.

**Repro confidence:** High. The real reconciliation and outcome functions accepted the obsolete failure after a newer lock event.

**Type:** race; bad error path.

**Counter-example:** A newly opened popup reads active profile A and begins bootstrapping. Another window locks A before a bootstrap network request captures its execution fence. The lock event reaches the popup and routes it to auth. The network request then rejects with `Wallet locked`. Boot converts that rejection to `kind: "failed"`. Because event supersession is checked only for `kind: "locked"`, the older boot result installs a failure banner and hides the password/passkey form. The wallet is actually locked and needs an ordinary unlock.

**Violated invariant:** `BootSessionResult` defines `failed` as an **open session** whose activation failed. A newer lock event owns the resulting locked state; an obsolete bootstrap must not overwrite it.

**Failing path:** `app.vue:311–324` → `resolveBootSession()` catches the bootstrap rejection at `boot-session.ts:57–60` → `reconcileLockedBoot()` returns non-locked results before its event fence at `reconcile-locked-boot.ts:39–40` → `applyBootOutcome()` installs failure at `apply-boot-outcome.ts:42–44` → `auth.vue:63,248` withholds the form. The ordinary lock-induced rejection is supported by `network/service.ts:242` and `profile/service.ts:525–526`.

**Expected vs actual behavior:** Remain on a usable unlock screen. Instead, the screen claims startup failed and requires an unnecessary boot retry before unlocking.

**Recommended fix:** Apply event supersession to failed boot outcomes before committing them. Ensure obsolete runs still settle retry bookkeeping, as the existing `event-superseded` outcome does.

**Instances:** `apps/extension/src/popup/reconcile-locked-boot.ts:39–40`; classification at `apps/extension/src/popup/boot-session.ts:57–60`; application at `apps/extension/src/popup/apply-boot-outcome.ts:42–44`.

## b07-popup-boot-state-X-4: [Minor] Developer Mode can persist as off while Debug Mode remains enabled

**Title:** Developer Mode can persist as off while Debug Mode remains enabled.

**Severity:** Minor.

**Repro confidence:** High. Reproduced the partial durable state with the page’s actual update functions.

**Type:** state invariant violation; bad error path.

**Counter-example:** Start with `developerMode=true`, `debugMode=true`, and `indicateFailures=false`. Turn Developer Mode off. Its write succeeds, persisting `{developerMode:false, debugMode:true}`. The separate debug-disable write fails. After a worker restart, that persisted configuration loads: debug logging is enabled, but its control is hidden because Developer Mode is off. Opening Advanced Settings merely reads these values and does not repair them.

**Violated invariant:** The page explicitly couples Developer Mode off to Debug Mode off (`advanced/index.vue:124–127`) while making the Debug Mode control visible only under Developer Mode (`:87–91`).

**Failing path:** `updateSetting("developerMode", false)` at `advanced/index.vue:108–114` → `applySetting()` changes visibility and launches independent child writes at `:120–127` → child failure is swallowed after a toast at `:115–116`. `ConfigStore.set()` mutates memory before persistence (`wallet/config/store.ts:64–66`), so the failed debug write initially changes memory but leaves disk unchanged. On restart, `LoggerStore` reads the surviving debug flag at `wallet/logger/store.ts:27`.

**Expected vs actual behavior:** Disabling Developer Mode durably disables its dependent settings, or reports failure while retaining accessible controls. Instead, the parent setting succeeds independently and hides a child setting that returns enabled after restart.

**Recommended fix:** Persist the parent and dependent resets in one awaited configuration transaction, publishing the resulting settings only after that transaction succeeds.

**Instances:** `apps/extension/src/popup/pages/settings/advanced/index.vue:108–127`; both dependent writes at `:125,127`; event-driven entry at `:140–144`.

## Leads adjudicated

- **q07-popup-pages-claude — Developer Mode cascade:** Confirmed → **b07-popup-boot-state-X-4**. Correction: a storage-write rejection occurs after the in-memory debug flag changes; the durable inconsistency becomes active again on worker restart. Developer Mode off still disables log persistence.

## Routed to security

- `apps/extension/src/popup/components/popups/PopupManager.vue:76–101,293–298`: with one trust prompt open and another queued, locking calls `closeAll()` but retains the identity triple; the close watcher dequeues and opens the next prompt without checking `isLogined`, exposing receive/token metadata over the lock screen (`locked-state.ts:19–27`).

## Non-findings considered

- **Prior N-08:** The reported unlock-handler continuation and unbounded activation wait are repaired; X-1 concerns separate preference-read assignments.
- **Prior N-05:** Network-switch results now check generation and live scope after awaits.
- **Prior B-27:** Import recovery joins the current same-profile bootstrap instead of replacing its clients concurrently.
- **Prior B-25:** Send balance additions now mutate the array through `applyBalanceAdd()`.
- **Prior B-26/B-28:** Trust decisions have a submit latch, payload-key check, and captured toast label.
- **Prior B-30:** Send disconnects its execution client on abandonment and transfers teardown ownership to settlement after submission.
- **Send double-submit:** `isSending=true` is assigned synchronously before submission; no double-click window found.
- **Plain journal-refresh snapshot overwrite:** Explicitly characterized by `app.store.in-flight.test.ts:247–255`; excluded as pinned behavior.
- **Direct account-edit RPC returning after client replacement:** Current synchronous port registration and pending-request rejection invalidate the older transport-immunity argument; no separate finding established.
- **Onboarding import continuing without an active session:** Explicitly documented: later onboarding pages need no session, and the popup subsequently requests unlock.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **b07-popup-boot-state-C-1 — Partially agree; high confidence.** Lock-triggered reopening and silently discarded decisions are real (`apps/extension/src/popup/components/popups/PopupManager.vue:80–101,293–298`; `IncomingTrustPopup.vue:103–110`). However, “the triple watcher does not fire” is incorrect: unlock bootstrap clears and restores the network (`apps/extension/src/composables/useProfileBootstrap.ts:56,71`). Replay still fails because the remembered key survives (`PopupManager.vue:177–180`). The proposed retained-queue fix is incomplete: the intermediate missing network also purges queued entries (`:196–199`); reset replay state across lock/unlock. Minor is defensible for the functional impact.
- **C-1’s security dismissal is unsupported.** Public contract addresses do not make their association with this wallet’s received transfers public. Keep the functional finding, but also route the locked-screen disclosure to security.

**2. Rejected leads that are real**

- **Developer Mode cascade — disagree with rejection; high confidence.** A worker restart between writes is unnecessary: the child storage write itself can reject (`apps/extension/src/wallet/config/store.ts:64–66`). With `indicateFailures=false`, the successful parent write persists `developerMode=false, debugMode=true`; the failed debug-disable write changes memory only. A later restart restores hidden Debug Mode. The toast neither rolls back nor repairs that configuration (`apps/extension/src/popup/pages/settings/advanced/index.vue:115–127,148–153`). This is **X-4**, a Minor invariant violation.
- **Boot-race rejection is too broad; high confidence.** `isCurrent()` tracks boot-run supersession, while the separate event-sequence fence is bypassed for every non-locked result (`apps/extension/src/popup/reconcile-locked-boot.ts:38–40`). A bootstrap failure following a newer lock remains actionable: **X-3**.
- **Conversely, accept C-1’s functional consequence.** My initial report routed the disclosure to security but did not separately retain the silently drained decision queue.

**3. What Claude missed that I still stand by**

- **b07-popup-boot-state-X-1:** Late preference reads overwrite a newer selected/activated profile without checking identity or component lifetime (`apps/extension/src/popup/pages/auth.vue:205–208`; `apps/extension/src/popup/route-guard.ts:47–52`).
- **b07-popup-boot-state-X-2:** An account pick waiting on journal refresh can commit its captured A account after B activates; discarding stale journal rows returns normally, allowing the old callback to proceed (`apps/extension/src/stores/app.store.ts:252–258,295,376–380`). The correctly fenced sibling at `:438–440` demonstrates the missing check.
- **b07-popup-boot-state-X-3:** A lock-induced bootstrap rejection becomes `failed`, bypasses event supersession, and withholds the unlock form despite the session being locked (`apps/extension/src/popup/boot-session.ts:57–60`; `reconcile-locked-boot.ts:39`; `pages/auth.vue:63,248`).
- **b07-popup-boot-state-X-4:** The durable Developer Mode/Debug Mode inconsistency described above remains confirmed.

**4. What both missed**

No additional finding established in this light pass.