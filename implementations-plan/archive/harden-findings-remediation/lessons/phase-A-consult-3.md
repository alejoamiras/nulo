Choose **(b)**.

Do **not** import `WalletSchema` into `wallet-bridge`. That conflicts with the package boundary in [ARCHITECTURE.md](/home/homelab/Projects/nulo/nulo-2/ARCHITECTURE.md:57) and the transport-shaped rationale in [ARCHITECTURE.md](/home/homelab/Projects/nulo/nulo-2/ARCHITECTURE.md:62). It also couples dispatch validation to the side-effect schema patch in [nulo-schema-patch.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:18), including custom methods added at [nulo-schema-patch.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:45) and [nulo-schema-patch.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:96).

Do **not** move this to `content-script-validator`. That file validates only the outer runtime envelope; `content` is intentionally `unknown` at [content-script-validator.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:50), and the file says it is not itself a security boundary at [content-script-validator.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:20). Parsing decrypted wallet RPC args there would duplicate the upstream secure-message path in the wrong layer.

The right F-08 close is a **small, dependency-free arg-shape guard in `wallet-bridge` immediately before arg-dependent scope enforcement**. The insertion point is [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:301), before `enforceScopeWithSession(...)` at [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:322). Keep it structural, not Aztec-semantic: verify only the fields the dispatcher/scope layer uses before casts.

Guard these methods first:

`sendTx`, `simulateTx`, `profileTx`: `args[0]` is object, `exec.calls` is an array, every call is object-like with `to` present and `name` a string. Current scope code casts at [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:109).

`executeUtility`: call object has `to` and string `name`, matching the existing scope dependency at [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:168).

`createAuthWit`: `args[0]` present; `args[1]` is either CallIntent with `caller`, `call.to`, string `call.name`, or IntentInnerHash with `consumer` and `innerHash`. Keep raw Fr rejected as now at [method-scope-checkers.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/method-scope-checkers.ts:318).

`grantPublicAuthwit`: `args[1]` has `caller`, `contract`, `method` strings and `args` array, before the handler dereferences at [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:702).

`registerToken`: two non-nullish positional args before account/token coercion at [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:645) and [dispatcher.ts](/home/homelab/Projects/nulo/nulo-2/packages/wallet-bridge/src/dispatcher.ts:659).

This leaves full Aztec object parsing downstream, where it already belongs: e.g. `FunctionCall.schema.parseAsync` at [tx-request-builder.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/tx-request-builder.ts:414), authwit intent parsing at [service.ts](/home/homelab/Projects/nulo/nulo-2/apps/extension/src/wallet/services/execution/service.ts:685), and PXE-level parsing at [service.ts](/home/homelab/Projects/nulo/nulo-2/packages/aztec-runtime/src/pxe/service.ts:393). Document the residual: wallet-bridge validates only authorization-relevant shape, not full `WalletSchema`.

RECOMMENDATION: (b) — Add a dispatcher-local, dependency-free arg-shape guard for scope/authorization-sensitive methods before scope enforcement; document full WalletSchema dispatch parsing as a follow-up.