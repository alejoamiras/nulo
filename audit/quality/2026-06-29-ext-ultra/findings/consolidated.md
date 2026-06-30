# Consolidated QUALITY Findings — Nulo Aztec Wallet Monorepo

Scope: `/harden quality` ultra, typing + dedup lens. Findings are deduplicated by root cause, not by file. Change-frequency is based on six-month `git log --oneline --since=6.months -- <path> | wc -l` samples: extension service/UI areas are hot, shared bridge/core areas are hot-to-warm, design/crypto/PXE are warm, docs/schema-patch are cold.

## Cross-Cutting Findings

### Q-01 Boundary Codecs Are Missing At Persistence, RPC, dApp, And Backup Seams
- Smell: Schema/Type Drift + Stringly-Typed Boundary
- Lens: typing
- Impact: architectural · blast radius: 8 files / 30+ casts or unchecked parses · change-freq: hot
- Convergence: both
- Instances: `packages/wallet-core/src/storage/entity_storage.ts:49`; `packages/wallet-core/src/storage/value-storage.ts:21`; `packages/extension-messaging/src/core/decode.ts:15`; `packages/extension-messaging/src/utils.ts:22,28`; `packages/aztec-runtime/src/pxe/client.ts:90-93,144,191-195`; `apps/extension/src/composables/useDappInteractionPayload.ts:16,86`; `apps/extension/src/composables/useFullBackupImport.ts:165,201-214,245-246,300,321,363,370,385-391`
- Evidence: storage and messaging return `JSON.parse(...) as T` / `res as T`; dApp payloads are `unknown` asserted to a caller-supplied generic; backup import reconstructs the envelope and service slices with inline `Record<string, unknown>` casts and seven `as never` client erasures. aztec-runtime proves the better pattern with zod rehydration, then skips it on selected PXE methods.
- Why it harms future change: storage migrations, RPC result changes, dApp payload changes, and backup v3 changes can compile while stale or malformed data is treated as a trusted domain object. Failures surface far from the boundary.
- Refactoring: Introduce Codec / Replace Cast With Schema → storage constructors accept a parser/schema; messaging/dApp/backup seams decode by method or interaction kind; PXE client result validation becomes uniform.
- Effort: weeks
- Confidence: high

### Q-02 Untyped RPC Dispatch Is The Real Downstream `MethodsMap` Finding
- Smell: Generic-That-Enforces-Nothing + Stringly-Typed Dispatch
- Lens: typing
- Impact: architectural · blast radius: 6 files / 100+ dispatch casts · change-freq: hot
- Convergence: both
- Instances: `packages/wallet-core/src/base/index.ts:11`; `packages/extension-messaging/src/core/base-service.ts:111,125,130`; `packages/extension-messaging/src/core/base-client.ts:117,205`; `packages/extension-messaging/src/utils.ts:28`; `packages/wallet-bridge/src/dispatcher.ts:275,328,349,503,509,534,544,586,635,704,1078-1162`; `packages/wallet-bridge/src/method-scope-checkers.ts:28,58-190,255-370`; `packages/wallet-bridge/src/scope-enforcement.ts:59,83-103`
- Evidence: synthesized split resolution: `MethodsMap = Record<string, (...params: any[]) => unknown>` is locally justified as a variance constraint and does not widen concrete `ServiceSpec` inference. The smell is downstream: extension-messaging invokes by `this as Record<string, fn>` and wallet-bridge accepts `methodName: string, args: unknown[]`, then hand-indexes `args[N] as ...` in builders and scope checkers.
- Why it harms future change: changing an RPC signature or reordering args is not compiler-checked at the dApp trust boundary; builder, scope-checker, and enforcement code can silently diverge.
- Refactoring: Introduce Parameter Object / `RpcRequest` discriminated union derived from method descriptors; narrow once at dispatch, then pass typed tuples to builders and scope checkers.
- Effort: weeks
- Confidence: high

