# Phase 1 · The sponsor probe

## Step 0 · I4 settled: it holds, no C8 fallback

A throwaway spec (uncommitted, deleted after the run) on `85c4d20f`, Chrome, proverless:
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<probe>.test.ts --retry=0`,
the `tokenReadyExtension` fixture (a fresh account, public TST, no Fee Juice of its own). 1 test, 1 passed.

| Question | Observed |
|---|---|
| Salt-1 SponsoredFPC address | `0x15574f36…4762f`; the canonical salt-0 sponsor is `0x2ece607a…7315b` |
| Deployed on the node? | no (`node.getContract` returns nothing) |
| Its Fee Juice | `0` at `computeFeePayerBalanceStorageSlot(salt1)`; the canonical sponsor holds `9999837671063440000000` |
| Playground `registerContract(instance)` under the `basic` bundle | `ok`: the wallet resolves the SponsoredFPC class from its PXE, no artifact passed |
| Settings → FPCs → add it by hand | the row lands (`nulo:core:fpcs@<id>`), picked in Send's menu by `data-fpc-id` |
| Estimate a public Send with it | settles in about 5 s (two-pass: not `isProtocol`); the card reads "You pay —" / "Nulo can't tell what this fee contract charges you." |
| Kernel's fee payer | the script wallet's `simulateTx` of `sponsor_unconditionally` on salt-1 plus a mint names salt-1 (`publicInputs.feePayer`) |
| The node's verdict on a send | refused, nothing spent: `Invalid tx: Insufficient fee payer balance (required=136435734225124340, available=0)` |

So P4's unfunded test needs no published instance: registering through the playground and adding
the row by hand gives a real sponsor that estimates, that the kernel names, and that the node
refuses.

## Step 1 · Red on `85c4d20f`

The tests of step 1, run against the unchanged source (only the test double
`FakeNodeFactory` gained the method, so the service case fails on the service):

- `packages/aztec-runtime`: `bun --bun vitest run src/adapters/` → exit 1, 4 of 4 failed:
  `vi.spyOn()` finds no `SILENT_RPC_LOG` to spy on (no export, no method).
- `apps/extension`: `bun --bun vitest run` over `fee-juice.test.ts`, `network/service.test.ts`,
  `sponsor-funding.test.ts`, `fee/strategies-structural.test.ts`, `transfer-executor.test.ts`,
  `dapp-send-executor.test.ts` → exit 1; 6 files failed, 12 tests failed, 196 passed.
  - `sponsor-funding.test.ts`: `Cannot find module './sponsor-funding'`.
  - `fee-juice.test.ts` (2): `readPublicFeeJuiceBalance is not a function`.
  - `network/service.test.ts` (1): `service.readPublicStorageOnce is not a function`.
  - `strategies-structural.test.ts` (3, fast path, two-pass, chain-mismatch fallback):
    `expected undefined to be 'fpc-1'`, no `sponsor` field.
  - `transfer-executor.test.ts` and `dapp-send-executor.test.ts` (3 each): no `sponsorFunding`
    (`expected undefined to deeply equal { fpcId: 'fpc-9', … }`), the failed read never attempted
    (`called 1 times, but got 0 times`), and the cancel during the probe resolving instead of
    rejecting.
- Controls, green on `85c4d20f` as they must stay: the three strategy cases that set no
  `sponsor` (a delegating contract, no payer named, a PrivateFPC row) and, in each executor, the
  build that names no sponsor.

## Interruption · API spend limit during step 2

The build was cut off mid-step by an API spend limit and resumed on another account. Not a
flake, and no run was in flight: no process of this worktree was left, the host's port registry
held no row of it, and the tree held only this phase's edits (the step-1 tests, the port, the
adapter, the two doubles and `NetworkService.readPublicStorageOnce`). Nothing to reap; step 2
continues from where it stopped.

## Step 2 · Implementation notes

- First `bun run typecheck:all`: exit 2. Three more executor-deps doubles construct the deps by
  type (`feesettings-invariant.test.ts`, `service.characterization.test.ts`,
  `transfer-executor.cancel-window.pins.test.ts`); each gained `readPublicStorageOnce`. Rerun: exit 0.
- One case added past the plan's list. The SDK client resolves a `null` result as `undefined`
  instead of rejecting (`@aztec/foundation` 5.2.0 `safe_json_rpc_client.js:173-180`), so the port's
  `Promise<Fr>` could hand back no field. The adapter now rejects it. Red on the adapter without the
  guard (a scratch copy swapped in, then restored): `promise resolved "undefined" instead of
  rejecting`; green with it.
- The probe is total: the comparison with the fee limit sits inside the same `try` as the read,
  so nothing in it can fail an estimate.

## Deviation · the balance helper is its own module, not `wallet/utils/fee-juice.ts`

The plan puts `readPublicFeeJuiceBalance` in `wallet/utils/fee-juice.ts`. That file is re-exported
by the `@/wallet/utils` barrel, which the popup and onboarding import (`getRandomHex`, `sleep`,
`fromBase64`, ...), and `@aztec/protocol-contracts/fee-juice` calls `loadContractArtifact` on a
570 KB JSON at module init with no `sideEffects: false`, so nothing tree-shakes it.

- Built there (`bun run build`, exit 0): the protocol chunk became
  `aztec-protocol-contracts-artifacts-FeeJuice~offscreen~popup~index.html~onboarding~index.ts~…`
  (570,809 bytes) and `dist/chrome/src/popup/index.html` referenced it beside the noir-contracts
  Fee Juice chunk it already loads: a second copy of the same artifact on every popup open.
- Moved to `apps/extension/src/wallet/utils/fee-juice-balance.ts` (not in the barrel; its test is
  `fee-juice-balance.test.ts`), `fee-juice.ts` back to its base content. Rebuilt (exit 0): the chunk
  is `…FeeJuice~offscreen~index.ts…` again, as on the base, and the popup HTML references only the
  noir-contracts chunk. `UPDATE.md` names the new path.

## Gate ✓

On the final P1 tree (base `85c4d20f` plus this phase's edits):

| Command | Exit | Counts |
|---|---|---|
| `packages/aztec-runtime`: `bun --bun vitest run src/adapters/ src/utils/` | 0 | 3 files, 26 tests passed |
| `apps/extension`: `bun --bun vitest run` over the plan's seven paths | 0 | 20 files, 392 tests passed |
| `bun run lint` | 0 | 29 warnings and 3 infos, as on the base, none in a touched file; complexity baseline OK |
| `bun run typecheck:all` | 0 | 15 workspaces |
| `bun run test:all` | 0 | extension 608 files passed, 3 skipped; 8049 tests passed, 4 skipped, 8 todo. aztec-runtime 35 passed, 1 skipped; 255 tests passed, 2 skipped. passkey-rp (`bun test`) 5 passed, 6 skipped. Every other workspace passed with no skip |
