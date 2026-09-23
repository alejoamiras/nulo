# Recon — plan 7 popup-shell-state (read-only sweep, 2026-09-01, base = dev @ eca082ca)

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Activity row merge/scope (tx + journal + incoming) | `apps/extension/src/utils/activity-rows.ts:51-101` `buildActivityRows` — called only by `popup/pages/activity.vue:112`; `RecentActivityView.vue:85-138` hand-mirrors it (its comment :100-105 says so) | adapt — make RecentActivityView consume the shared builder (or a shared sub-helper) only if the behavior is provably identical; else keep the mirror and cut inside it |
| File download/upload | `utils/files.ts:26 downloadFile`, `:87 pickFile` — already reused by useContactImportExport :73/:93, export/full.vue:370, export/account.vue:187, LogsViewer.vue:144, accounts/import.vue:58, useProfileImportFlow.ts:247 | reuse-as-is (no duplicate found) |
| Contacts export parsing | `utils/contacts-export-format.ts:48 parseContactsExport` — reused at useContactImportExport :105 | reuse-as-is |
| Focus trap wrapper | `createFocusTrap` at `DropdownRoot.vue:145` (try/catch + fallbackFocus) and `Popup/Popup.vue:29` (bare) | absence — no shared wrapper; not in scope unless the cut needs it |

## Baseline offenders (manifest, in-scope dirs)

cognitive: DropdownRoot.vue 2 · RecentActivityView.vue 1 · FeeSettingsCard.test.ts 1 · useContactImportExport.ts 1 · NewNetworkPopup.vue 1 · popup/index.ts 1 · auth.vue 1 · balances.store.fuzz.test.ts 2 · activity-rows.ts 1 · amount.ts 1 · files.ts 1 · log-payload-ban.test.ts 2 · packages/design/src/ui/Input.vue 1
lines: JsonViewer/creator.js 1 · useContactImportExport.ts 2 · stores/activity.store.ts 1 · stores/app.store.ts 1
(FeeSettingsCard.test / balances.store.fuzz.test / log-payload-ban.test / amount.ts / creator.js / activity.store.ts are NOT plan-7 targets — check scope.md ACCEPTED before touching.)

Per directive:
- `DropdownRoot.vue:144` — `nextTick()` callback inside `openDropdown()` (127) — cog 22 (positioning/focus-trap block :144-203, try/catch around createFocusTrap/activate, no promises)
- `DropdownRoot.vue:216` — `onKeydown` (217-246) — cog 22 (Escape/Enter/ArrowUp/ArrowDown)
  listener lifecycle: added in openDropdown (128), removed in closeDropdown (122) and onBeforeUnmount (205-209, also trap.deactivate + removeOutside). Tests: Dropdown.test.ts (38)
- `RecentActivityView.vue:84` — `recentActivityRows` computed (85-138) — cog 30, pure. Tests: RecentActivityView.test.ts (19: wiring, account-switch containment, scope-triple containment, ABA)
- `useContactImportExport.ts:29` — `useContactImportExport()` (30-258) — 118 lines; `:86-87` `importContacts` (88-255) — 86 lines + cog 60
  exportContacts (35-82): getSendersAcrossActiveNetworks :45 → getActiveProfile :69 → downloadFile :73 (try/catch/finally 3 deep)
  importContacts: pickFile :93 → file.text :104 → importPromise :145 (created :117-120, handed to cacheStore.importPromise, resolved externally by the import-contacts popup) → per-row loop updateContact/addContact :185/187/189 (per-row try/catch) → addSender :208 → 4-way toast branching :232-242; finally :251 clears cacheStore.importContacts/importPromise. Tests: useContactImportExport.test.ts (14)
- `NewNetworkPopup.vue:72` — `handleCreateNetwork` (73-100) — cog 21; addNetwork :88 → activateNetworkGuarded :93 → getNetworks :107/:111; registered as submit via usePopupEntity (:135-138). Tests: NewNetworkPopup.test.ts (2: re-entrancy latch, DUPLICATE_CHAIN toast)
- `popup/index.ts:56` — `router.beforeEach` (57-110) — cog 22; authRequiredGate :85 → getProfiles :93 → getLastActiveProfileId :95. No test file (auth-guard.ts has auth-guard.test.ts)
- `auth.vue:89` — `handleUnlockWallet` (90-177) — cog 28; passkey branch getPasskeyCredentialId :107 → runCeremony :108 → unlockPasskeyProfile :109 | password unlockProfile :111 → awaitProfileActivation :119 → setLastActiveProfileId :164 → fire-and-forget syncTransactions/refreshBalances :174-175; finally :147 resets isAwaitingResponse; advancePastAuth (78-83) races the isLogined watcher (198-203) via postAuthNavClaimed latch. Tests: auth.test.ts (14: torn-import refusal, single-shot nav race, bounded activation wait, reentry guard, stale-continuation drift)
- `activity-rows.ts:50` — `buildActivityRows` (51-101) — cog 29, pure. Tests: activity-rows.test.ts (13)
- `files.ts:96` — `input.onchange` inside `pickFile` (87-149) — cog 22, async linear (decompress try/catch). Tests: files.test.ts, files.caps.test.ts
- `stores/app.store.ts:21` — `useAppStore` setup (22-482) — 245 lines, 27 awaits. setupActiveAccount (117-147: storageLocalGet → commitAccountTarget → storageLocalSet); commitScopeChange (324-332: refreshInFlight → commit); syncTransactions (394-428: getTransactions → setTimeout backoff retry :423). inFlightJournal.onOperationAdded/Updated/Deleted.add at 262-264 inside refreshInFlight, never removed (store lifetime). Tests: app.store.test.ts (destination resolution, account-switch containment, generation-guarded syncTransactions) + app.store.setup-active-account.test.ts (stale-activation fence, ABA)
- `packages/design/src/ui/Input.vue:137` — `handleInput` (138-171) — cog 21, sync (sanitize → maxLength warn/truncate → number/int/default emit). Tests: Input.test.ts (18 incl. a pinned int-parsing bug)

## Gates
- e2e: `apps/extension/tests/e2e/network/{senders-advanced,account-switch-isolation,wallet-locked-mid-session,passkey-execution-canary}.test.ts` — network suite only (smoke excludes network/**). Run via root `e2e:agent` with the spec paths.
- component tests: `apps/extension` `test:components` = `bun --bun vitest run src/components`; the popup/composable suites run under the package `test` script.
