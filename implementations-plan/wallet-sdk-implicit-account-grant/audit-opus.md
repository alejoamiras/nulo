# Opus 4.7 audit — plan v1

Independent senior reviewer audit, sent in parallel with codex. Plan reviewed: `plan.md` (v1).

---

## 1. Verdict

**Ship-with-changes.** Diagnosis is correct, design is the right call, but the implementation sketch has two real bugs and one UX dead-end the plan doesn't catch. Fix those plus tighten three audit questions before approving.

## 2. Diagnosis correctness

The root cause holds up cleanly.

- `dispatcher.ts:253-262` — `handleGetAccounts` returns `[]` when `dappSession.accounts` is empty. Verified verbatim against the plan's quote.
- `background.ts:396-406` — session is created with empty `accounts` and zero grants. The "will be populated via getAccounts()" comment on line 391 is misleading; it actually implies `requestCapabilities()`, not `getAccounts()`. That comment should be tightened in this PR.
- `aztec-faucet/src/lib/use-wallet-connect.ts:93-114` — the fallback only fires on `throw`. Empty array silently kills the flow. The plan is exactly right that returning `[]` is "the worst of both worlds".
- `enforceCapability` (`dispatcher.ts:560-575`) exempts `getAccounts` via `EXEMPT_METHODS` in `capability-map.ts:14`, so there's nothing already throwing — the plan's "lazy grant inside the handler" framing is the correct seam.

One nit on the §2 narrative: it should also note that `resolveNetworkAndAccount` (`dispatcher.ts:766-784`) throws `"No accounts authorized..."` for *other* account-bound methods after the empty-accounts state — i.e. the rest of the dispatcher has already adopted a throw posture. `handleGetAccounts` is the inconsistent one. That observation strengthens the case for the fix.

## 3. Design correctness

Lazy implicit grant is the right call. I'd add one option the plan didn't list:

- **Option D: throw with a structured "needs accounts capability" error code.** The wallet-sdk could grow a convention (analogous to EIP-1193 `4100`) so dApps can react programmatically without code-string matching. Cleaner than B in principle, but **rejected for the same reason as B**: it requires upstream coordination and dApp adoption you don't control. Worth a single sentence in §3's rejection table so codex can't ding you for missing it.

The §3 contract table is solid. The "session has accounts grant but zero accounts AND no rejection" path (theoretical desync) deserves an explicit row — the plan currently lumps it into row 3, but it's a different failure mode (the wallet shipped a bad write, not the user rejecting). I'd return `[]` there too, but log a warning.

## 4. Implementation risks

Two concrete bugs in §4 Phase 1:

**Bug A — `enforceCapability` runs first and short-circuits the synthetic call.** In `dispatch()` (`dispatcher.ts:212`), `enforceCapability` runs **before** the per-method dispatch. When you call `this.handleRequestCapabilities(syntheticManifest, ctx)` directly (not via `this.dispatch(...)`), you bypass `enforceCapability` and `enforceScope` — which is what the plan wants. But: `requestCapabilities` is in `EXEMPT_METHODS` anyway, so even routing through `dispatch` would skip enforcement. **The plan's "recursion safety" framing is mostly wrong in detail**: the loop risk isn't enforcement, it's that `dispatch("requestCapabilities", ...)` ends up calling `handleRequestCapabilities` directly via the early return on line 218-220. So a recursive `dispatch` would call `handleRequestCapabilities` exactly once and return — no infinite loop. The direct call is still cleaner, but rewrite the rationale in §4 Phase 1 note 3 and §8 risk #2.

**Bug B — `delta.length === 0` early-return interaction.** In the §8 risk #2 ("two popups") mitigation, the plan claims the second `requestCapabilities` would be suppressed because the existing accounts grant covers it. Verify: after implicit approval, `dappSession.capabilityGrants` contains an `accounts` record with `{canGet: true, canCreateAuthWit: false}`. If the dApp's later explicit call asks for `{type: "accounts", canCreateAuthWit: true}`, the delta filter at `dispatcher.ts:380-382` uses `grantedTypes.has(cap.type)` — a **type-only check, no shape comparison**. So a dApp upgrading from `canGet` to `canCreateAuthWit` would NOT trigger a second popup. That's a real authority-escalation bug, not just a UX nit. The plan's `canCreateAuthWit: false` synthetic is correct but it implicitly inherits this pre-existing flaw and amplifies it: any dApp that does `getAccounts()` first then `requestCapabilities([{type:"accounts", canCreateAuthWit:true}])` gets `canCreateAuthWit` silently. **This needs to be called out and either fixed in this PR or filed as a follow-up before merge.**

