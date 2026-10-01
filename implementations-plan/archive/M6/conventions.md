# M6 — Vue conventions

> Codifies the rules a future agent must follow when writing or modifying Vue code under M6. Companion docs: `plan.md`, `audit.md`, `decisions.md`, `STATUS.md`.

## Layer model (L0-L6)

```
[L0] design tokens     src/design/tokens.ts
                       Pure typed reflection of CSS vars. No imports beyond types.

[L1] core primitives   src/components/core/
                       Flex, Icon, MaterialIcon, Text. Pure. No chrome.*.

[L2] ui primitives     src/components/ui/
                       Button, Input, Toggle, ... Pure. No service/store/service-bound composable.
                       PopupCard joins this layer once the L4 violation is fixed in Phase 4c.

[L3] composites        src/components/composite/
                       FormPopup, EntityForm, SecretRevealCard, InputWithButton, ...
                       Plus 6 modules promoted from L4 (TransactionAwaitingCard, AmountCard, etc.).
                       May import L0-L2. No service/store.

[L4] feature modules   src/popup/components/modules/
                       BalanceView, FeeSettingsCard, TokenCard, GasBalanceCard, ...
                       Service-bound. May import L0-L3.

[L5] popups + windows  src/popup/components/popups/, src/popup/windows/
                       Orchestration. May import L0-L4. May own service-client lifecycle.

[L6] pages             src/popup/pages/
                       Orchestration. May import L0-L4 + popups. May own service-client lifecycle.
```

Enforced via biome `noRestrictedImports` (Phase 8 — landed; extends the existing M3.7 rule at `biome.json:208`). Two overrides in play:
- `components/{core,ui,composite}/**` — banned from importing service clients, service implementations, stores, and `@/utils/core`.
- `popup/components/modules/**` — banned from importing `@/popup/pages/*` and `@/popup/windows/*`.

Pages and windows remain unrestricted: they legitimately own service-client lifecycles.

**The "may own service-client lifecycle" rule applies only to L5 + L6.** L0-L3 must stay pure. Composables in `src/composables/services/` (or flat) act as the bridge.

## Composables layer

```
[C0] pure utilities    src/composables/                 (existing)
                       useTicker, useExternalImage, useExternalLink, ...

[C1] service hooks     src/composables/  OR  src/composables/services/  (subdir requires vite.config.ts dirs update)
                       useFormState, useEntityCrud<T>, useFeeEstimation, useDappInteractionPayload, useFullscreenPopupSetting, ...

[C2] page composables  Inline if used once; extract if reused.
```

**Service composables receive a connected client OR a "do-the-thing" function. They NEVER call `connect()` / `disconnect()` themselves.** The parent owns the lifecycle. Composables expose a `dispose()` method that the parent calls in the existing onUnmounted slot.

## CSS module naming

- All styled components use `<style module>` (single file-isolated CSS scope).
- Class names: `snake_case_underscored` (matches existing convention).
- Local class blocks live WHOLESALE in the component that uses them. Never pass parent `$style.x` to a child — the binding only reaches the child root and breaks nested selectors.
- During Phase 7 extractions: full block transfer per PR. No partial moves (prevents CSS specificity battles during transitions).

## Vue SFC ordering (carry from CLAUDE.md)

Components follow execution-order-based ordering inside `<script setup>`:

1. Imports (grouped with `/** Services */`, `/** Components */`, `/** Utils */`, `/** Composables */`, `/** Stores */`, etc.)
2. Macros (`defineEmits`, `defineProps`, `defineExpose`)
3. Store instantiation
4. Composables
5. Router/Route
6. Reactive state
7. Service clients + event subscriptions
8. Functions/Handlers
9. Watchers
10. Lifecycle hooks (in chronological order: onBeforeMount, onMounted, onBeforeUnmount, onUnmounted)

## Test conventions

### File location

- Component test: `<Name>.test.ts` colocated with `<Name>.vue` (e.g., `Button.vue` + `Button.test.ts` in same dir).
- Story file: `<Name>.story.vue` colocated with `<Name>.vue` (Histoire convention).
- Composable test: `<name>.test.ts` colocated with `<name>.ts` in `src/composables/`.

### Test API

- **Component tests**: `@vue/test-utils` (`mount` / `shallowMount`) + jsdom (already configured).
- **Pinia in tests**: `createTestingPinia()` from `@pinia/testing`. Stub all stores by default; override per-test with `initialState`.
- **Router in tests**: `createMemoryHistory()` for stories/tests that depend on navigation.
- **chrome.* in tests**: Vitest already stubs at `tests/vitest.setup.ts:88-113`. Histoire stories that need it import the same stub from `histoire.setup.ts`.

### Test coverage minimum

