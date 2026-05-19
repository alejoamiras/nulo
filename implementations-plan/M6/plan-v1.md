# A12 — Vue design system + component library (replaces A11)

> **Status**: draft v1, for parallel audit. Not approved.
>
> **Replaces**: A11 (`implementations-plan/A11/plan.md`), which scoped only `execute/index.vue` + `capabilities/index.vue` decomposition. A11.1 (humanizeOperationKind extract, `3a701df`) is on master and folds into A12 Phase 7.

## Why replace A11

A11 was symptom-only: two popups are big, decompose them. The root cause is broader:

- **23 pages bypass `Button.vue`** and reinvent CTAs via `:class="$style.cta"` (in `import.vue`, the security/export trio, `profile/new.vue`, settings forms…).
- **`Input.vue` ships dual visuals**: `variant: "default" | "brutalist"`. 23 explicit `variant="brutalist"` calls — pages choose individually.
- **24 popup SFCs in `popup/components/popups/`** all follow header + form + save/cancel — but each is its own SFC. Every NewX/EditX pair (Contact, Account, Token, Network, Fpc, Endpoint) reduplicates ~250 lines.
- **3 export pages** (`security/export/key.vue`, `full.vue`, `seed.vue`) all do the same "reveal secret + copy" dance, ~600 lines each.
- **0 Vue component unit tests**. Manual smoke is the only fidelity gate.
- **0 visual sandbox**. No way to see all variants at once.

A12 fixes that. It does to Vue what M1-M4 did to TypeScript: unify primitives, codify boundaries, add tests, add tooling. Decomposition is in here, but at the **end** — after we've built the toolbox.

## Scope

✅ **In**:
- Discovery + canonical design-system audit
- Vue component test infra (`@vue/test-utils` + happy-dom)
- Visual sandbox (**Histoire** — Vue-native, lightweight, Vite-based; alternative to Storybook chosen for fit)
- Foundation primitive unification (Button, Input, Toggle, Checkbox, Dropdown, …)
- Composite library (`FormPopup`, `EntityForm<T>`, `SecretRevealCard`, `InputWithButton`, `ConfirmDialog`, …)
- Composable extraction layer (`useEntityCrud<T>`, `useFeeEstimation`, `useDappPayload`, …)
- Decomposition of every 1000+ line file using the new toolbox
- Layer enforcement via `biome` `noRestrictedImports`
- Documentation (CLAUDE.md + `implementations-plan/A12/conventions.md`)

❌ **Out**:
- New features
- Functional bug fixes (track separately if discovered mid-arc)
- Behavioral / visual changes (visual fidelity = zero deltas, except where the audit explicitly decides to consolidate dual variants)
- TS migration of existing JS SFCs (Vue 3.5 supports JS `<script setup>`; not churning syntax in this arc)
- Service-layer refactors
- Routing changes
- Brand redesign

## Goals (success criteria)

| Goal | Target |
|---|---|
| Single source of truth for primitives | Every `components/ui/` SFC has Histoire story + ≥5 unit tests |
| Eliminate raw `cta` buttons | 0 `<button class.*cta` in `popup/**`; everything uses `<Button>` |
| Resolve dual-variant Input | Single `<Input>` API; `variant="brutalist"` either default or removed |
| Component test coverage | 100% primitives, 100% composites — prop/event/slot contract |
| Big-file rule | Every `popup/pages/*.vue` and `popup/windows/*/index.vue` ≤ 500 lines; every `popup/components/**/*.vue` ≤ 400 |
| Visual sandbox | All primitives + composites surfaced in Histoire |
| Quality gates | Typecheck + lint + unit + components + stories-build + e2e green per sub-PR |
| Documented conventions | `CLAUDE.md` + `implementations-plan/A12/conventions.md` |

## Inventory baseline (2026-04-28)

Top offenders (the decomposition targets in Phase 7):

