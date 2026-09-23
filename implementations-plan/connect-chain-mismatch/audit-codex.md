# connect-chain-mismatch — codex plan audit

Session `01a07268-aca2-79d2-86a7-3eed84474c4d` (gpt-5.6-sol, xhigh, read-only). Prompt: plan.md +
recon.md + the standard packet (adversarial/security · assumption-attack · implementation critique · copy).

## Round 1 — response (verbatim)

**1. Security & adversarial**

- **Medium — I1 understates the change.** A dApp would trigger persistent account creation before capability approval; creation writes storage and emits `onAccountAdded` (`apps/extension/src/wallet/services/account/service.ts:255`). Configured endpoints constrain the target, but “once per chain” is false: unsuccessful creation leaves no default, so subsequent requests can probe again (`account/service.ts:196`; `network/service.ts:375`). Specify bounded retry behavior before accepting this exposure.
- **Medium — `{ chainId, error }` does not guarantee address-free logs.** Error projection preserves message text and scrubs URLs; it deliberately does not redact addresses or arbitrary embedded secrets. Prefer a controlled failure reason over an unrestricted exception message (`apps/extension/src/wallet/logger/utils.ts:163`; `CLAUDE.md:125`).

**2. Assumption attack**

**Facts**

- **Medium — F4 is only an entry check.** The unlocked-profile gate precedes dispatch; account creation subsequently reads the secret, awaits verification/derivation, then checks a deletion fence before writing. A lock after secret acquisition does not necessarily produce `unauthorized`. Correct the claimed guarantee and test both timing cases (`apps/extension/src/wallet/services/wallet-sdk/background.ts:880`; `account/service.ts:227`; `account/service.ts:254`).
- **Low — F8’s reproduction is sound, but “inside the sandbox” overstates isolation.** Testnet has a public RPC, and popup bootstrap starts network-status synchronization. Starting on Testnet therefore retains an external-network dependency (`apps/extension/src/wallet/services/network/service.ts:110`; `apps/extension/src/composables/useProfileBootstrap.ts:77`; `apps/extension/src/stores/app.store.ts:429`).

**Inferences**

- **Medium — I4 has a counterexample:** a chain containing only hidden imported accounts. `getAccounts` returns no visible rows, while `ensureDefaultAccount` excludes imported rows and creates a visible derived account. The proposed flow consequently permits approval instead of preserving the promised all-hidden error. Distinguish zero rows from zero visible rows and pin this case (`apps/extension/src/wallet/services/account/service.ts:168`; `account/service.ts:201`; `account/service.ts:249`).
- **Medium — I1/I2 need revision:** pre-approval mutation is a changed trigger, and operational failure is not evidence of account absence. See the security findings and failure-handling recommendation below.
- **Low — I3/I5 are substantially supported.** Approval constructs CAIP identifiers from window-local selected accounts; the network watcher replaces the shell’s account client/store. Discovery parameters contain only metadata (`apps/extension/src/popup/windows/capabilities/index.vue:202`; `apps/extension/src/popup/app.vue:113`; `apps/extension/src/wallet/services/dapp-interaction/spec.ts:97`). However, activation serialization explicitly covers only one popup realm (`apps/extension/src/utils/guarded-network-activation.ts:15`).

**Asks**

- **Medium — Surface the actual policy choices:** repeated custom-endpoint probes, persistence after the user rejects, and hidden-imported-only behavior. “Accepted once-per-chain probing” does not settle repeatable failure behavior; copy and merge authority do not settle these product decisions.

**3. Implementation critique**

