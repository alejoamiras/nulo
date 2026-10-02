# Outer repo map (apps/extension + 10 packages), branch dev, 2026-09-30

Scope verified via `git ls-files packages`: exactly 10 tracked packages (no bridge-core). LOC = non-test/story/.d.ts lines of .ts/.vue/.js (approximate; includes some generated files noted in section 4).

## 1. Workspaces
| Workspace | Purpose | Prod LOC | Workspace deps (package.json) |
|---|---|---|---|
| apps/extension | Vue 3 MV3 wallet: popup/onboarding/windows UI + background SW services (`src/wallet/services/*`) + offscreen | ~101k (src, incl. .vue) | all 10 packages |
| wallet-core | Base layer: storage (EntityStorage/ValueStorage), migration engine, ports, base service/job classes, logger interfaces, utils (lock, keyed-lock, queue, deferred, sleep, encoding, error-json, mnemonic, rw-guard, alarm-dispatcher), activity | ~6.0k | none |
| aztec-runtime | PXE client/service, OPFS store, frozen account contract/address freeze, offscreen entry, fee-juice, adapters | ~5.1k | extension-messaging, wallet-core, wallet-crypto, resolve-asset |
| wallet-bridge | wallet-sdk dispatcher, method-scope checkers, discovery queue (dApp <-> wallet transport) | ~4.4k | extension-messaging, wallet-core, wallet-sdk-schema-patch |
| design | L0-L2 design system: tokens (generated), base.css, fonts, core/ui/composite SFCs, composables | ~4.0k | none |
| extension-messaging | RPC client/server, background/offscreen channels, `WalletError` hierarchy (errors.ts), messages, zod helpers | ~2.8k | wallet-core |
| wallet-crypto | KDF/AES/sealed secrets, passkey PRF, branded secret types | ~1.5k | wallet-core |
| third-party-notices | Build-time THIRD-PARTY-NOTICES generator + licence policy | ~1.2k | design, resolve-asset |
| legal | Terms/privacy versions, consent strings, status derivation | ~0.26k | none |
| resolve-asset | Resolve package files from caller location (isolated linker safe) | ~0.18k | none |
| wallet-sdk-schema-patch | Adds registerToken/isTokenRegistered/grantPublicAuthwit to WalletSchema (`./apply`, `./register`) | ~0.14k | none |

### Public exports (package.json `exports`; all point at raw `src/*.ts`)
- wallet-core: `.`, `./ports`, `./testing`, `./utils`, `./storage`, `./migration`, `./base`, `./logger`(interfaces.ts), `./jobs`, `./activity`
- wallet-crypto: `.` only
- extension-messaging: `.`, `./background`, `./offscreen`, `./errors`, `./messages`, `./utils`, `./zod`, `./testing`
- aztec-runtime: `.`, `./pxe`, `./pxe/public-events`, `./account`, `./ports`, `./adapters`, `./utils`, `./offscreen/entry`, `./fee-juice`
- wallet-bridge: `.` only
- design: `.`, `./tokens`, `./base.css`, `./core/*`, `./ui/*`, `./composite/*`, `./composables/*`, `./testing`
- legal, resolve-asset, third-party-notices: `.` only; wallet-sdk-schema-patch: `./apply`, `./register` (no `.`)

## 2. Import direction (verified from `from "@nulo/*"` in non-test source)
Counts = import statements.
- wallet-core -> none
- wallet-crypto -> wallet-core (7)
- extension-messaging -> wallet-core (25)
- aztec-runtime -> extension-messaging (5), wallet-core (15), wallet-crypto (3); resolve-asset only in tests/declared (no src import found; check package.json usage, possibly build-script/vite path)
- wallet-bridge -> extension-messaging (3), wallet-core (4); schema-patch declared (side-effect import, not matched by `from` regex)
- third-party-notices -> resolve-asset (tests); design declared
- extension -> wallet-core 346, extension-messaging 163, wallet-bridge 74, design 55, aztec-runtime 53, wallet-crypto 45, legal 19, resolve-asset 8, third-party-notices 1 (+ schema-patch side-effect)
- design, legal, resolve-asset, schema-patch -> none

Layering verdict: NO upward/violating package imports found. Documented chain `wallet-core -> wallet-crypto -> extension-messaging -> aztec-runtime -> wallet-bridge -> extension` is a coarse order, not strict: actual edges are wallet-crypto->core, messaging->core only (messaging does NOT import wallet-crypto, fine; it is a partial order). wallet-bridge correctly does not import aztec-runtime. Not documented in the chain but real: design/legal/resolve-asset/schema-patch/third-party-notices are leaf-ish side packages. Worth a grep by the auditor: `apps/extension` reaching into package internals via deep paths (not checked).