### Q-03 RPC Surfaces Are Hand-Restated As Client/PXE Passthroughs
- Smell: Duplicate Code + Shotgun Surgery
- Lens: dedup
- Impact: architectural · blast radius: 30 files / 110+ service forwards + 7 PXE surfaces · change-freq: hot
- Convergence: both
- Instances: `apps/extension/src/wallet/services/{account,account-state,auth-registry,config,contact,dapp-interaction,dapp-session,execution,fpc,incoming-transfer,log-viewer,logger,network,note,operation-journal,passkey,profile,task,token,token-balance,transaction}/client.ts`; `apps/extension/src/wallet/services/pxe/client.ts`; `packages/aztec-runtime/src/pxe/spec.ts:24-81`; `packages/aztec-runtime/src/pxe/ipxe.ts:27-50`; `packages/aztec-runtime/src/pxe/subset.ts:25-44`; `packages/aztec-runtime/src/pxe/proxy.ts:26-103`; `packages/aztec-runtime/src/pxe/client.ts:76-201`; `packages/aztec-runtime/src/pxe/service.ts:60-82,190-470`
- Evidence: extension clients mechanically implement `return this.request("method", ...args)` even though `Methods` already defines the surface. PXE repeats the same method list as `Methods`, `IPXE`, subset keys, proxy methods, client methods, service registry, and service implementations.
- Why it harms future change: every new or renamed method is a multi-file edit with string-literal drift risk. PXE changes are especially costly because validation/rehydration bodies are also hand-written per method.
- Refactoring: Replace Boilerplate With Typed Proxy / Extract Method Table → `ServiceClient` factory derives passthrough methods; PXE uses one descriptor table to derive `IPXE`, proxy forwarding, RPC names, and zod metadata.
- Effort: days
- Confidence: high

### Q-04 OperationKind Policy And Draft/Executable Operation Models Are Split
- Smell: Switch Statements + Parallel Type Hierarchy
- Lens: mixed
- Impact: architectural · blast radius: 9 files / 25+ policy switches or casts · change-freq: hot
- Convergence: both
- Instances: `apps/extension/src/wallet/services/dapp-interaction/materialize.ts:44-61,76-147`; `apps/extension/src/wallet/services/dapp-interaction/service.ts:293-294,353-391,475-514`; `apps/extension/src/wallet/services/execution/service.ts:377-453`; `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:130-164`; `apps/extension/src/wallet/services/execution/operation-planner.ts:105-139,257-267`; `apps/extension/src/wallet/services/execution/contract-resolver.ts:85-107`; `apps/extension/src/popup/windows/execute/types.ts:33-58`; `apps/extension/src/popup/windows/execute/index.vue:135,330,353,398`; `apps/extension/src/popup/windows/execute/OperationCard.vue:201,205,209,455-472`
- Evidence: `Operation` is a discriminated union, but materialization uses `MaterializedOperation & Record<string, unknown>` and then `as unknown as Operation`; popup has a better `DraftOperation` duplicate. Access level, materialization, session validation, execution dispatch, and UI rendering each switch over the same kind strings.
- Why it harms future change: adding an operation kind requires coordinated edits across materialization, authorization, fee readiness, execution, and UI. Missed access-level entries fall back to `AccessLevel.None`.
- Refactoring: Replace Conditional With Registry → a shared `OperationPolicy` table keyed by `OperationKind`, plus one shared `DraftOperation` and `assertExecutableOperation` exported at the model seam.
- Effort: days
- Confidence: high

### Q-05 Capability Request Flow Erases The `Capability` Union And Mirrors Enforcement Logic
- Smell: Duplicate Code + Type Erasure
- Lens: mixed
- Impact: architectural · blast radius: 4 files / 6 capability types across 4 policy sites · change-freq: hot
- Convergence: both
- Instances: `packages/wallet-bridge/src/capabilities.ts:16-20,53-59`; `packages/wallet-bridge/src/dapp-interaction-protocol.ts:143-153`; `packages/wallet-bridge/src/dispatcher.ts:173-236,240-243,694-916,922-967`; `packages/wallet-bridge/src/method-scope-checkers.ts:42-53,58-190,255-370`
- Evidence: `CapabilityManifest.capabilities?: unknown[]`, `CapabilityResult.granted: unknown[]`, and `Record<string, unknown>` stand-ins force `as unknown as AccountsCapability` / `ContractsCapability` / etc. Coverage predicates in `dispatcher.ts` manually mirror call-time enforcement in `method-scope-checkers.ts`.
- Why it harms future change: a new capability field or type must be added to delta detection, coverage, enrichment, and enforcement. The missed `contractClasses` delta branch shows this drift mode is already real.
- Refactoring: Replace Conditional With Strategy → parse once to `Capability[]`; introduce a `Capability["type"]` keyed table for `parse`, `covers`, `delta`, `merge`, `enrich`, and `check`.
- Effort: days
- Confidence: high

