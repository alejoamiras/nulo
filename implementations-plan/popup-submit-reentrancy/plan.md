# popup-submit-reentrancy [blueprint light]

Close the popup submit re-entrancy class. Origin: codex's arc-D discovery (`isProfileUpdateInProgress` is a loading flag, not a guard), generalized by recon to the whole family — then CORRECTED by the plan audit, which found the class wider than recon claimed (a masked authwits gap + an unsafe approval window) and three latch-lifetime defects the naive fold would have converted into lockouts or mid-flight reopenings. Full evidence: [recon.md](recon.md); audit ledger below.

## The invariant (the audit's formulation, adopted as the plan's core)

> **Every async submit handler self-checks a FULL-LIFETIME latch, and every control that fires it explicitly disables on that latch.**

Implemented per popup as the validity-source fold (`canSubmit`-style: availability AND NOT in-flight) feeding BOTH the handler's early-return and the button's `:disabled` — with explicit repairs wherever the current wiring breaks one of the invariant's two halves (a button not consuming the computed, a latch that ends before the handler does, a latch that never clears on rejection, or no latch at all).

## Success criterion

Every async submit surface in `popup/components/popups/` + the capabilities approval window is re-entrancy-safe through EVERY route (Enter, mouse click, keyboard-focused activation, future callers), with full-lifetime latches that clear on rejection; pinned per the repo's hung-promise + re-press technique; happy paths proven unbroken by the existing e2e specs.

## Assumptions

**Facts (recon + audit, all source-verified):**
1. `usePopupEntity`/`isPopupSubmitKey` keydown paths call submit handlers directly — no DOM, no `:disabled` awareness.
2. Button's `loading` is CSS `pointer-events:none` only — mouse blocked, keyboard-focused activation OPEN; native `disabled` + `tabindex` key off `disabled` alone.
3. 12 popups have the gap; `NewAccountPopup` has NO latch and a concrete duplicate-account race (sync uniqueness check vs post-await push).
4. **Latch-lifetime defects (audit):** `NewNetworkPopup` clears `isCreating` right after `addNetwork` while activation/refresh awaits continue; `EditAccountPopup` and `EditNetworkPopup` never clear their flags on rejection (no try/finally) — the naive fold would lock them disabled after one failed submit.
5. **Binding gaps (audit):** `NewSenderPopup`'s button binds `:disabled="!!error.type || !senderAddress"`, NOT the availability computed; `RevokeAuthwitsPopup`'s real button omits `isLoading` from `:disabled` (its keydown gate has it — the focused-button route is open) AND its test stub disables on `disabled || loading`, masking exactly this gap; `capabilities/index.vue`'s `:confirm-disabled` omits `isLoading` and `approve()` has no self-guard — the window IS unsafe, recon's click-only-safe exclusion was wrong.
6. No other consumer of any of the 12 `isAvailableToX` computeds exists (audit checked: no warnings/watchers keyed on them) — the fold disturbs nothing.
7. The hung-promise re-press pin technique exists 4× in the same directory; 5 vulnerable popups have ready harnesses.

**Inferences (owner-visible):**
- The in-flight visual (native-disabled 0.3 opacity layered under the spinner) is an acceptable state during slow probes (NewEndpoint's RPC probe, NewNetwork's addNetwork) — **explicit ASK below**.
- B-09/B-26/NewToken stay untouched: their specialized latches justify convention divergence (audit concurs: "do not normalize merely for style").

**Asks — RESOLVED at the approval gate:**
1. **Visual: Option B chosen by the owner** (via the design-system A/B artifact): while loading, the disabled dim is suppressed — `.wrapper.disabled.loading { opacity: 0.8 }` in the design package's Button — so "saving" (bright + spinner) stays visually distinct from "invalid form" (0.3 dim). The native `disabled` attribute + `tabindex="-1"` behavior is identical in both options; the delta is presentational only.

## Architecture & Implementation (compact)

**Change map — four repair classes:**