## 3. Similarity candidates (concrete evidence)
A. Hex encoding duplicated (3+ copies of bytes->hex; wallet-core owns `bytesToHex`):
 - packages/wallet-core/src/utils/encoding.ts:10 `bytesToHex` (canonical)
 - apps/extension/src/wallet/services/activity-protocol/coordinator.ts:52 `mintNonce` inline `[...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")`
 - apps/extension/src/wallet/services/profile/spec.ts:107 `mintPxeGeneration` inline `Array.from(bytes,...padStart(2,"0")).join("")`
 - packages/aztec-runtime/src/account/account-export.ts:80 `Buffer.from(sha256(...)).toString("hex")`
 - packages/wallet-core/src/utils/random.ts:9 `getRandomHex` (same concern as the two mint* functions above: random N bytes -> hex)
 - apps/extension/src/wallet/utils/passkey-ceremony.ts:41,139 `Buffer.from(userHandle,"hex")` (no fromHex helper exists in wallet-core)
B. Base64 encoding: wallet-core has `toBase64`/`fromBase64` (utils/encoding.ts:21,34; comment says byte-identical to Buffer) yet bypassed by:
 - apps/extension/src/wallet/services/profile/service.ts:1718,1876-1878,2063,2072,2310,2321,2341 `Buffer.from(x).toString("base64")` / `Buffer.from(s,"base64")` (~10 sites)
 - apps/extension/src/wallet/services/dapp-session/integrity.ts:59 `Buffer.from(mac,"base64")`
 - apps/extension/src/wallet/services/account/service.ts:439 `Buffer.from(master,"base64")`
 - packages/aztec-runtime/src/pxe/client.ts:208 `btoa(String.fromCharCode(...provision.key))` and pxe/service.ts:817 `Uint8Array.from(atob(...))` (the exact stack-overflow pattern encoding.ts:17 warns about)
 - apps/extension/src/popup/app.vue:375 `btoa(LogoIcon)`
C. Promise-with-timeout / race-with-deadline reimplemented 6+ times (no shared helper):
 - apps/extension/src/stores/balances.store.ts:124 exported `withTimeout`
 - apps/extension/src/popup/auth-guard.ts:85 `withinDeadline` (race + clearTimeout in finally)
 - apps/extension/src/components/Header.vue:35-43 (race `read` vs `expired`, clearTimeout finally)
 - apps/extension/src/components/JsonViewer/LogsViewer.vue:195; apps/extension/src/composables/importChainSync.ts:115; importPreflight.ts:41; wallet/utils/offscreen.ts:333
 - packages/aztec-runtime/src/pxe/opfs-store.ts:127 (+ private `ChainStoreOpenTimeoutError`); packages/extension-messaging/src/core/base-client.ts:298
D. sleep/delay: wallet-core `sleep` (utils/sleep.ts:1) vs private copy apps/extension/src/e2e/migration-fixture.ts:41 (e2e fixture, src-side); backoff loops balances.store.ts:618 and token/seeder.ts:623 hand-roll delay math.
E. `isRecord` type guard redefined 4x: apps/extension/src/popup/windows/capabilities/details-table.ts:88, permission-rows.ts:253; packages/wallet-bridge/src/dispatcher.ts:307, method-scope-checkers.ts:395; near-variant `isPlainObject` packages/legal/src/status.ts:66. No shared export in wallet-core/utils.
F. Error classes / serialization:
 - `WalletError` hierarchy in packages/extension-messaging/src/errors.ts (~25 classes) vs ad-hoc `extends Error` classes outside it: extension unlockWait.ts `UnlockTimeoutError`/`BootstrapFailedError`; utils/files.ts:82 `FileTooLargeError`; utils/full-backup-helpers.ts:104 `AssemblyAbortedError`; account/spec.ts:68 `ImportedAccountUnusableError`; execution-mutex.ts:37,49 (`...AbortError`,`...CapacityError`); token/seeder.ts:12 `PinMismatchError`; transaction/spec.ts:223 `TxConfirmationTimeoutError`; aztec-runtime pxe/effective-class.ts:23 `ContractUpgradedError`, pxe/opfs-store.ts:37,54,65 (`WrongStoreKeyError`,`ChainStoreWedgedError`,`ChainStoreOpenTimeoutError`). Similar concern (typed failure + timeout/abort) in two homes; check whether they need wire serialization (wallet-core utils/error-json.ts + errors.ts `errorMessageFromUnknown`).
 - Error-message helpers: wallet-core utils/errors.ts:8 `errorMessageFromUnknown`; extension wallet/services/account-state/normalize.ts:85 `truncateErrorMessage`; balances.store.ts:124 builds its own timeout Error.
