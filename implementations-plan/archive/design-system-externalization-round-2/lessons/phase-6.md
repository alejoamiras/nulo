# Phase 6 — Input (extension-only)

**Status:** ✓ green. Branch: `chore/design-r2-holdouts`. Faucet untouched (frozen).

## What shipped
- **`Input.vue`** → package: the biggest + loosest SFC. Ported `<script setup>` → `<script setup
  lang="ts">` with verbatim-preserving casts:
  - `text` typed `ref<string | number | null | undefined>` (it genuinely holds string|number|null
    across the int/clear branches); string-op sites cast `(text.value as string)`.
  - untyped `event` → `event?: Event` + `(event!.target as HTMLInputElement)`.
  - `window.clipboardData` legacy IE fallback → `(window as unknown as { clipboardData?: DataTransfer })`
    (avoids `any`).
  - `inputEl` → `ref<HTMLInputElement | null>`; `el`/`selectionStart`/`setSelectionRange` cast.
  - explicit imports: `computed/nextTick/onMounted/ref/watch` + `Flex/Icon/Text/Tooltip` (renders the
    now-package Tooltip) + `sanitizeString` from the internal copy.
- **`internal/sanitize.ts`** — byte-identical `sanitizeString` for Input's opt-in `sanitize` ONLY;
  the extension's `utils/string.ts` STAYS (service-layer callers: backup + contact import). 6
  byte-identity tests (adversarial inputs: HTML chars, emoji, ZW/RTL marks, length cap).
- 18-case Input test ported. Resolver + index + mount-all grown; local deleted; story relocated.

## Lessons / gotchas
- **The test caught a real quirk → BUG PIN:** `subtype='int'` emits `Number.parseInt(text.value, 10)`
  of the RAW text (e.g. 12 from "12a3", since parseInt stops at "a") while it sets `text.value` to the
  cleaned digits ("123"). Verbatim-preserved; pinned `toEqual([12])`.
- `components.d.ts` Input → `@nulo/design` (clean migration, like Tooltip — else `<Input>` consumers
  resolve against the deleted-local's type). 6 round-2 names now route to the package in the committed
  dts; round-1 names left at HEAD.
- `onMounted` autofocus uses `inputEl.value?.focus()` (matches the sibling `focus()` method; inputEl is
  set in onMounted — defensible micro-consistency, not a behavior change).

## Validation gate — green
- `bun run typecheck:all` → 0 (fresh). `bun run --cwd packages/design test` → 249 passed (Input 18 +
  sanitize 6 + the rest). `bun run test` → 2391 passed (extension; `<Input>` everywhere via resolver).
  `bun run test:faucet` → 343 passed (untouched). `bun run lint` → 0. `bun run build` +
  `bun run build:faucet` → built. `bun run --cwd packages/extension build-storybook` → built (all 7
  relocated package stories glob in).
- `bun run test:e2e` (smoke): the recurring `passkey-backup.test.ts:331` ceremony-abort failure again
  — same pre-existing flake as P5: 0 `<Input>`/`setValue` refs in the flow, P6 changed 0 e2e files,
  **passes on isolated retry (3/3)**. No NEW smoke failures (A1).
- Faucet frozen (no faucet sign-off in P6).