1. **Plain fold (8 popups):** EditFpc, EditEndpoint, EditContact, EditProfile, NewContact, NewFpc, NewEndpoint, NewSender — flag joins the availability computed (explicit `false` returns where the style is bare-`return`). NewSender ADDITIONALLY: button `:disabled` re-based onto the computed so the native-disabled half of the invariant actually engages.
2. **Lifetime repairs + fold (3):** NewNetwork — `isCreating` spans the WHOLE handler (finally); EditAccount + EditNetwork — try/finally added so rejection clears the latch (prevents the fold-induced lockout).
3. **Missing latch (1):** NewAccount — new `isCreatingAccount` ref (try/finally), fold, `:submitLoading` bound (currently absent).
4. **Out-of-family repairs (2, audit-mandated):** RevokeAuthwits — `isLoading` added to the real button's `:disabled` (keydown gate already has it) + the test stub corrected to stop masking; capabilities window — `isLoading` joins `:confirm-disabled` and `approve()` gains the self-guard first line (matching execute/discover, which already self-guard).
5. **Design-package visual (owner decision, Option B):** `packages/design/src/ui/Button.vue` gains `.wrapper.disabled.loading { opacity: 0.8 }` so the loading treatment wins over the disabled dim while a save runs. Pinned in the existing `Button.test.ts` (class-stacking case: disabled+loading renders BOTH classes — the selector's precondition; the opacity rule itself is CSS-only, review-verified).

**Tests (audit-shaped):** the 5 existing-harness pins + a NewAccount harness whose single pin covers the rapid dual-route double-submit resolving to ONE RPC and ONE appended account; PLUS NewNetwork full-lifetime single-flight pin (re-press during the post-`addNetwork` awaits); NewSender disabled-follows-loading assertion; one rejection→retry pin on EditAccount or EditNetwork (latch clears, resubmit works); the corrected RevokeAuthwits stub keeps its existing `(REGRESSION-PIN)` honest. The remaining plain-fold popups (EditFpc, EditNetwork*, EditEndpoint, NewFpc) carry no new harnesses — each diff is the one-expression fold (\*EditNetwork's finally is covered by the rejection→retry pin if it's the chosen representative). No parameterized mega-harness (audit: it would hide fixture complexity, not save it). No new e2e (deterministic component pins beat Puppeteer races); existing specs run as regression checks.

**Validation gates:** `audit:vue` → armed smoke locally (attention: `profile-rename`, `endpoints`, `accounts`, `contacts`, `settings-crud`) → SOLO network `senders-advanced.test.ts` → PR with `e2e:smoke` label → single codex xhigh end-diff pass.

## Security & Adversarial Considerations

- The class is a user-triggerable data-integrity race (held Enter auto-repeat): duplicate contacts/senders/endpoints/networks, double renames racing their own re-checks, duplicate same-named accounts (the severe instance), and double capability approvals in the dApp window (the audit-found miss — an approval surface, the arc's most security-adjacent site).
- The guard narrows when handlers run; no new storage shapes, RPC surface, manifest, or crypto.
- Fail-safe REPAIRED, not assumed: the audit falsified "flags clear in finally everywhere" — EditAccount/EditNetwork would have locked out on rejection under the fold. All latches in scope end in try/finally after this arc; the rejection→retry pin proves the recovery path.

## Delivery

Single PR to dev (squash), title `fix(popup): submit re-entrancy — full-lifetime latches folded into the validity source`. Post-approval: pins-first where harnesses exist (RED via hung-promise against unguarded handlers), lifetime repairs, folds, bindings, gates.

## Audit ledger

- **Codex xhigh plan audit (light tier): `reject` — all findings ADOPTED.** (1) NewSender's button doesn't consume the availability computed (fold alone ≠ native disabled); (2) NewNetwork's latch ends mid-handler (fold would reopen during activation awaits); (3) EditAccount/EditNetwork never clear on rejection (fold → permanent lockout; the plan's "finally everywhere" fact was FALSE); (4) RevokeAuthwits' real button omits `isLoading` and its test stub masks the gap — moved IN scope; (5) capabilities window is unsafe (`confirmDisabled` sans `isLoading`, unguarded `approve()`) — recon's exclusion overturned, moved IN scope. Test economy accepted with 4 named additions; parameterized harness rejected as hidden complexity; B-09/B-26/NewToken non-normalization endorsed ("correctness — not convention — requires" the authwits fix). The plan's core reformulated to the audit's invariant. Visual acceptance surfaced as an owner Ask.
- All five findings independently re-verified against source before adoption (bindings at NewSenderPopup/RevokeAuthwitsPopup/capabilities, the NewNetwork flag lifetime, the missing finallys).
- **Codex end-diff: `conditional approve` — all conditions implemented.** (1) Both authwit handlers now self-guard on `isLoading` first line, with handler-owned latch release (Revoke's summary logic extracted around a try/finally; ChangeAuthwits' finally clears the latch instead of relying on popup closure) — the caller-side duplication remains as defense-in-depth. Unmasked en route: the ChangeAuthwits test file leaked armed document listeners, previously hidden ONLY because completed instances' latches stuck true — dispose hygiene added. (2) Revoke's regression pin now also asserts the button is NATIVELY disabled mid-flight (the corrected stub makes that honest). (3) The capabilities window gained a harness + the double-approve pin (hung grant → confirm disables AND a direct re-emit is dropped; the interaction resolves once). (4) The contact pins switched from delta assertions to unique-argument filtering (`*-Reentrant` markers) — placement-proof and instance-attributed. Codex's scope note adopted: the sweep's claim covers the FormPopup/approval family; Confirm-passkey, Verify-confirmation, and account-selection click actions are separately dispositioned as OUT of this arc (recorded below).
- **Out-of-family, not claimed by this arc (codex scope note):** ConfirmPopup's passkey path (self-guarded already), SelectProfile/IncomingTrust (latched, pinned), and the remaining unlatched async CLICK actions outside the submit family (AccountsPopup row selection; verify-window confirmation) — candidates for a future sweep if flagged, not silently covered here.
- **End-diff validation:** popup+window suites green; design package 313/313; audit:vue green; the FIRST armed smoke (pre-conditions tree) green; SOLO `senders-advanced` network spec green. The final-tree armed smoke gates the PR and its result is recorded below when complete — an earlier ledger draft claimed it green while in flight; codex caught the overclaim and it is corrected here.
- **Final-tree armed smoke: GREEN** — 112 passed / 6 skipped (fixture-stamped build per `_smoke-e2e.yml`) on the converged tree.
- **Codex resume 2 (final): `approve` → CONVERGED.** Verified the frozen oracle byte-identical to origin/dev, the re-entrancy coverage additive, the ledger accurate, `git diff --check` clean.
- **Codex resume 1: `reject` — a genuine blunder caught.** The new capabilities harness had been written OVER the existing 402-line frozen-oracle suite (`windows/capabilities/index.test.ts`: shell lifecycle, reject routing, cancellation, the `JobCancelledError` classification pins), deleting real regression coverage — green totals do not compensate for removed assertions. REPAIRED: the original suite restored verbatim from origin/dev; the re-entrancy pin moved to its own additive file (`windows/capabilities/reentrancy.test.ts`); both pass together (capabilities dir 59/59).
