# Codex audit — frontend UX fixes plan (`/blueprint mid`, dual audit #1)

Session `019eebb9-50a8-7343-b4cc-c8ee93d25de9`, `xhigh`, read-only. Prompt: `/tmp/codex-fuxfixes-audit.md` (this session).
Paths below rewritten repo-relative per CLAUDE.md.

**Verdict:** `reject` (blocking: P3 relies on a non-guaranteed confirm surface for recipient verification; P5's verified facts/root-cause model are wrong; the single-emoji/hashToEmoji address plan is unsafe as written).

Two "verified facts" in the draft are wrong: plan said `Input` has "no stray tabindex/focus-trap" but shared primitives DO; and it cited a nonexistent `onboarding/.../NewProfileCredentials.vue` path.

## HIGH / CRITICAL

- **P5 root-cause model is false.** `packages/design/src/ui/Toggle.vue:27` has manual `tabindex`, and `packages/extension/src/components/Popup/Popup.vue:29,62` is a real focus trap (sentinel). Fix: split P5 — shared-primitive repairs first (`Toggle`, popup sentinel/focus trap, any roving-tabindex widgets), THEN surface sweeps.
- **"DOM order, no manual tabindex" won't fix the known seams.** `packages/extension/src/onboarding/pages/create.vue:137` + `…/new-profile/NewProfileCredentials.vue:31`: there are intentional focusables between fields already — auth-method buttons and the password-visibility button. Fix: decide the desired keyboard model for those controls; don't treat them as accidental drift.
- **P3 masking mitigation is insufficient.** `packages/extension/src/popup/pages/send.vue:237` + `…/modules/send/RecipientField.vue:82`: send submits from this page and navigates away immediately; there is no guaranteed later confirm surface for full-recipient verification. Fix: keep the full recipient visible on the send page, OR make P3 absorb the Send-specific P4 work so the same screen has an explicit full-address reveal/copy state before submit.
- **Single-emoji-from-address is unsafe.** `hashToEmoji()` (`@aztec/wallet-sdk/crypto`) is hash-shaped, not raw-`0x…`-address-shaped; `0x` misparses, and one emoji is only 8 bits. Fix: reject the single-emoji option; if you use emojis, normalize/hash the address first and keep it secondary to name+address.

## MEDIUM
- **Facts:** plan overstates reuse of `packages/design` `EmojiGrid`; the extension currently uses its OWN `packages/extension/src/components/composite/general/EmojiGrid.vue`. Matters for layering + test scope.
- **Inferences:** the `--txt-undefined` theory is weak — no bad `vault` color prop found; nearest icon-color misuse is unrelated (`…/modules/general/TokenImportRow.vue:54`). Don't bind P2 to that bug without reproduction.
- **Asks (surface before approval):** P3 must own the Send-specific address-verification UX; P2 should choose `initials` or a multi-cell emoji indicator, not single-emoji; P5 should be split into "shared focus primitives" and "long-tail sweep".

## LOW
- P4 blur-mask/focus-reveal inside shared `Input.vue` is easy to botch for paste, selection, and screen readers if it mutates the actual value. Prefer an extension-side wrapper/overlay, NOT wallet semantics inside `@nulo/design` core.
- Preserving testids isn't enough: `…/modules/send/RecipientField.test.ts:44` asserts the `vault` fallback directly, so tests must be rewritten, not just selectors preserved.

## looks right
- P1 is real: `…/pages/settings/index.vue:55` is misleading copy.
- P6 is real: both contact popups stack a top border on `.sender_row` (`EditContactPopup.vue:474`, `NewContactPopup.vue:297`).
- By-type phasing is mostly defensible — but only if P3 absorbs the Send-specific slice of P4 so a half-done recipient-verification flow doesn't ship.
