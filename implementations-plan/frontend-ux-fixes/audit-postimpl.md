# Post-implementation audit — frontend UX fixes (P1–P5b)

**Codex (`xhigh`) eventually completed** (session `019eec34-8302-7941-abc9-53ff351189ae`) after several
mid-run network drops (`Connection reset by peer` / "Reconnecting…"). Its verdict: **no high/critical**,
confirming the self-audit below — and it independently verified the load-bearing safety property (the
submit address never diverges from the card's displayed address) + no XSS + AddressInput value-preservation.
It added 2 MEDIUM + 3 LOW.

**Codex findings + disposition:**
- **MED — disabled dropdown items keyboard-reachable + Enter-activatable** (`DropdownItem` kept disabled
  at `tabindex=0`; `DropdownRoot` Enter does `activeElement.click()`). **FIXED** (commit `733c152`):
  disabled → `tabindex=-1` + no `data-dropdown-item` (out of Tab order AND arrow-nav); Enter gated on
  `aria-disabled`. Test added.
- **MED — show/hide-password buttons no longer keyboard-operable** (P5b's `tabindex=-1` removed them from
  Tab with no replacement → WCAG 2.1.1). **ACCEPTED TRADEOFF (user decision).** Surfaced with three
  options (reposition / keep-as-is / restore-standard); the user chose **keep-as-is** — field→field flow
  is the priority, the eye stays `tabindex=-1` (mouse + screen-reader reachable, not Tab-reachable). The
  password fields remain fully usable without it; toggling visibility is a convenience. Documented as a
  deliberate, owner-accepted gap, NOT an oversight.
- **LOW — silent clipboard failure** on the recipient card. **FIXED** (`733c152`): emits `copy-error` →
  RecipientField toasts a warning. Test added.
- **LOW — test gaps** for the two MEDs. **FIXED**: disabled-item + copy-error tests added.
- **LOW — avatar color could read as an identity signal** on the send surface. Acknowledged; it is
  decoration only and we deliberately do NOT use color in any verification copy/assertion. No change.

**Post-fix codex re-audit** (session `codex-HqS5x2X9`, verdict **`ship`**): no high/critical/medium.
Independently verified both fixes are correct — `tabindex="-1"` + omitted `data-dropdown-item` removes
disabled items from Tab + arrow-nav, the Enter handler refuses `aria-disabled="true"`, and
`querySelectorAll("[data-dropdown-item]")` still matches `data-dropdown-item=""` so ENABLED items navigate
normally; clipboard rejection emits only `copy-error` (no double-emit / unhandled rejection) → warning toast;
no send submit/display divergence; no new XSS/layering. It flagged 2 LOW test-coverage gaps (no end-to-end
Enter-gate test; copy-error toast unpinned) — **both CLOSED** (commit `78508ec`: a DropdownRoot Enter-gate
test with enabled+disabled items, and a RecipientField copy-error→warning-toast test).

The rigorous self-audit (done while codex was stalled) is retained below; it reached the same conclusion.

Scope: the uncommitted change set P1–P5b on `feat/frontend-ux-batch-1`. Verified against code + the full
`audit:vue` (typecheck → unit/component suite → lint → build, all green) + the smoke suite (69/76 pass; the
1 fail is pre-existing `passkey-backup`, proven on clean dev).

## HIGH / CRITICAL
None found.

## MEDIUM
None found.

## LOW (observations / follow-ups — not blockers)
- **Show/hide-password button duplication.** The same `<button class="visibility_btn">` toggle is copy-pasted
  across 6 SFCs (`auth`, `NewProfileCredentials`, `change-password`, `ImportFullBackupForm`,
  `ImportSecretForm`). P5b correctly added `tabindex="-1"` to all, but a shared `PasswordInput`/visibility
  composable would DRY them (and make the convention un-forgettable). Follow-up, out of this PR's scope.
- **`RecipientField.justCleared` stays `true`** after the first "change" (it only affects the AddressInput's
  `:autofocus` at mount). Harmless; could reset on blur for tidiness.
- **`AccountAvatar` palette is a fixed const** (10 saturated colors, white text). Verified theme-safe (the
  repo has no dark theme); if a dark theme ever lands, revisit contrast. Decoration only — documented.

## Adversarial / security review
- **P3 recipient verification (the one that matters).** The card shows the masked address but binds the
  SAME `searchTerm` that `send.vue` submits (`handleSelectContact` sets `searchTerm = contact.address`; the
  card's `address` prop = that value). There is no path where the displayed/submitted address diverge. The
  masked-by-default + OPTIONAL one-tap reveal is the user's INFORMED risk-acceptance (full-always /
  mandatory-reveal / optional were offered; optional chosen) — the implementation honors it: the reveal is
  prominent, exposes the FULL selectable address + copy, and raw typed/pasted addresses fall through to the
  AddressInput (P4) which keeps them readable. Residual address-poisoning risk is owned by the user.
- **XSS:** card + avatar render text + a CSS-`background` from a FIXED palette (never user input) — no
  `v-html`, no string-interpolated styles from untrusted data. Clean.
- **Value integrity (P4):** `AddressInput` never writes the model (test-pinned: blur emits no
  `update:modelValue`); `scrollLeft=0` is display-only. The `c.address === searchTerm` equality and the
  e2e `[data-testid="send-destination-field"] input` selector both survive (smoke green).
- **Focus model (P5a):** no positive `tabindex` remains anywhere (grep-verified); `<div>` widgets stay
  focusable+operable (tabindex 0 + Enter/Space, tested); `DropdownRoot` arrow-nav decoupled to
  `[data-dropdown-item]` + null-guarded (tested). Show/hide buttons at `tabindex="-1"` are still
  mouse/AT-clickable — keyboard users lose nothing (the visibility toggle is a convenience, not a gate).
- **Layering:** `AccountAvatar`/`RecipientCard`/`AddressInput` (L3 composites) import only `vue` +
  `@/utils/string` (`getInitials`) — no service clients, stores, or `@/utils/core`. Clean.

## Assumption check
- `getInitials` is behavior-identical to the old `_getAbbreviation` (empty/whitespace → "" in both;
  test-pinned). The contact service delegates to it — `abbr` derivation unchanged.
- `EditAccountPopup` accesses `accountToEdit.name`/`.address` non-optionally, consistent with the
  pre-existing `:title="accountToEdit.name"` (the popup only renders with a resolved account). No new risk.

## Verdict
**Self-audit: no high/critical, no medium; 3 low follow-ups (none blocking).** The implementation is sound
and matches the approved plan + the user's P3 decision. Pending: human keyboard/visual sign-off (P5b) +
1Password unlock to commit. Reconcile with codex if/when it completes.
