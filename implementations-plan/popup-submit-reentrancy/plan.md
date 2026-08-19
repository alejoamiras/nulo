# popup-submit-reentrancy [blueprint light]

Close the popup submit re-entrancy class: 12 popups set an in-flight flag during their async submit but never check it, so a repeated Enter (auto-repeat included) or a Tab-focused button activation starts CONCURRENT submissions. Origin: codex's arc-D discovery (`isProfileUpdateInProgress` is a loading flag, not a guard) generalized by recon to the whole family. Full evidence: [recon.md](recon.md).

## Success criterion

Every popup with an async submit is re-entrancy-safe through EVERY route (Enter, click, keyboard-focused activation, future callers), pinned by the repo's established hung-promise + re-press technique; happy paths proven unbroken by the existing e2e specs that exercise these popups.

## Assumptions

**Facts (verified by recon, file-cited in recon.md):**
1. `usePopupEntity`/`isPopupSubmitKey` keydown paths call the submit handler directly — no DOM, no awareness of `:disabled`/`:loading`.
2. The design-system Button keys native `disabled` + `tabindex` off `disabled` only; `loading` is CSS `pointer-events: none` + `aria-busy` — mouse blocked, keyboard-focused activation OPEN.
3. 12 popups have the gap (list in recon §2); 11 have an unchecked flag; `NewAccountPopup` has NO flag and a concrete duplicate-account race (sync name-uniqueness check against a post-await push).
4. 5 popups are already guarded under 3 conventions, each carrying pins (`NewTokenPopup` guard-line fold; B-09/B-26 latches; authwits caller-side duplication with `(REGRESSION-PIN)`s) — this class has bitten this repo before and was fixed ad hoc.
5. The hung-promise re-press pin technique exists 4× in the same directory; the 5 vulnerable popups with existing test files share a ready harness idiom.
6. The `.disabled` CSS (0.3 opacity, later declaration) wins over `.loading` (0.8) at equal specificity — the folded state renders as a coherent inert button.

**Inferences (challenge in audit):**
- Folding the flag into `isAvailableToX` disturbs no other consumer — VERIFIED per popup during implementation (watchers/other bindings grep), but recon did not exhaustively enumerate consumers for all 12.
- The authwits/B-09/B-26/NewToken popups need no change (already safe + pinned); normalizing their three conventions onto the new pattern would be churn, not value.
- `capabilities/index.vue`'s missing self-guard is click-only-reachable today and stays OUT (recorded for the owner report).

**Asks (none silent):** none — scope, guard shape (research-settled), and validation were owner-answered in Phase 0.

## Architecture & Implementation (compact)

**The pattern (uniform across all 12): validity-source fold.** The in-flight flag joins the popup's `isAvailableToX` computed — the single submit-validity source the handler already early-returns on and the button already binds `:disabled`/`:submitDisabled` to. One expression changed per popup; every current and future route through the handler is closed, and the button becomes natively `disabled` + `tabindex="-1"` during flight (closing the keyboard-focus DOM route with a correct a11y state instead of a silent no-op). This mirrors the arc-D `isStartedEditing` fold — the third time this repo converges on "one validity source" — and beats the handler-line fold on the DOM route and the authwits caller-side duplication on future-caller safety.

**File-level change map:**
- 11 popups (recon §2 table): `isAvailableToX` gains `&& !<flag>.value` (or the equivalent early-return-shaped clause matching each computed's style). No template changes — the bindings already consume the computed.
- `NewAccountPopup.vue`: NEW `isCreatingAccount` ref + set/clear in `handleCreateAccount` (try/finally) + fold into `isAvailableToCreateAccount` + bind `:submitLoading="isCreatingAccount"` (currently unbound). This is the severe instance; its fix adds the missing latch, not just the fold.
- Per-popup verification obligation: grep each `isAvailableToX` for other consumers before folding (inference 1).

**Tests (smallest honest set, per the map's recommendation — component layer only):**
- Re-entrancy pin per popup with an existing harness (EditContact, EditProfile, NewContact, NewEndpoint, NewSender): hang the mocked service, submit, re-press Enter + re-fire the click route, assert exactly one service call. ~1 test each, extending existing files.
- NEW harness for `NewAccountPopup` (the severe instance): the re-entrancy pin + the duplicate-account race pin (two rapid submits → one account created).
- The remaining 6 (EditAccount, EditNetwork, EditFpc, EditEndpoint, NewFpc, NewNetwork) receive the identical one-expression change; no new harnesses — the pattern is proven 6× by the pins above and their diffs are review-verifiable. (Audit may challenge this economy; the alternative is 6 new mock harnesses testing the same line.)
- The 5 already-guarded popups: untouched, their pins stay.

**Validation gates:** `bun run audit:vue` (units + components + lint + build) → armed smoke locally (fixture-stamped build, per `_smoke-e2e.yml` env) with attention to `profile-rename`/`endpoints`/`accounts`/`contacts`/`settings-crud` → SOLO network run of `senders-advanced.test.ts` (the one real `addSender` path) → PR with `e2e:smoke` label → single codex xhigh end-diff pass (light tier).

## Security & Adversarial Considerations

- The class is a data-integrity race, user-triggerable by a held Enter key: duplicate contacts/senders/endpoints/networks, double renames racing their own validation re-checks, and (NewAccount) two same-named accounts from one intent. No attacker amplification beyond what the user can do to themselves, but the duplicate-account race touches account-list integrity — the arc's highest-value close.
- The guard adds no new attack surface: it only narrows when a handler runs. No storage shapes, no RPC surface, no manifest, no crypto.
- Fail-safe: flags clear in `finally` everywhere (verified pattern); an errored submit re-enables the form — no lockout path.

## Delivery

Single PR to dev (squash), title `fix(popup): submit re-entrancy guards — fold in-flight into the validity source`. Post-approval: implement per the change map, pins first where harnesses exist (RED via the hung-promise technique against the unguarded handlers), then the folds, then gates.

## Audit ledger

(appended as legs complete)
