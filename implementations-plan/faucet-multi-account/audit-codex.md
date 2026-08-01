# Codex audit transcript — faucet-multi-account

## Round 1 (fresh session, gpt-5.6-sol @ xhigh, read-only) — VERDICT: reject

Session: 019faf61-b76d-70a3-a083-1e7c3aa248b4

## Implementation critique

- **[CRITICAL] Switching currently sends faucet actions to the wrong displayed account.** `TokenCard.vue` captures `props.account` when mounted, while `FaucetView.vue` keys cards only by connected/on-off. After switching A→B, the chip and props show B, but balances and `useFaucetDrip()` remain bound to A. Include the account in the card key or rebuild its account-bound handles reactively, with an integration test proving the next drip uses B.

- **[HIGH] Persistence is not “per wallet.”** One `${appId}:selected-account` record is overwritten by wallet B, so A→B→A forgets A’s selection. Use a bounded, validated wallet-id→address map or wallet-scoped keys. “Naturally superseded” contradicts the fixed requirement.

- **[HIGH] The pause mechanism is underspecified.** “Capture a continuation” does not define a single-use claimant like verification’s `pending = null`. Use a structured `pendingAccountChoice = {epoch, wallet, provider}` token. On pause, return from `requestCapabilities` without resolving through setup while retaining `activeFlowEpoch`; confirm must atomically clear the token and set `"setting-up"` before calling a shared `finishSetup(token)` tail. `cleanupSession()` must null it. Avoid a deferred Promise/resolver: cancellation and rejection become harder to prove.

- **[HIGH] The proposed `Popover` is not reusable as-is.** It defaults to teleporting into `#popover`, which faucet’s `index.html` does not provide. It also contains a documented open→close-before-`nextTick` null-cleanup crash and lacks unmount cleanup. Either repair it with design-package tests or use a local dropdown/pass a valid target; the “no design changes” assumption is currently untenable.

- **[HIGH] Single-account users lose Disconnect.** The plan moves Disconnect into the dropdown, then removes the dropdown for one account. Retain a direct disconnect action or keep a session-actions menu.

- **[MED] The proposed trigger creates nested buttons.** `AddressDisplay` is itself a `<button>`, so placing it inside a whole-chip `<button>` is invalid and makes copy clicks toggle the menu. Use non-interactive address text in the trigger or sibling controls.

## Assumption attack

### Facts

- **[CRITICAL] F3 is false.** Faucet drip/balance state is captured at component mount, not action start. The bridge journal also re-reads the current `selectedAccount` during claim recovery.
- **[MED] F3’s BridgeForm implication is misstated.** Its watcher only disposes/recreates the L2 balance handle; it does not reset amount, stage, stepper, or receipt.
- **[MED] F6 proves export, not suitability.** The missing teleport root and known lifecycle race invalidate reuse-as-is.
- **[LOW] F2 is true in code, but comments in `App.vue` and the session config still claim independent sessions and should be corrected.

### Inferences

- **[HIGH] I1 is only safe with an explicit single-use token and shared setup tail.** Add tests for confirm-vs-disconnect ordering, double confirm, cancel followed immediately by reconnect, stale setup completion, and retry→choice→cancel/confirm.
- **[CRITICAL] I2 is false today.** Besides the stale TokenCard, switching during an already-open wallet prompt makes the chip say B while the pending RPC explicitly spends from A.
- **[HIGH] I3 is false:** no form reset exists.
- **[LOW] I4 is sound if the modal remains solely in `App.vue`.

### Asks

- **[HIGH] Define switching semantics during active drip/bridge/fuel operations.** Either temporarily disable switching or visibly pin/name the operation’s captured account through prompt, stepper, and receipt.
- **[HIGH] Define genuine A→B→A persistence and acknowledge that provider IDs are claimed identifiers, not authenticated wallet identities.
- **[MED] Decide whether successful one-account connections are remembered; “explicit choices only” means later expanded grants unexpectedly prompt.

## Adversarial/security

