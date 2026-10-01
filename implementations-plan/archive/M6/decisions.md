# M6 — Phase 0 decisions (binding)

> Pre-approved by user 2026-04-28.
> This document is binding for Phase 4-onwards execution. Sub-PRs that contradict any decision below must update this document first (with audit + user re-sign).

## Decision 1 — Button variant naming

### Current state

`Button.vue` uses a `type` prop with values `primary` | `secondary` | `primary_outline` | `tertiary`. Used by 64 callers across the codebase.

22 sites bypass `Button.vue` entirely with raw `<button :class="$style.cta">` (and `cta_outline`, `cta_red` flavors) because the existing variant set didn't fit the brutalist redesign's prominent CTAs.

### Decision

Rename `type` prop → `variant`. Final variant set:

| variant | Visual | Replaces |
|---|---|---|
| `primary` | solid filled, brand color | existing `type="primary"` |
| `secondary` | solid filled, less prominent | existing `type="secondary"` |
| `outline` | bordered, transparent fill | existing `type="primary_outline"` |
| `ghost` | text-only, no background | existing `type="tertiary"` |
| `cta` | brutalist big action button | NEW — replaces 12 raw `$style.cta` sites |

Plus orthogonal modifiers (boolean props):
- `outline` (combinable with any variant — replaces `cta_outline` flavor; 6 raw sites)
- `destructive` (red color tone — replaces `cta_red` flavor; 1 raw site)

Sizes: `small` / `medium` (default) / `large`. Existing `Button.vue` already supports `large/medium/small/mini/dynamic/micro` — keep all six but document the canonical three; `mini`/`dynamic`/`micro` deprecated for new code (existing usages stay until touched).

### Migration scope (Phase 4a)

