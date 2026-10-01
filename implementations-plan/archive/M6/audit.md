# M6 — Phase 0 audit

> Generated 2026-04-28 from inventory.md.
> Companion docs: `plan.md`, `inventory.md`, `decisions.md`, `conventions.md`, `STATUS.md`.

## Foundation primitive state (L2 `components/ui/`)

| Primitive | Lines | Variant smell | Story (Phase 2) | Test (Phase 1) |
|---|---|---|---|---|
| `Button.vue` | 303 | `type` prop; 64 callers; 22 raw `cta` button bypass | TODO Phase 4a | TODO Phase 4a |
| `Input.vue` | 396 | `variant: "default" \| "brutalist"`; 23 explicit brutalist callers | TODO Phase 4b | TODO Phase 4b |
| `Toggle.vue` | 98 | — | TODO Phase 4d (Form batch) | TODO Phase 4d |
| `Checkbox.vue` | 67 | — | TODO Phase 4d (Form batch) | TODO Phase 4d |
| `Dropdown/DropdownRoot.vue` | 284 | uses `#dropdown` teleport | TODO Phase 4d (Overlay batch) | TODO Phase 4d |
| `Dropdown/DropdownTrigger.vue` | 131 | — | folded into Dropdown story | folded |
| `Dropdown/DropdownItem.vue` | 53 | — | folded | folded |
| `Dropdown/DropdownTitle.vue` | 17 | — | folded | folded |
| `Dropdown/DropdownDivider.vue` | 12 | — | folded | folded |
| `Popover.vue` | unknown | uses `#popover` teleport | TODO Phase 4d (Overlay batch) | TODO Phase 4d |
| `Tooltip.vue` | unknown | uses `#tooltip` teleport | TODO Phase 4d (Overlay batch) | TODO Phase 4d |
| `Spinner.vue` | unknown | — | TODO Phase 4d (Layout batch) | TODO Phase 4d |
| `Badge.vue` | unknown | — | TODO Phase 4d (Layout batch) | TODO Phase 4d |
| `Banner.vue` | unknown | — | TODO Phase 4d (Layout batch) | TODO Phase 4d |
| `LoadingState.vue` | unknown | — | TODO Phase 4d (Layout batch) | TODO Phase 4d |
| `SectionLabel.vue` | unknown | — | TODO Phase 4d (Settings family) | TODO Phase 4d |
| `SubPageHeader.vue` | unknown | — | TODO Phase 4d (Settings family) | TODO Phase 4d |
| `Settings/ItemsContainer.vue` | unknown | — | folded into Settings story | folded |
| `Settings/SettingField.vue` | unknown | — | folded | folded |
| `Settings/SettingItem.vue` | unknown | — | folded | folded |
| `Settings/SettingValue.vue` | unknown | — | folded | folded |
| `ToastManager.vue` | unknown | uses `#toast` teleport | TODO Phase 4d (Toast/Popup batch) — round-3 added | TODO Phase 4d |
| `Popup/PopupHeader.vue` | unknown | — | TODO Phase 4d (Toast/Popup batch) — round-3 added | TODO Phase 4d |

L2 totals: 23 SFCs, all need stories + tests.

## Layer rule violation to fix in Phase 4c

