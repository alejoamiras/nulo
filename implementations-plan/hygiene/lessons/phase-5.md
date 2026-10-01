# Phase 5 · C3 · the derivation-parity script

`tests/e2e/scripts/check-derivation-parity.ts` is deleted, and `browser-seam.test.ts`'s `EXEMPT`
set and doc comment keep only the two seam files. `check-setup-pre-funded.ts` stays in
`tests/e2e/scripts/`; C3 does not touch it.

## Gate

- `bun --bun vitest run scripts/e2e/browser-seam.test.ts scripts/e2e/unresolved-names.test.ts`
  (from `apps/extension`): exit 0, 2 files, 45 tests passed.
- `git grep -n check-derivation-parity -- . ':!implementations-plan' ':!audit'`: no match.
- `bun run lint`: exit 0 (28 warnings and 3 infos, one warning fewer than P2's run over 1,900
  files, now 1,899).
