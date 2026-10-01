# Cluster B — runtime packages review

Scope reviewed (every non-test source file, ~8,900 LOC): `packages/aztec-runtime/src` (34 files), `packages/wallet-bridge/src` (24 files), `packages/wallet-sdk-schema-patch/src` (2 files), `packages/resolve-asset/src` (1 file).

## Cluster verdict

This cluster is well above the codebase-average quality bar the brief warns about — it reads like code that already went through several audit/refactor passes (many files literally say "extracted from N hand-rolled copies" or "derived from the single registry" in their own docstrings: `chain-coordinates.ts`, `lifecycle-coordinator.ts`, `async-memo.ts`, `proxy.ts`, `descriptors.ts` are all post-dedup). The account-derivation, PXE-concurrency, and public-events code in `aztec-runtime` is dense but each line is load-bearing (security/concurrency invariants), not filler. The residual duplication is concentrated in the newer, most-iterated file in the cluster — `wallet-bridge/dispatcher.ts` and its sibling `method-descriptors.ts` / `method-scope-checkers.ts` — where repeated audit rounds (F-003, F-005, F-006, F1, F-08, B-14...) each added a similar guard/log/checker without going back to consolidate the previous one. Biggest lever: the scope-checker flag-gate pattern and the registry-derivation reducers in wallet-bridge (F1/F2 below). Total realistic removable: **~110 LOC**, none of it risky — this is a small, low-risk cleanup pass, not a rewrite.

## Findings

### F1 [duplication] Same flag-gated scope-check body repeated 5× in `method-scope-checkers.ts`

**Where:**
- `packages/wallet-bridge/src/method-scope-checkers.ts:65-76` (`checkRegisterContract`, flag `canRegister`)
- `packages/wallet-bridge/src/method-scope-checkers.ts:78-88` (`checkGetContractMetadata`, flag `canGetMetadata`)
- `packages/wallet-bridge/src/method-scope-checkers.ts:90-102` (`checkIsTokenRegistered`, flag `canGetMetadata` — **identical body** to `checkGetContractMetadata` except the method name in the error string)
- `packages/wallet-bridge/src/method-scope-checkers.ts:369-375` (`checkGetAddressBook`, flag `addressBook`)
- `packages/wallet-bridge/src/method-scope-checkers.ts:382-388` (`checkRegisterSender`, flag `addressBook` — **identical body** to `checkGetAddressBook` except the method name)

