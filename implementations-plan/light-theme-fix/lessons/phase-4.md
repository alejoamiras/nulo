# Phase 4 — Cross-cutting validation

## Gate result
- **`bun run audit:vue`** → GREEN (typecheck:all across all packages → extension **2598** tests → lint → build, all passed in sequence).
- **`bun run --cwd packages/design test`** → GREEN (270 — contrast gate 18/18 both themes + both undefined-var guards). Run EXPLICITLY because `audit:vue`'s `test` step is extension-only and does NOT execute the design package (finding H1).
- **`bun run --cwd packages/extension build-storybook`** → GREEN (theme toolbar renders both themes via the real `theme` attr).
- **`bun run test:e2e`** (smoke) → 67 passed / 6 skipped / **1 flaky** (`wallet-lock.test.ts > lock wallet and unlock with password`, 30s timeout under full-suite load, retried 3×).

## The e2e flake — NOT a regression (established)
- The same test **passes in isolation**: `bun run --cwd packages/extension test:e2e tests/e2e/wallet-lock.test.ts` → 1 passed, exit 0, 4.7s.
- My changed files don't touch the lock/unlock flow — only a CSS hover on `authwits/index.vue` and the CTA color on `change-password.vue` (neither is the lock screen).
- 67/76 passed INCLUDING popup boot → `theme-boot.js` isn't breaking the popup.
- Smoke e2e is **advisory** per CLAUDE.md and the repo has a standing de-flake effort (`network-e2e-required`). This is a pre-existing load/timing flake, not a light-theme regression.

## Manual smoke (HANDED TO THE USER — agent can't render UI)
The plan's security/affordance manual matrix in light mode is the user's to run: send-confirm (amounts/fees), dApp-connect, passkey ceremony dialog, address displays, JSON/Logs viewers, danger/warning banners, and the affordance check (links read as links, ON toggles read as on). Surfaced in the wrap-up.