| File | Lines | Phase 7 ID |
|---|---|---|
| `popup/pages/import.vue` | 1188 | 7c |
| `popup/windows/execute/index.vue` | 1088 | 7b |
| `popup/windows/capabilities/index.vue` | 966 | 7a |
| `popup/pages/tx/[id].vue` | 892 | 7d |
| `components/JsonViewer/LogsViewer.vue` | 811 | 7j |
| `popup/pages/send.vue` | 753 | 7e |
| `popup/components/modules/send/FeeSettingsCard.vue` | 721 | 7i |
| `popup/pages/settings/security/export/key.vue` | 644 | 7g |
| `popup/pages/settings/security/export/full.vue` | 597 | 7g |
| `popup/pages/settings/security/export/seed.vue` | 577 | 7g |
| `popup/components/popups/NewTokenPopup/CandidatesForm.vue` | 514 | 7k |
| `popup/pages/auth.vue` | 492 | 7f |
| `popup/pages/settings/contacts/index.vue` | 491 | 7h |
| `popup/pages/settings/connected-apps/[id].vue` | 475 | 7h |
| `popup/pages/settings/fpcs/index.vue` | 465 | 7h |
| `popup/pages/profile/new.vue` | 463 | 7h |
| `popup/windows/discover/index.vue` | 448 | 7l |