- **[HIGH] Grant parsing is not hardened.** `extractGrantedAccounts()` assumes `accounts` is an array and entries/aliases have the expected shape; malformed entries, throwing `toString`, invalid/empty addresses, duplicates, or huge lists can crash or exhaust rendering. Validate canonical Aztec addresses, string aliases, count/length bounds, and deduplicate before publishing reactive state.
- **[MED] Alias capping does not stop bidi/control-character spoofing.** Isolate or sanitize aliases and keep an unambiguous address visible.
- **[MED] Storage tampering can silently select another currently granted account.** That is a meaningful account-confusion outcome, not merely harmless validation success; document the residual risk and visibly signal remembered auto-selection.

## Scope and phasing

- **[HIGH] Add a consumer-correctness phase before enabling the switcher:** TokenCard remount/reactivity, bridge-operation account semantics, balance re-keying, and add-token state.
- **[MED] `createAztecWalletSession.test.ts` does not currently exist; the plan says “extend” it. Define whether tests move to a factory-focused file or extend the existing singleton suite.
- **[MED] Add hostile-grant, A→B→A persistence, storage-failure, Popover lifecycle, and cross-component switch tests.
- **[MED] Modal requirements need radio/selection semantics, initial focus, focus trap/restoration, labelled dialog, and duplicate-testid handling across three always-mounted panels.

Looks fine: one shared singleton, app-level choice modal, retaining `activeFlowEpoch` while paused, explicit wallet-side `from` validation, and the validation commands.

VERDICT: reject (blocking: stale-account faucet execution, non-per-wallet persistence, undefined single-use pause continuation, and broken disconnect/dropdown design)
## Round 2 (resumed session, xhigh) — VERDICT: reject

## Remaining blockers

- **[HIGH] Busy gating must be enforced at the mutation boundary.** `selectAccount()` is exported session API; UI-only disabling permits programmatic/future callers to switch mid-operation, recreating chip-versus-RPC confusion. Make `selectAccount()` reject while the shared registry is busy.

- **[HIGH] Busy coverage is incomplete.** `useFaucetAddToken`/`BridgeAddToken`, journal-card retries, and `resumeSessionWork()` can perform account-sensitive wallet work outside the four proposed wrappers. Define the invariant around every account-sensitive prompt/send, preferably with an idempotent release closure or `withOperation()` helper rather than raw counter increments.

- **[HIGH] `finishSetup` lacks explicit error ownership.** The auto path remains inside `requestCapabilities`’ catch, but the later confirm path will not unless specified. `finishSetup` itself—or both callers identically—must normalize errors, set `"error"`, clear/retain retry state deliberately, and `releaseFlowIfOwner`. Also state explicitly that confirm sets `selectedAccount` before invoking it. The plan currently contradicts itself about persisting before versus after setup.

- **[HIGH] The specified address API does not exist.** This Aztec version exposes `AztecAddress.fromStringUnsafe`, `AztecAddress.schema`, and async `isValid()`, but no `AztecAddress.fromString`. Decide whether parsing becomes async and validates curve membership, or use schema parsing plus a documented validation level.

- **[HIGH] BridgeForm reset needs ownership cleanup.** Resetting `stage/receipt/amount` while an owned journal record exists can leave `ownedId`/foreground suppression stranded. Reuse the existing background/reset path so account change releases foreground safely and clears associated errors.

## New-decision attack

- **[MED] LRU 8 is defensible**, provided read and write both cap, dedupe wallet IDs, bound strings, and reinsert atomically.

- **[MED] Grant cap 16 is defensible for DoS resistance, but silently dropping account 17 recreates the original hidden-account problem.** Reject oversized grants with a user-visible error or visibly disclose truncation; `console.warn` is insufficient.

- **[MED] The auto-selection toast is useful signal, not a security control.** The persistent chip is the real safeguard. Ensure the toast fires exactly once from an app-level owner; three always-mounted panels must not each emit it.

- **[MED] Menu rows remain ambiguous:** if the selectable row is a button containing `AddressDisplay`, nested buttons return. Specify a selection button plus sibling copy control.

## D-15 and phasing

- **[MED][CONCEDED] D-15 is correct.** `createAztecWalletSession.test.ts` exists and is a 664-line factory suite. My round-1 claim was erroneous.

- **[LOW] Five phases are appropriately sized for light tier.** Phase 2 should absorb the complete busy-invariant coverage and BridgeForm ownership cleanup; Phase 1 should test setup rejection after resumed confirmation.

