# 0.6 Phase 2 — IDispatcherServices + isNoFromRequest + Operation type strategy

Pre-refactor for M3.5. Phase 1 (capabilities + caip) already shipped on branch `m3.0/dispatcher-decouple`. Phase 2 continues on the same branch.

## Goal

Replace the 6 concrete service class type imports in `dispatcher.ts` with a single structural interface. After this, dispatcher's ONLY runtime import is the BackgroundConnectionHandler from `@aztec/wallet-sdk`. Every service it uses comes through `IDispatcherServices`.

Type imports for Network / Account / Operation / OperationResult / ExecutionResult / DappSession / LocalTxOrigin stay for now — they're pure type imports (erased at runtime) and addressing them requires either a shared types package or full Operation-type relocation, which is out of scope for a pre-refactor. Codex option (b) explicitly endorses this approach.

## Exhaustive service surface (verified from source grep)

From `dispatcher.ts`, the dispatcher calls:

| Service | Methods | Call sites |
|---|---|---|
| networkService | `getNetworks(chainId?: number)` — via `resolveNetworkByChainId` helper | line 735 |
| accountService | `getAccounts(profileId, chainId)` | lines 231, 407, 513, 748 |
| executionService | `executeOperations(ops, origin?)` | line 206 |
| profileService | **(unused)** — received but only bound as `_profileService` | line 159 |
| dappInteractionService | `execute({...})`, `requestCapabilities({...})` | lines 338, 415 |
| dappSessionService | `tryGetDappSessionByOrigin(origin)`, `getDappSession(id)`, `updateDappSession(id, permissions, accounts, confirmationLevel)`, `setAccountAliases(id, aliases)`, `setCapabilityGrants(id, grants)`, `setCapabilityRejections(id, rejections)` | lines 219, 310, 355, 444, 451, 466, 475, 478, 546, 753 |

Nothing else. The grep is exhaustive — `this.\w+Service\.` matches every instance-field access.

## New file: `wallet-sdk/services-contract.ts`

```ts
/**
 * Structural service interfaces that the wallet-sdk dispatcher consumes.
 *
 * The dispatcher deliberately does NOT import the concrete service
 * classes (NetworkService, AccountService, …). The 6 concrete services
 * live in `@nulo/extension` and won't be reachable from wallet-bridge
 * after M3.5. Dispatcher depends on the interfaces; real services
 * satisfy them structurally at the wiring site (background.ts).
 *
 * Type imports (Network, Account, Operation, etc.) from extension paths
 * are intentional — they're TypeScript type-only imports with zero
 * runtime emission. Relocating these types is a separate architectural
 * decision (shared types package vs. operation-type move) not covered
 * by this pre-refactor.
 */

import type { Network } from "@/wallet/services/network/service"
import type { Account } from "@/wallet/services/account/service"
import type { Operation, OperationResult } from "@/wallet/services/execution/service"
import type { ExecutionResult } from "@/wallet/services/dapp-interaction/service"
import type { DappPermissions, DappSession, AccessLevel } from "@/wallet/services/dapp-session/spec"
import type { LocalTxOrigin } from "@/wallet/services/transaction/service"
import type { GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"

export interface INetworkReader {
	getNetworks(chainId?: number): Promise<Network[]>
}

export interface IAccountReader {
	getAccounts(profileId: string, chainId: number): Promise<Account[]>
}

export interface IExecutionRunner {
	executeOperations(ops: Operation[], origin?: LocalTxOrigin): Promise<OperationResult[]>
}

/** Dispatcher doesn't call anything on profile service — marker type. */
export interface IProfileServiceMarker {
	readonly _profileServiceMarker?: never
}

// Shape of the `execute` call payload. Taken verbatim from the
// dispatcher call site (not currently exported from
// dapp-interaction/service). Kept minimal — add fields only if the
// dispatcher actually reads them from the return value.
//
// If these definitions drift from the real `DappInteractionService`,
// TypeScript catches it at the wiring site in `background.ts` where
// the real service is assigned to `IDispatcherServices`.

export interface IDappInteractionRunner {
	execute(req: unknown): Promise<ExecutionResult>
	requestCapabilities(req: unknown): Promise<{
		approved: boolean
		grants: GrantedCapabilityRecord[]
		rejections: RejectedCapabilityRecord[]
		accountAliases?: Record<string, string>
	}>
}

export interface IDappSessionWriter {
	tryGetDappSessionByOrigin(origin: string): Promise<DappSession | undefined>
	getDappSession(id: string): Promise<DappSession>
	updateDappSession(
		id: string,
		permissions: DappPermissions[],
		accounts: string[],
		confirmationLevel: AccessLevel,
	): Promise<DappSession>
	setAccountAliases(id: string, aliases: Record<string, string>): Promise<DappSession>
	setCapabilityGrants(id: string, grants: GrantedCapabilityRecord[]): Promise<DappSession>
	setCapabilityRejections(id: string, rejections: RejectedCapabilityRecord[]): Promise<DappSession>
}

/** Aggregated container passed to the dispatcher constructor. */
export interface IDispatcherServices {
	networkService: INetworkReader
	accountService: IAccountReader
	executionService: IExecutionRunner
	profileService: IProfileServiceMarker
	dappInteractionService: IDappInteractionRunner
	dappSessionService: IDappSessionWriter
}
```

