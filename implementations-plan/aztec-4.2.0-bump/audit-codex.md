# Codex Audit — `plan-v1.md` (Aztec 4.2.0 dep bump)

## Command run

```
codex exec --sandbox read-only -c model_reasoning_effort=xhigh "<prompt>"
```

- codex-cli `0.120.0`
- model `gpt-5.4`, reasoning effort `xhigh`
- workdir `(project root)`
- session id `019dff59-1403-78b2-a825-7e302fb328a6`
- elapsed: ~9m 56s
- exit 0
- prompt body matches the 9-question audit (inventory, GasSettings, scopes, capsule enforcement, EmbeddedWallet, slot regression, storage migration, `@aztec/wallets` + `@aztec/viem`, risks the plan misses)
- full transcript: `/tmp/codex-audit-output.txt` (7,112 lines, ~35 KB; not checked in)

The full transcript includes every `rg`/`sed`/`nl`/`fd` invocation codex issued plus tool output. The final report is reproduced verbatim below.

---

## Final report (verbatim)

**BLOCKING**
- The plan's capsule-scope claim is false for the supported `NO_FROM` / DefaultEntrypoint path. It says we always scope `[account.address, ...additional]` in [plan-v1.md]((project root)/implementations-plan/aztec-4.2.0-bump/plan-v1.md:24), but the discovery simulation in [execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1763) runs with `scopes: additionalScopes` and omits the caller account, even though `buildNoFrom` includes user capsules/authwits in the `TxExecutionRequest` at [tx-request-builder.ts]((project root)/packages/extension/src/wallet/services/execution/tx-request-builder.ts:432). The similar stubbed path in [authwit-discoverer.ts]((project root)/packages/extension/src/wallet/services/execution/authwit-discoverer.ts:93) does include `[account.address]`, so `executeNoFromSendTx` is the outlier most likely to break under 4.2.0's stricter scope enforcement.

**SHOULD-FIX**
- The GasSettings inventory is incomplete. `GasSettings.fallback()` in [tx-request-builder.ts]((project root)/packages/extension/src/wallet/services/execution/tx-request-builder.ts:444) is the only `GasSettings.*` static-member site, but the plan's "1 line in 1 file" framing in [plan-v1.md]((project root)/implementations-plan/aztec-4.2.0-bump/plan-v1.md:20) misses the real surface: production code rewrites or constructs `GasSettings` in [execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1555), [fee-strategy.ts]((project root)/packages/extension/src/wallet/services/execution/fee/fee-strategy.ts:117), [embedded-strategy.ts]((project root)/packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts:48), [fpc-strategy.ts]((project root)/packages/extension/src/wallet/services/execution/fee/fpc-strategy.ts:68), [default-fpc-handler.ts]((project root)/packages/extension/src/wallet/services/fpc/handlers/default-fpc-handler.ts:19), and [nulo-account.ts]((project root)/packages/aztec-runtime/src/account/nulo-account.ts:113). There are also active estimation-constant sites in [default-fpc-handler.ts]((project root)/packages/extension/src/wallet/services/fpc/handlers/default-fpc-handler.ts:11) and [nulo-account.ts]((project root)/packages/aztec-runtime/src/account/nulo-account.ts:18), so "`forEstimation()` is n/a" is too glib.
- The Wonderland-package inventory undercounts production usage. The extension aliases `@wonderland/aztec-fee-payment` and `@defi-wonderland/aztec-standards` into runtime JSON imports in [vite.config.ts]((project root)/packages/extension/vite.config.ts:45) and [vitest.config.ts]((project root)/packages/extension/vitest.config.ts:39); production code then consumes them in [known-artifacts.ts]((project root)/packages/aztec-runtime/src/pxe/known-artifacts.ts:41), [note-schemas.ts]((project root)/packages/aztec-runtime/src/pxe/note-schemas.ts:77), and [fpc/service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:22). This is broader than the plan's slot-regression framing in [plan-v1.md]((project root)/implementations-plan/aztec-4.2.0-bump/plan-v1.md:38).
- The storage migration bypasses the repo's own purge pipeline. [migrate.ts]((project root)/packages/extension/src/wallet/storage/migrate.ts:16) removes a hand-picked subset, but [network/service.ts]((project root)/packages/extension/src/wallet/services/network/service.ts:515) expects chain cleanup to flow through subscribers before PXE reset. Because migration does not call `purgeChain`, persisted `nulo:core:tokens` in [token/service.ts]((project root)/packages/extension/src/wallet/services/token/service.ts:39), `nulo:core:fpcs` in [fpc/service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:34), and auth-registry rows in [auth-registry/service.ts]((project root)/packages/extension/src/wallet/services/auth-registry/service.ts:28) survive even though related account/network state is wiped.
- `additionalScopes` is effectively unchecked at the wallet boundary. The dispatcher forwards raw opts in [dispatcher.ts]((project root)/packages/wallet-bridge/src/dispatcher.ts:333), scope enforcement only checks target calls/utilities in [scope-enforcement.ts]((project root)/packages/wallet-bridge/src/scope-enforcement.ts:90) and [scope-enforcement.ts]((project root)/packages/wallet-bridge/src/scope-enforcement.ts:132), and execution code consumes `op.opts.additionalScopes` directly in [execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1562) and [execution/service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1749). That is exactly the surface 4.2.0 makes more brittle.

**NICE-TO-HAVE**
- The bundled-artifact regression test does call `loadContractArtifact()` for Wonderland Token and PrivateFPC in [note-schemas.test.ts]((project root)/packages/extension/src/wallet/services/note/note-schemas.test.ts:62) and [note-schemas.test.ts]((project root)/packages/extension/src/wallet/services/note/note-schemas.test.ts:67), which matches runtime's raw-JSON load path in [note-schemas.ts]((project root)/packages/aztec-runtime/src/pxe/note-schemas.ts:77). But it does not exercise `loadProductionNoteSchemas()` / `getContractClassFromArtifact()` / `getNoteSchemas()` as used at runtime in [pxe/service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:137). A tiny smoke test on the real loader would close that gap.
- The current no-from e2e is not a real regression gate: it explicitly accepts either success or failure in [tx-sendTx-noFrom.test.ts]((project root)/packages/extension/tests/e2e/network/tx-sendTx-noFrom.test.ts:66). That means the scope-sensitive path above can break without tripping CI.

**NITS**
- Confirmed: there are no hits for `DEFAULT_GAS_LIMIT`, `DEFAULT_TEARDOWN_GAS_LIMIT`, `MAX_PROCESSABLE_L2_GAS`, or `MAX_PROCESSABLE_DA_GAS_PER_CHECKPOINT` under `packages/`.
- Confirmed: no `'ALL_SCOPES'` literal and no imported `AccessScopes` type under `packages/`; the only symbol is the local `AccessScopesSchema` in [pxe/service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:27). Low-level `simulateTx` / `proveTx` / `executeUtility` / `profileTx` calls all ultimately hand `AztecAddress[]` or schema-parse to it.
- Confirmed: `EmbeddedWallet.create` appears once, in [aztec.ts]((project root)/packages/extension/tests/e2e/fixtures/aztec.ts:75).
- Confirmed: `@aztec/wallets` and `@aztec/viem` are fixture-only here. The pins are in [extension/package.json]((project root)/packages/extension/package.json:79), and the only imports are [aztec.ts]((project root)/packages/extension/tests/e2e/fixtures/aztec.ts:16) and [aztec-private-fpc-bridge.ts]((project root)/packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:26).

---

_token usage: 293,394_