### Q-06 Secret Bytes And Wire Encodings Are Primitive-Typed
- Smell: Primitive Obsession + Stringly-Typed
- Lens: typing
- Impact: architectural · blast radius: 8 files / secret and encoding APIs across crypto + profile · change-freq: warm
- Convergence: both
- Instances: `packages/wallet-crypto/src/encryption-key.ts:11,87,97,114`; `packages/wallet-crypto/src/password-secret-box.ts:57-73,80,96,103,122,136,156-174`; `packages/wallet-crypto/src/passkey-credential.ts:7-14,37,39,53,63`; `packages/wallet-crypto/src/zeroize.ts:33,39,46`; `apps/extension/src/wallet/services/profile/spec.ts:22-35,250-262`; `apps/extension/src/wallet/services/profile/service.ts:80,159,628,817,888,913,924,981`; `apps/extension/src/wallet/services/profile/session-manager.ts:80,202-215`; `apps/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:38-43`
- Evidence: passhash, salt, master secret, ciphertext, guard, credential id, PRF output, and user handle are `ArrayBuffer`, `Uint8Array`, `Buffer`, or `string`. The overloaded `masterKey: string` means password restore uses a base64 master key while passkey restore uses a credential id in the same slot.
- Why it harms future change: a backup/import/profile refactor can swap encodings or byte roles and still type-check; errors appear only at decrypt/restore time.
- Refactoring: Replace Primitive With Branded Types → `Passhash`, `MasterSecretBytes`, `Salt`, `Base64Ciphertext`, `Base64CredentialId`, `Base64SecretPrf`, `HexUserHandle`; split restore payloads by profile type.
- Effort: days
- Confidence: high

### Q-07 Error Taxonomies And Error Projection Are Split And Stringly-Typed
- Smell: Stringly-Typed + Duplicate Code
- Lens: mixed
- Impact: structural · blast radius: 9 files / job, RPC, journal, execution, token import · change-freq: warm
- Convergence: both
- Instances: `packages/wallet-core/src/jobs/types.ts:73-82`; `packages/wallet-core/src/jobs/error.ts:38,53-59`; `packages/wallet-core/src/utils/errors.ts:1,3`; `apps/extension/src/wallet/services/operation-journal/spec.ts:189-190`; `apps/extension/src/wallet/services/operation-journal/reaper.ts:178-184`; `apps/extension/src/wallet/services/execution/execution-lane.ts:260`; `apps/extension/src/wallet/services/execution/mark-failed-unless-cancelled.ts:35`; `apps/extension/src/wallet/services/token/service.ts:568-575`; `apps/extension/src/utils/journal-state.ts:105,164-186,226-266`; `packages/extension-messaging/src/errors.ts:16-20,220-246`; `packages/extension-messaging/src/background/client.ts:134-140`; `packages/extension-messaging/src/offscreen/client.ts:113-117`
- Evidence: `JobError.kind` is a bare `string`; documented values, producers, and UI switches have already drifted. `WalletErrorPayload.details?: unknown` forces per-code casts. `getErrorMessage` and `jobs/error.extractMessage` duplicate hostile-input handling; `makeRemoteError` is byte-identical across both messaging clients.
- Why it harms future change: adding an error category or structured detail requires manual edits across producers, schemas, UI copy, and error rehydration with no exhaustiveness signal.
- Refactoring: Replace Type Code With Open Union → `KnownJobErrorKind | (string & {})`; make `WalletErrorPayload` a code-keyed discriminated union; extract `errorMessageFromUnknown` and shared `remoteErrorFromResponseContent`.
- Effort: days
- Confidence: high