Counts (today's master `edbe2a3`):
- 18 SFCs in `src/components/` (4 core + 17 ui + 7 flat)
- 51 SFCs in `popup/components/` (18 modules + 31 popups + Navigation)
- 38 pages in `popup/pages/`
- 9 windows in `popup/windows/`
- **94 SFCs use `<style module>`** — single styling discipline ✓
- **0 raw `<input>`** outside primitives — Input is centralized ✓
- **23 raw `<button class="cta">`** in pages — Button bypassed ✗
- **23 explicit `variant="brutalist"`** Input usages — dual-variant smell ✗
- **9 composables** total — barely any (5 .ts + 4 .js, inconsistent)
- **0 Vue component unit tests**

## Hard rules

1. **Auto-import covers `src/components/` only.** Every extracted SFC in `popup/components/`, `popup/windows/`, `src/components/composite/` requires explicit `import` in its parent.
2. **CSS isolation.** Local styles move WHOLESALE into the extracted SFC. Never pass a parent `$style.x` to a child — only reaches the child root.
3. **Service-client lifecycle stays in the parent.** Composables receive a connected client OR a "do-the-thing" function. They never `connect()` / `disconnect()`. Parent owns `onMounted` / `onUnmounted`.
4. **Cleanup order preserved verbatim**: `service.disconnect()` → timer-clear → `window.removeEventListener("beforeunload", reject)`. Composables expose `dispose()` that the parent calls in the existing slot.
5. **No "wrapper" components that just relocate a switch** (the A11 OpCard.vue dispatcher anti-pattern). If extraction adds an indirection without reducing surface, don't extract.
6. **Stop rule**: 2 consecutive failures of any quality gate within a sub-PR → halt the arc, post audit-and-iterate.

## Architecture

### Layer model (L0-L6)

```
[L0] design tokens     src/design/tokens.ts (NEW)
                       Pure. Typed reflection of CSS vars. No imports beyond types.

[L1] core primitives   src/components/core/   (existing)
                       Flex, Icon, MaterialIcon, Text. Pure. No chrome.*. No service. No store.

[L2] ui primitives     src/components/ui/     (existing)
                       Button, Input, Toggle, …. Pure. No service. No store. No service-bound composable.

[L3] composites        src/components/composite/  (NEW)
                       FormPopup, EntityForm, SecretRevealCard, …. May import L0-L2. No service. No store.

[L4] feature modules   src/popup/components/modules/  (existing)
                       TokenCard, BalanceView, FeeSettingsCard, …. Service-bound. May import L0-L3.

[L5] popups + windows  src/popup/components/popups/, src/popup/windows/  (existing)
                       NewContactPopup, capabilities/index.vue, …. Orchestration. May import L0-L4.

[L6] pages             src/popup/pages/  (existing)
                       auth.vue, send.vue, …. Orchestration. May import L0-L4 + popups.
```

Enforced via biome `noRestrictedImports` in Phase 8 — same pattern M3.7 uses for the package-layer rule (CLAUDE.md).

### Composables layer

```
[C0] pure utilities    src/composables/                 (existing)
                       useTicker, useExternalImage, useExternalLink, …

[C1] service hooks     src/composables/services/        (NEW)
                       useFeeEstimation, useDappPayload, useEntityCrud<T>, …
                       Take connected clients; expose typed API.

[C2] page composables  Inline if used once; extract if reused.
```

## Phases (sequential — fan out within each)

Each phase has: entry condition, work items, exit gate, expected line delta, time estimate.

### Phase 0 — Discovery + audit (~3-4 hr; **no code changes**)

**Entry**: A12 plan approved.

**Work**:
1. Write `scripts/component-inventory.ts` — emits `implementations-plan/A12/inventory.md` with one row per SFC: `path | lines | layer | imports.length | has-style-module | has-css-class("cta")`.
2. Hand-audit the inventory:
   - Every `cta`-styled button → tag for Phase 4a unification.
   - Every `variant="brutalist"` Input call → tag for Phase 4b decision.
   - Every NewX/EditX popup pair → tag for Phase 5b `EntityForm`.
   - Every "reveal secret" page → tag for Phase 5c `SecretRevealCard`.
3. Write `implementations-plan/A12/audit.md`:
   - Foundation primitive state (Button + Input + Toggle + …)
   - Duplication clusters (popup pairs, secret-reveal sites, "input + button" combos)
   - Decomposition targets, prioritized
4. Write `implementations-plan/A12/conventions.md`:
   - CSS module naming (snake_case underscored)
   - Layer rules (L0-L6 from above)
   - Test conventions: `*.test.ts` next to `*.vue`, story `*.story.vue` next to `*.vue`
   - Composable conventions: parent owns lifecycle, composable exposes `dispose()`
5. Write `implementations-plan/A12/STATUS.md` — the re-engageable tracker (every phase + sub-step has a checkbox).

**Exit gate**:
- 4 markdown docs reviewed (one-screen summary delivered to user).
- No code changes.

---

### Phase 1 — Vue component test infrastructure (~3-4 hr)

**Entry**: Phase 0 docs approved.

**Work**:
1. Add devDeps: `@vue/test-utils`, `happy-dom`. Optionally `@vitest/ui`.
2. Add `vitest.components.config.ts` — env=happy-dom, includes `**/*.test.ts` colocated with `.vue`.
3. Add `bun run test:components` script.
4. Pilot: write `components/ui/Button.test.ts` covering 5 cases (props reactivity, click event, disabled, slot rendering, loading state).
5. Update CLAUDE.md project section: Vue test layer, test file conventions.

**Exit gate**:
- `bun run test:components` runs and passes (1 file, ≥5 cases).
- `bun run typecheck:all` clean.
- One example pattern pinned in conventions.md.

---

### Phase 2 — Visual sandbox via Histoire (~3-4 hr)

**Entry**: Phase 1 done.

**Work**:
1. Add devDeps: `histoire`, `@histoire/plugin-vue`.
2. Add `histoire.config.ts` (root config), `bun run story` (dev) + `bun run story:build` (CI).
3. Pilot: write `components/ui/Button.story.vue` — render every variant matrix.
4. Histoire build runs in CI; failure halts merge.
5. Document story conventions in `conventions.md`.

**Exit gate**:
- `bun run story:build` clean.
- One example story renders all Button variants.
- User verifies `bun run story` works locally.

**Fallback if Histoire fails / wrong fit**: Custom Vite-served `playground.html` page that imports every primitive into a single grid. Decision deferred to first concrete obstacle.

---

### Phase 3 — Design tokens (~2 hr)

**Entry**: Phase 2 done.

**Work**:
1. Read every CSS var in `src/styles/`, `src/popup/index.css`, etc.
2. Extract to `src/design/tokens.ts` — typed exports for color names, spacing scale, typography scale, motion scale.
3. One Histoire story per category (Colors, Spacing, Typography, Motion) showing the palette.
4. **No CSS rewrites** — tokens.ts is a typed reflection of existing CSS vars.

**Exit gate**:
- tokens.ts compiles + typecheck clean.
- Histoire renders 4 token panels.
- Visual diff: zero (we didn't change anything yet).

---

### Phase 4 — Foundation primitives unification (~6-8 hr; multi-PR)

**Entry**: Phase 3 done.

**Sub-PRs**:

**4a — Button unification**
- Decision required from user mid-arc: variant naming. Proposal: `primary` / `secondary` / `outline` / `ghost` / `cta` × `small` / `medium` / `large`. Plus `brutalist` flag (or merged into a variant).
- Update `Button.vue`: brutalist CTA shape supported via prop, NOT a separate `cta` class.
- Add `Button.story.vue` — full variant matrix.
- Add `Button.test.ts` — ≥10 cases (variants, sizes, disabled, loading, click event, link/router-link, leftIcon/rightIcon, slot).
- Migrate every raw `<button class="cta">` (23 sites) to `<Button>`.

**4b — Input unification**
- Decision required: drop `default`, keep brutalist (post-redesign default)? Or rename `Legacy` + migrate?
- Add `Input.story.vue` + `Input.test.ts` (≥10 cases).
- Migrate 23 `variant="brutalist"` callers (drop the prop).

**4c — Other primitives** (Toggle, Checkbox, Dropdown, Spinner, Tooltip, Badge, Banner, Popover, LoadingState, SectionLabel, Settings/*)
- One sub-PR per primitive (or batch by similarity).
- Each: story + ≥5 tests + variant audit + fix any inconsistency.

**Exit gate per sub-PR**:
- Story renders.
- Unit tests pass.
- Typecheck + lint clean.
- E2E smoke (`tests/e2e/registration.test.ts`, `tests/e2e/accounts.test.ts`) passes.
- Manual visual review against pre-change Histoire snapshot.

---

### Phase 5 — Composite library (~6-8 hr; multi-PR)

**Entry**: Phase 4 done (or 4a-4b done if a composite needs only Button + Input).

Each composite ships in its own sub-PR with story + tests + first migration:

**5a — `FormPopup`** (header + body + footer + save/cancel slot)
- Replaces boilerplate at the top of every NewX/EditX popup (~50 lines × 24 popups = ~1200 lines total).
- Migrate `NewContactPopup.vue` first as proof; then 5 more popups in same PR.

**5b — `EntityForm<T>`** for NewX/EditX twins
- Single-source field definitions; same form renders for new + edit.
- Migrate Contact pair (NewContact + EditContact → ContactForm) — saves ~150 lines.
- Roadmap doc lists the other 5 pairs to migrate in follow-up PRs.

**5c — `SecretRevealCard`** (export/key, export/full, export/seed)
- Reveal-on-click, copy, optional download.
- Migrate one export page first; lines saved across 3 pages: ~400.

**5d — `InputWithButton`** (recipient + scan/paste, password + show/hide)
- Story matrix.
- Migrate `send.vue` recipient field, all password fields.

**5e — `ConfirmDialog` upgrade**
- Convert popup-store-driven confirm to component-driven with promise API.
- Migrate ≥5 confirm sites.

**Exit gate per composite**: same as Phase 4 sub-PR.

---

### Phase 6 — Composables extraction (~4-5 hr; multi-PR; can run parallel to Phase 4-5)

**Entry**: Phase 1 done (test infra ready).

Each composable is a sub-PR with unit tests:

**6a — `useEntityCrud<T>`** — generic entity CRUD: subscribe to `onAdded`/`onUpdated`/`onDeleted`, expose reactive list.
- ~24 popup consumers; ~100 lines saved per consumer.
- Tests: subscription lifecycle, optimistic vs settled update.

**6b — `useFeeEstimation`** — per-op fee estimation with debounce + dispose.
- Replaces inline pattern in execute window + send page (was A11.3 in old plan).

**6c — `useDappInteractionPayload`** — load + decode dApp interaction payload.
- Used by execute, capabilities, discover, verify, json windows.

**6d — `useFormState`** — controlled inputs + validation rules + dirty tracking.
- Used by every entity form.

**Exit gate per composable**:
- Tests ≥ 10 cases each.
- Types explicit (no `any`).
- Callers no longer import service clients directly.

---

### Phase 7 — Page/popup decomposition (~8-12 hr; multi-PR)

**Entry**: Phases 4-6 done. (5+6 specifically for the popup/window targets.)

Tackle big files in priority order; each gets a sub-PR with:
- Pre-change story snapshot
- Decomposition using only Phase 3-6 primitives + composites
- Visual fidelity verified (post-change story matches pre-change)
- E2E regression run for relevant tests
- Line target hit

| Sub-PR | Target | Current | Goal |
|---|---|---|---|
| 7a | `capabilities/index.vue` | 966 | ≤ 400 |
| 7b | `execute/index.vue` | 1088 | ≤ 400 |
| 7c | `import.vue` | 1188 | ≤ 500 |
| 7d | `tx/[id].vue` | 892 | ≤ 400 |
| 7e | `send.vue` | 753 | ≤ 400 |
| 7f | `auth.vue` | 492 | ≤ 350 |
| 7g | export pages (key/full/seed) | 644+597+577 | ≤ 250 each (collapses into `SecretRevealCard`) |
| 7h | settings/contacts, connected-apps/[id], fpcs, profile/new | 491+475+465+463 | ≤ 350 each (collapse into composites) |
| 7i | `FeeSettingsCard.vue` | 721 | ≤ 400 (extract `FeeMethodRow` + `FeeCostReadout`) |
| 7j | `LogsViewer.vue` | 811 | ≤ 400 |
| 7k | `NewTokenPopup/CandidatesForm.vue` | 514 | ≤ 350 |
| 7l | `discover/index.vue` | 448 | ≤ 350 |

For each sub-PR:
- Use Histoire to confirm before/after visual fidelity.
- Run relevant e2e: dApp window decompositions trigger network suite; pages trigger registration/accounts/transfers.

---

### Phase 8 — Layer enforcement (~2-3 hr)

**Entry**: Phase 7 done.

**Work**:
1. Add `biome.json` `noRestrictedImports` overrides:
   - `src/components/composite/**` cannot import service clients, stores, or service-bound composables.
   - `popup/components/popups/**` cannot import service clients directly (must use composables from `src/composables/services/`).
   - `popup/pages/**` similarly.
2. Run lint; fix any violations surfaced.

**Exit gate**: lint clean.

---

### Phase 9 — Documentation + automation (~2 hr)

**Entry**: Phase 8 done.

**Work**:
1. Update CLAUDE.md project section:
   - Layer model L0-L6
   - Component test conventions
   - Story conventions
   - When to extract composable vs pure helper
2. Update `implementations-plan/A12/conventions.md` with final decisions.
3. Add `bun run audit:vue` script that runs:
   - `bun run typecheck:all`
   - `bun run test:components`
   - `bun run story:build`
   - `bun run lint`
   - `bun run test:e2e tests/e2e/registration.test.ts` (one-shot smoke)

**Exit gate**: docs reviewed; `bun run audit:vue` exits 0.

---

### Phase 10 — Final verification + visual regression sweep (~2-3 hr)

**Entry**: Phase 9 done.

**Work**:
1. Full e2e suite (`bun run test:e2e:all`) green.
2. Manual smoke matrix (provided as checklist in PR description):
   - Connect dApp → execute popup
   - Connect dApp → capabilities popup (rerequest path included)
   - Send sponsored
   - Send Fee Juice (public + private)
   - Reset profile
   - Change password
   - Add contact + edit contact + delete contact
   - Add token + edit token + delete token
   - Settings → walk every section
   - Export seed / key / full
3. Histoire sweep: every primitive + composite renders, every variant visible.
4. Audit: any regressions, line targets missed, debt accumulated.
5. Mark A12 done in `AUDIT.md` (if exists) and `implementations-plan/A12/STATUS.md`.

**Exit gate**:
- Full e2e suite green.
- Manual smoke matrix all green.
- All line targets met (or risk-#4-style explanations for any miss).
- `STATUS.md` 100% checked.

## Quality gates (per sub-PR)

| Gate | What | When |
|---|---|---|
| typecheck | `bun run typecheck:all` | always |
| lint | `bun run lint` | always |
| component tests | `bun run test:components` | per primitive/composite/composable change |
| stories build | `bun run story:build` | per primitive/composite change |
| unit tests | `bun run test` | per composable/helper change |
| e2e smoke | `tests/e2e/registration.test.ts`, `tests/e2e/accounts.test.ts` | per Phase 7 sub-PR |
| e2e network | relevant `tests/e2e/network/*.test.ts` | per dApp window decomposition |
| visual snapshot | Histoire eyeball or automated diff | per Phase 4-7 sub-PR |
| manual QA | Specific scenario in PR description | per Phase 7 sub-PR + final |

## Tracker (re-engageability)

`implementations-plan/A12/STATUS.md` carries:

```
## Phase 0 — Discovery
- [ ] inventory.md
- [ ] audit.md
- [ ] conventions.md
- [ ] STATUS.md (this file)

## Phase 1 — Vue test infra
- [ ] @vue/test-utils + happy-dom installed
- [ ] vitest.components.config.ts
- [ ] Button.test.ts pilot
- [ ] CLAUDE.md updated

## Phase 2 — Histoire
- [ ] histoire installed
- [ ] histoire.config.ts
- [ ] bun run story works
- [ ] bun run story:build clean
- [ ] Button.story.vue pilot

## Phase 3 — Tokens
- [ ] src/design/tokens.ts
- [ ] tokens story rendered

## Phase 4 — Primitives
- [ ] 4a — Button (decision + migration + 23 cta sites)
- [ ] 4b — Input (decision + 23 variant calls)
- [ ] 4c — Toggle/Checkbox/Dropdown/Spinner/Tooltip/Badge/Banner/Popover/LoadingState/SectionLabel/Settings/*

## Phase 5 — Composites
- [ ] 5a — FormPopup
- [ ] 5b — EntityForm<T> (Contact pair migration)
- [ ] 5c — SecretRevealCard (one export migration)
- [ ] 5d — InputWithButton
- [ ] 5e — ConfirmDialog upgrade

## Phase 6 — Composables
- [ ] 6a — useEntityCrud<T>
- [ ] 6b — useFeeEstimation
- [ ] 6c — useDappInteractionPayload
- [ ] 6d — useFormState

## Phase 7 — Decomposition
- [ ] 7a — capabilities/index.vue
- [ ] 7b — execute/index.vue
- [ ] 7c — import.vue
- [ ] 7d — tx/[id].vue
- [ ] 7e — send.vue
- [ ] 7f — auth.vue
- [ ] 7g — export pages (key/full/seed)
- [ ] 7h — settings/contacts, connected-apps/[id], fpcs, profile/new
- [ ] 7i — FeeSettingsCard.vue
- [ ] 7j — LogsViewer.vue
- [ ] 7k — NewTokenPopup/CandidatesForm.vue
- [ ] 7l — discover/index.vue

## Phase 8 — Layer enforcement
- [ ] biome noRestrictedImports overrides
- [ ] lint clean

## Phase 9 — Docs
- [ ] CLAUDE.md updated
- [ ] conventions.md final
- [ ] bun run audit:vue script

## Phase 10 — Final
- [ ] e2e:all green
- [ ] Manual smoke matrix all green
- [ ] Histoire sweep
- [ ] AUDIT.md marked
```

A future agent reads STATUS.md, sees what's checked, picks up from the next unchecked item.

## Estimated time

| Phase | Time | Cumulative |
|---|---|---|
| 0 — Discovery | 3-4 hr | 3-4 |
| 1 — Test infra | 3-4 hr | 6-8 |
| 2 — Histoire | 3-4 hr | 9-12 |
| 3 — Tokens | 2 hr | 11-14 |
| 4 — Primitives | 6-8 hr | 17-22 |
| 5 — Composites | 6-8 hr | 23-30 |
| 6 — Composables | 4-5 hr | 27-35 |
| 7 — Decomposition | 8-12 hr | 35-47 |
| 8 — Layer enforcement | 2-3 hr | 37-50 |
| 9 — Docs | 2 hr | 39-52 |
| 10 — Final verification | 2-3 hr | 41-55 |

**Total: 41-55 hours.** Realistic over multiple sessions. Phases independent enough to pause between.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Histoire too heavy / wrong fit | M | Pilot in Phase 2; fallback to custom Vite playground page |
| Brutalist redesign half-applied | M | Audit captures dual-variants; Phase 4 forces a per-primitive decision |
| Visual fidelity loss | H | Histoire snapshots before+after; manual smoke matrix in Phase 10 |
| Time cost (41-55 hr) | H | Phases independent; STATUS.md tracker enables pause/resume |
| Concurrent agent contention on e2e ports | L | Already documented in `feedback_e2e_isolation` memory; check `lsof -ti:5174` before each e2e run |
| Existing tests break mid-arc | M | E2E smoke per sub-PR + `audit:vue` script per Phase 9 |
| Premature abstraction (composite not actually reused) | M | Phase 0 audit drives extracts from REAL duplication, not speculation |
| Library rule misalignment with Aztec churn | L | tokens.ts is forward-only; Histoire is offline; no Aztec coupling |

## Decision points for user approval

- [ ] **Plan scope** — A12 replaces A11; broader. OK?
- [ ] **Histoire** as visual sandbox — Vue-native, Vite-based, lightweight. OK or prefer Storybook?
- [ ] **Phase order** — Test infra (Phase 1) before primitives (Phase 4). OK?
- [ ] **Time budget** — 41-55 hours over multiple sessions. OK?
- [ ] **Brand decisions mid-arc** — Button variant naming, drop legacy Input variant. User available?
- [ ] **A11.1 status** — already merged (`3a701df`). Folds into Phase 7b. OK to leave as-is or revisit?

## Lessons absorbed from A11.1 pilot (humanizeOperationKind)

A11.1 extracted a 29-line pure helper from execute/index.vue, added 7 unit tests including the pre-existing-bug pin, kept the bug verbatim. Worked cleanly. Confirms:
- Pure-helper extraction is the lowest-risk pattern.
- Pre-existing bugs MUST be preserved verbatim (with documented pin) during structural refactors.
- `wc -l` line target is a guardrail, not a goal — A11.1 reduced execute by 8 lines while adding test coverage.

A12 carries this forward: every extraction documents and pins existing behavior. No silent fixes.

---

**End of plan v1. Audits next.**
