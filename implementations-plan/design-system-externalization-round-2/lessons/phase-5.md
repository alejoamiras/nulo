# Phase 5 — Host-DOM (useOutside + Tooltip + Popover)

**Status:** ✓ green. Branch: `chore/design-r2-holdouts`. Faucet untouched (frozen).

## What shipped
- **`packages/design/src/composables/outside.ts`** — TS port of `outside.js` (`useOutside`/`useEvent`),
  behavior verbatim: the iPad/iPhone UA → `touchstart` (else `mousedown`) branch + the `data-outside`
  collision guard + the unconditional `removeEventListener(element.value)` in `remove()` (preserved with
  a cast, not a guard). 10 tests incl. the collision-guard BUG PIN. Extension `composables/outside.js`
  → explicit-named re-export shim (kept at `.js`; **DropdownRoot** also consumes it — verified the
  extension suite still resolves it).
- **`Tooltip.vue`** → package: `teleportTo` prop (default `#tooltip`) + the `--base-width` host-token
  contract (documented in the README). Already TS + explicit vue imports + no auto-imported children,
  so the port was just the teleport prop. 8 tests (+ `teleportTo` override).
- **`Popover.vue`** → package: `teleportTo` (default `#popover`), package `useOutside`, explicit
  imports + `lang="ts"` (loose-JS → TS: typed `removeOutside: (()=>void)|null`, `reactive<Record<...>>`,
  `Number(props.width)` for the string-arithmetic, `(triggerEl.value as HTMLElement)`). **(BUG PIN)**
  `removeOutside` is null until the open-branch `nextTick` assigns it → `(removeOutside as () => void)()`
  in the else-branch throws if closed before assignment (preserved verbatim). 6 tests (+ override).
- Resolver + index + mount-all grown (Tooltip, Popover — clean migrations, locals deleted, stories
  relocated). README documents the teleport-root + `--base-width` + composables contracts.

## Lessons / gotchas
- **`components.d.ts` MUST point Tooltip/Popover → `@nulo/design`** (unlike P4's wrapper-backed
  Button/SubPageHeader which stay local). Caught when `verify/index.vue:208` `<Tooltip #content>`
  failed typecheck (`Property 'content' does not exist on type '{}'`) — the stale dts (Tooltip →
  deleted-local) gave the resolved type empty slots. Fix: restore HEAD + set the 2 migrated entries
  (same pattern as P2's Spinner family). Re-typecheck after the build regenerates the dts.
- Porting loose-JS composables/SFCs to strict TS needs casts to preserve runtime verbatim — never a
  behavior-changing guard. `outside.ts` `parentNode.closest` needs `(… as Element)`.
- Always `rm packages/design/tsconfig.tsbuildinfo` before trusting a fresh package/extension typecheck.

## Validation gate — green
- `bun run typecheck:all` → 0 (fresh). `bun run --cwd packages/design test` → 224 passed (outside 10 +
  Tooltip 8 + Popover 6 + the rest). `bun run test` → 2407 passed (extension; Dropdown's useOutside via
  the shim resolves). `bun run lint` → 0. `bun run build` → built.
- `bun run test:e2e` (smoke): the run reported a `passkey-backup.test.ts` failure
  (`page.waitForFunction` 10s timeout in the ceremony-abort flow, under a heavily-loaded 322s run).
  **Classified pre-existing flake, NOT P5:** (1) P5 changed ZERO `tests/e2e/**` files; (2) the
  passkey-backup flow (`PasskeyCeremonyDialog` + agreement gate) uses NO P5-migrated component
  (no useOutside/Tooltip/Popover); (3) it **passes on isolated retry (3/3)** — non-deterministic. No
  NEW smoke failures.
- Faucet frozen (no faucet sign-off in P5).