- **Low — (a) Prefer the required dependency and wiring adapter.** Optional provisioning makes correctness depend silently on the host. Keeping account type/name in the extension respects the narrow consumer boundary; `IAccountReader` becomes a misleading name once it provisions accounts (`packages/wallet-bridge/src/services-contract.ts:10`; `services-contract.ts:40`; `apps/extension/src/wallet/services/account/service.ts:196`).
- **Medium — (b) Do not collapse every derivation exception into `[]`.** Prefer rejecting with a sanitized operational error, especially for authorization failure. If wallet-side presentation is required, carry an explicit failure state. Today an empty list becomes a hard error with no recovery path, while the dApp request awaits the interaction (`apps/extension/src/popup/windows/capabilities/index.vue:146`; `packages/wallet-bridge/src/dispatcher.ts:1089`).
- **Low — (c) One thin activation wrapper is reasonable.** Reuse the existing guard and feedback ladder. As C1, receive connected clients or callbacks instead of introducing hidden manager ownership; preserve parent-controlled teardown (`apps/extension/src/popup/pages/settings/networks/[id].vue:68`; `CLAUDE.md:221`; `CLAUDE.md:291`).
- **Low — (d) Compute the name locally.** The session already supplies the chain string and bootstrap supplies network rows. Additional wire metadata adds little; gate the action until a matching row exists (`packages/wallet-bridge/src/session-types.ts:59`; `apps/extension/src/composables/useProfileBootstrap.ts:63`).
- **Medium — (e) Add approval without switching.** The proposed e2e exercises only the optional switch. Assert the returned address, unchanged active network, and successful approval separately. Also cover Approve/Reject during a pending switch and repeated switch clicks: Banner invokes callbacks directly, and its loading prop does not disable the action (`packages/design/src/ui/Banner.vue:58`). Arm popup listeners before triggering requests (`apps/extension/tests/e2e/fixtures/extension.ts:287`).
- **Low — (f) No necessary budget breach.** The cited dispatcher method has 70 nonblank lines; `init()` has 47. Helpers outside those bodies preserve headroom; cognitive complexity still requires measurement, not inference from length (`packages/wallet-bridge/src/dispatcher.ts:1044`; `apps/extension/src/popup/windows/capabilities/index.vue:118`; `CLAUDE.md:82`).

**4. Copy**

- **Medium — Suppress the normal invitation on hard errors.** “Approve as is” is misleading when derivation failure/all-hidden disables Approve. Preserve the locked wording for eligible requests (`apps/extension/src/popup/windows/capabilities/index.vue:361`).

conditional approve (with conditions: correct probe and lock assumptions, preserve all-hidden behavior, distinguish operational failures, gate misleading copy, and add no-switch and switch-race coverage)

## Round 1 — triage

Adopted: the unattended rule (probe-free kinds only, chain has no rows of any kind —
`AccountService.provisionDefaultAccount`, `NetworkService.derivesOffline`); no swallowing (rejections
propagate as the dApp error envelope); F4 corrected to an entry gate; banner hidden while the hard error
shows; no-switch e2e added; re-entry + pending-approve guard on the switch action; the C1 composable
receives persist/read callbacks; the action only with a matching row; `IAccountProvisioner` split instead
of widening `IAccountReader`.

Rejected: a timing test for a lock landing after the secret read (the row write is secret-free and
identical to an in-flight switch — benign); an e2e for approve-vs-switch (a timing race is not a
deterministic browser test; the guard is a two-line check).

## Round 2 — response (verbatim; resumed with the revised plan + Q1–Q3)

**Q1:** Keep the policy in `NetworkService`; exposing `kind` would move its probe rules across the boundary. **Medium:** a boolean preflight alone cannot guarantee offline derivation. A seeded row can be deleted and replaced with a custom row before `ensureDefaultAccount` reaches its separate network lookup, which can then probe. Enforce “offline only” at the resolver’s actual row read, preserving canonical L1 validation (`apps/extension/src/wallet/services/network/service.ts:489`, `:442`, `:368`).

**Q2:** No High findings. Remaining findings:

- **Medium — Restore the visible-account re-read.** Between the initial empty read and provisioning, another caller can create an account. Provisioning then returns `null`, producing a false empty popup. Conversely, after provisioning’s empty check, another caller can create/hide a derived account; `ensureDefaultAccount` can return that hidden row, which the revised dispatcher would project directly. Re-read visible accounts after provisioning, including after `null`; this restores the reusable switch pattern (`apps/extension/src/wallet/services/account/service.ts:198`, `:205`, `:297`; `apps/extension/src/popup/network-switch.ts:73`).

- **Medium — The success banner cannot render.** The planned `mismatch && !noAccountsAvailable` condition becomes false when activation sets the target network. Include a separate confirmed-success branch, tied to the current chain, while keeping the invitation/action mismatch-only (`implementations-plan/connect-chain-mismatch/plan.md:136`; `apps/extension/src/utils/guarded-network-activation.ts:63`).

