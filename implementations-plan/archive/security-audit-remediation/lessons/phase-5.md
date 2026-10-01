# Phase 5 — F-011 + F-012 RPC endpoint trust

## Closed findings
- **F-011**: RPC URL scheme allowlist enforced at both the schema layer (network/spec.ts) and the node-factory adapter (aztec-runtime/adapters). `https:` for any host; `http:` only for loopback (`localhost`, `127.0.0.1`, `[::1]`); everything else rejected.
- **F-012** (partial): `assertLiveChainIdentity(network, nodeInfo)` helper applied at the two main tx-request-builder sites where signing/proving consumes `node.getNodeInfo()`. **5 of the audit's 6 sink sites remain — deferred follow-up below.**

## Implementation

### F-011 scheme allowlist
- `packages/extension/src/wallet/services/network/spec.ts`:
  - New `RpcUrlSchema = z.string().url().refine(...)` — checks scheme/host per the allowlist.
  - `NetworkEndpointSchema.rpcUrl` now uses `RpcUrlSchema` (was plain `z.string()`).
  - `NetworkInfoSchema.rpcUrl` now uses `RpcUrlSchema` (was plain `z.string()`).
  - `addNetwork`/`addEndpoint`/`updateEndpoint` param schemas use `RpcUrlSchema` (was `z.string().url()`).
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts`:
  - Exported `isAllowedRpcUrl(rpcUrl)` for reuse.
  - `AztecNodeFactoryAdapter.createNode()` now calls `isAllowedRpcUrl()` before invoking upstream `createAztecNodeClient()`. Defense in depth — catches drift if a URL ever bypasses the schema gate.

**IPv6 form**: per codex Round 2 B-3, WHATWG-URL preserves brackets in `URL.hostname`. The literal allow-list entry is `[::1]` (WITH brackets), confirmed in both Bun 1.3.13 and Node v24. Test vector `http://[::1]:8888` passes the allowlist; `http://::1:8080` (invalid URL syntax) doesn't.

### F-012 chain identity rebind
- `packages/aztec-runtime/src/utils/chain-identity.ts` (new): exports `assertLiveChainIdentity(network, nodeInfo)`. Throws with diagnostic message when `network.chainId !== nodeInfo.l1ChainId`.
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts`:
  - Line ~108: assertion added between `node.getNodeInfo()` and the contract registration logic (the standard path).
  - Line ~454: assertion added between `node.getNodeInfo()` and `GasSettings.fallback` (the NO_FROM / DefaultEntrypoint path).

## Tests added
- **F-011** (8 new in `network/service.test.ts` → "F-011: RPC URL scheme allowlist" describe):
  - rejects `javascript:`, `data:`, `file://`, non-loopback `http:`
  - accepts `https://anywhere`, `http://localhost`, `http://127.0.0.1`, `http://[::1]`
- **F-012** (3 new in `aztec-runtime/src/utils/chain-identity.test.ts`):
  - passes when chainId matches
  - throws when live node reports a different chainId
  - error message includes both values for diagnostic

## Verification
- `bun --cwd packages/extension test`: 2224 pass, 7 todo, 1 skipped.
- `bun --cwd packages/extension test -- network/service.test`: 48 pass (40 + 8 new).
- `cd packages/aztec-runtime && bun test src/utils/chain-identity.test.ts`: 3 pass.
- `bun --cwd packages/extension typecheck`: clean.

## Deferred F-012 sink sites (audit-followup)
Per codex Round 2 B-4, F-012 ideally hits 6+ sink sites. Phase 5 covers 2 (the highest-leverage ones in tx-request-builder); the remaining ones need their own sweep:
1. `packages/extension/src/wallet/services/execution/authwit-discoverer.ts:100-101` — pass network in to compare.
2. `packages/extension/src/wallet/services/execution/fast-path.ts:170-175` — likely already has network in scope.
3. `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:236-243` — same.
4. `packages/extension/src/wallet/services/execution/service.ts:2202-2207` — `getChainInfo` response path; trickier since it's the path that builds chain info FROM the node.
5. `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105,199-229` — needs an interface change to pass `networkInfo` in.
6. `packages/aztec-runtime/src/account/nulo-account.ts:99-103` — same interface issue (no `networkInfo` parameter). Per codex Round 2 B-4 the right fix is to NOT add the check here; cite the deferred follow-up.

These all extend the same `assertLiveChainIdentity` helper to additional call sites. None block the F-011/F-012 primary fix (chain-spoofing on the signing path).

## Codex consult
**Deferred to PR review** per the plan's discipline note. Will run `/codex xhigh` on the F-011 + F-012 diff at PR-creation time.

## Open follow-ups
- File upstream issue (optional): `BackgroundConnectionHandler` doesn't currently expose enough of `pendingDiscoveries` for Nulo to purge approved-but-not-yet-key-exchanged entries on revocation (Phase 3 deferred). Worth filing as a separate "wallet-sdk hardening" issue alongside the F-001/F-002 upstream items.
- Sweep remaining 5 F-012 sink sites in a follow-up PR.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-5.md
