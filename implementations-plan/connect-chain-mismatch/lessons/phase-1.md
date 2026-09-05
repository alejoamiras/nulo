# Phase 1 — the dispatcher provisions the dApp chain's default account

Status: ✓ (2026-09-05)

## What landed
- `IAccountProvisioner.provisionDefaultAccount(profileId, chainId): Promise<void>` in wallet-bridge; the
  dispatcher takes `IAccountReader & IAccountProvisioner`; `loadAvailableAccountsForPopup` = visible read
  → (empty) provision → visible re-read.
- `AccountService.provisionDefaultAccount`: per-tuple serialized; any live row (hidden/imported) → no-op;
  else `createAccountInternal(…, { unattended: true })`, catching ONLY `ERR_UNATTENDED_PROBE`.
- `NetworkService.resolveVerifiedL1ChainId(…, { unattended })` refuses to probe non-seeded kinds.
- `DEFAULT_ACCOUNT_NAME` replaces the two literal `"Account"` call sites.

## Gate
- `packages/wallet-bridge`: `bun run test` → 9 files, 241 passed (4 new).
- `apps/extension`: `bun run test src/wallet/services/account/service.test.ts` → 34 passed (7 new);
  `src/wallet/services/network/service.test.ts` → 78 passed (2 new).
- `bun run lint` exit 0 (complexity baseline OK); `bun run typecheck` exit 0; wallet-bridge typecheck exit 0.

## Notes
- The 20 typed `IAccountReader` fakes in `dispatcher.test.ts` became `AccountFake` with a no-op
  `declineProvision` stub (a throwing stub would have broken the existing empty-wallet fixtures, which
  now legitimately reach the provisioner). The provisioning behaviour has its own describe block.
- The Bun test harness mocks `NuloAccount.new` (bb.js WASM does not run there), so the provision tests
  assert row shape and count, not the address.
