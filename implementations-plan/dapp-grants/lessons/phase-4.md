# Phase 4 · The capability answer is the stored grant (G2)

## Interruption

- An API spend limit ended the session at this phase's start, while the red tests were being
  written. No test or e2e run was in flight, no process of this build was left running and the port
  registry held no run of it, so nothing was reaped; the phase restarted at its red step.

## Red run

- `enrichGrantedCapabilities` is unchanged since `85c4d20f` (the only `dispatcher.ts` change since
  is the sender refusal and its import), so the run was taken at the P3 head.
- `bun --bun vitest run src/dispatcher.test.ts -t "the answer is the stored grant"` in
  `packages/wallet-bridge`: 5 failed. Each is red on the answer alone; the window counts matched.
  - Transaction, simulation, contracts: a request for A inside a held A + B grant opens no window
    and is answered with the request (A), not the held grant (A, B).
  - Contract classes: a request for classes A and B beside a held A opens no window and is answered
    with both, while the stored grant is A alone, so the answer claimed a class that
    `checkGetContractClassMetadata` refuses (Fact 11).
  - The rejection sequence: the wider request opened the window once, rejected with the window's
    `UserRejectedError`, recorded `transaction` as rejected and kept A + B stored (green there); the
    later request inside the held grant opened no window and was answered with the request (red).
- The plan's two regression controls already exist, green before and after, so the copies first
  written into the new describe pinned the same behaviour twice and were dropped:
  - the `grantsNothing` echo with no contracts grant stored: "a contracts permission that grants
    nothing › %s: answered as asked, with no window and no write" (three shapes, schema-checked);
  - the accounts projection: "enrichGrantedCapabilities projects the session accounts array (alias
    hit / name fallback / filtered) — Q11", whose stored grant lists no account while the answer
    lists two, so answering accounts from the stored grant would turn it red.

## Pins the plan did not list

- With the change and the old expectations, 5 existing tests failed: the three echo rows of "a held
  contract in another case" (Fact 12), and two echo pins Fact 12 does not cite:
  - "a declined type asked again › a contracts subset of a held grant whose widening was declined
    opens no window and keeps the rejection" expected the subset echoed;
  - "a contracts permission that grants nothing › a held contracts grant and a stored rejection
    survive it, alone and beside another approval" expected the no-flags request echoed while a
    contracts grant is held. § G2's rule answers it with the held grant: a request answers for
    itself only when no grant of its type is stored.
- Both expected answers moved to the held grant. What they pin about the row (the grants and the
  rejection kept) is unchanged.

## Decisions

- The `else` arm calls `storedGrantAnswer`, a module function beside `dataAnswer`, so
  `enrichGrantedCapabilities` gains no branch. Its fallback to the request is reachable only by a
  request that grants nothing, with no grant of its type stored.
- The comment above the loop covers every type: each value in the answer is what the wallet stores
  and enforces.
- No README or architecture text described the answer as an echo; P3's README line ("its own
  `requestCapabilities` answer, which is the stored grant") is now exact.

## Gate

- `bun --bun vitest run src/dispatcher.test.ts` in `packages/wallet-bridge`: exit 0, 243 passed.
- `bun run lint`: exit 0 (the same 29 warnings and 3 infos as P3, none in a touched file;
  complexity baseline unchanged).
- `bun run typecheck:all`: exit 0, 15 workspaces.
- `bun run test:all`: exit 0. Extension 606 files passed, 3 skipped; 8072 tests passed, 4 skipped,
  8 todo. wallet-bridge 508, extension-messaging 240, wallet-core 247, aztec-runtime 250 passed
  (2 skipped), wallet-crypto 120, design 401, third-party-notices 66, legal 54, landing 40,
  resolve-asset 14, wallet-sdk-schema-patch 11, passkey-rp 5 (6 skipped); every workspace exited 0.
- `bun run test:ci-gating`: exit 0, 244 passed, 2 skipped, 0 failed (246 tests, 17 files). The plans
  gate's three `path-token` reports are in files this build does not touch; 0 enforced.
- `bun run build`: exit 0.
