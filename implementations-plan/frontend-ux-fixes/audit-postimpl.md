# Post-implementation audit — frontend UX fixes (P1–P5b)

**Codex (`xhigh`) was launched** (`/tmp/codex-fuxfixes-postimpl.md`, session dir `codex-PSYEpKGF`) but
**stalled service-side mid-audit** — its log shows it analyzing files, then repeated
`stream disconnected before completion: IO error: Connection reset by peer` / "Reconnecting… 3/5". Same
codex-stall pattern documented in `aztec-5.0-upgrade` + `no-fuel-claim-fee-source`. Per that established
fallback, the post-impl review below is a **rigorous documented self-audit**; re-run codex when the
service/network recovers to reconcile (it can only add findings — nothing here is gated on it).

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