`src/components/Popup/PopupCard.vue` — imports `ConfigServiceClient` and runs `connect()` / `disconnect()` lifecycle. Violates L2 rule (UI primitives can't import service clients).

**Fix (decisions.md, pre-approved)**: extract `useFullscreenPopupSetting()` composable in `src/composables/`. PopupCard becomes pure. Stays at the same path or moves to `src/components/ui/Popup/` for symmetry with `PopupHeader.vue`.

## Duplication clusters

### Cluster 1 — raw `cta`-styled buttons (Phase 4a)

22 raw `<button :class="$style.cta">` (and `cta_outline`, `cta_red` flavors) across 7 files:

| File | Sites |
|---|---|
| `popup/pages/import.vue` | 8 (lines 895, 903, 910, 917, 928, 937, 945, 950) |
| `popup/pages/settings/security/export/key.vue` | 4 (326, 330, 337, 356) |
| `popup/pages/settings/security/export/full.vue` | 4 (366, 370, 381, 389) |
| `popup/pages/settings/security/export/seed.vue` | 3 (263, 267, 274) |
| `popup/pages/settings/security/change-password.vue` | 1 (204) |
| `popup/pages/settings/security/reset.vue` | 1 (147) — uses `cta_red` |
| `popup/pages/profile/new.vue` | 1 (255) |

Variant mapping (per decisions.md):
- 12 sites use `$style.cta` → `<Button variant="cta">`
- 6 sites use `$style.cta + $style.cta_outline` → `<Button variant="cta" outline>` (or whatever the final naming lands on)
- 1 site uses `$style.cta + $style.cta_red` → destructive variant

### Cluster 2 — dual-variant Input (Phase 4b)

23 explicit `variant="brutalist"` Input callers. Brutalist is the post-redesign default; legacy `default` variant is dead code.

**Action**: drop `variant="default"`; remove the prop entirely from `Input.vue`; sed-rewrite the 23 callers to drop the explicit prop.

### Cluster 3 — native `<input>` bypass (split between Phase 4b and 5b)

4 native `<input>` sites:

| File | Site | Pattern | Migration phase |
|---|---|---|---|
| `popup/components/modules/send/AmountCard.vue` | 79 | simple amount input | Phase 4b (just use `<Input>`) |
| `popup/windows/capabilities/index.vue` | 452 | account-alias inline edit | Phase 4b (just use `<Input>`) |
| `popup/pages/auth.vue` | 179 | password + visibility toggle | **Phase 5b** (needs `<InputWithButton>`) |
| `popup/pages/send.vue` | 458 | recipient + suggestion popover | **Phase 5b** (needs `<InputWithButton>`) |

### Cluster 4 — New/Edit popup pairs (Phase 5d, 6 sub-PRs)

6 matched pairs that all share the "modal + form + save/cancel" shape:

| Pair | Combined size | Service |
|---|---|---|
| NewContactPopup + EditContactPopup | 244 + 300 | ContactService |
| NewAccountPopup + EditAccountPopup | 191 + 189 | AccountService |
| NewTokenPopup + EditTokenPopup | (350 inside dir) + ~280 | TokenService |
| NewNetworkPopup + EditNetworkPopup | unknown | NetworkService |
| NewFpcPopup + EditFpcPopup | unknown | FpcService |
| NewEndpointPopup + EditEndpointPopup | unknown | (M4.10 endpoint service) |

Migration plan (Phase 5d):
1. Build `EntityForm<T>` composite (5d-i — Contact pair as proof)
2. Migrate the other 5 pairs in 5d-ii through 5d-vi

Estimated savings: ~150 lines × 6 pairs = ~900 lines.

**Out of M6 scope (tracked in STATUS.md)**:
- `NewSenderPopup.vue` (no Edit counterpart, doesn't fit `EntityForm`)
- `EditProfilePopup.vue` (no New counterpart, doesn't fit `EntityForm`)

### Cluster 5 — Secret reveal flow (Phase 5e, partial)

3 export pages, 2 share the "type password → unlock → reveal+copy" pattern:

| File | Lines | Pattern |
|---|---|---|
| `popup/pages/settings/security/export/key.vue` | 644 | reveal+copy → **Phase 5e** (`SecretRevealCard`) |
| `popup/pages/settings/security/export/seed.vue` | 577 | reveal+copy → **Phase 5e** |
| `popup/pages/settings/security/export/full.vue` | 597 | encrypted backup pipeline (different) → **Phase 7m** (separate decomposition) |

### Cluster 6 — Module re-classification (Phase 5c)

6 modules promoted L4 → L3 (transitively pure — verified zero direct or transitive store/service deps):

1. `popup/components/modules/activity/TransactionAwaitingCard.vue` → `composite/activity/`
2. `popup/components/modules/capabilities/CapabilityDetailPanel.vue` → `composite/capabilities/`
3. `popup/components/modules/general/EmojiGrid.vue` → `composite/general/`
4. `popup/components/modules/send/AmountCard.vue` → `composite/send/` (also gets native-input migration in 4b)
5. `popup/components/modules/send/FeeJuiceCard.vue` → `composite/send/`
6. `popup/components/modules/send/SendTypesCard.vue` → `composite/send/`

NOT promoted (transitive deps; remain L4 unless refactored):
- `popup/components/modules/activity/TransactionsList.vue` — imports `TransactionCard` (service-bound)
- `popup/components/modules/general/WarningView.vue` — uses `useExternalLink()` which transitively pulls Pinia via `configClient.ts`

L4 remaining post-promotion (13 modules): TransactionsList, TransactionCard, WarningView, BalanceView, GasBalanceCard, ActionButtonsView, NetworkBadge (pre-A11 removed it; verify), RecentActivityView, SplittedBalancesView, TokenCard, TokensView, FeeSettingsCard, SelectTokenCard, FeeSettingsCard. (Phase 0 inventory will surface the exact post-pre-A11 count.)

## Decomposition targets (Phase 7)

Top offenders, ordered by Phase 7 sub-PR. See `plan.md` Phase 7 table for required composables per target.

| Sub-PR | File | Lines | Target |
|---|---|---|---|
| 7g | `export/key.vue` + `seed.vue` | 644 + 577 | ≤ 250 each (consumes `SecretRevealCard`) |
| 7j | `LogsViewer.vue` | 811 | ≤ 400 (independent of Phase 6) |
| 7a | `capabilities/index.vue` | 966 | ≤ 400 |
| 7b | `execute/index.vue` | 1088 | ≤ 400 |
| 7l | `discover/index.vue` | 448 | ≤ 350 (parallelizable with 7a/7b once 6c lands) |
| 7c | `import.vue` | 1188 | ≤ 600 (hard cap) |
| 7d | `tx/[id].vue` | 892 | ≤ 500 |
| 7e | `send.vue` | 753 | ≤ 500 |
| 7f | `auth.vue` | 492 | ≤ 350 |
| 7h | settings/contacts, connected-apps/[id], fpcs, profile/new, authwits | 491+475+465+463+484 | ≤ 350 each |
| 7i | `FeeSettingsCard.vue` | 721 | ≤ 400 |
| 7k | `NewTokenPopup/CandidatesForm.vue` | 514 | ≤ 350 |
| 7m | `export/full.vue` | 597 | ≤ 400 (separate, NOT SecretRevealCard) |

## Drift since plan v3 was committed (post-pre-A11 cleanup)

Pre-A11 UX cleanup arc shipped 4 of 5 branches before M6 plan was committed to master. Inventory reflects post-pre-A11 state:
- `NetworkBadge.vue` was removed (consolidated into mono-text labels) — drop from L2 primitive list
- `TransactionCardLayout.vue` was added to `popup/components/modules/activity/` — verify L3/L4 classification in Phase 5c (likely L3 if pure)
- `notes/index.vue` was rewritten (display-model precompute) — does not affect M6 phases

These shifts are minor; M6 phase shape unchanged.

## Open questions (resolved)

All Phase 0 decisions resolved in `decisions.md`. No mid-arc blockers.

## Next steps

Phase 0 exit gate: 5 docs (this one + inventory + decisions + conventions + STATUS) reviewed by user. Then Phase 1 (Vue test infra) begins on its own branch.