- **Medium — Switch guards protect only one ordering.** They prevent starting another switch or switching during approval; they do not protect a switch already waiting when Approve/Reject closes the window. Activation awaits a journal refresh before persistence, so closing can abandon the requested switch. Coordinate switch completion/cancellation with closing. A deferred-promise component test makes this deterministic; no timing-dependent e2e is necessary (`apps/extension/src/stores/app.store.ts:213`; `apps/extension/src/utils/guarded-network-activation.ts:67`; `apps/extension/src/popup/windows/capabilities/index.vue:242`, `:260`).

- **Low — Reconcile contradictory instructions.** “Any row → null” contradicts “a second call returns the same row”; Phase 2 still tests manager ownership; the critical flow still describes the old implementation (`implementations-plan/connect-chain-mismatch/plan.md:109`, `:204`, `:212`, `:146`). Also assert the no-switch strip before approval or reopen a wallet popup afterward—the approval window closes (`apps/extension/src/popup/windows/capabilities/index.vue:242`).

The separate provisioner contract and injected activation callbacks otherwise fit the reuse map.

**Q3:** I see no concrete harm justifying deletion on rejection, or a mandatory test for the benign post-secret-read lock case. The persisted account contains public identity/metadata, while capability grants are applied separately after the interaction returns (`apps/extension/src/wallet/services/account/service.ts:241`; `packages/wallet-bridge/src/dispatcher.ts:1107`). Reject-time deletion could instead remove a default another concurrent flow has begun using.

conditional approve (with conditions: enforce offline resolution at use, restore visible-account re-reading, fix success-banner gating, and coordinate pending switches with window closure)

## Round 2 — triage

All four conditions adopted: `unattended` option on `resolveVerifiedL1ChainId` (refusal at the row read
derivation uses, `ERR_UNATTENDED_LIVE_CHECK`) instead of a `derivesOffline` preflight; `provisionDefaultAccount`
returns `void` and the dispatcher re-reads visible rows; two-state banner keyed on `switchedTo` = the
current chain; footer held while `isSwitching` + a deferred-activation component test. Lows fixed (the
"same row" contradiction, the manager-ownership test case, the stale critical flow, the no-switch strip
asserted before approval). Q3: no harm in the row persisting after a reject — kept.

## Round 3 — response (verbatim)

**Q1:** The sentinel throw is clean with respect to the deletion fence. `capture()` only reads the epoch; it acquires no reservation requiring cleanup. The resolver runs before derivation, persistence, and `onAccountAdded`, so catching this specific refusal leaves no write to validate or undo. Preserve the existing capture-before-await ordering and propagate every other error (`apps/extension/src/wallet/services/profile/profile-deletion-state.ts:51`; `apps/extension/src/wallet/services/account/service.ts:224`, `:238`, `:254`).

One **Medium** remains: the new `reject()` guard also blocks **lifecycle cancellation**. `useDappApprovalWindow` invokes that same callback on lock/profile change and `beforeunload`; it is not exclusively the Reject-button handler (`apps/extension/src/composables/useDappApprovalWindow.ts:79`, `:103`; `apps/extension/src/popup/windows/capabilities/index.vue:110`). If locking occurs during activation, rejection becomes a no-op while the shell navigates to authentication, leaving the interaction pending (`apps/extension/src/popup/app.vue:172`).

Guard only the footer’s rejection action; keep lifecycle rejection unconditional. Extend the deferred-activation test with a lock/profile-change event. Actual browser closure already has background cancellation through `WindowManager`, but that does not cover merely navigating away (`apps/extension/src/wallet/services/window-manager/window-manager.ts:102`).

**Low:** Update “Approve stays enabled throughout” to acknowledge the newly authorized switching exception (`implementations-plan/connect-chain-mismatch/plan.md:27`, `:150`).

conditional approve (with conditions: preserve unconditional lifecycle rejection while guarding footer decisions during switching, and pin it with the deferred-activation test)

## Round 3 — triage

Q1 clean. Medium adopted: `reject()` stays unconditional (lifecycle rejection on lock / profile change /
`beforeunload`); only the footer's Reject is held while switching; the component test gains a
profile-change-during-activation case. Low adopted: the "Approve stays enabled throughout" wording.

## Round 4 — response (verbatim)

No remaining material findings in the revised blueprint. All audit conditions are addressed.

