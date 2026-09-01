# Complexity residue — round 2: adjudicated scope

Commissioned by the owner after round 1 closed at 126 directives (see
[complexity-budgets](../complexity-budgets/plan.md) + the seven arc records). Scope fixed by
Claude×Codex dual-position adjudication, reconciled to explicit agreement 2026-09-01: codex
gave per-file burn/accept verdicts after reading the functions; Claude conceded three accepts
(runtime.ts, the wallet-protocol cluster, the PXE family) against that evidence; codex
accepted the 7-plan consolidation of its 11 arcs and withdrew nothing else. **Target:
manifest 126 → 49** (36 harness/script + 13 justified prod). This file is the binding
burn/accept list; the driving /goal references it.

Tiers: **BL/C** = blueprint-light + characterization pins committed first ·
**BL/E** = blueprint-light over existing suites · **M/E** = mechanical, existing coverage.
All gates are exact spec basenames (extension `tests/e2e/network/` unless marked faucet).

## The 7 plans, in order (strictly sequential; 11 PR units)

### 1 · backup-integrity (2 PRs, BL/C)
- **PR-a — migration core**: `backup/row-map-migration.ts` (`validateTransform` ONLY —
  **retain** `cloneJsonValue`, `applyRowTransform`, `retypeValue`: hostile-JSON algebra, DSL
  interpreter, conversion matrix), `backup-migration-registry.ts`, `backup-migrator.ts`.
  Split clause validators / descriptor handlers without weakening fail-closed behavior.
- **PR-b — restore surface**: `account-state/{service,normalize}.ts`,
  `pages/settings/security/export/full.vue`, `composables/useProfileImportFlow.ts`,
  `utils/full-backup-helpers.ts`.
- Gates: backup-migration-roundtrip · backup-restore-integrity · backup-restore-sw-restart ·
  profile-reimport-matrix.

### 2 · pxe-network-boundary (1 PR, BL/E)
- `packages/aztec-runtime/src/pxe/{service,public-events,client}.ts`, `utils/fetch.ts`;
  extension `wallet/services/network/service.ts`. Seams: OPFS/IDB sweeps,
  contract-resolution cascade, page validation/decoding, incarnation stamping/retry.
- Gates: opfs-storage · networks · public-events-capability · incoming-public-transfers.

### 3 · execution-pipeline (1–2 PRs, BL/E)
- `execution/helpers/batched-view-simulation.ts` (71 — belongs HERE, not balances: its
  invariant is PXE/node arm dispatch + ordered result assembly), `claim-helper.ts`,
  `tx-request-builder.ts`, `execution/service.ts`, `transfer-executor.ts`,
  `fee/fee-strategy.ts`, `composables/internal/fee-estimation-engine.ts`, `fpc/service.ts`.
- Gates: sim-methods · batch-mixed · batch-partial-failure · fee-methods · transfers ·
  tx-sendTx-{default,delegated-authwit,feePayer,multicall,noFrom,reject,sponsoredFpc} ·
  cancel-mid-prove.

### 4 · balance-durable-jobs (1–2 PRs, BL/C — characterize event ordering + stale-flight fences first)
- `stores/balances.store.ts`,
  `token-balance/{service,balance-job-queue,balance-projector,reconcile-pairs}.ts`,
  `incoming-transfer/service.ts`, `token/seeder.ts`, `operation-journal/{service,reaper}.ts`.
- Gates: account-balance-orphans · balance-row-reconciliation · incoming-transfers ·
  receive-unregistered · default-token-seeding · account-switch-isolation.

### 5 · sw-wallet-protocol (2 PRs, BL/C)
- **PR-a**: `wallet/runtime.ts` — extract migration-gate / registration / post-start /
  heartbeat phases. Gates: cold-wake-discovery · backup-restore-sw-restart ·
  profile-reimport-matrix.
