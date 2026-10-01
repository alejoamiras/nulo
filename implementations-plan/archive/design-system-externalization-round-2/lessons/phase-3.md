# Phase 3 — Toast substrate (composable + ToastManagerBase + extension wrapper)

**Status:** ✓ green. Branch: `chore/design-r2-holdouts`.

## What shipped
- **`packages/design/src/composables/toast.ts`** — TS port of the extension's `toast.js`: `TOAST_DURATION`,
  `ToastOptions`, module-scope singleton `toast` ref + `useToast()` (explicit `import { ref }`). ≥10
  tests incl. timer-reset, close, auto-close timing, and a **singleton-identity** test (two
  `useToast()` share one ref).
- **`./composables/*`** added to the package `exports` map.
- **Extension shims (kept as `.js` + `.d.ts`):** `composables/toast.js` → explicit named re-export
  from `@nulo/design/composables/toast`; `composables/toast.d.ts` → type re-export. Both stay at the
  `.js`/`.d.ts` paths so the ~55 explicit importers (15 `.js`-suffixed) + `auto-imports.d.ts` resolve
  unchanged. The shim re-exporting the package singleton means a toast opened anywhere shows in the
  region (singleton preserved).
- **`ToastManagerBase.vue`** (package) — port of ToastManager with explicit imports + a `teleportTo`
  prop (default `#toast`). Tests: 8 ported + 1 `teleportTo`-override (9). Extension
  `components/ui/ToastManager.vue` → thin wrapper rendering `<ToastManagerBase>` (wrapper-backed, NOT
  in the resolver — keeps the bare `<ToastManager>` tag local + the package export neutrally named so
  it doesn't collide with the faucet's `Toast`). Extension `ToastManager.test.ts` slimmed to 2
  shell-integration cases (validates the shim singleton crosses to the base + teleports to `#toast`).
  Toast story relocated to the package as `ToastManagerBase.stories.ts`.

## Decisions / overrides
- **KEPT `toast.d.ts` (override of the final-codex "delete it" point).** Verified the extension
  tsconfig has `allowJs` unset (→ false), so TS reads `toast.js`'s types from the sibling `toast.d.ts`.
  Deleting it would `TS7016`-break the 55 explicit `.js` importers. Re-exporting types from the
  package keeps one source of truth without losing the declarations. Defensible repo-verified call;
  codex's deletion assumption (`ToastOptions` unreferenced) didn't account for `allowJs:false`.
- **`enableAutoUnmount(afterEach)`** in both toast test files — the module-scope singleton means a
  lingering mounted region from a prior test also renders the next test's toast (the `teleportTo`-
  override test caught this: 8 default-target instances polluted `#toast`).
- Generated files (`components.d.ts`/`auto-imports.d.ts`/`.eslintrc-auto-import.json`) restored to HEAD
  after the build — P3 adds no resolver entry (ToastManager stays local), and the shim preserves the
  export surface, so the committed generated files are unchanged. Verified typecheck:all passes with
  HEAD generated files + P3 source.

## ⚠ P2 correction (caught here)
P2's reported "typecheck green" was **masked by the stale `incremental` tsbuildinfo cache**. A fresh
`vue-tsc` (after `rm tsconfig.tsbuildinfo`) failed on `Banner.vue`/`LoadingState.vue`: they were plain
`<script setup>` (JS) SFCs, but the package is strict + `allowJs:false` → `TS7016`. **Fix (committed as
a follow-up on this branch):** `<script setup lang="ts">` on both + `PropType<{name;callback}>` for
Banner's `action` prop + tighten `LoadingState.test.ts`'s helper props type. Lesson: **always
`rm packages/design/tsconfig.tsbuildinfo` before trusting a package typecheck after adding `.vue`
files** — the incremental cache can hide TS7016 on new JS-script SFCs. All migrated package SFCs must
use `lang="ts"`.

## Validation gate — green (fresh, no cache)
- `bun run typecheck:all` → 0 (all packages). `bun run --cwd packages/design test` → 179 passed
  (toast composable 10 + ToastManagerBase 9). `bun run test` → 2429 passed (extension; shim + wrapper
  + 55 useToast consumers resolve). `bun run test:faucet` → 343 passed (untouched). `bun run lint` → 0.
  `bun run build` → built.

## Push: transient SSH blip (resolved)
After committing P3 (19eb84a), `git push` first failed with `Permission denied (publickey)` (SSH agent
hiccup mid-session) — did NOT attempt to re-add the key (one-off auth flow = hard limit). A later
retry succeeded on its own (transient, not a persistent eviction): **P1–P3 are on origin**
(`1b0b88a..19eb84a`). Takeaway: on a push `publickey` failure, just retry on a later loop tick rather
than touching auth.