VERDICT: reject (blocking: central busy invariant and coverage, nonexistent address-validation API, finishSetup error ownership, and BridgeForm ownership cleanup)
## Round 3 (resumed session, xhigh) — VERDICT: conditional approve

No remaining CRITICAL/HIGH findings. V3 resolves the state-machine, mutation-boundary, consumer-binding, persistence, and ownership blockers.

- **[MED] `resumeSessionWork()` is currently synchronous and fire-and-forget.** Wrapping that outer function with `withOperation()` would release immediately. Wrap each spawned `runDepositClaim`/`runWithdrawConsume` promise, or refactor it to return an awaited aggregate. Include this in the mid-operation switch test matrix.

- **[MED] Round-trip parsing is syntactic, not curve-validity enforcement.** Dispatcher membership validation proves authorization, not that an address can receive encrypted notes. Given the light/testnet scope, the documented residual is acceptable, but correct the security wording and test the resulting behavior for a syntactically valid, curve-invalid address.

- **[MED] Toast ownership still needs explicit session signals.** A module-level watcher cannot infer “remembered auto-selection” or `N > 16` from ordinary `selectedAccount/status` changes alone. Expose consumable reason/count metadata or a monotonically keyed notification ref, then test exactly-once emission and reset cleanup.

- **[LOW] For menu semantics**, give the `<li>` wrapper `role="none"` and define keyboard treatment for the sibling copy control so the menu’s focus model remains coherent.

The five phases remain right-sized. These items fit naturally within Phases 1–4 and their existing typecheck/lint/unit gates; they do not require another architecture round.

VERDICT: conditional approve (conditions: wrap spawned journal continuations rather than the void dispatcher, define explicit one-shot toast metadata, and accurately document/test syntactic-only address validation)
## Post-impl round 1 (resumed session, xhigh) — VERDICT: reject

No CRITICAL findings. Two HIGH blockers remain despite the green suite.

- **HIGH — Journal actions can target the wrong displayed account.** `visibleRecords` is not scoped by `selectedAccount`; only private claims enforce an account mismatch. Public deposit claims and standalone Fuel Juice claims use the record’s recipient directly. With A and B both granted, the chip can show B while an action successfully sends from A. This violates “selection drives all tabs” and diverges from v4’s live journal re-scoping without a ledger entry. See [useBridgeJournal.ts](/home/homelab/Projects/nulo/.claude/worktrees/faucet-multi-account/apps/faucet/src/composables/useBridgeJournal.ts:923).

- **HIGH — Operation-span coverage is incomplete.** `claimFuelStandalone()` is entirely outside `withOperation`, and the detached `void sendStandaloneFjClaim(...)` launched during a deposit claim is not independently wrapped. The enclosing operation is not guaranteed to remain active through that detached wallet prompt/send, permitting a mid-operation account switch. See [useDeposit.ts](/home/homelab/Projects/nulo/.claude/worktrees/faucet-multi-account/apps/faucet/src/composables/useDeposit.ts:220) and [useDeposit.ts](/home/homelab/Projects/nulo/.claude/worktrees/faucet-multi-account/apps/faucet/src/composables/useDeposit.ts:578).

- **MED — Storage hardening diverges from D-23.** Reads bound wallet IDs, but `writeRememberedAccount()` inserts the current provider ID without the 256-character bound before serialization. A hostile provider can repeatedly trigger oversized writes/quota failures.

- **MED — D-30’s test does not prove its claim.** The “syntactically valid without proving curve validity” fixture uses address `0x…02`, which `isValid()` reports as valid. It also lacks the promised normal RPC-failure-path assertion. The implementation documentation is correct; the test evidence is not.

- **MED — Modal focus behavior remains imperfect.** The trap’s selector includes buttons with `tabindex="-1"`, undermining roving-tabindex boundary detection; initial focus lands on the dialog rather than the selected/first radio. The immediate-watcher TDZ fix itself is correct, but this mount-while-open path lacks a focused regression test.

- **LOW — AccountSwitcher avoids nested interactive elements and handles Escape/outside close correctly, but disabled rows remain in Arrow-key traversal.**