**Bug C — popup dead-end when zero accounts exist on the profile.** `index.vue:101-109`: if `availableAccounts` is empty, the popup neither renders `AccountSelectRow` nor `CapabilityCard`s. It shows a toast and an enabled Approve button that errors on click (line 168-171 requires ≥1 selected account, but `needsAccountSelection` is false, so the guard is skipped — Approve will fall through and send `granted: [accounts]` with no selectedAccounts). The dispatcher then writes an `accounts` grant with no accounts. The next `getAccounts()` call hits "hasAccountsGrant=true → return []" and the dApp stays broken forever, with no UI path to recover. This bug pre-exists the plan, but the plan makes it reachable from a much more common path. **Either fix it (disable Approve when accounts-delta-only AND no available accounts) or pin it as a known bug.**

`synthMetadataForImplicit` is fine, but be explicit: the dispatcher writes `manifest.metadata` into the popup payload via `dappInteractionService.requestCapabilities({...manifest...})`. Today (`dispatcher.ts:421-428`) the popup doesn't actually use `manifest.metadata` for display — it uses `dappSession.dappMetadata` via `useDappInteractionPayload`. So `synthMetadataForImplicit` is **dead code** unless something downstream consumes it. Drop it, or document why we set it.

## 5. Test plan adequacy

The 4-unit + 1-component + 1-e2e is right in shape but underweight.

**Missing unit tests:**

- **Format-parity test.** Test #1 ("session has accounts → returns them") proves the fast path returns *something*; it does NOT prove that the implicit-grant happy path (Test #2) returns the *same shape* as the fast path. Add an assertion that the granted-accounts response equals what the same-state fast path would return. This is the regression-pin for `formatSessionAccounts` extraction — otherwise the extraction could silently change the wire shape.
- **No-accounts-on-profile test.** Cover Bug C above. Drive the implicit grant when `accountService.getAccounts()` returns `[]`. Assert sensible behavior (currently broken).

**Redundant:**

- Test #4 (two cases parameterized) is fine but ensure the "grant exists, zero accounts" sub-case is the desync scenario from §3 row 3 — not just a copy of #3.

**Component test:** the proposed assertion ("renders `AccountSelectRow` and no `CapabilityCard`") is correct but should also assert that `DappIdentityBlock` shows the **session's** dapp metadata, not the synthetic manifest's — protects against confused-deputy regressions.

**E2E:** the playground-driven smoke is fine. Add one assertion: the second `getAccounts()` call (after approval) does NOT re-open the popup. That's the popup-spam regression pin.

## 6. Security & adversarial review

The §6 section is decent but soft on three things.

- **Authority escalation via shape-blind delta filter.** Bug B above. The threat model needs a row: "dApp upgrades implicit `canGet` grant to `canCreateAuthWit` without a popup." This is the actual confused-deputy attack — not the stale-metadata one §6 currently lists.
- **Popup-spam mitigation is incomplete.** The "rejection persists forever, dApp must call `requestCapabilities` to re-prompt" defense ignores that `requestCapabilities` for an `accounts` capability with **the same shape** is *also* gated by the same delta filter — but if the rejection is set, the re-request path *does* re-open the popup (`dispatcher.ts:380-382`, the `rejectedTypes.has(...)` clause). So a hostile dApp can spam via `requestCapabilities([{type:"accounts"}])` in a loop. **This is a pre-existing issue, not introduced by the plan**, but the plan should not claim popup-spam is solved when it's only solved for the implicit path. Adjust the §6 "popup spam" mitigation copy.
- **The "synthetic manifest is hardcoded" defense doesn't hold under code review.** §6 says the dApp can't influence the synthetic shape — but the dApp influences the *triggering* (call `getAccounts()` ⇒ popup). And once the popup is open, the user sees a request that the dApp didn't explicitly send. That's an attribution attack: a dApp that calls `getAccounts()` 20 times during a single page load looks to the user like the wallet is asking 20 times. The rejection-persistence mitigation handles 19 of those, but the first one is unsolicited from the user's POV. **Solution:** add a debounce/single-flight guard in the dispatcher — if a synthetic-grant popup is already in flight for `(origin, chainId)`, return the same promise. Easy fix, prevents the noise.
- **Supply chain claim is correct but trivial.** No new deps.

