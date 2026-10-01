# Phase 2 · The nonce reads like the card's other fields

- **Built, O2 (b) only.** `nonceValue` in `call-surface.ts`; `CallArguments.vue` renders the nonce
  through a computed with `valueText`, `:mono` on a field and `valueTitle` as the hover. A nonce
  below 2^64 stays a plain number with no title, so the sample Token's small nonces read as before.
- **Tests.** `call-surface.test.ts`: `9`, `2^64 − 1`, `2^64` (the first field), the modulus − 1
  (whole hex as the title) and two nonces that trim to the same `0x0f3c7a91..c07e2a` with distinct
  titles. `OperationCard.createAuthwit.test.ts`: a wire-shaped `transfer_in_private` authorization
  with the 254-bit nonce reads trimmed, whole on hover; the existing small-nonce assertion stays.
- **Generated.** The build rewrote `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json`
  for P1's two new `src/utils` exports (Fact 14); committed here.
- **Gate.** `bun run --cwd apps/extension test src/popup/windows/execute`: 17 files, 167 tests
  passed. `bun run typecheck:all`: every workspace exit 0. `bun run lint`: exit 0 (28 pre-existing
  warnings). `bun run --cwd apps/extension build-storybook`: completed successfully.
