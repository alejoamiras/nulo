# Phase 4 — Settings network list: active badge (item 4, option B)

**Done.** `settings/networks/index.vue`: removed the misleading left `check-circle`/`circle` icon
(the "looks selectable but isn't" source). The active row now shows a small accent DOT + "Active"
label in the `#right` slot before the chevron; every row is a drill-in to detail (where
`network-set-active` still lives). Active is conveyed by TEXT ("Active"), not color alone (a11y).

**Keyboard (codex condition #2):** rows were click-only focusable `<div>`s (`SettingItem` `@click`).
Switched to `SettingItem :to="/popup/settings/networks/<id>"` → renders a real keyboard-activatable
router-link (`SettingItem.vue` `<component :is="'router-link'">`), Enter/Space navigate natively.
Removed the now-unused `useRouter`/`handleOpenDetail`. e2e `switchToNetwork` uses a dispatched click,
which vue-router's router-link intercepts, so the switch flow stays compatible with the `<a>` rows.

**Testids preserved:** `network-row`, `data-network-id`, `data-network-name` verbatim; added
`network-active-badge` for the active indicator.

**Tests (greenfield — no prior scaffold):** `index.test.ts` (3) — every row carries a `to` (proving
keyboard-activatable link, not click-only div); the ACTIVE row renders the "Active" badge, non-active
don't, testids stable; no `check-circle`/`circle` icon remains. Children stubbed per the repo
convention (auto-imports don't resolve for a page mount); app-store `chrome.storage.local` stubbed.

**Gate:** component 3/3 · lint + typecheck:all 0 · build:chrome 0. Settings network-path smoke folds
into the consolidated e2e pass.