- Rename prop `type` → `variant` across 64 existing callers (sed-rewrite + manual review)
- Replace 22 raw `<button class="cta*">` sites with `<Button>` calls using the new variants
- Keep all `data-testid` attributes verbatim (Hard Rule #6)

### Rationale

- `variant` is the standard Vue prop name (Element Plus, PrimeVue, Naive UI, Quasar all use `variant` or `type` interchangeably; we pick `variant` for clarity)
- Splitting `cta_outline` and `cta_red` into orthogonal modifiers (`outline`, `destructive`) avoids the variant matrix explosion (`cta`, `cta_outline`, `cta_red`, `cta_outline_red`, …)
- Single source of truth for every button shape

## Decision 2 — Drop `Input variant="default"` entirely

### Current state

`Input.vue` ships `variant: "default" | "brutalist"` (line 14-21 of the file). 23 explicit `variant="brutalist"` callers.

### Decision

**Drop the legacy `default` variant.** Brutalist becomes the only path. Remove the `variant` prop from `Input.vue` entirely.

### Migration scope (Phase 4b)

- Remove `variant` prop from `Input.vue`
- sed-rewrite the 23 `variant="brutalist"` callers to drop the prop (no behavioral change; brutalist is now default and only)
- Update 1 simple native `<input>` site to use `<Input>`: `capabilities/index.vue:452` (boxed alias input → brutalist underline; visual shift is the same drift class as the 27 default callers)
- ~~`AmountCard.vue:79`~~ — **re-classified as complex during execution (2026-04-27)**. The native input there is a hero amount display (40px headline font, custom `e.data` purge logic for `"0"`/`","` first-character expansion). Brutalist `<Input>` exposes no way to override the input's font or event semantics; migrating would shrink the hero to 15px boxed-input style and would require rewriting the purge handler around `update:modelValue`. Deferred to a future "HeroInput"/amount-display primitive (track in STATUS.md follow-ups).
- Defer the 2 complex native `<input>` sites (`auth.vue:179`, `send.vue:458`) to Phase 5b (`InputWithButton`)

### Rationale

- Brutalist redesign is fully merged to master (per user 2026-04-28). No compatibility window needed.
- Dual-variant primitives are an anti-pattern; pages choose individually and visual drift creeps in.
- 23 callers is small enough for a clean sed-rewrite without staging.

## Decision 3 — PopupCard: composable extraction (stays in L2)

### Current state

`src/components/Popup/PopupCard.vue` imports `ConfigServiceClient` and runs `connect()`/`disconnect()` lifecycle to read one config value (`showPopupFullscreen`). Sits in `src/components/Popup/` (flat) — outside `core/`/`ui/` — to dodge the L2 layer rule that forbids service imports.

This is a layer-rule violation in spirit even if the directory placement avoids the lint check.

### Decision

Extract `useFullscreenPopupSetting()` composable in `src/composables/`. PopupCard becomes pure (no service imports, no lifecycle). Stays in L2 territory.

### Migration scope (Phase 4c)

```ts
// src/composables/fullscreenPopupSetting.ts (NEW)
export function useFullscreenPopupSetting(): Readonly<Ref<boolean>> {
  // Read once at composable instantiation
  // Subscribe to config updates
  // Return reactive ref
  // dispose() on parent unmount via ConfigServiceClient.disconnect()
}
```

PopupCard.vue diff: ~3 lines of imports removed, ~10 lines of lifecycle removed, ~1 line of composable call added. Net ~-12 lines.

Optional move: `src/components/Popup/` → `src/components/ui/Popup/` (symmetry with `PopupHeader.vue` already in `components/ui/Popup/PopupHeader.vue`). Decided in Phase 4c sub-PR; not blocking.

### Rationale

- PopupCard's visual contract IS pure — it's a layout shell. The config dependency is incidental.
- Composable extraction sets the canonical pattern for "separate visual contract from data source" — applies throughout M6.
- Smaller diff than the alternative (demoting PopupCard to L4); preserves the clean L2 layer.
- Reusable: any other primitive that wants the fullscreen setting later just imports the same composable.

## Decision 4 — `SecretRevealCard` scope (key + seed only)

### Current state

3 export pages (~600 lines each) under `popup/pages/settings/security/export/`:

| Page | Pattern |
|---|---|
| `key.vue` | type password → unlock → reveal+copy private key |
| `seed.vue` | type password → unlock → reveal+copy seed phrase |
| `full.vue` | type password → unlock → build encrypted backup file → download |

### Decision

`SecretRevealCard` covers `key.vue` + `seed.vue` only. `full.vue` is structurally different (it's a backup pipeline, not a reveal+copy) — decompose separately in Phase 7m without using `SecretRevealCard`.

### Migration scope

- Phase 5e — Build `SecretRevealCard`; migrate `key.vue` (proof) + `seed.vue` (~250 lines saved across both)
- Phase 7m — Decompose `full.vue` into smaller pieces; no shared component imposed

### Rationale

- Forcing `full.vue` into `SecretRevealCard` would create a leaky abstraction (the component would need download + encrypt + filename branches that don't apply to key/seed).
- Codex round-3 audit explicitly flagged this.

## Decision 5 — `ConfirmDialog` deferred out of M6

### Current state

Confirmation dialogs use a callback-on-store pattern:

```js
cacheStore.confirm.title = "Confirm Action?"
cacheStore.confirm.description = "Description text"
cacheStore.confirm.confirm_text = "Yes"
cacheStore.confirm.callback = () => { /* action */ }
popupStore.open("confirm")
```

Documented in `CLAUDE.md`. ~30 sites use it.

### Decision

**Leave it alone in M6.** A promise-based upgrade (`if (await confirm("Delete?")) {}`) is ergonomically nicer but doesn't unblock anything else. Out of scope.

### Tracked

`STATUS.md` "Known follow-ups" section. Pick up post-M6 if/when convenient.

### Rationale

- The current pattern works.
- M6 is already 54-73 hr; scope creep risk is real.

## Decision 6 — EntityForm rollout (6 paired in / 2 unpaired out)

### Decision

In M6 scope (Phase 5d-i through 5d-vi):
- Contact pair (proof migration, 5d-i)
- Account pair (5d-ii)
- Endpoint pair (5d-iii)
- Fpc pair (5d-iv)
- Network pair (5d-v)
- Token pair (5d-vi)

Out of M6 scope (tracked in STATUS.md):
- `NewSenderPopup.vue` (no Edit counterpart)
- `EditProfilePopup.vue` (no New counterpart)

### Rationale

- The 6 paired popups give immediate consolidation value (~150 lines × 6 ≈ 900 lines saved).
- The 2 unpaired popups don't fit the pattern; forcing them in would either create a degenerate `EntityForm` or require a separate abstraction. Defer until separately audited.

## Decision 7 — Brutalist redesign: already merged

### State

Brutalist redesign (`brutalist-redesign/post-rebrand` branch) merged to master before M6 plan landed.

### Decision

No mid-arc coordination needed. Drop `Input variant="default"` cleanly with no compatibility window.

## Sign-off

- ✅ User pre-approved 2026-04-28 (chat session "design-system")
- ✅ Round-3 Codex audit incorporated (no blockers remaining)
- ✅ Plan committed to master (`d4c0c2e`)

Phase 4 sub-PRs reference this document by section number when migrating; if they need to deviate, they update this document first.