R3 condition 2 landed fully. Condition 1 landed for the named journal continuations but not the complete invariant. Condition 3 landed in documentation, but its test is invalid. The pause-token/`finishSetup` state machine otherwise withstands disconnect, retry, stale completion, and double-entry attacks.

VERDICT: reject (blocking: wrong-account journal actions and unguarded standalone Fuel Juice wallet-operation spans)
## Post-impl round 2 (resumed session, xhigh) — VERDICT: approve

No remaining CRITICAL/HIGH findings.

- **Verified:** All deposit claims now reject account mismatches before wallet work. Keeping records visible while enforcing ownership is coherent and explicitly ledgered.
- **Verified:** Both standalone Fuel Juice paths acquire independent `withOperation` spans; the detached `.catch` behavior remains intact.
- **Verified:** Selected-account persistence rejects oversized identifiers. I independently confirmed `0x…03` round-trips syntactically and `await isValid()` returns `false`.
- **Verified:** Modal focus/trap and disabled-row Arrow navigation fixes are correct. Withdraw consume is legitimately L1-only.

Noted residuals:

- **MED:** Both account guards allow execution when the active account is `null`; they only reject a truthy mismatch. Normal UI paths make this unlikely, but fail-closed enforcement should require `active === recipient`.
- **MED:** The new standalone guard and two operation-span placements lack direct regression tests.
- **LOW:** The preferred-wallet storage path still accepts an unbounded provider ID, although the selected-account map is now bounded.
- **LOW:** D-30’s older ledger wording still claims a normal RPC-error-path test; the suite only tests parser acceptance. The curve-invalid fixture itself is now valid evidence.

VERDICT: approve
## Labels round (phase 6, resumed session, xhigh) — VERDICT: conditional approve

No CRITICAL/HIGH findings. Two MED bugs remain.

- **MED — Malformed journal recipients can crash card rendering.** `acct` calls `addr.toLowerCase()`, but `loadJournal()` accepts any object with string `id` and valid `direction`; it does not validate `recipient`. I confirmed a numeric recipient survives loading. One otherwise valid tampered record can therefore throw during render. Empty recipients avoid the crash but produce no tag and bypass the engine’s recipient-mismatch comparison before later address parsing fails. Validate/quarantine non-string, empty, or noncanonical recipients before rendering and acting.

- **MED — Switch redirects can appear enabled while switching is impossible.** `offerSwitch` ignores connection status. During `setting-up`, or after setup failure where grants remain populated, another-account cards show an enabled switch button, but `selectAccount()` rejects because status is not `"connected"`; clicking silently does nothing. Include session status in the button gate. The card test mock exposes only accounts/selection, so this state is currently untested.

- **LOW — Visually empty aliases defeat fallback.** Whitespace/zero-width aliases are truthy, yielding weak toast/button text such as `SWITCH TO`. Vue escaping and alias caps prevent injection, and the tag includes the address, but label selection should use a trimmed/visibly-nonempty alias.

- **LOW — Header wrapping can separate age and corner control.** Because `.age` owns `margin-left:auto` independently, narrow widths may place the age and clear/backup button awkwardly across wrapped lines.

The action matrix otherwise holds: claim variants and switch are mutually exclusive; completed fuel recovery cannot overlap normal claim; discard remains available; non-granted recipients retain the guarded action. Case-insensitive matching followed by the canonical exact selection argument is correct. Withdraw and direct-Fuel handling are also correct.

Targeted Vitest execution was blocked only by the read-only sandbox preventing Vite’s `.vite-temp` write.

VERDICT: conditional approve (conditions: harden malformed journal recipients before rendering/matching, and disable journal switch redirects unless the session is connected)
## Labels confirmation round — VERDICT: approve

Confirmed. All conditions are addressed:

- Malformed/empty recipients no longer crash rendering; the engine short-circuits to `mismatch` before parsing or wallet work.
- Switch redirects require `"connected"` status, preserving the canonical exact-address selection path.
- Alias sanitization now strips zero-width characters/BOM and trims whitespace, activating address fallbacks correctly.
- Regression tests cover each path, including proving malformed recipients never reach `claim`.

Only the accepted narrow-width header cosmetic remains.

VERDICT: approve