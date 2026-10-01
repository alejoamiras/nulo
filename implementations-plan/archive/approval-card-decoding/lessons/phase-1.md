# Phase 1 — vocabulary + intent (retrofit log)

Commit `ec297815` (with phases 2–3). Written after the fact: the fix shipped before the plan.

## What landed

- `token-transfer-vocabulary.ts`: `MintKind`, `MintSignature`, `MINT_SIGNATURES`
  (`mint_to_private` / `mint_to_public` → `["to", "amount"]`), `findMintSignature(name, arity)`.
- `transfer-intent.ts`: `TransferIntent` gains `{ kind: "mint"; to; amount }`; `readTransfer` /
  `readMint`; `canonicalAmount` returns a decimal string through `BigInt` (safe non-negative
  integers, bigints ≥ 0, hex fields); `ProjectedArgument` is `field | text | opaque` — a 66-char
  hex is a field, never an address; `smallFieldDecimal` for values below 2⁶⁴.

## Root cause pinned

`ad130aea` (PR #596) derived the vocabulary from token descriptors. No descriptor names a mint and
none has a three-argument transfer shape, so both readings silently vanished; the raw fallback then
classified every wire field as an address. The old tests passed because they fed `5n`, not the
`0x…` + 64-hex strings the dispatcher forwards.

## Gate

`bunx vitest run src/utils/token-transfer-vocabulary.test.ts src/utils/transfer-intent.test.ts` +
`bun run typecheck` — green, included in the 15-file / 112-test targeted run on `ec297815`.