approve
**Final verdict: `approve`.**

# Post-implementation loop

Fresh session `01a07294-020b-7c93-9355-7ee3b244428b` (gpt-5.6-sol, xhigh, read-only) over the net diff
from `91074a74`, with plan.md + recon.md, the adversarial ask, and the no-over-engineering +
comment-quality rules. Triage: `lessons/post-impl.md`.

## Round 1 — response (verbatim, paths made repo-relative)

**High:** None found.

**Medium**

- **The banner offers a switch before the dApp’s chain is known.** [capabilities/index.vue:64](apps/extension/src/popup/windows/capabilities/index.vue:64): missing payload becomes `""`, then chain `0`. While loading, a Testnet wallet therefore exposes “Switch wallet to Local Network,” even for a Testnet request, beside disabled Approve. A generic approval failure also disables Approve without hiding the invitation. Gate the banner/action on completed initialization and absence of a hard error. Both cases reproduced with in-memory component probes; existing tests preload the payload before mounting.

- **Provisioning can write after the target network’s account purge finishes.** [account/service.ts:227](apps/extension/src/wallet/services/account/service.ts:227): creation fences profile deletion only. Deleting the inactive target network invokes `clearChainState`, which does not share provisioning’s lock; suspended derivation can subsequently write an orphan account. A deferred service probe confirmed a row appearing after the purge completed. Coordinate provisioning with chain cleanup and the existing network-liveness check. The dispatcher’s re-read merely returns the late row.

- **A concurrent import can be overwritten.** [account/service.ts:223](apps/extension/src/wallet/services/account/service.ts:223): provisioning locks `Nulo_v1`, whereas `importAccount` locks `Imported`. An import of the same deterministic account can finish during provisioning’s awaits; provisioning then replaces its imported type and user-selected name with derived defaults. This reproduced using the real service methods with mocked crypto. Share the creation/import critical section across account types. The new sequential idempotency test covers neither this race nor the purge race.

**Low**

- **Comments retain incorrect explanations.** [capabilities/index.vue:51](apps/extension/src/popup/windows/capabilities/index.vue:51) still describes chain mismatch as the usual cause of missing accounts—the behavior this PR fixes. The new comment at line 156 also lists “only imported” as an empty-picker cause, although visible imported accounts are returned. Replace these with one accurate explanation of why an empty visible-account list blocks approval.

- **Several new comments narrate obvious code.** Trim the introductory paragraphs in [useNetworkActivation.ts:13](apps/extension/src/composables/useNetworkActivation.ts:13) and [chain-mismatch.ts:14](apps/extension/src/popup/windows/capabilities/chain-mismatch.ts:14), plus the self-evident comments on [Banner’s test ID](packages/design/src/ui/Banner.vue:30) and [DEFAULT_ACCOUNT_NAME](apps/extension/src/wallet/services/account/spec.ts:6). Keep the row-snapshot and unconditional-rejection invariants.

- **One test claims a distinction it cannot detect.** [useNetworkActivation.test.ts:116](apps/extension/src/composables/useNetworkActivation.test.ts:116) claims persistence receives the target rather than the store’s row, but those already match when persistence runs. It duplicates the first test’s target-ID assertion; remove it.

**What looks fine**

Unattended refusal uses derivation’s network-row snapshot; seeded L1 validation and error propagation remain intact.  
Grant assembly, footer coordination, and `beforeunload`/profile-change rejection remain intact; no dependencies, crypto changes, or log statements were added.  
233 targeted unit tests passed with one thread worker; four in-memory probes reproduced the findings. No e2e ran.

not converged

## Round 2 — response (verbatim, resumed with the fix diff + the two declined races argued)

**Low — [capabilities/index.vue:79](apps/extension/src/popup/windows/capabilities/index.vue:79):** “The invitation never sits beside a disabled Approve” overstates the invariant: switching and submission intentionally disable Approve while the invitation can remain. Remove the absolute claim or qualify those exceptions.

No remaining material findings. The banner fixes are correct. I accept handling the two storage races separately after confirming both exist in the baseline. The new dApp trigger broadens creation timing, but does not give the dApp control over purge or import.

All 40 targeted unit/component tests passed. No e2e ran.

converged
**Converged after round 2** (the round-2 Low — an overstated comment — folded before the PR).