### Q-08 `nulo-schema-patch.ts` Is Triplicated Across Apps
- Smell: Duplicate Code + Untyped Boundary
- Lens: mixed
- Impact: structural · blast radius: 3 files / 9 schema mutations · change-freq: cold
- Convergence: both
- Instances: `apps/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:47-118`; `apps/faucet/src/lib/nulo-schema-patch.ts:24-95`; `apps/playground/src/lib/nulo-schema-patch.ts:23-94`
- Evidence: the executable patch bodies are identical except headers. Each uses `(WalletSchema as any)` to add `registerToken`, `isTokenRegistered`, and `grantPublicAuthwit`. Codex correctly noted the documented tradeoff; the duplication remains real and is only partially pinned by wallet-bridge tests.
- Why it harms future change: adding a fourth custom RPC or adapting to an upstream schema change is a three-copy edit; faucet/playground drift is not caught by the extension-only reachability pin.
- Refactoring: Extract a tiny internal `applyNuloSchemaPatch(schema)` helper or generate the three files from one source, preserving the “do not export wallet-bridge to third-party dApps” constraint.
- Effort: days
- Confidence: moderate

### Q-09 Hex/Base64 Encoding Helpers Are Duplicated And Divergent
- Smell: Duplicate Code
- Lens: dedup
- Impact: structural · blast radius: 8 files / 15+ encoding sites · change-freq: warm
- Convergence: both
- Instances: `packages/wallet-crypto/src/encryption-key.ts:114`; `packages/wallet-core/src/utils/random.ts:7-9`; `packages/bridge-core/src/content-hash.ts:33-43`; `packages/bridge-core/src/recovery-crypto.ts:35-46`; `apps/extension/src/utils/full-backup-helpers.ts:19`; `packages/wallet-crypto/src/password-secret-box.ts:160-161,169,174`; `packages/wallet-crypto/src/passkey-credential.ts:37,39`; `apps/extension/src/wallet/utils/passkey-ceremony.ts:17-23`
- Evidence: byte-to-hex loops repeat the same `b.toString(16).padStart(2, "0")` idiom. Base64 is split between `btoa`/`atob` loops and `Buffer.from(...).toString("base64")`, which also drives representation casts.
- Why it harms future change: removing the Buffer polyfill or fixing encoding behavior requires a repo-wide hunt; edge-case behavior can differ by implementation.
- Refactoring: Extract Function → `bytesToHex`, `toBase64`, and `fromBase64` in `@nulo/wallet-core/utils`, returning the canonical byte representation used by wallet-crypto.
- Effort: hours
- Confidence: high

## Package/Area Findings

### Q-10 Design Prop Contracts Bypass Token Unions And Extension Wrappers Re-Copy Them
- Smell: Primitive Obsession + Shotgun Surgery
- Lens: mixed
- Impact: structural · blast radius: 14 design components + 2 extension wrappers · change-freq: warm
- Convergence: both
- Instances: `packages/design/src/core/Flex.vue:8-41`; `packages/design/src/core/Text.vue:4-19,41-54`; `packages/design/src/core/Icon.vue:9-13,43`; `packages/design/src/core/MaterialIcon.vue:4-14,30`; `packages/design/src/ui/Button.vue:7-24,73-79`; `packages/design/src/ui/Input.vue:15-103,140-216`; `packages/design/src/ui/Badge.vue:4-13`; `packages/design/src/ui/Banner.vue:11-21,37`; `packages/design/src/ui/Checkbox.vue:5`; `packages/design/src/ui/Toggle.vue:4-8,30`; `packages/design/src/ui/Popover.vue:16-40`; `packages/design/src/ui/Tooltip.vue:8-24`; `packages/design/src/ui/SubPageHeaderBase.vue:9-24`; `apps/extension/src/components/ui/Button.vue:18-65`; `apps/extension/src/components/ui/SubPageHeader.vue:7-52`
- Evidence: generated token unions exist, but older primitives expose variant/size/color props as `String` or array-form `defineProps`; `Button` indexes `$style[props.variant]` unguarded. Extension wrappers then re-declare and forward the base contracts in untyped JS, losing any base type safety.
- Why it harms future change: token or variant changes compile with typoed call sites and wrappers can silently drop new base props.
- Refactoring: Replace Primitive With Token Unions → migrate old primitives to typed `defineProps`; export base prop types from design; extension wrappers extend host-only props and forward a typed `baseProps`.
- Effort: days
- Confidence: high

