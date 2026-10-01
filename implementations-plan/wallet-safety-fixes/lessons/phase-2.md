# Phase 2 · Refusals carry no request value (A2)

## The sink pin, before the change

`apps/extension/src/wallet/services/wallet-sdk/background.refusal-log.test.ts`, run on the unfixed
refusals (`b172f0ca`, identical to `624117cd` for these files): exit 0, 4 passed. So Inference 3
holds and § A2 needs no sink change: `handleWalletMessage` answers a plain `Error` with
`UNCLASSIFIED_ERROR_MESSAGE` and logs that envelope, not the error. Each case builds the real
refusal through `enforceScope("createAuthWit", …)` with a sentinel in every request field (`from`,
the call's `caller`, `to` and `name`, the inner hash's `consumer` and `innerHash`), and a pattern
per case proves the intended branch threw, before and after the new texts. A fourth case pins that
the serializer really expands an `Error`'s message, which plain `JSON.stringify` drops.

## Red, then green

- `packages/wallet-bridge/src/method-scope-checkers.test.ts`, "no request value reaches a refusal
  of …", on the unfixed code: exit 1, 3 failed, each branch pattern matched and each message
  carried the request:
  - `Scope violation: createAuthWit for account SENTINEL-FROM, not permitted by granted accounts scope`
  - `Scope violation: createAuthWit authorizes SENTINEL-NAME@SENTINEL-TO, not permitted by granted transaction or simulation scope`
  - `Scope violation: createAuthWit inner-hash authorizes consumer SENTINEL-CONSUMER, not permitted by granted transaction or simulation scope`
- The three texts as § A2; the locals still feed their checks. Green.
- The `grant-check-address-case` sibling changes `matchesPattern` to `sameFieldAddress`, which is
  false for any non-address string, so a sentinel contract still refuses once both land.

## The gate

- `bun --bun vitest run src/method-scope-checkers.test.ts src/scope-enforcement.test.ts src/dispatcher.test.ts`
  from `packages/wallet-bridge`: exit 0, 3 files, 355 passed.
- `bun --bun vitest run src/wallet/services/wallet-sdk/ src/utils/log-payload-ban.test.ts` from
  `apps/extension`: exit 0, 22 files, 250 passed.
- `bun run lint` exit 0 (the same 29 warnings and 3 infos); `bun run typecheck:all` exit 0;
  `bun run test:all` exit 0 (wallet-bridge 426 passed; the extension 7814 passed, 4 skipped,
  8 todo).
