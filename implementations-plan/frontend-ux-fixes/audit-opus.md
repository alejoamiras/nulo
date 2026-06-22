# Second auditor — frontend UX fixes plan (`/blueprint mid`, dual audit #2)

**Auditor: opus Plan subagent.** Claude Fable 5 was unavailable this session, so a top-tier opus
planning critic substituted as the second independent auditor (blueprint protocol: "capability matters
more than the literal name"). Fresh context, hostile pass. Paths rewritten repo-relative.

**Verdict:** `reject`. Blocking findings:
1. P3 masks the only recipient-verification surface — `send.vue:237 handleSend` has no confirm step and P4 masks the same input, so masking must be dropped or the full address kept selectable + P4 exempted.
2. Plan-"verified" Facts are false — `hashToEmoji` is verification-hash-only not an account indicator; single-glyph identicon is 1-in-256 and `SettingItem.icon` can't render emoji; the create-account tab break is in `create.vue` not `NewProfileCredentials.vue`, real cause being `tabindex="1"` on `Toggle.vue:27` / `DropdownItem.vue:8`, not DOM order.
3. Every P2–P5 validation gate runs `vitest run src/components`, which matches NONE of the `src/popup/**` target files.

## Lead — plan-marked-verified items that are WRONG
- **`hashToEmoji` is NOT an existing account indicator.** Every caller (`…/windows/verify/index.vue:155`, `…/settings/connected-apps/[id].vue:58`) feeds it a `session.verificationHash`, never an address. No address→emoji mapping exists. P2 invents a new semantic dressed as "reuse."
- **create-account break is in `create.vue`, not `NewProfileCredentials.vue`.** `NewProfileCredentials.vue` is used by `…/pages/profile/new.vue:153`, NOT onboarding `create.vue` — which inlines its own password Inputs (`create.vue:162-178`). Two distinct flows; the plan conflated them.
- **Tab break root cause is wrong.** `Input` itself is clean, but `Toggle.vue:27` and `DropdownItem.vue:8` carry `tabindex="1"`. A positive tabindex anywhere pulls the WHOLE document into two-pass tab order — every implicit-0 field becomes reachable only AFTER all `tabindex="1"` nodes. In both contact popups the sender-row Toggle sits right after the address Input, so "rely on DOM order" alone will NOT fix flow while any `tabindex="1"` survives.

## HIGH / CRITICAL
1. **P3 security — stated mitigation does not exist.** `send.vue:237 handleSend` reads `searchTerm.value` and calls `executeTransfer` directly; there is NO confirm screen re-showing the full recipient. Combined with P4 blur-masking the same input → ZERO full-recipient verification surface. Fix: P3 keeps the full address rendered/selectable (not only 8…8) or adds a real confirm step; P4 exempts the Send recipient input.
2. **Single-glyph identicon trivially grindable + not a drop-in.** `count=1` → `byte % 256` (256 buckets, 8 bits) — worse than `vault` for anti-substitution. And `SettingItem.icon` (`SettingItem.vue`) routes to `<Icon name=…>` (SVG path lookup); it CANNOT render an emoji string — must use the `#icon` slot. Fix: full 3×3 `EmojiGrid` (or initials); drop "single deterministic emoji."
3. **Validation gates run the wrong command.** `test:components` = `vitest run src/components` (`package.json:25`). Every file P2/P3/P5 touch lives under `src/popup/**`. The gate silently runs none. Fix: `vitest run` / `bun run test` / `audit:vue`, not `test:components`.

## MEDIUM
- **Phasing seam:** P2/P3/P4/P5 each carve a slice out of Send; the card + masked input + keyboard order are co-designed nowhere. P3 should absorb the Send-recipient slice of #4 and the input-exemption of #2.
- **P4 breaks the test contract / a11y** if it rewrites the bound value (corrupts paste/selection, the `c.address === searchTerm` equality in `RecipientField.vue:30,43`, the `:global(input)` mono override, and screen-reader announcement). Simpler: a read-only sibling/overlay or letter-spacing — don't touch the value.
- **#1 copy loses info:** static "Profile" removes the only place the profile name shows on the settings list (it still shows on the detail page). Confirm intended — user explicitly asked for this.
- **P5 as one mid phase is unrealistic;** split: (a) fix `tabindex="1"` sources + create-flow + convention; (b) long-tail sweep behind human sign-off.
- **e2e testids:** `RecipientField.test.ts:39,49` assert `[data-name="vault"]` — P3 removes vault, so those tests must be REWRITTEN, not "preserved."

## LOW
- `trimAddress` defaults `start=8,end=4`; `TokenMetadataPopup` masks `slice(0,6)/slice(-4)` — neither is the "8…8" the plan claims as the established pattern.
- `--txt-undefined`: it's `hoverColor` not `color` that hits `var(--txt-*)`; the plan misattributes the prop.
- `audit:vue` already chains typecheck+test+lint+build, so listing them separately AND `audit:vue` double-runs.

## Looks right
- `vault` census: exactly 4 (`RecipientField:89,131`, `EditAccountPopup:99`, `accounts/index:147`).
- #6 double border real; fix correct.
- #2 diagnosis (`text-overflow: ellipsis` no-op on focused input) correct.
- Layering/XSS: card renders text+emoji, no `v-html`; `@nulo/design` boundary intact.