### Q-11 Design Severity/Status Color Vocabulary Is Duplicated
- Smell: Duplicate Code + Primitive Obsession
- Lens: dedup
- Impact: structural · blast radius: 5 files / 4 vocabularies · change-freq: warm
- Convergence: both
- Instances: `packages/design/src/ui/Badge.vue:5,22-40`; `packages/design/src/ui/Banner.vue:12,83-115`; `packages/design/src/ui/Toast.vue:2-17,44-46`; `packages/design/src/composables/toast.ts:13-16`; `packages/design/src/ui/ToastManagerBase.vue:21-27,91-101`
- Evidence: the same status-color idea is `info|warning|error|purple`, `info|done|warning|error`, `ok|error|info`, and raw `red|green|orange`.
- Why it harms future change: adding or recoloring a semantic state requires edits in multiple CSS/JS maps plus caller vocabulary translation.
- Refactoring: Extract Shared Severity Map → `SeverityTone` and token mapping in the design contract; renderers keep their layout but share names and colors.
- Effort: days
- Confidence: high

### Q-12 Token Function ABI Matchers And Function Kinds Are Copy-Paste Catalogs
- Smell: Duplicate Code + Shotgun Surgery
- Lens: dedup
- Impact: architectural · blast radius: 12 files / ~1.3k LOC · change-freq: hot
- Convergence: both
- Instances: `apps/extension/src/wallet/services/token/functions/balance-of-private.ts`; `balance-of-public.ts`; `get-name.ts`; `get-symbol.ts`; `get-decimals.ts`; `transfer-private.ts`; `transfer-public-to-private.ts`; `transfer-public.ts`; `transfer-private-to-public.ts`; `apps/extension/src/wallet/services/token/service.ts:322-371,401-450`; `apps/extension/src/wallet/services/token/spec.ts:17-25,62-104`; `apps/extension/src/wallet/services/token/utils.ts:3-27`
- Evidence: every token function module repeats enum dispatch, `new()`, candidate scoring, ABI literals, artifact predicates, and default selection. The 9-function kind set is re-threaded through service assembly, parsing, `TokenInfo`, and completeness checks.
- Why it harms future change: Aztec ABI predicate changes or new token capabilities require synchronized edits across modules, service blocks, specs, and utils.
- Refactoring: Parameterize Method / Extract Descriptor Registry → one `TokenFnDescriptor` table with shared ABI builders, scoring, candidate predicates, pack/unpack hooks, and iteration over the 9 kinds.
- Effort: days
- Confidence: high

### Q-13 Entity Restore, ID Allocation, Ownership Guards, And Cascades Are Reimplemented Per Service
- Smell: Boilerplate-Per-Consumer + Duplicate Code
- Lens: dedup
- Impact: structural · blast radius: 10 files / 60+ repeated scaffold sites · change-freq: hot
- Convergence: both
- Instances: `apps/extension/src/wallet/services/token/service.ts:186,521,535,543,552`; `token-balance/service.ts:264,275`; `token-balance/balance-repository.ts:42`; `fpc/service.ts:81,198,225,265,290,312,377,397,425,450,472,491`; `network/service.ts:238-487,634,661,691`; `account/service.ts:59,105,208,227,242`; `auth-registry/service.ts:82,151,421,429,438`; `contact/service.ts:72,99,128,157,248,274,285,294`; `incoming-transfer/service.ts:201`; `apps/extension/src/utils/full-backup-helpers.ts:73,94`
- Evidence: restore loops repeat `try/catch → toRestoreError → Restored<T>[]`; numeric IDs use repeated `array_max(...) + 1`; string IDs use repeated `while contains getRandomHex`; profile ownership checks and delete cascades are open-coded per service.
- Why it harms future change: restore error shape, collision policy, profile-scoped delete behavior, or audit logging becomes a multi-service edit with per-service drift.
- Refactoring: Form Template Method / Extract Repository → shared `restoreRows<T>()`, ID allocator strategies, and `ProfileScopedRepository` helpers for `requireOwned` and profile delete cascades.
- Effort: days
- Confidence: high

