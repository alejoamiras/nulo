# Repo map — `apps/extension/src/{utils,wallet(excl. services),e2e}`

Scope: `apps/extension/src/utils`, `apps/extension/src/wallet` (excluding `wallet/services/`), `apps/extension/src/e2e`. `*.test.ts` excluded.

## 1. Inventory

### `src/utils/` (24 files, ~2,300 LOC)
| path | purpose | LOC |
|---|---|---|
| amount.ts | Base-units parse/format for token amounts; legacy `comma()` formatter | 277 |
| journal-state.ts | Journal record → terminal display / card-props mapping | 353 |
| files.ts | File download/picker + gzip compress/decompress + MIME map | 273 |
| full-backup-helpers.ts | Pure helpers for backup-file selection/parsing | 192 |
| core.ts | Popup-side lazy service-client registry (`managers` proxy) | 183 |
| tx-enrichment.ts | Tx call → human label/trim, re-exports primary-method.ts | 174 |
| fee-estimation.ts | Fee Juice display formatting + USD conversion (builds on amount.ts) | 140 |
| transfer-intent.ts | "Do-not-guess" parser for sendTx call args | 132 |
| activity-rows.ts | Merges tx/journal/incoming-transfer into one feed | 101 |
| primary-method.ts | Filters wallet-injected fee/entrypoint methods from call lists | 99 |
| guarded-network-activation.ts | Serializes network-activation attempts per popup realm | 86 |
| contacts-export-format.ts | Contacts JSON export schema v1/v2 | 69 |
| storage.ts | Migration-aware `chrome.storage.local` facade (the ONLY sanctioned path) | 66 |
| received-display.ts | Incoming-transfer record → label/"From" display | 55 |
| in-flight-send.ts | Guard blocking account switch while a send is in flight | 57 |
| incoming-dust.ts | USD-dust filter for incoming-receive feed (bigint cross-mult.) | 45 |
| card-subtitle.ts | JobStage → subtitle map for in-flight cards | 35 |
| string.ts | capitalize/trimAddress/getInitials/isValidHex/sanitizeString/stringCompare | 41 |
| console-sniffer.ts | Buffers console.* calls pre-handler-attach | 32 |
| console-sniffer.ts | console.* override buffer, drains once popup attaches a handler | 32 |
| general.ts | Theme dark-mode probe + paint-hint + `debounce` | 30 |
| chain-ids.ts | `walletChainId` — the one chainId derivation, both shells | 24 |
| confirmation-policies.ts | Dapp-confirmation policy list keyed by AccessLevel | 27 |
| lastActiveProfile.ts | Persisted last-active-profile-id getter/setter | 16 |
| restore-error.ts | Normalize a caught value to a display string | 15 |
| index.ts | Barrel: re-exports only `files.ts` + `string.ts` (partial) | 2 |

### `src/wallet/` excl. services (22 files, ~1,900 LOC)
| path | purpose | LOC |
|---|---|---|
| runtime.ts | Composition root — wires all services from injected ports | 342 |
| utils/offscreen.ts | Offscreen document/window lifecycle (create/health/close, single-flight) | 342 |
| utils/passkey-ceremony.ts | WebAuthn ceremony runner shared by both passkey UI paths | 151 |
| wallet/index.ts | Shell wiring: real adapters → `createWalletRuntime().start()` | 101 |
| logger/store.ts | `LoggerStore`: circular buffer + level filter + flush | 100 |
| config/store.ts | `ConfigStore`: validated get/set/reset over `ValueStorage` | 99 |
| utils/onboarding-tab.ts | Open/focus onboarding tab, cross-context single-flight lock | 89 |
| storage/migrations/template.ts | Copy-paste starting point for new migrations | 88 |
| utils/create-passkey-profile.ts | Passkey-profile creation w/ conflict-retry handshake | 57 |
| constants/explorers.ts | Block-explorer URL templates per network | 57 |
| storage/migrations/index.ts | Real-migration registry + baseline/degraded/blocked constants | 59 |
| utils/passkey-label.ts | WebAuthn display-name sanitizer/formatter | 54 |
| utils/auth-registry.ts | AuthRegistry storage-slot derivation helpers | 64 |
| config/config.ts | `Config` zod schema + defaults | 69 |
| utils/fn.ts | `Fn`/`ViewFn` contract-call wrapper classes + `simulate` | 127 |
| logger/utils.ts | Log trim/print/CircularBufferIterable helpers | 135 |
| utils/caip.ts | Re-exports CAIP helpers from `@nulo/wallet-bridge` | 42 |
| utils/fee-juice.ts | Fee Juice address/artifact/name constants | 23 |
| utils/index.ts | Barrel: re-exports `@nulo/wallet-core/utils` + Aztec-safe helpers | 17 |
| config/index.ts | `IConfigStore` interface | 16 |
| base/index.ts | Re-export of `@nulo/wallet-core/base` | 5 |
| logger/index.ts | Re-export of `@nulo/wallet-core/logger` | 13 |
| storage/index.ts | Re-export of `EntityStorage`/`ValueStorage` from wallet-core | 9 |

