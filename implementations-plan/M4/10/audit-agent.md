# M4.10 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- ChainRuntime constructor change: plan adds `rpcUrlHash` + `dataDir` as positional args at `chain-runtime.ts:33-38`. Verify zero external callers (only internal call is `chain-runtime.ts:92`; `pxe/chain-runtime.test.ts` may construct directly — check). If any found, switch to options-bag ctor to avoid silent breakage.
- Cross-root ordering with M4.7 under-specified. Migrator reads `nulo:core:networks` to resolve `rpcUrl`. M4.10 migrator must declare `fromVersion: 1` (or whatever value comes after networks-collection migrators), NOT "decide at execution time" (line 229).

**SHOULD-FIX**
- Orphan cleanup `NetworksClient` injection — concrete fix: pass `INetworksReader` port (mirrors existing `IProfileReader`/`IPxeConfig` pattern at `service.ts:46-61`). Add 4th constructor arg `networks: INetworksReader` with `getNetworks(): Promise<NetworkInfo[]>`.
- `renameIndexedDb` partial-failure idempotency hand-wavy. Failure mode: copy succeeds, delete-old fails. Both DBs exist. Re-run sees old shape, attempts copy again — overwrite or merge? **Fix**: (a) check if target DB exists before copying, (b) if exists, skip copy and just delete old. Document in JSDoc.
- Test coverage gap: M4.7-runner-with-M4.10-registered integration test. Current 9-11 tests cover M4.10 in isolation but not the integration with M4.7-a's runner.
- Hash length: pin **16 chars** as the answer (not "audit may push to 64"). 8-byte truncation is safer than birthday-paradox-relevant for non-adversarial inputs. Adding 48 chars to every IndexedDB name is pure ergonomic loss.

**NIT**
- 2 networks same chainId, different rpcUrl: testnet + testnet-mirror. Real use case worth this complexity.
- keyval-store predicate still works (prefix-match). Add explicit assertion in orphan-cleanup test.
- M2.4 plan format: add explicit "verification cadence" table per sub-PR (M2.4 has it at line 421-429).
- `crypto.subtle` available in MV3 SW + offscreen — verify (it is).
