# Phase 2 — proof in real builds and real CI

## Gate

```
build:testnet + verify:build-target testnet → ✓ build.json matches target testnet (chainId 1816023401; testnet-bridge.json digest verified)
build:mainnet + verify:build-target mainnet → ✓ build.json matches target mainnet (chainId 4248422646; mainnet-bridge.json digest verified)
pr-quick.yml workflow_dispatch on worktree-tools-rename @ 2046aab5 → run 33565490934: completed / success
  Detect changes ✓ · Lint + Typecheck ✓ · Unit tests ✓ · Build Chrome ✓ · Build Firefox ✓
  Build Tools (testnet) / vite build (tools testnet) ✓ · Build Tools (mainnet) / vite build (tools mainnet) ✓
  quality-status ✓ (Commitlint skipped — dispatch has no PR range)
bun run test:e2e (extension smoke, local, Chrome, armed build) → Test Files 31 passed | 1 skipped (32); EXIT=0
  (first, unarmed run: 29 passed | 1 failed [backup-migration arming contract] | 2 skipped — see Notes)
```

## Notes

- The two builds share `apps/tools/dist`, so they ran sequentially (testnet → verify → mainnet → verify).
- The smoke suite needs a built extension first: `dist/chrome` did not exist in the fresh worktree and `global-setup-smoke.ts` fails closed ("Extension not found … Run bun run build"). Sequence for a fresh worktree: `bun run --cwd apps/extension build && bun run test:e2e`, run under tmux (machine rule: long jobs die with the agent shell otherwise).
- **First full run: 29/30 files green, 1 red for arming, not for the rename.** `backup-migration.test.ts`'s fixture-arming contract fails closed on a repo build that was not built with `VITE_NULO_E2E_MIGRATION_FIXTURE=1` (+ `NULO_E2E_MIGRATION_FIXTURE=1` at run time) — exactly what `_smoke-e2e.yml:71,105` and the e2e-testing skill (§ "re-arm before smoke") prescribe. Rerun armed: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet bun run --cwd apps/extension build && NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
- The dispatch's `Detect changes` forced every filter true (`pr-quick.yml:152-166`), which is why both `Build Tools` jobs ran despite no PR — the plan's F5 held.