## `isNoFromRequest` — inline in dispatcher

The helper is 3 lines. Inline at top of dispatcher.ts:
```ts
/** Detects whether a sendTx `opts.from` value indicates NO_FROM
 *  (DefaultEntrypoint). Mirrors execution/utils/fee-detection.ts. */
function isNoFromRequest(from: unknown): boolean {
	return from === "NO_FROM"
}
```

Remove the import. Zero behavior change.

## Operation types — strategy (codex option b)

Operation types (`Operation`, `OperationResult`, `EncodedCallAction`, and the 8 `Aztec*Operation` types) are USED by dispatcher as signature types. They're imported as `import type` — no runtime emission. Keep as-is for this pre-refactor.

M3.5 proper will decide: either (a) move Operation type defs to wallet-bridge with extension re-exporting, or (b) accept the type-only dep from wallet-bridge to extension. Option (b) is consistent with wallet-bridge being "extension-specific" per the M3.5 plan's framing (it wraps `@aztec/wallet-sdk` which is extension-only anyway).

## `dispatcher.ts` constructor rewrite

Before:
```ts
constructor(
	private readonly networkService: NetworkService,
	private readonly accountService: AccountService,
	private readonly executionService: ExecutionService,
	readonly _profileService: ProfileService,
	private readonly dappInteractionService: DappInteractionService,
	private readonly dappSessionService: DappSessionService,
	private readonly logger: ILogger,
) { … }
```

After:
```ts
constructor(
	private readonly networkService: INetworkReader,
	private readonly accountService: IAccountReader,
	private readonly executionService: IExecutionRunner,
	readonly _profileService: IProfileServiceMarker,
	private readonly dappInteractionService: IDappInteractionRunner,
	private readonly dappSessionService: IDappSessionWriter,
	private readonly logger: ILogger,
) { … }
```

Method bodies need zero changes — they call the same methods, now typed through the interfaces.

## Remove now-unused imports from `dispatcher.ts`

After the constructor swap, delete the 6 concrete-class type imports:
```
- import type { NetworkService, Network } from "@/wallet/services/network/service"
- import type { AccountService, Account } from "@/wallet/services/account/service"
- import type { ExecutionService, Operation, ... } from "@/wallet/services/execution/service"
- import type { ProfileService } from "@/wallet/services/profile/service"
- import type { DappInteractionService, ExecutionResult } from "@/wallet/services/dapp-interaction/service"
- import type { DappSessionService } from "@/wallet/services/dapp-session/service"
- import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/service"
- import { isNoFromRequest } from "@/wallet/services/execution/utils/fee-detection"
```

