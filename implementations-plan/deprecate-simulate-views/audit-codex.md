# Codex adversarial audit — `deprecate-simulate-views` plan

Model: GPT-5.x via `codex exec` (xhigh). Date: 2026-05-24.
Session ID: `019e5aa2-2bf9-7193-95b0-616c75f90557`
CODEX_DIR: `/var/folders/p9/5vbplm5s6p5bjy78gdqnh0500000gn/T/codex-slDjjj7X`

## Findings

### BLOCKER

**C1 (consensus with Opus F3)** — Plan §5.1 step 6 ("for each utility call: `await pxe.executeUtility(...)`") is not behavior-parity-safe. Current code starts utility executions eagerly by pushing live `pxe.executeUtility(...)` promises during the scan (`service.ts:1271-1272, 1298-1315, 1365-1382, 1441-1448`), then awaits them later. Plan's literal "await each utility call" would serialize utilities, change failure ordering, and lose current overlap with tx simulation. Helper MUST preserve the launch-then-await pattern.

### HIGH

**C2** — Parity test matrix missing two load-bearing branches:
1. Origin-dependent private-return quirk: `txRequest.origin.toString() === op.accountAddress ? .nested : .nested[1].nested` (`service.ts:1425-1428`). Plan §5.2 says "all-private calls → correct private return unpacking" without splitting these two branches.
2. `hideSender` (for `call` kind, `service.ts:1322-1324`) vs `hideMsgSender` (for `encoded_call` kind, `service.ts:1388-1391`) vs utility hardcodes `false` (`service.ts:1300-1311, 1367-1378`). If both branches aren't pinned, "verbatim extraction" is wishful thinking.

**C3** — Cleanup inventory incomplete. Plan misses:
- `packages/extension/src/popup/windows/execute/OperationCard.vue:288-296` (template render branch) — same as Opus F1
- `packages/extension/src/wallet/services/dapp-interaction/spec.ts:11-38` (re-export of SimulateViewsRequest)
- Stale header comment in `packages/extension/src/wallet/services/token-balance/balance-projector.ts:1-4`
- Stale dispatcher comment in `packages/wallet-bridge/src/dispatcher.ts:171-174`

The "already covered by 5.10 + 5.11 + 5.12" claim at `plan.md:305-307` is false.

**C4** — Do NOT put `previewedInterface` on the dApp protocol request shape. The current architecture:
- `registerToken` is a strict 2-arg wallet-sdk method (`nulo-schema-patch.ts:36`)
- Dispatcher constructs a fresh `RegisterTokenRequest` from those two args only (`dispatcher.ts:434-445`)
- `approveInteraction()` is a JS trust boundary that forwards popup-built `Operation[]` without revalidation (`dapp-interaction/service.ts:83-95`)

The actual producer of preview data is the popup-side `TokenServiceClient.previewTokenMetadata(...)` call (`execute/index.vue:261-269`). So `previewedInterface` belongs on the EXTENSION-LOCAL executable op field (set during popup approval), maybe — wallet-bridge wire request field, NO.

### MEDIUM

**C5** — Register-token threading scope is understated.
- `previewTokenMetadata` currently returns only `{ name, symbol, decimals }` in both spec (`token/spec.ts:176-183`) and client (`token/client.ts:59-64`)
- Popup stores exactly that in `tokenMetadata` (`execute/index.vue:93-95, 268-269`)
- Approval strips only `network` and `account`, forwards the rest (`execute/index.vue:327-335`)

You need an explicit popup-side merge path for the interface, not just "popup approves with it attached."

## Confirmations (not blockers)

**On extractability**: `executeSimulateViews` IS extractable, but not blind copy-paste. Hidden state: init/profile/network/account/PXE resolution + logging live on `this` (`service.ts:1237-1260, 1433-1446`). Injected dependency shape is otherwise sound:
- `getAccountContract()` returns `IAccountContract` (`account/service.ts:169-177`) — exposes `address`, `ensureRegistered`, `buildTxExecutionRequest` (`aztec-runtime/src/account/index.ts:14-31`)
- `ContractResolver` effectively stateless apart from logger (`contract-resolver.ts:38-39`)

(Matches Opus F2 — types should be `IPXE` + `IAccountContract`.)

**On TxSimulationResult stubbing**: Easier than feared. Code only calls `.getPublicReturnValues()` and `.getPrivateReturnValues().nested` (`service.ts:1424-1428`); duck-typed object is enough. What must be real are the `Fr` values inside (consumed by `decodeFromAbi` + viewFn unpack).

**On previewedInterface forgeability**: NOT dApp-forgeable through current wallet-sdk path (dApp only gets 2 args + dispatcher rebuilds the request). Concern is extension-internal trust + staleness. Acceptable IF the field stays off the public request protocol AND the executor keeps the fallback fetch.

**On BATCH_SIZE = 12**: Scheduling policy, not helper API. Duplicated in both `balance-projector.ts:29` AND `balance-job-queue.ts:15-19, 36-37`. No PXE hard limit found. Don't parameterize the helper; if you touch it, centralize the constant separately (out of this PR's scope).

**On journal/storage migration**: No blocker. Journal kinds are `transfer | dapp_execute | token_import` only (`operation-journal/spec.ts:34, 137`). Pending dApp interactions live in in-memory `Map`, not durable storage (`dapp-interaction/service.ts:47, 83-95`).

## ADOPT (Codex's distilled list)

- Shape C, but keep it tight: ONE pure `batchedViewSimulation` helper, not protocol widening plus helper sprawl.
- Extend `previewTokenMetadata` to return the parsed interface from the EXTENSION side, then inject it at popup-approval time only.
- Add explicit tests for the origin-dependent private-return branch and the `hideSender` / `hideMsgSender` split.
- Keep `BATCH_SIZE` out of the helper.

## REJECT (Codex's distilled list)

- The plan's literal "await each utility call" step.
- Adding `previewedInterface` to `RegisterTokenRequest` / wallet-bridge protocol.
- Declaring the cleanup inventory complete without `OperationCard.vue`, `dapp-interaction/spec.ts`, and the stale comments/docs.
- Calling the current preview-threading security argument "waterproof." It's acceptable, not airtight.
