# Phase 5 — Cleanup + final gate

## What landed
- **Deleted the dead trio** `packages/extension/src/assets/styles/{_base,_flex,_text}.scss` — verified unimported (only `_base.scss`'s own `@use "./flex"`/`@use "./text"` referenced them; a closed dead loop). The `styles/` dir is now gone. One source of truth: `@nulo/design/base.css`.
- **Fixed 2 stale comments** that pointed at `_base.scss`: `onboarding/onboarding.scss` (tokens actually come from `@nulo/design/base.css` via `onboarding/index.ts`) and `design/Motion.stories.ts`.

## Gate result (PASS)
- `bun run --cwd packages/extension build:chrome` → GREEN after deletion (nothing referenced the trio).
- `bun run lint` → exit 0.
- (Full final gate consolidated in the post-impl sequence: `/code-review max --fix` → codex audit → `audit:vue` + design test + smoke e2e.)

## Deferred (Asks, not done — out of approved scope)
- Delete the dead `--btn-primary-bg`/`--btn-red-bg` tokens (a `token-contract.ts` + `gen:tokens` change).
- `:root` fallbacks for `--json-*`/`--log-*` (theme-only tokens with no `:root` default).
- Make onboarding read the user's persisted theme (currently uses the `new Config()` default; low impact since onboarding precedes preference-setting — and the `@media`-free boot script now sets the OS-resolved theme pre-paint anyway).
- Wire `bun run test:all` (or the design contrast gate) into the CI regression aggregate so the dark-freeze guard runs on every PR (closes H1 permanently).