**But keep** the type-level imports dispatcher's method bodies still reference:
```
+ import type { Network } from "@/wallet/services/network/service"  // used in method signatures
+ import type { Account } from "@/wallet/services/account/service"
+ import type { Operation, OperationResult, EncodedCallAction, Aztec*Operation (8 types) } from "@/wallet/services/execution/service"
+ import type { ExecutionResult } from "@/wallet/services/dapp-interaction/service"
+ import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/service"  // OriginType is runtime enum access
```

Net change: the 6 service CLASS type imports disappear. The DOMAIN type imports stay (for now — documented as M3.5 followup).

`OriginType` is a runtime value (enum) used in dispatcher method bodies. It stays imported (type-only wouldn't work for enum access at runtime).

## `background.ts` — no changes required

Background.ts constructs the dispatcher by passing 6 concrete services. Those services satisfy the new interfaces structurally. TypeScript accepts the call without any changes:

```ts
const dispatcher = new WalletSdkDispatcher(
	networkService,          // NetworkService satisfies INetworkReader
	accountService,          // AccountService satisfies IAccountReader
	executionService,        // ExecutionService satisfies IExecutionRunner
	profileService,          // ProfileService satisfies IProfileServiceMarker (empty interface)
	dappInteractionService,  // DappInteractionService satisfies IDappInteractionRunner
	dappSessionService,      // DappSessionService satisfies IDappSessionWriter
	logger,
)
```

Structural typing does the rest. If any real service drifts from the interface (a method is renamed or removed), TypeScript fails at the wiring site, not inside the dispatcher.

## Risk — `IDappInteractionRunner.execute` and `requestCapabilities` signatures are `unknown` params

The real call sites pass specific request shapes:
```ts
await this.dappInteractionService.execute({
	dappMetadata, operations, chainId, networkId, account, feeSettings, origin, …
})

await this.dappInteractionService.requestCapabilities({
	dappMetadata, dappSession, capabilities, selectedAccount, networkId, …
})
```

The real service defines these shapes. The interface types them as `unknown` because:
1. The shapes are deep (many fields with nested types)
2. Writing out the full shape would require importing dap-interaction/service.ts internal types that we're trying to decouple from
3. At runtime, structural typing ensures the real service accepts the call; the dispatcher types `unknown` only affects where TypeScript enforces the call shape

**Trade-off**: dispatcher loses compile-time checking on the arguments it passes to `execute`/`requestCapabilities`. Bugs in the dispatcher's payload construction won't be caught until runtime.

**Mitigation**: the dispatcher's payload construction is already well-tested by existing scope-enforcement tests + e2e. Add a typed local interface inside dispatcher.ts if the loss of type safety is unacceptable.

**Alternative**: export the request-shape types from `dapp-interaction/service.ts` (rename existing internal types to `DappInteractionExecuteRequest` and `DappInteractionCapabilitiesRequest`, export them). Import those in `services-contract.ts`. More work but preserves compile-time safety.

**Decision needed**: go with `unknown` for speed, or add the request-shape types for safety? I lean toward `unknown` for the pre-refactor and add typed shapes during M3.5 proper.

## Verification

- `bun run test src/wallet/services/wallet-sdk/` — scope-enforcement 53 tests pass
- `bun run typecheck` — error count stays at 116 (master baseline)
- `bun run test` (full extension suite) — no regressions
- `bun run build` — clean build
- Smoke: unlock wallet, discover + connect the playground dApp, call `sendTx` → resolves correctly

## Rollback

`git revert` the 0.6 phase 2 commit. Dispatcher goes back to concrete class imports. Structural typing guarantees zero runtime behavior change, so the revert is safe.

## Open questions for codex review

1. Are the method signatures in each interface exhaustive? Did the grep miss any `this.<service>.*` call?
2. Is `unknown` acceptable for `execute`/`requestCapabilities` params, or does codex want the typed shape extracted?
3. Is `IProfileServiceMarker` the right pattern for an unused-but-held service, or should we just drop `profileService` from the dispatcher constructor entirely?
4. Is there any subtle issue with `OriginType` being a runtime enum that my approach missed?
5. Any blockers I missed?