### Q-14 Popup And dApp Approval Windows Duplicate Lifecycle Shells
- Smell: Duplicate Code + Shotgun Surgery
- Lens: dedup
- Impact: structural · blast radius: 29 popups + 3 dApp windows · change-freq: hot
- Convergence: both
- Instances: `apps/extension/src/popup/windows/execute/index.vue:267-268,377,416-446,495-525`; `apps/extension/src/popup/windows/capabilities/index.vue:232,245-273,359-389`; `apps/extension/src/popup/windows/discover/index.vue:124,140-168,198-228`; popup keydown/lifecycle/error copies in `NewNetworkPopup.vue:113`, `NewFpcPopup.vue:58-121,181-202`, `NewAccountPopup.vue:84`, `EditFpcPopup.vue:99-189,277-291`, `NewEndpointPopup.vue:77`, `EditProfilePopup.vue:90,110`, `ChangeAuthwitsRegistryPopup.vue:103,110`, `EditAccountPopup.vue:74`, `RevokeAuthwitsPopup.vue:156,163`, `NewContactPopup.vue:95-181,266-287`, `EditNetworkPopup.vue:88`, `NewSenderPopup.vue:83,95`, `ImportContactsPopup.vue:131`, `NewTokenPopup.vue:274-296`, `EditContactPopup.vue:143-348,437-458`
- Evidence: dApp windows repeat interaction/profile client setup, session wait, auth redirect, beforeunload rejection, completion cleanup, and processing-error UI. Popup SFCs repeat connect-on-show/disconnect-on-hide, Enter-key handlers, and error tooltip blocks.
- Why it harms future change: cancellation semantics, beforeunload behavior, disconnect ordering, or keyboard submit fixes must be applied across many SFCs.
- Refactoring: Extract Template Method / Composable → dApp window shell for session/cancel/beforeunload; `usePopupEntity` plus FormPopup-level submit/error handling for popups.
- Effort: days
- Confidence: high