- L1/L2 primitives: ≥5 cases (props, events, slots, edge cases, accessibility).
- L3 composites: ≥10 cases.
- Composables: ≥10 cases (lifecycle, error paths, dispose).
- L4/L5/L6 components: NOT required to have component tests (covered by e2e + manual smoke). Optional if the component is complex.

### Pre-existing bug pinning (Hard Rule #8)

When extracting a function or component, preserve any pre-existing buggy behavior verbatim. Document via a test pin if the bug is behaviorally surprising:

```ts
test("(BUG PIN) replaces only the FIRST underscore in operation kind", () => {
  // humanize.ts has a single .replace("_", " ") which leaves later underscores.
  // Preserved verbatim during A11.1 extraction; tracked separately for fix.
  expect(humanize("aztec_get_chain_info")).toBe("aztec get_chain_info")
})
```

## testid preservation rule (Hard Rule #6)

Every extraction preserves all `data-testid` attributes verbatim. New components inherit testids from the parent template — they are NOT invented.

Per sub-PR check:
```bash
git diff --name-only HEAD~1 HEAD -- '*.vue' | xargs -I {} grep -oE 'data-testid="[^"]+"' {} | sort -u > .testids-after.txt
git show HEAD~1 -- '*.vue' | grep -oE 'data-testid="[^"]+"' | sort -u > .testids-before.txt
diff .testids-before.txt .testids-after.txt  # should be empty (or only +entries, no -)
```

If the diff shows any removed testids, halt the sub-PR. Re-add the testid in the new location.

## Cleanup order in `onUnmounted` (Hard Rule #4)

Carry-from-A11 lesson. Do NOT reorder these:

```ts
onBeforeUnmount(() => {
  profileService.disconnect()
  interactionService.disconnect()
  executionService.disconnect()        // ← BEFORE timer clear
  feeEstimation.dispose()              // ← composable's dispose, AFTER executionService.disconnect()
  for (const t of Object.values(estimateTimers)) clearTimeout(t)
  window.removeEventListener("beforeunload", reject)
})
```

Composables MUST NOT own their own `onUnmounted`. They expose `dispose()` that the parent calls in the existing slot.

## Storybook / Histoire bootstrap (Phase 2)

`histoire.setup.ts` MUST install:
1. Global SCSS: `import "@/assets/styles/_base.scss"` and `import "@/popup/index.scss"` (provides every CSS var the primitives consume)
2. Pinia: `app.use(createPinia())` with `createTestingPinia` for stories that need stubbed stores
3. Vue Router (memory mode): only for stories that need it
4. Teleport roots: `#popup`, `#tooltip`, `#dropdown`, `#popover`, `#toast` — required by Tooltip, DropdownRoot, Popover, ToastManager, Popup
5. chrome.runtime stub: same pattern as `tests/vitest.setup.ts:88-113`

Per-story setup (when needed):
- Mock `*ServiceClient` modules via `vi.mock()` (component tests) or Histoire's per-story setup (visual stories).
- Document any masked region for visual regression in the story file's frontmatter (`<!-- @lost-pixel-mask: hover-state -->`).

## Visual regression policy

- Threshold = **0** globally. Any pixel diff fails the CI gate.
- Per-story masks documented in the story file when a region is genuinely flaky (animation, time-based content, font loading).
- Baseline captured at the post-redesign master HEAD; re-baselined only when intentional visual changes ship (NEVER mid-extraction).

## Stop rule (per gate)

| Gate | Failure handling |
|---|---|
| typecheck | retry once after fix |
| lint | retry once after fix |
| build | halt immediately |
| component test | retry once after fix; halt sub-PR if reproduces |
| stories build | halt sub-PR |
| visual regression | halt sub-PR; per-story mask requires conventions update |
| unit tests | halt sub-PR |
| e2e smoke | 2× consecutive failures → halt arc, post audit-and-iterate |
| e2e network | 2× consecutive failures → halt arc, post audit-and-iterate |
| testid drift | halt sub-PR |
| manual QA | 2× consecutive failures → halt arc, post audit-and-iterate |

## Branch naming

- `m6/phase-N-<short-name>` for whole phases (e.g., `m6/phase-0-discovery`, `m6/phase-2-histoire`)
- `m6/<sub-pr-id>-<short-name>` for sub-PRs (e.g., `m6/4a-button-unification`, `m6/5d-i-contact-form`)

## Commit message style

Conventional commits (lowercase subject):
- `docs(plan):` for plan/audit doc changes
- `feat(<area>):` for new components / composables / capabilities
- `refactor(<area>):` for extractions, renames, layer moves
- `test(<area>):` for test-only changes
- `chore(deps):` for dependency adds (Histoire, Lost Pixel, etc.)
- `fix(<area>):` reserved for bug fixes — should NOT happen during M6 extractions (Hard Rule #8)

Reference plan section in body when applicable: "M6 5d-i Contact pair migration".
