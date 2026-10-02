# Phase 1 · Skip what every PXE boot registers (B1)

## Red first (base `e34b32b4`, the plan commit on `85c4d20f`)

`bun --bun vitest run src/wallet/services/account-state/ src/composables/importChainSync.test.ts`
from `apps/extension`: exit 1, 3 failed and 45 passed across 4 files.

- `restore-surface.pins.test.ts` › a preloaded standard contract is skipped like a protocol one:
  `expected "vi.fn()" to be called 1 times, but got 2 times` (the AuthRegistry entry launched).
- `normalize.test.ts` › a network holding only what every PXE boot registers has no work:
  `expected [ 'alpha', 'testnet' ] to deeply equal [ 'testnet' ]`.
- `importChainSync.test.ts` › a network holding only what every PXE boot registers:
  `expected [ 'n1' ] to deeply equal []` (the probe dialed).
- Guard, green on the base: a malformed spelling of a protocol address (`0x05`, which upstream's
  parse refuses with "Invalid AztecAddress length 1.") keeps its parse error and launches nothing
  (`-t "malformed spelling"`: 1 passed).

## Probes

- `AztecAddress.fromStringUnsafe` (stdlib 5.2.0) refuses a short hex (`0x2`, `0x05`), an upper-case
  `0X` prefix, surrounding whitespace, 33 bytes, and any value at or above the field modulus
  (`0xcdcd…`, the normalizer tests' default contract); a `0x` prefix with upper-case digits parses
  to the same value as the lower-case spelling. So `isPxeProvidedContract` answers false for every
  spelling the restore itself would refuse, and those entries keep counting as work.
- Upstream addresses at 5.2.0: MultiCallEntrypoint `0x246d…2986`, AuthRegistry `0x1e8e…666c`,
  HandshakeRegistry `0x0612…aa9d`, historical HandshakeRegistry v5.0.1 `0x086c…831d`; protocol
  contracts at 1, 2 and 3.

## Change

- `pxe-provided.ts`: `isPxeProvidedAddress` (the protocol range 0 to 6, moved verbatim, or one of
  the four preloaded addresses) and `isPxeProvidedContract` (today's parse, false on a refusal).
- `registrableNetworkIds` counts a network only for a sender or a contract the predicate does not
  mark provided; `precheckContractAddress` keeps its network-first throwing parse and compares the
  parsed value through `isPxeProvidedAddress` (arm renamed `"pxe-provided"`).
- Comments: the `normalize.ts` cap note now states the invariant (the export still writes these
  contracts, so they count against the cap); the service's "monolith" narration is cut to the
  single-await and lazy-sampling invariants.
- Inference 7 holds: `getDefaultStandardPreloadedContracts()` runs under vitest on Bun (the pin
  passes in-process, no subprocess needed). Inference 6 holds: the build takes
  `handshake-registry/constants` into the popup's graph without complaint.

## Gate

- `bun --bun vitest run src/wallet/services/account-state/ src/composables/importChainSync.test.ts`
  (from `apps/extension`): exit 0, 5 files, 52 passed, 0 skipped.
- `bun run lint`: exit 0 (the same 29 pre-existing warnings; complexity-baseline check OK, no
  finding in the touched files).
- `bun run typecheck:all`: exit 0, every workspace.
- `bun run build`: exit 0; `git status` shows no change under `apps/extension/src/types/`.
