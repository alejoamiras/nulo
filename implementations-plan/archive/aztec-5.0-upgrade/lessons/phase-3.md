# Phase 3 — wallet-bridge + extension + schema patch + storage (IN PROGRESS)

Bottom-up: `extension-messaging` (zod v4 issue-path widening) committed first — it's a low layer. Then extension.

## Done (extension 11 → 3 real errors)
- `transaction/service.ts`: **TxExecutionResult collapsed** — 5.0's `AztecTxExecutionResult` only has `SUCCESS` + `REVERTED` (was SUCCESS/APP_LOGIC_REVERTED/TEARDOWN_REVERTED/BOTH_REVERTED). Mapped `REVERTED → TxExecutionResult.AppLogicReverted` (catch-all). **⚠️ RATIFIED QUIRK / USER REVIEW:** the Nulo enum's `TeardownReverted`/`BothReverted` are now unreachable — the protocol no longer distinguishes revert phases. Follow-up: collapse the Nulo enum + audit any UI that switches on the granular variants. Label loss is cosmetic (UI treats all reverts as "failed").
- `auth-registry/service.ts`: `node.getL2Tips()` → `node.getChainTips()` (pure rename; `ChainTips.proven.block.number` shape identical).
- `execution/helpers/block-header-anchor.ts`: `node.getBlockHeader()` (removed) → `(await node.getBlock("latest"))?.header` (BlockResponse.header always present). (`getBlockData(param)` is the cheaper header-only alt if needed.)
- `utils/auth-registry.ts`: `CANONICAL_AUTH_REGISTRY_ADDRESS` (gone from `@aztec/constants`, auth_registry demoted) → `STANDARD_AUTH_REGISTRY_ADDRESS` from `@aztec/standard-contracts/auth-registry/constants` (already an `AztecAddress` — dropped the `fromNumber`).
- `execution/tx-request-builder.ts`: 2nd `GasSettings.fallback` site — added `gasLimits: new Gas(nodeInfo.txsLimits.gas.daGas, …l2Gas)` (nodeInfo already in scope) + `Gas` import.
- `wallet-sdk/background.ts`: `BackgroundConnectionConfig` gained required `logger: WalletSdkLogger` → pass `NOOP_LOGGER` from `@aztec/wallet-sdk/types` (preserves prior no-SDK-logging behavior; follow-up: route to @nulo logger for channel/heartbeat diagnostics).

## Pending (codex-gated)
- **Schema patch `z.function().args().returns()` → zod v4** (`nulo-schema-patch.ts:36,57,83`, 3 errors). zod v4 dropped `.args()` on `z.function()`. Codex consult IN FLIGHT (session in `/tmp/codex-aztec5-schemapatch.md`) on: the exact v4 form, how @aztec 5.0 `WalletSchema` represents entries (the patch must mirror it so the dispatcher Proxy routes our custom methods), the `.parameters().items.length` guard rewrite, and the `dispatcher.test.ts` assertion. Affects all 3 copies (extension/faucet/playground) → fixing it also clears the P4 faucet/playground schema-patch errors.
- Storage `CURRENT_VERSION` 7→8 + ARCHITECTURE.md wipe doc: NOT yet done (do with the schema-patch, before P3 commit-final).
- `bun run test:all` (wallet-bridge `method-descriptors.test.ts` + `dispatcher.test.ts`) + extension `note/note-schemas.test.ts`: run once schema-patch lands.

## Notes
- wallet-bridge had 4 line-count "errors" — likely the schema-patch via the extension copy (dispatcher.test imports it). Re-check after the schema-patch fix.

## Resolved
- **Schema patch → zod v4** (codex `019edfc5`): `z.function({input:z.tuple([...]),output})`; proxy reads `schema.def.input/.def.output`. Applied to all 3 copies + dispatcher.test (`.def` shape) with a stronger arg-type+output-type guard (closes the earlier audit hardening condition). 633aa1ca.
- **`registerContractClass`** (new in 5.0 WalletSchema; codex `vEEG6mIc`): **neutralized** — NOT dApp-exposed. It's an unbound PXE artifact write (no chain check) and Nulo's authz can't scope it yet (`contractClasses` read-only, no `canRegister`; sync ScopeCheck vs async class-id derivation). `handler`-routed descriptor + `checkRegisterContractClassDisabled` deny-checker (throws at scope-enforcement = single source of truth). Skipped codex's suggested dispatcher throw — it'd be unreachable dead code (scope runs before routing). Frozen parity snapshots 14→15. 63dbd1a1.
  - **Follow-up if ever exposed:** add `contractClasses.canRegister`, `requestCapabilities` delta coverage, popup/settings copy, `aztec_registerContractClass` op plumbing + an async class-id scope gate.
- **Storage v8** + ARCHITECTURE doc. 633aa1ca.

## P3 status: package-level DONE
extension / extension-messaging / wallet-bridge / aztec-runtime all typecheck 0 + tests green. The plan's `audit:vue` gate is workspace-wide (`typecheck:all`), so the formal P3 ✓ runs together with P4/P5 once faucet/playground/bridge are green too.

LESSONS_FILE=implementations-plan/aztec-5.0-upgrade/lessons/phase-3.md