## 7. Open-question triage

- **Q1 (recursion safety):** Mostly a non-issue — see Bug A. `requestCapabilities` is exempt; direct call doesn't matter for safety, only for clarity. Rewrite the rationale.
- **Q2 (rejection timeout):** Default position is correct. No timeout.
- **Q3 (per-session re-grant):** Correct — per-session is right.
- **Q4 (wire-mark the synthetic):** Yes — add a single boolean `implicit: true` on the popup payload (NOT the wire to the dApp) and surface a one-line subtitle in the popup: "*This site is asking to share accounts to continue.*" Distinguishes user intent from dApp solicitation. Helps user attribution.
- **Q5 (Wonderland sanity check):** Cheap check exists — open devtools network tab on the Wonderland page, watch the wallet-sdk wire messages. The wallet-sdk skill (per the user's context) flags the `getAccounts()`-first pattern as a known footgun; checking takes 5 minutes and either confirms or rules out the hypothesis cheaply. Plan should add this to §5.
- **Q6 (`canCreateAuthWit: false`):** Right default. But explicitly link to Bug B — if the upgrade path is silent, this default is moot in practice.
- **Q7:** Covered above.

**Add a Q8:** "If `accountService.getAccounts()` returns `[]` (no accounts on profile), what does the user see?" — forces Bug C into the discussion.

## 8. Concrete edits

- **§2 root cause:** add a paragraph noting `resolveNetworkAndAccount` throws for other account-bound methods — `getAccounts` is the inconsistent one.
- **§3 design:** add Option D (structured error code) to the rejection table.
- **§3 contract table:** split row 3 into two rows — "grant exists, zero accounts (desync)" and "previously rejected" — they're distinct failure modes.
- **§4 Phase 1 note 3 + §8 risk #2:** rewrite the "recursion" rationale. The risk isn't infinite recursion; the direct call is for clarity. Acknowledge the `EXEMPT_METHODS` line.
- **§4 Phase 1:** drop or document `synthMetadataForImplicit` — the popup uses `dappSession.dappMetadata`, not the manifest's.
- **§4 Phase 1:** add a single-flight guard for in-flight implicit popups per `(origin, chainId)`.
- **§4 Phase 2:** add the empty-availableAccounts dead-end case and a fix sketch (disable Approve, render an explicit "no accounts on this profile — create one" CTA).
- **§4 Phase 3 unit tests:** add the format-parity test and the no-accounts-on-profile test.
- **§4 Phase 3 e2e:** add the "second getAccounts() does not re-popup" assertion.
- **§5 verification:** add the 5-minute Wonderland devtools check (Q5).
- **§6 threats:** add an "Authority escalation via shape-blind delta" row covering Bug B; rewrite the "popup spam" row to acknowledge `requestCapabilities` is still spammable; add the single-flight mitigation.
- **§8 risks:** add Bug B (silent canCreateAuthWit escalation) and Bug C (popup dead-end with no accounts) as separate rows. Both high-impact, low-likelihood.
- **§10:** add `packages/extension/src/wallet/services/wallet-sdk/background.ts:391` (comment fix) to the touched-files list.
- **§12:** add Q8 (no-accounts dead-end). Rephrase Q1 to drop the "recursion" framing.

The plan is well-structured and the diagnosis is correct. The implementation sketch needs the three fixes above before it's safe to ship — Bug B in particular is a quiet security regression amplifier that the current text misses.
