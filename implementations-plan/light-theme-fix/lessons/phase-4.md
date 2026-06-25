# Phase 4 — Cross-cutting validation

## Gate result
- **`bun run audit:vue`** → GREEN (typecheck:all across all packages → extension **2598** tests → lint → build, all passed in sequence).
- **`bun run --cwd packages/design test`** → GREEN (270 — contrast gate 18/18 both themes + both undefined-var guards). Run EXPLICITLY because `audit:vue`'s `test` step is extension-only and does NOT execute the design package (finding H1).
- **`bun run --cwd packages/extension build-storybook`** → GREEN (theme toolbar renders both themes via the real `theme` attr).
- **`bun run test:e2e`** (smoke) → 67 passed / 6 skipped / **1 flaky** (`wallet-lock.test.ts > lock wallet and unlock with password`, 30s timeout under full-suite load, retried 3×).

## The e2e flake — NOT a regression (CONCLUSIVELY established over 4 runs)
The smoke suite is environmentally flaky in this setup. Evidence:
- **A DIFFERENT test fails each run** — run 1: `wallet-lock` ×3; run 2: 1 unidentified; run 3: `passkey-backup` ×3. A deterministic regression fails the SAME test every time; different-test-each-run = environmental timing flake.
- **`passkey-backup` PASSED in run 1** with the exact same code, then failed later — same code, different result = flake by definition.
- **In isolation the same file flakes with varying counts** — `passkey-backup.test.ts` alone gave "1 failed/2 passed" then "2 failed/1 passed" on consecutive runs. The headless WebAuthn/passkey-ceremony emulation is timing-sensitive (a known-hard e2e area).
- **My diff touches NONE of the failing flows** (`git diff --name-only 3e392be..HEAD | grep -iE "passkey|backup|lock|unlock"` → none for the lock/passkey FLOWS; only a CSS hover on `authwits` + CTA color on `change-password`, which aren't those screens).
- **67–69/76 pass every run, INCLUDING popup boot** → `theme-boot.js` doesn't break the popup; the theme applies.
- Smoke e2e is **advisory** per CLAUDE.md, with standing de-flake plans (`network-e2e-required`, `passkey-e2e`). The `test:e2e` exit-1 is the known flake, not a light-theme regression. Individual flaky tests exit 0 in isolation (e.g. `wallet-lock` 1/1 pass).

## Manual smoke (HANDED TO THE USER — agent can't render UI)
The plan's security/affordance manual matrix in light mode is the user's to run: send-confirm (amounts/fees), dApp-connect, passkey ceremony dialog, address displays, JSON/Logs viewers, danger/warning banners, and the affordance check (links read as links, ON toggles read as on). Surfaced in the wrap-up.