### Q-15 Execution Send Paths Duplicate Slot/Journal Scaffolding And Aztec Payload Normalization
- Smell: Duplicate Code + Long Method
- Lens: dedup
- Impact: architectural · blast radius: 5 files / 10 repeated blocks · change-freq: hot
- Convergence: both
- Instances: `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:150-162,204-254,291-417,444-604`; `apps/extension/src/wallet/services/execution/transfer-executor.ts:130-237`; `apps/extension/src/wallet/services/execution/operation-planner.ts:166-250`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:412-424`; `packages/wallet-bridge/src/operation.ts:59-70`
- Evidence: send executors repeat acquire-slot, claim journal, cancellation, simulating checkpoint, catch/finally release, transaction recording, and authwit discovery. Standard and no-from Aztec payload paths parse capsules/authwits/fee gas settings in parallel.
- Why it harms future change: concurrency/cancel ordering is load-bearing; a missed scaffold update can leak a lane slot or mis-record a transaction. Upstream Aztec payload changes must be threaded through multiple parsing paths.
- Refactoring: Form Template Method → `lane.withExecutionSlot(...)` owns journal/cancel/finally; shared `recordTransaction` builder; shared `parseAztecPayloadParts` and `projectFeeOptions`.
- Effort: days
- Confidence: high

### Q-16 `AppServices` Lies About Lazily Assigned Clients
- Smell: Temporal Coupling + Lying Types
- Lens: typing
- Impact: structural · blast radius: 1 type plus ~44 popup reads · change-freq: warm
- Convergence: claude-only
- Instances: `apps/extension/src/utils/core.ts:44-50,75-77,132-139`
- Evidence: `AppServices` declares `network`, `transaction`, and `account` as required clients, but `createAppServices()` initializes them as `null as unknown as Client` until unlock/init code assigns them.
- Why it harms future change: new popup code can dereference a lazy client before unlock with no compile-time warning.
- Refactoring: Replace Type Lie With Honest Optionality → split eager/lazy services or type lazy clients as `Client | undefined` and provide asserted accessors at real chokepoints.
- Effort: days
- Confidence: high

### Q-17 Profile Service Defines `runExclusive` But Bypasses It In 22 Lock Blocks
- Smell: Duplicate Code
- Lens: dedup
- Impact: structural · blast radius: 1 large facade / 22 lock pairs · change-freq: warm
- Convergence: claude-only
- Instances: `apps/extension/src/wallet/services/profile/service.ts:113-120`; bypasses at `143/148,162/181,203/213,232/250,282/308,323/330,340/353,377/393,440/443,450/453,460/476,483/529,543/550,589/616,674/695,805/808,819/834,851/873,926/960,988/1021,1057/1106`
- Evidence: the helper already implements `lock.enter()` / `try` / `finally lock.leave()`, but facade methods paste the same structure inline.
- Why it harms future change: changing lock behavior, telemetry, or reentrancy handling is a 22-site edit; one missed `finally` wedges profile RPCs.
- Refactoring: Apply Existing Extract Method → route facade lock sections through `runExclusive`, with outer `finally` only for zeroization where needed.
- Effort: hours
- Confidence: high

### Q-18 Aztec Runtime Duplicates Artifact Class-Id Work Across Loaders
- Smell: Duplicate Code
- Lens: dedup
- Impact: structural · blast radius: 2 files / 4 artifacts double-loaded and double-hashed · change-freq: cold
- Convergence: both
- Instances: `packages/aztec-runtime/src/pxe/known-artifacts.ts:13-21,40-68`; `packages/aztec-runtime/src/pxe/note-schemas.ts:3-8,66-83`
- Evidence: Token, NFT, Wonderland Token, and Private FPC artifacts are imported/loaded in both files, and `getContractClassFromArtifact` computes the same class ids under two cache regimes.
- Why it harms future change: artifact alias or Aztec class-id changes can leave note schemas keyed differently than known artifact resolution.
- Refactoring: Extract Known Artifact Catalog → one loader owns artifact, class id, optional instance, and note schema metadata.
- Effort: hours
- Confidence: high

### Q-19 PXE Factory Modes And Chain Coordinates Are Primitive/Repeated
- Smell: Boolean Blindness + Data Clump
- Lens: mixed
- Impact: structural · blast radius: 3 files / 10 repeated mode or key sites · change-freq: cold
- Convergence: claude-only
- Instances: `packages/aztec-runtime/src/pxe/chain-runtime.ts:26-40,103-117,123,142-190,215,291`; `packages/aztec-runtime/src/pxe/service.ts:127,156-180,458-467,521,530-534`; `packages/aztec-runtime/src/pxe/artifact-registry.ts:13-17,162`
- Evidence: `ProductionPxeFactoryOptions` allows illegal boolean combinations checked only at runtime; `(profileId, chainId)` is encoded as both `profileId:chainId` and `pxe/profile/chain` in multiple places; `NetworkInfo` names two different shapes.
- Why it harms future change: new PXE modes or DB path layout changes require hunting optional flags and string literals; profile cleanup can drift from runtime registry keys.
- Refactoring: Replace Flags With Discriminated Union; Introduce `ChainCoordinates` / key codec; remove or rename the unused registry `NetworkInfo`.
- Effort: hours
- Confidence: high

### Q-20 Config Store Uses Reflective Double-Casts Instead Of A Schema
- Smell: Reflective Access + Schema/Type Drift
- Lens: typing
- Impact: local · blast radius: 2 files / persisted config seam · change-freq: warm
- Convergence: claude-only
- Instances: `apps/extension/src/wallet/config/store.ts:14,35,47-52`; `apps/extension/src/wallet/config/config.ts`
- Evidence: config loading treats `Config` as `Record<string, unknown>` and validates by `typeof src[key] === typeof dst[key]`; literal unions like theme are only checked as strings.
- Why it harms future change: a corrupt or migrated string value can load as a valid config prop even if it is outside the domain union.
- Refactoring: Replace Reflection With Schema → zod schema as the source of `Config`, `ConfigProp`, and persisted validation.
- Effort: hours
- Confidence: moderate

### Q-21 Host Utility Seam Has Two Small Real Drifts, Not A Broad Adapter Failure
- Smell: Schema/Type Drift + Duplicate Code
- Lens: mixed
- Impact: local · blast radius: 4 files / 2 concrete drifts · change-freq: warm
- Convergence: both
- Instances: `apps/extension/src/core/adapters/chrome-browser-api.ts:136-137`; `packages/wallet-core/src/ports/runtime-port.ts:52-54`; `apps/extension/src/utils/files.ts:71-72`; `apps/extension/src/utils/general.js:21,32`; `apps/extension/src/utils/general.d.ts:7,9`
- Evidence: synthesized split resolution: the Chrome adapter’s double-casts are localized and correct, and popup utilities may use `chrome.*`. The real findings are narrower: `lastError` is re-shimmed outside the port with `as any`, and `general.js` has a hand-maintained `.d.ts` type shadow.
- Why it harms future change: host API typing changes require edits in both the adapter and `files.ts`; `general.js` signatures can drift from `general.d.ts` with no compiler check.
- Refactoring: Reuse the `RuntimePort.lastError` helper or extract one lastError reader; migrate `general.js` to `general.ts` and delete the declaration shadow.
- Effort: hours
- Confidence: moderate

### Q-22 Cross-Package Documentation Drift Misstates Version, Architecture, And Crypto Constants
- Smell: Comment Drift
- Lens: mixed
- Impact: cosmetic · blast radius: 8 docs/comments · change-freq: cold
- Convergence: claude-only
- Instances: `packages/aztec-runtime/README.md:62`; `packages/aztec-runtime/src/pxe/service.ts:362`; `packages/wallet-bridge/README.md:284`; `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:91,355`; `packages/wallet-crypto/README.md:17`; `packages/wallet-crypto/src/encryption-key.ts:2`; `packages/wallet-crypto/src/password-secret-box.test.ts:132`; `packages/extension-messaging/README.md`; `packages/wallet-core/README.md`; `packages/wallet-core/tsconfig.json:11`
- Evidence: Aztec docs/comments still cite `4.2.0` while package pins are `5.0.0-rc.1`; wallet-crypto README says PBKDF2 250k while source is `600_000`; extension-messaging README omits the `core/` correlator and stale error behavior; wallet-core README says `types: []` while tsconfig has `["node"]`.
- Why it harms future change: stale architecture maps and constants mislead future maintainers and audit agents, especially around security-relevant KDF cost and Aztec compatibility.
- Refactoring: One doc sweep; optionally add a doc-lint pin for PBKDF2 iteration text.
- Effort: hours
- Confidence: high

## Cheapest High-Value Fixes

1. `Q-17` Apply `runExclusive` in `profile/service.ts`: hours, structural risk reduction, no public API change.
2. `Q-18` Extract aztec-runtime artifact catalog: hours, removes double class-id hashing and cache drift.
3. `Q-19` Convert `ProductionPxeFactoryOptions` to a discriminated union: hours, eliminates illegal mode states.
4. `Q-09` Add `bytesToHex` / `toBase64` / `fromBase64`: hours, broad cleanup and removes several byte casts.
5. `Q-07` Extract shared `remoteErrorFromResponseContent` and `errorMessageFromUnknown`: hours, deletes duplicated error projection.
6. `Q-10` Type `Checkbox` and `ButtonVariant/ButtonSize` first: hours-to-day, immediate design contract wins before full token migration.
7. `Q-21` Move `general.js` to `general.ts` and centralize `lastError`: hours, removes a production JS/type shadow.
8. `Q-20` Replace config reflection with a schema: hours, aligns config with the service graph’s validation idiom.

## Findings NOT Pursued

- `MethodsMap` base `any[]` alone: locally justified variance constraint; real downstream issue is captured in `Q-02`.
- `useFormState`: casts are encapsulated mapped-type builder mechanics; public inference is precise.
- `useEntityCrud<T>` and settings `*-helpers.ts`: CRUD mechanics are already centralized; remaining helpers are per-entity domain formatting/sort logic.
- Blanket “Chrome adapter is unsafe”: falsified; adapter casts are localized compatibility shims. Only `lastError` duplication and `general.js` shadow are kept in `Q-21`.
- Fee strategy similarity: real but guarded by parity tests and lower leverage than execution slot/payload duplication; revisit when adding a new fee kind.
- `Flex`/`Text`/`Icon` class-builder boilerplate: incidental similarity; abstraction would be noisier than inline code.
- Two toast renderer existence: intentional faucet item vs extension singleton split; only shared severity vocabulary is scored in `Q-11`.
- `Input.vue` modelValue cast cascade: concrete but explicitly pinned to preserve broad model contract; lower value than typing the public token props.
- `ClockPort.TimerHandle = unknown`: small local adapter friction; not enough blast radius for this consolidated set.
- Empty root barrels / dead export paths: cosmetic only.
- Vendored `serialization.ts` and BIP39 table: deliberate dependency-boundary/data choices, not maintainability findings.
- Test/fake `as unknown as` clusters: excluded unless production-wired.
- PXE IndexedDB delete-wrapper duplication and `[SYNC-DEBUG]` blocks: concrete local cleanup, but lower priority than the PXE method surface and chain-coordinate finding.
- `nulo-schema-patch` “not a finding” position: rejected for reduce output. The tradeoff is documented, but the three executable copies and `as any` schema mutations are still real maintainability debt, scored as `Q-08` with moderate action confidence.