- **PR-b**: `packages/wallet-bridge/src/dispatcher.ts`, `wallet-sdk/background.ts`,
  `packages/wallet-sdk-schema-patch/src/apply.ts`, `popup/windows/execute/index.vue`.
  Gates: cap-request-{accounts,basic,partial,reject,repeat-noPopup,rerequest} ·
  connect-{dapp,deny,locked-queue,locked-queue-sw-restart} ·
  session-{explicitDisconnect,profileSwitch,reconnect,tabClose,tabNavigate} ·
  meta-{batch,getAccounts,getAccounts-pregrant,getChainInfo} · register-token ·
  data-{addressBook,privateEvents,registerSender}.

### 6 · faucet-cluster (2 PRs, BL/E then BL/C)
- **PR-a**: `composables/createAztecWalletSession.ts` (57×3 + 405L) — storage / discovery /
  verification / capability / setup controllers, preserving the epoch owner.
- **PR-b**: `useFuel.ts`, `fuelClaim.ts`, `useL1FeeAsset.ts`, `useWithdraw.ts`,
  `lib/bridge-steps.ts`, `packages/bridge-core/src/backup.ts` — REUSE/generalize
  `deposit-flow.ts` (#497): `bestEffortL2Block` as-is, `ensurePermit2Approval`
  parameterized by asset, shared router-`bridge()` mechanics extracted; never force fuel
  through the token-specific `buildDepositRecord`.
- Gates: faucet unit suites + faucet e2e faucet-smoke · bridge-smoke · fuel-smoke.

### 7 · popup-shell-state (2 PRs, BL/C batch + M/E rider)
- **PR-a**: `useContactImportExport.ts` (a UI-feature composable — picker/popup/cache/toast
  orchestration, not service invariants), `stores/app.store.ts` (245L),
  `RecentActivityView.vue`, `utils/activity-rows.ts`, `pages/auth.vue`,
  `popups/NewNetworkPopup.vue`, `popup/index.ts`.
- **PR-b (mechanical tail)**: `ui/Dropdown/DropdownRoot.vue`, `packages/design/src/ui/Input.vue`,
  `utils/files.ts`.
- Gates: senders-advanced · account-switch-isolation · wallet-locked-mid-session ·
  passkey-execution-canary.

## ACCEPTED residue — do not touch (owner-signed)

| entry | why it stays |
|---|---|
| `wallet/logger/utils.ts` (45) | the ordered recursive redaction walker IS the auditable security policy; decomposition scatters shape precedence |
| `stores/activity.store.ts` (122L) | length-only Pinia setup aggregation; bounded actions jointly own one ABA-safe cache |
| `utils/amount.ts` (22) | compact integer-formatting algorithm; the branches ARE the formatting semantics |
| `components/JsonViewer/creator.js` | vendored declarative theme object; splitting constants only games the metric |
| `execution/operation-estimate-reuse.ts` (21) | ordered single-shot validation ladder = the reuse-authorization checklist |
| `execution/operation-fingerprint.ts` (25) | recursive type-tagged canonical encoder; intrinsic traversal complexity |
| faucet `lib/errors.ts` (21) | precedence-sensitive error-classification policy |
| faucet `lib/phase-clock.ts` (22) | small temporal-state reducer whose branches are its specification |
| `wallet-core/base/topology.ts` (29) | conventional, tested layered Kahn algorithm |
| `wallet-core/utils/serialization.ts` (23) | upstream-derived recursive JSON codec |
| `row-map-migration.ts` ×3 fns | `cloneJsonValue` / `applyRowTransform` / `retypeValue` — see plan 1 |
| all test/e2e harness directives (25) | scores mirror scenario matrices; splitting scatters the matrix |
| remaining bridge-core operational scripts (11) | run-once tooling; "never validate by broadcasting" |

A blueprint may move a file to ACCEPT with evidence (recorded here + the residue ledger);
any NEW accept above score 35 needs owner sign-off. Never refactor a function into worse
shape to hit the number.