G. Locks/queues/serialization primitives: wallet-core `Lock` (utils/lock.ts), `KeyedLock` (keyed-lock.ts), `Queue` (queue.ts) vs extension `ExecutionMutex` (wallet/services/execution/execution-mutex.ts:70), `BalanceJobQueue` (wallet/services/token-balance/balance-job-queue.ts:74), wallet-bridge `DiscoveryQueue` (src/discovery-queue.ts:42), extension utils/coalesce.ts (single-flight), wallet-core `jobs/`. Candidate overlap: mutex + bounded queue + abort.
H. Canonical JSON / stable stringify: apps/extension wallet/services/dapp-session/integrity.ts:34 `stableStringify` vs packages/aztec-runtime/src/account/account-export.ts (`canonical` serialization, ~line 80) vs wallet-core utils/serialization.ts.
I. Storage wrappers: wallet-core storage/{entity_storage,value_storage,prefixed-entries,memory-storage-area}.ts + ports/storage-port.ts vs extension utils/storage.ts (migration-aware facade, by design), wallet/storage/index.ts, dapp-session/mac-storage.ts, popup/constants/storage-keys.ts, e2e/chrome-storage-*.ts (4 near-sibling gates + storage-gate.ts; also tests/e2e/fixtures/{incoming-poll-gate,proof-gate,restore-gate,token-seeds}.ts mirror them).
J. Logging/redaction: wallet-core logger/{index,interfaces}.ts vs extension wallet/logger/{index,store,utils,console-forwarding}.ts + wallet/services/logger/{client,service,spec}.ts + utils/console-sniffer.ts + utils/scrub-urls.ts. Layered on purpose; check for repeated key-name redaction lists.
K. Zod: schema specs in 20+ extension `wallet/services/*/spec.ts` plus aztec-runtime pxe/{schemas,public-events,client,service}.ts, extension-messaging zod-helpers.ts, schema-patch apply.ts, extension wallet/utils/raw-row.ts, wallet-sdk/content-script-validator.ts. Look for repeated primitives (hex string, address, bigint/Fr coercion, `0x`+64hex) re-declared per spec vs `zod-helpers.ts`; extension utils/string.ts:28 `isValidHex` and aztec-runtime pxe/note-schemas.ts:31 `canonicalSlotHex` are separate hex validators.
L. Extension-local "util" sprawl that may shadow package helpers: apps/extension/src/utils/{core,general,string,coalesce,files,password}.ts (not read in depth) vs wallet-core utils/*; `useSecretCountdown.ts:23` and `PrestoStatusCard.vue:17` both hand-roll padStart(2,"0") formatting.
M. Design tokens mirrored: packages/design/src/tokens.ts (generated) re-exported by apps/extension/src/design/tokens.ts; design/src/fonts/*.woff2 duplicated at apps/extension/src/assets/fonts/*.woff2 (same 5 filenames).

## 4. Exclude from finding eligibility
Generated / vendored / fixtures:
- packages/design/src/tokens.ts, packages/design/src/base.css (generated by packages/design/scripts/gen-tokens.ts from token-contract.ts; hash/drift-pinned), packages/design/src/fonts/*.woff2, apps/extension/src/assets/fonts/*.woff2
- apps/extension/src/types/auto-imports.d.ts, components.d.ts, .eslintrc-auto-import.json
- packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json + PROVENANCE.md (byte-exact vendored, frozen)
- apps/extension/src/wallet/services/token/default-tokens.ts (data mirror of deployed addresses), any `*.snap`, apps/extension/src/wallet/services/wallet-sdk/queued-journal.fixtures.ts
- packages/third-party-notices output (THIRD-PARTY-NOTICES.txt, build-emitted)
- Test/e2e harness (separate gate; eligible only for test-specific findings): apps/extension/tests/**, apps/extension/src/e2e/** (in-extension test gates, shipped only under test builds), all `*.test.ts`, `*.stories.*`, `*.fixtures.ts`, packages/*/src/testing/**
- Out of scope entirely: apps/tools, packages/bridge-core, apps/landing, apps/playground, infra/, implementations-plan/ (docs), the untracked audit/ dir.
- Existing deliberate complexity acceptances (biome-ignore `accepted at score N`, manifest scripts/complexity-baseline/manifest.json) are not findings.
