# Phase 4 — Settings network list: active badge (item 4, option B)

**Done.** `settings/networks/index.vue`: removed the misleading left `check-circle`/`circle` icon
(the "looks selectable but isn't" source). The active row shows a small status DOT in the LEFT
`#dot` slot (where the fake radio was) + an "Active" chip in the `#right` slot before the chevron;
every row is a drill-in to detail (where `network-set-active` still lives). Active is conveyed by
TEXT ("Active"), not color alone (a11y).

**Design-system correction (post-review).** The first cut DRIFTED from the chosen artifact
(`network-ux-options.html` option B): it put the dot on the RIGHT next to a hand-rolled pill. The
mock had the dot on the LEFT + an "Active" chip on the right. Rebuilt from `@nulo/design`: the chip
is the `Badge` primitive (NOT bespoke CSS), and colors are real tokens — the mock's placeholder
indigo `#7c8cff` is NOT ours. Chosen treatment (user-picked, artifact 6e26ac98): **`--green` dot**
(Nulo's real "active/live" status color, mirroring `DappStatusStrip`'s ready dot) + **`Badge
variant="info"`** (neutral, high-contrast in BOTH themes). Rejected: `Badge variant="purple"` +
purple dot — matched the mock's indigo (`--purple #5856de`) more literally but the purple Badge is
black-ish text on indigo in dark mode (~3.6:1, below AA). Lesson: the artifact is the UI *idea*;
render it in our tokens/primitives, never copy the mock's colors. Testid `network-active-dot` added
for the left marker.

**Keyboard (codex condition #2):** rows were click-only focusable `<div>`s (`SettingItem` `@click`).
Switched to `SettingItem :to="/popup/settings/networks/<id>"` → renders a real keyboard-activatable
router-link (`SettingItem.vue` `<component :is="'router-link'">`), Enter/Space navigate natively.
Removed the now-unused `useRouter`/`handleOpenDetail`. e2e `switchToNetwork` uses a dispatched click,
which vue-router's router-link intercepts, so the switch flow stays compatible with the `<a>` rows.

**Testids preserved:** `network-row`, `data-network-id`, `data-network-name` verbatim; added
`network-active-badge` (chip) + `network-active-dot` (left marker) for the active indicator.

**Tests (greenfield — no prior scaffold):** `index.test.ts` (3) — every row carries a `to` (proving
keyboard-activatable link, not click-only div); the ACTIVE row renders BOTH the left dot and the
"Active" chip, non-active rows show neither, testids stable; no `check-circle`/`circle` icon remains.
Children stubbed per the repo convention (incl. a `Badge` stub for deterministic testid/text
assertions; auto-imports don't resolve for a page mount); app-store `chrome.storage.local` stubbed.

**Gate:** component 3/3 · lint + typecheck:all 0 · build:chrome 0. Settings network-path smoke folds
into the consolidated e2e pass.