**Evidence** (the two exact-duplicate pairs):
```ts
export function checkGetContractMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const address = String(args[0])
	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return
	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: getContractMetadata targets ${address}, not permitted by granted contracts scope`)
	}
}
export function checkIsTokenRegistered(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const address = String(args[0])
	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return
	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: isTokenRegistered targets ${address}, not permitted by granted contracts scope`)
	}
}
```
```ts
export function checkGetAddressBook(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw new Error("Scope violation: getAddressBook requires data.addressBook=true")
	}
}
export function checkRegisterSender(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw new Error("Scope violation: registerSender requires data.addressBook=true")
	}
}
```

**Refactor:** add two tiny parametrized helpers in the same file (leaf module, no new dependency):
```ts
function checkContractsFlag(methodName: string, address: string, grants: GrantedCapabilityRecord[], flag: "canRegister" | "canGetMetadata"): void {
	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return
	if (!caps.some((c) => c[flag] && inAddressList(address, c.contracts))) {
		throw new Error(`Scope violation: ${methodName} targets ${address}, not permitted by granted contracts scope`)
	}
}
function checkDataAddressBookFlag(methodName: string, grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw new Error(`Scope violation: ${methodName} requires data.addressBook=true`)
	}
}
```
Then each of the 5 exported functions becomes a 1-2 line named wrapper (the file already uses this "named wrapper for a stable function reference" idiom at the bottom for `checkSendTx`/`checkSimulateTx`/`checkProfileTx`, so this is consistent with the file's own convention, not a new one). Error-string text is preserved exactly (interpolated method name replaces the literal).

**LOC delta:** -25 (54 lines → ~29).
**Risk / tests:** low. Every error string is preserved verbatim; scope tests assert on `/Scope violation:.../` patterns generically in `scope-enforcement.test.ts` and via `dispatcher.test.ts`'s F-003/F-004/A1 sections. No test asserts on function *identity* for these five (unlike `checkSendTx`/`checkSimulateTx`/`checkProfileTx`, whose identity IS pinned — this refactor keeps that pin intact since it doesn't touch those three).
**Confidence:** high.

### F2 [duplication] Six near-identical `Object.entries`/`Object.values` reducers in `method-descriptors.ts`

**Where:** `packages/wallet-bridge/src/method-descriptors.ts:324-330` (`deriveCapabilityMap`), `:332-338` (`deriveExemptSet`), `:340-346` (`deriveMethodToKind`), `:348-354` (`deriveNetworkOnlyKinds`), `:356-362` (`deriveAccountKinds`), `:364-370` (`deriveScopeCheckerMap`).

**Evidence:**
```ts
export function deriveCapabilityMap(registry: Record<string, MethodDescriptor>): Record<string, CapabilityType> {
	const out: Record<string, CapabilityType> = {}
	for (const [method, d] of Object.entries(registry)) {
		if (d.capability !== null) out[method] = d.capability
	}
	return out
}
export function deriveNetworkOnlyKinds(registry: Record<string, MethodDescriptor>): Set<OperationKind> {
	const out = new Set<OperationKind>()
	for (const d of Object.values(registry)) {
		if (d.routing.via === "network-operation") out.add(d.routing.kind)
	}
	return out
}
```
All six share the identical "iterate, test a projection, insert into an accumulator, return it" shape — three build `Record`s keyed by method name, three build `Set`s of values.

**Refactor:** two generic helpers, keeping every exported name/signature identical (they're individually asserted against a frozen oracle in `method-descriptors.test.ts`, so the public surface must not change):
```ts
function deriveRecord<V>(registry: Record<string, MethodDescriptor>, project: (d: MethodDescriptor) => V | null | undefined): Record<string, V> {
	const out: Record<string, V> = {}
	for (const [method, d] of Object.entries(registry)) {
		const v = project(d)
		if (v !== null && v !== undefined) out[method] = v
	}
	return out
}
function deriveSet<V>(registry: Record<string, MethodDescriptor>, project: (d: MethodDescriptor) => V | undefined): Set<V> {
	const out = new Set<V>()
	for (const d of Object.values(registry)) {
		const v = project(d)
		if (v !== undefined) out.add(v)
	}
	return out
}
export const deriveCapabilityMap = (r: Record<string, MethodDescriptor>) => deriveRecord(r, (d) => d.capability)
export const deriveMethodToKind = (r: Record<string, MethodDescriptor>) => deriveRecord(r, (d) => (d.routing.via !== "handler" ? d.routing.kind : undefined))
export const deriveNetworkOnlyKinds = (r: Record<string, MethodDescriptor>) => deriveSet(r, (d) => (d.routing.via === "network-operation" ? d.routing.kind : undefined))
export const deriveAccountKinds = (r: Record<string, MethodDescriptor>) => deriveSet(r, (d) => (d.routing.via === "account-operation" ? d.routing.kind : undefined))
export const deriveScopeCheckerMap = (r: Record<string, MethodDescriptor>) => deriveRecord(r, (d) => d.scopeCheck)
export const deriveExemptSet = (r: Record<string, MethodDescriptor>) => new Set(Object.entries(r).filter(([, d]) => d.exemptReason !== undefined).map(([m]) => m))
```

**LOC delta:** -20 (42 lines of near-identical loops → ~14 lines of generics + 6 one-liners).
**Risk / tests:** low. `method-descriptors.test.ts` calls each `derive*` function directly and compares to a frozen oracle (`FROZEN_CAPABILITY_MAP` etc.) — a pure behavior-preserving refactor is caught immediately if it drifts.
**Confidence:** high.

### F3 [verbosity] Seven 4-5-line `this.logger.log("wallet-sdk", LogLevel.X, ...)` calls in `dispatcher.ts` where a thin wrapper would collapse each to one line

**Where:** `packages/wallet-bridge/src/dispatcher.ts:740-744`, `:750-754`, `:852-856`, `:861-865`, `:869-873`, `:1261-1265`, `:1276-1280`.

**Evidence:**
```ts
this.logger.log(
	"wallet-sdk",
	LogLevel.Warn,
	`Desync: accounts grant exists but session.accounts is empty for session ${describeExternalId(ctx.sessionId)}`,
)
...
this.logger.log(
	"wallet-sdk",
	LogLevel.Debug,
	`handleSendTx: account=${account.address}, chainId=${ctx.chainId}, origin=${ctx.origin}`,
)
```
Every call in the file passes the literal source `"wallet-sdk"` — `WalletSdkDispatcher` never logs under any other source. `ILogger` (`packages/wallet-core/src/logger/interfaces.ts:30-32`) only exposes the raw `log(source, level, ...data)` signature (unlike the `Service` base class used elsewhere in the cluster, which already has `logDebug`/`logWarn`/`logError` convenience methods) — `WalletSdkDispatcher` is a plain class, not a `Service`, so it never got that convenience.

**Refactor:** two 3-line private methods on `WalletSdkDispatcher`:
```ts
private logDebug(msg: string, ...rest: unknown[]): void {
	this.logger.log("wallet-sdk", LogLevel.Debug, msg, ...rest)
}
private logWarn(msg: string, ...rest: unknown[]): void {
	this.logger.log("wallet-sdk", LogLevel.Warn, msg, ...rest)
}
```
Each of the 7 call sites becomes `this.logDebug(...)` / `this.logWarn(...)` — one line, same message text, same level.

**LOC delta:** -18 (7×5=35 lines → 6 lines of helpers + 7×1=7 lines of calls = 13).
**Risk / tests:** low — logging is not assertion-tested in `dispatcher.test.ts` (it's `Debug`/`Warn` level, not user-facing behavior); a mechanical extraction cannot change dispatch semantics.
**Confidence:** high.

### F4 [dead-code] `IDispatcherServices` interface in `services-contract.ts` has zero importers anywhere in the repo

**Where:** `packages/wallet-bridge/src/services-contract.ts:145-155`.

**Evidence:**
```ts
/** Aggregated services dependency container. Exported for consumers
 *  that want to build a dispatcher test fixture without knowing the
 *  individual interface names — the constructor takes the five
 *  services as separate positional arguments, not this aggregate. */
export interface IDispatcherServices {
	networkService: INetworkReader
	accountService: IAccountReader & IAccountProvisioner
	executionService: IExecutionRunner
	dappInteractionService: IDappInteractionRunner
	dappSessionService: IDappSessionWriter
}
```
`grep -rn "IDispatcherServices" apps/ packages/` (repo-wide, both `apps/` and `packages/`) returns only its own declaration in `services-contract.ts` — no import, no test fixture uses it, despite the docstring's stated purpose.

**Refactor:** delete the interface (and its doc comment). It is re-exported via `export * from "./services-contract"` in `index.ts`, so no other change is needed.
**LOC delta:** -11.
**Risk / tests:** none — confirmed zero references anywhere, including test files.
**Confidence:** high.

### F5 [duplication] `if (!dappSession) throw new Error(\`No dApp session found for origin ${ctx.origin}\`)` repeated 6× in `dispatcher.ts`

**Where:** `packages/wallet-bridge/src/dispatcher.ts:725-727` (`handleGetAccounts`), `:858-860` (`handleSendTx`), `:914-916` (`handleCreateAuthWit`), `:966-968` (`handleRegisterToken`), `:1007-1009` (`handleGrantPublicAuthwit`), `:1063-1065` (`handleRequestCapabilities`).

**Evidence** (one of six identical 3-line blocks):
```ts
if (!dappSession) {
	throw new Error(`No dApp session found for origin ${ctx.origin}`)
}
```

**Refactor:** a private helper that narrows the type, replacing all 6 call sites:
```ts
private requireSession(dappSession: IDappSessionRef | undefined, ctx: SessionContext): IDappSessionRef {
	if (!dappSession) throw new Error(`No dApp session found for origin ${ctx.origin}`)
	return dappSession
}
```
Each call site becomes `const session = this.requireSession(dappSession, ctx)` — the 5 handlers that currently reuse the narrowed `dappSession` variable name afterward (e.g. `dappSession.id`, `dappSession.accounts`) just re-bind to `session` (or the helper can be called inline where the narrowing is only needed for the immediate next line).

**LOC delta:** -10 (6×3=18 lines → 4-line helper + 6×1=6 lines).
**Risk / tests:** low. `dispatcher.test.ts` asserts `.rejects.toThrow()` (no message match) at the call sites that hit this guard (e.g. lines 1505, 1589, 2052) — a behavior-preserving extraction is safe.
**Confidence:** high.

### F6 [duplication] Three near-identical `indexedDB.deleteDatabase` Promise-wrapper blocks in `pxe/service.ts`

**Where:** `packages/aztec-runtime/src/pxe/service.ts:279-293` (per-DB delete inside `sweepLegacyIndexedDbs`), `:304-312` (the shared `keyval-store` delete, same function), `:817-832` (the general-purpose `deleteDb` helper used by `clearChainState`/`clearProfileState`).

**Evidence:**
```ts
// sweepLegacyIndexedDbs, per-item:
const deleted = await new Promise<boolean>((resolve, reject) => {
	const req = indexedDB.deleteDatabase(pxes[i].name!)
	req.onsuccess = () => resolve(true)
	req.onerror = () => reject(req.error)
	req.onblocked = () => {
		this.logWarn("deleteDatabase blocked (DB still in use):", pxes[i].name)
		resolve(false) // Skip — don't hang the sweep forever
	}
})
```
```ts
// the existing general helper, already in the file:
private deleteDb(name: string, timeoutMs = 5_000): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase(name)
		let timer: ReturnType<typeof setTimeout> | undefined
		const finish = (fn: () => void) => { if (timer) clearTimeout(timer); fn() }
		req.onsuccess = () => finish(resolve)
		req.onerror = () => finish(() => reject(req.error ?? new Error(`deleteDatabase failed: ${name}`)))
		req.onblocked = () => {
			this.logWarn("deleteDatabase blocked (waiting for close):", name)
			timer = setTimeout(() => reject(new Error(`deleteDatabase blocked past timeout: ${name}`)), timeoutMs)
		}
	})
}
```
All three wrap `indexedDB.deleteDatabase` in a `Promise` with the same three-handler (`onsuccess`/`onerror`/`onblocked`) shape; they differ only in what "blocked" does (resolve-false-and-continue vs. timeout-then-reject) and what "success" returns (bool vs. void).

**Refactor:** this one needs care because the "blocked" semantics genuinely differ (the sweep wants to skip-and-continue immediately; `deleteDb` wants to wait up to `timeoutMs` then fail loudly). Rather than force one shape, extract just the request-to-promise plumbing and parametrize the `onblocked` behavior:
```ts
private deleteDatabase(name: string, onBlocked: (req: IDBOpenDBRequest) => void): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase(name)
		req.onsuccess = () => resolve()
		req.onerror = () => reject(req.error ?? new Error(`deleteDatabase failed: ${name}`))
		req.onblocked = () => onBlocked(req)
	})
}
```
`deleteDb(name, timeoutMs)` becomes a thin wrapper supplying the timeout-then-reject `onBlocked`; the sweep loop supplies a resolve-immediately-with-a-warn `onBlocked` and tracks "was it actually deleted" via its own flag instead of the promise's resolved value. This keeps both call sites' distinct fail-safe-vs-fail-loud policies explicit rather than papering over them.

**LOC delta:** -15 (39 lines across the three blocks → ~24).
**Risk / tests:** medium — this is inside `PxeService`'s destructive-cleanup path (profile/chain purge), which is concurrency-audited (`B-18`, `#281 D3/D4` markers throughout the file). Covered by `service-sweep.test.ts` and `service.test.ts`. Recommend doing this one only with the full sweep/clear test suite green before and after, not as a drive-by.
**Confidence:** medium (the refactor is straightforward, but this file's git-blame trail shows several rounds of concurrency-bug fixes in exactly this area, so a reviewer should treat it as security-adjacent even though it's "just" a Promise wrapper).

### F7 [inconsistency] `err instanceof Error ? err.message : String(err)` reimplemented 7× in `aztec-runtime` instead of using the existing `@nulo/wallet-core/utils` helper

**Where:** `packages/aztec-runtime/src/pxe/client.ts:149`, `packages/aztec-runtime/src/pxe/public-events.ts:385`, `:440`, `packages/aztec-runtime/src/pxe/opfs-store.ts:216`, `packages/aztec-runtime/src/pxe/service.ts:208`, `:356`, `:929`.

**Evidence:**
```ts
// packages/aztec-runtime/src/pxe/service.ts:208
void this.sweepOrphanStores().catch((err) =>
	this.logWarn("deferred orphan-store sweep failed", err instanceof Error ? err.message : String(err)),
)
```
```ts
// packages/wallet-core/src/utils/errors.ts:8-14 — already exported at @nulo/wallet-core/utils,
// already imported into this same file for ReadWriteGuard (service.ts:36):
export function errorMessageFromUnknown(raw: unknown): string {
	if (raw instanceof Error) return raw.message
	if (typeof raw === "string") return raw
	if (raw === null) return "null"
	if (raw === undefined) return "undefined"
	return String(raw)
}
```
`errorMessageFromUnknown` is semantically identical to the inline ternary for every value these 7 call sites actually pass (Error → `.message`; everything else → `String(x)`, and `String(null)`/`String(undefined)` already produce `"null"`/`"undefined"`). `aztec-runtime` already depends on `@nulo/wallet-core/utils` (imports `ReadWriteGuard` from it in this exact file), so this isn't a new dependency — it's an existing import that should be widened by one name.

**Refactor:** `import { errorMessageFromUnknown } from "@nulo/wallet-core/utils"` and replace the 7 ternaries with `errorMessageFromUnknown(err)`.
**LOC delta:** ~0 (each site is already one line) — the value here is eliminating a second, drift-prone implementation of the same semantics, not line count.
**Risk / tests:** low — behavior-identical for every input these call sites produce (all are `catch (err)` from real thrown values or `unknown` node/PXE responses).
**Confidence:** high.

## Not worth it

- `wallet-sdk-schema-patch/src/apply.ts`'s four `isXShape` functions repeat `existing?.def?.input?.def?.items` / `existing?.def?.output?.def?.type` accessors, but each check has a genuinely different arity/type assertion and the whole file is 118 lines — extracting 2 one-line accessors used 4× each nets close to zero LOC.
- `resolve-asset/src/index.ts`'s two "path escapes the package root" guards (`resolvePackageAsset`, `assertPackageIdentity`'s `mustContain` branch) are only 2 copies, each ~3 lines — below the "2 copies must be >20 lines each" bar.
- `aztec-runtime/src/pxe/async-memo.ts`'s `memoizeAsync`/`memoizeAsyncBy` could theoretically share one implementation (the former is a special case of the latter with a constant key), but the file's own docstring says it already replaced six independent hand-rolled caches — further consolidating these last two is diminishing returns on an already-clean file.
- `pxe/client.ts`'s ~20 one-liner RPC methods (`getContractInstance`, `registerAccount`, etc.) look like "wrappers that only forward," but each pairs a distinct Zod response schema with a distinct upstream method — legitimate typed-transport boilerplate, not collapsible without losing per-method response validation.
- `dapp-interaction-protocol.ts`'s 16 `Omit<XOperation, Params> & { chain | account }` type aliases are mechanically repetitive but each is a distinct member of the `OperationRequest` discriminated union — a generic mapped type would lose the individual exported names several other files import by name.
- `opfs-store.ts`'s 3× "swallow `NotFoundError`, rethrow anything else" try/catch (`opfsRoot`, `removeChainStoreDir`, `removeProfileStoreDirs`) is a real repeated idiom but each instance is only ~3 lines — below the value bar even at 3 occurrences.
- `aztec-node-factory-adapter.ts`'s `isAllowedRpcUrl` check-then-throw is duplicated in `createNode`/`probeChainId`, but only 2 copies at ~3 lines each with different error-message context words.