### `src/e2e/` (7 files, ~460 LOC) — all test-only scaffolding, tree-shaken from prod
| path | purpose | LOC |
|---|---|---|
| chrome-storage-incoming-poll-gate.ts | `chrome.storage.session`-backed impl of IncomingPollGate | 116 |
| chrome-storage-proof-gate.ts | `chrome.storage.session`-backed impl of ProofGate | 88 |
| migration-fixture.ts | E2E fixture for the live-storage migration engine | 77 |
| config.ts | `E2E_PROVERLESS`/build-stamp constants | 65 |
| incoming-poll-gate.ts | Pure `IncomingPollGate` interface (port) | 47 |
| backup-migration-fixture.ts | E2E fixture for the backup-import migration engine | 34 |
| proof-gate.ts | Pure `ProofGate` interface + `NOOP_PROOF_GATE` (port) | 33 |

## 2. Grab-bags
- **`utils/files.ts`** (273 LOC): bundles DOM file-download/picker UI helpers with Web-Streams gzip compress/decompress and a MIME table — three barely-related concerns under one "files" name.
- **`utils/general.ts`** (30 LOC, minor): dark-mode/theme-paint-hint + a generic `debounce`. Small, but no thematic link between the two exports.
- `utils/index.ts` is a misleadingly partial barrel — only re-exports `files.ts` + `string.ts`, not the other 22 files in the dir, so `@/utils` imports are inconsistent (some via barrel, most via direct path).

## 3. Coupling surfaces
- Clean layering: only 4 files reach `@nulo/*` from `utils/`; `wallet/` reaches `@nulo/wallet-core/{utils,migration,ports,base,logger,storage}`, `@nulo/wallet-crypto`, `@nulo/wallet-bridge` (via `caip.ts` re-export), `@nulo/extension-messaging/errors`, `@nulo/aztec-runtime/{account,pxe,utils}`.
- `wallet/utils/index.ts` and `wallet/base|logger|storage/index.ts` are deliberate re-export shims over `@nulo/wallet-core/*` — evidence of prior dedup, not new duplication.
- `utils/core.ts` reaches across into `wallet/services/*/client` (5 service clients) — expected (it's the popup's service-client registry) but means `utils/` is not purely leaf-level.
- `e2e/*` gate pairs (`proof-gate.ts`/`chrome-storage-proof-gate.ts`, `incoming-poll-gate.ts`/`chrome-storage-incoming-poll-gate.ts`) are a deliberate port/adapter split, not duplication — confirmed by reading both members of each pair.

## 4. Duplication candidates (audit focus)

**A. Two competing amount-formatting implementations inside `utils/amount.ts` itself.**
`comma(target, symbol=",", fixed=2)` (`apps/extension/src/utils/amount.ts:11-37`) reimplements thousands-separator + trailing-zero-trim formatting via `Number.parseFloat`/`toFixed` (float-based), while `formatBaseUnits()` (`amount.ts:229-277`) does the same job as pure bigint math with an explicit truncate-only rounding contract documented at length. `comma()` is still live at 4 call sites — `apps/extension/src/components/composite/send/AmountCard.vue:107,155` and `apps/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:109,199` — all formatting token *balances*, the exact use case `formatBaseUnits`/`balanceFormatted` already cover. Two different rounding/precision behaviors for the same display job is a correctness risk, not just style debt.

**B. Address truncation reimplemented ~8x outside the canonical helper.**
`trimAddress(address, start=8, end=4)` lives in-scope at `apps/extension/src/utils/string.ts:6-9`, but the identical `${addr.slice(0,6)}...${addr.slice(-4)}` pattern (note: different width, start=6 not 8) is hand-rolled inline in at least: `popup/windows/verify/index.vue:44`, `popup/components/popups/AccountsPopup.vue:76`, `popup/windows/capabilities/AccountSelectRow.vue:51`, `popup/components/popups/ReceivePopup.vue:64`, `popup/pages/settings/connected-apps/[id].vue:231`, `popup/components/modules/general/TokenImportRow.vue:27`, `popup/pages/journal/[id].vue:125`, `popup/pages/settings/accounts/index.vue:79`, `components/Header.vue:250`. These consumers are outside this map's scope (popup/components) but the canonical util is in-scope and effectively unused for its intended job; `trimAddress` may also need a `(addr, 6, 4)` call-site convention added since none of the duplicates match its default width.

**C. Parallel "activity/tx display" mapping files with overlapping responsibility.**
`journal-state.ts` (353 LOC), `card-subtitle.ts`, `primary-method.ts`, `tx-enrichment.ts`, and `activity-rows.ts` all independently solve slices of "map a raw record (job/tx/journal) to a display label/subtitle/state" — not byte-duplicated (each has a documented reason to exist standalone, and `tx-enrichment.ts` explicitly re-exports `primary-method.ts` for compat), but five separate small state-machines for one conceptual "activity feed display" domain is worth a coordinator-of-specialists read to check for drift between them (e.g. do `journalTerminalDisplay` and `card-subtitle`'s stage map agree on every `JobStage`?).

No evidence found of: helpers reimplementing `@nulo/wallet-core/utils` (locks/EventHandler/errors are consistently imported, never re-implemented), storage-wrapper duplication (`utils/storage.ts` is the sole `chrome.storage.local` facade; `wallet/storage/index.ts` is a distinct, non-overlapping `EntityStorage`/`ValueStorage` re-export), or background/offscreen wiring duplication (`wallet/utils/offscreen.ts` constants are imported, not copied, by `offscreen/index.ts`).
