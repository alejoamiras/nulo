# QUALITY audit — `extension/components-composables-stores-design`

Scope: `packages/extension/src/{components,composables,stores,design}/**` (non-test).
Lens: typing + dedup. Focus = maintainability/change-cost only.

---

### Q1 `useFullBackupImport` — untyped backup envelope forces a ~24-cast narrowing cluster
- Smell: Primitive Obsession + loose boundary type (analog: Stringly/`unknown`-Typed Data — the parsed backup is carried as `Record<string, unknown>` / `unknown` and re-narrowed inline at every read instead of being parsed once into a domain type)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 1 file (casts are contained), but it is a trust boundary (restores untrusted backup files into storage), so loose typing here is the highest-cost place for it
- Instances (all in `composables/useFullBackupImport.ts`):
  - `:139` `selection.backup as { data?: { profile?: { name?: string } } } | null`
  - `:153` `(err as Error)?.message`
  - `:162` `selectedBackup.value?.backup as string`
  - `:165` `JSON.parse(decodedJson) as { data?: { profile?: { type?: string; name?: string } } }`
  - `:167` `selectedBackup.value as BackupSelection`
  - `:200` `selectedBackup.value as BackupSelection`
  - `:201-206` `sel.backup as { checksum?; "schema-version"?; "master-key"?; data: Record<string, unknown> }`
  - `:208-214` `backup.data as Record<string, unknown> & { account?; network?; token?; "token-balance"?; profile? }`
  - `:245` `backup["master-key"] as string`
  - `:246` `data.profile as { id: string; name: string; type: "password" | "passkey" }`
  - `:300-306` `(await networkService.restore(data.network)) as Array<{ id; name; rpcUrl; chainId; restoreError? }>`
  - `:321-323` `(data.network as Array<{ id; name; rpcUrl; chainId }>)`
  - `:363-367` `(await tokenService.restore(data.token)) as Array<{ id; contract; restoreError? }>`
  - `:370` `data.token as Array<{ id: string; contract: string }>`
  - `:375` `tb.token as string`
  - `:385-391` **7× `new <Name>ServiceClient() as never`** (TransactionServiceClient, TokenBalanceServiceClient, AccountStateServiceClient, AuthRegistryServiceClient, FpcServiceClient, ContactServiceClient, ConfigServiceClient)
  - `:427` `(err as Error)?.message`
- Evidence: there is no `FullBackup` / `BackupData` type. The envelope shape (`checksum`, `schema-version`, `master-key`, `data`) and each per-service slice (`network`, `token`, `token-balance` row) are re-described by an ad-hoc inline type literal at each use site — `data.network`'s `Array<{id;name;rpcUrl;chainId}>` shape is written **twice** (`:300` and `:321`), `data.token`'s shape twice (`:363` and `:370`). The 7 `as never` casts at `:385-391` exist only because the service clients share no common `RestorableServiceClient` interface (`{ restore(...args: unknown[]): Promise<unknown>; disconnect(): void }`), so each real client type is erased to `never` to fit the hand-rolled structural array.
- Why it harms future change: the `schema-version` is bumped on every storage migration. When the backup shape changes, none of these 24 cast sites are type-checked against the producer (`ProfileService.exportPlain` / each service's `restore`), so a field rename or a slice-shape change compiles clean and fails at runtime mid-restore — the worst place to discover it (orphan half-restored profile). Adding an 8th restorable service means another `as never` line instead of the compiler enforcing the contract.
- Refactoring: Extract Type — define `FullBackupV2` (envelope) + per-slice DTOs once (ideally a zod schema in `utils/full-backup-helpers.ts`, parsed in `readBackupFile`/`decryptBackup` so `selectedBackup.backup` is typed thereafter), and a shared `RestorableServiceClient` interface so the `:385-391` array drops all 7 `as never`. Removes ~24 casts and the twice-written slice shapes.
- Effort: days
- Confidence: high

---

### Q2 `cache.store.ts` — untyped cross-cutting state bag (sibling stores are fully typed)
- Smell: Primitive Obsession + loose boundary type (analog: Untyped Bag — `reactive({})` and bare `ref()` with no type parameter; the whole app mutates arbitrary properties on it)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 10+ files write `cacheStore.confirm.*` alone; the store is imported across the popup
- Instances (`stores/cache.store.ts`):
  - `:4` `const confirm = reactive({})` — mutated app-wide with 8 distinct ad-hoc props: `title`, `description`, `callback`, `confirm_text`, `confirm_color`, `confirmation_text`, `passkeyConfirmation`, `toggle`
  - `:8` `const incomingTrust = reactive({})`
  - `:10,14,15,16,18,21,25,34,36` bare `ref()` → `Ref<any>`: `networkToEditIdx`, `accountToEditIdx`, `contactToEditIdx`, `fpcToEditIdx`, `activeTokenIdx`, `preselectedTokenAddressToAdd`, `selectedNetwork`, `failureLog`, `viewerData`
  - `:20,30,32` `ref(null)` (untyped null): `preselectedContactToSend`, `importContact`, `importPromise`
  - `:22,24,26,31` `ref([])` (untyped array): `preselectedAuthwits`, `proposedNetworks`, `feePaymentMethods`, `importContacts`
- Evidence: the three sibling stores are all properly typed — `app.store.ts:42` `ref<ProfileInfo>()`, `:47` `ref<Account>()`, `:104` `ref<Network>()`; `notification.store.ts:23` `ref<NotificationItem[]>([])`; `popup.store.ts:11` `ref<OpenedPopups>({})`. `cache.store.ts` is the lone outlier. Concrete proof the missing type already bit: the `confirm` bag carries BOTH `confirm_text` and `confirmation_text` (near-duplicate property names) — exactly the drift an untyped bag cannot catch.
- Why it harms future change: `cacheStore.confirm` drives the global confirmation dialog (`CLAUDE.md` documents the `confirm.title/description/confirm_text/callback` pattern; used in e.g. `popup/pages/settings/fpcs/index.vue:80-99`). A typo (`confirm.calback`) or using the wrong near-twin (`confirm_text` vs `confirmation_text`) compiles fine and the dialog silently misbehaves. No editor autocomplete for any of these fields; every consumer must read the store source to learn the shape.
- Refactoring: Extract Type / Replace Bag with typed interface — define `ConfirmDialogState` + `IncomingTrustState` interfaces and type each `ref<T>()`; collapse `confirm_text`/`confirmation_text` to one field. Restores compile-time field checking across the 10+ call sites and kills the near-duplicate-prop class of bug.
- Effort: hours
- Confidence: high

---

### Q3 `useFeeEstimation` vs `useFeeEstimationMap` — copy-pasted debounce + staleness-counter estimator
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 files (~93 LOC each, ~85% structurally identical)
- Instances:
  - `composables/useFeeEstimation.ts` (single-slot)
  - `composables/useFeeEstimationMap.ts` (per-key)
- Evidence: the map version is the single version with `result`/`isEstimating`/`timer`/`counter` keyed by `TKey`. The core algorithm is duplicated line-for-line:
  - `clearTimer`/`clearTimerFor` (`useFeeEstimation.ts:45-50` ↔ `useFeeEstimationMap.ts:46-52`)
  - `cancel` — clear timer, bump counter, null result, clear flag (`:52-58` ↔ `:54-60`)
  - `schedule` — clear, null result, set flag, `++counter`, `setTimeout` with the identical `if (disposed || myCounter !== counter) return` staleness guard in `try`/`catch(onError)`/`finally(reset flag)` (`:60-81` ↔ `:66-89`)
  - `dispose` + `onScopeDispose` (`:83-90` ↔ `:91-98`)
  Only difference: scalar refs + one `counter` vs `Map`-keyed `results`/`estimating`/`counters`/`timers`.
- Why it harms future change: the staleness/disposed guard is the subtle, bug-prone part (it prevents a late estimator from writing after cancel/dispose — see the `dispose() prevents any further state mutation` test that exists in BOTH suites). Any fix to that guard must be made twice, in lockstep, or the two diverge silently.
- Refactoring: Extract a shared `createDebouncedStaleSlot` core (timer + counter + disposed guard for one slot); `useFeeEstimation` wraps one slot, `useFeeEstimationMap` wraps a `Map<TKey, slot>`. Removes the duplicated guard logic and the parallel test surface.
- Effort: hours
- Confidence: high

---

### Q4 Local design wrappers re-mirror the `@nulo/design` base prop contract in untyped JS
- Smell: Shotgun Surgery + Middle Man (the wrapper re-declares and re-forwards pass-through props that add no behavior; the base's prop contract is hand-copied with nothing enforcing parity)
- Lens: dedup (+ typing sub-note)
- Maintenance impact: structural
- Blast radius: 2 wrappers (`Button` is consumed across nearly every page/popup; `SubPageHeader` across the settings tree)
- Instances:
  - `components/ui/Button.vue:1` `<script setup>` (no `lang="ts"`); `:18-30` re-declares all 11 base props (`size, variant, wide, disabled, loading, link, target, leftIcon, leftIconColor, rightIcon, rightIconColor`); `:34-53` and `:54-68` forward 9 of them (`size, variant, wide, disabled, loading, left-icon, left-icon-color, right-icon, right-icon-color`) **twice** (RouterLink branch + else branch)
  - `components/ui/SubPageHeader.vue:1` `<script setup>` (no `lang="ts"`); `:7-29` re-declares 5 base props; `:48-53` forwards 4 to `SubPageHeaderBase`
  - (`components/ui/ToastManager.vue` is clean — no props mirrored; not a smell)
- Evidence: the bases are all TypeScript — `packages/design/src/ui/Button.vue:1` (`lang="ts"`), `SubPageHeaderBase.vue:1` (`lang="ts"`). The wrappers are plain JS, so the hand-copied `defineProps` object is not checked against the base contract at compile time. In `Button.vue` the wrapper already sets `inheritAttrs:false` + `v-bind="$attrs"` to the base (`:15,36,57`) — only `link`/`target` are host-coupled (RouterLink); the other 9 props are pure pass-through that `$attrs` already carries, so the explicit re-declaration + double `v-bind` is redundant forwarding.
- Why it harms future change: when `@nulo/design`'s `Button`/`SubPageHeaderBase` adds, renames, or retypes a prop, each wrapper's `defineProps` (and Button's two forward blocks) must be hand-edited to match, with zero compile-time signal if you miss one — classic Shotgun Surgery across the package boundary. The recently-added base `tag`/`href` props, for instance, are not declared in the wrapper and only work by `$attrs` accident.
- Refactoring: drop the redundant pass-through prop declarations and rely on `$attrs` fallthrough for everything except the host-coupled props (`link`/`target` for Button; `backTo` for SubPageHeader), or convert the wrappers to `lang="ts"` and derive props from the base's exported prop type so parity is compiler-enforced. Removes the hand-mirrored contract and the double forward.
- Effort: hours
- Confidence: high (Button redundancy) / moderate (SubPageHeader, where Flex-root fallthrough makes a thin forward more defensible)

---

### Q5 Profile create/import flows duplicate the name-validation preamble + password gate
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: local
- Blast radius: 2 composables (5 handler bodies)
- Instances:
  - `composables/useProfileCreateFlow.ts:60-65` `isAllowedToContinue` password gate (`>=8` + match) ↔ `composables/useProfileImportFlow.ts:104-109` same gate
  - The "latch FIRST → `getProfiles().map(p => p.name)` → `validateName({ existingNames })` → early-return-resetting-latch" preamble: `useProfileCreateFlow.ts:77-88` ↔ `useProfileImportFlow.ts` `handleImportSeed:129-137`, `handleImportPrivateKey:147-155`, `handleImportPublicKey:172-180`, `handleImportPasskey:196-204` (4 near-verbatim copies; import factored the fetch into `fetchExistingNames()` at `:123-125`, create inlines it at `:84`)
  - `UserRejectedError` silent-return handling duplicated (`useProfileCreateFlow.ts:98-101` ↔ `useProfileImportFlow.ts:213`)
- Evidence: both composables independently compose `useProfileNameField` + `usePasskeyCeremony` + `password`/`repeatedPassword` refs + an `isCreating`/`isImporting` latch, then repeat the same submit preamble. The 4 import handlers differ only in the single `managers.profile.importX(...)` call between identical pre/post blocks.
- Why it harms future change: a change to the duplicate-name policy, the password rule, or the rapid-double-click latch ordering must be applied in up to 6 places. The latch-before-await ordering is explicitly safety-relevant (comments at both sites warn about the race), so divergence reintroduces the bug in one path only.
- Refactoring: Extract a shared `submitProfile(buildProfile, { isPasskey })` helper (or a `useProfileSubmit` composable) owning the latch + existing-names fetch + `validateName` + `UserRejectedError` handling; each handler supplies only the `managers.profile.importX`/`createX` call. Collapses 5 preambles to one.
- Effort: hours
- Confidence: moderate

---

## Candidates assessed and rejected (not scored — checked because the brief flagged them)
- **`useFormState.ts` (~7-10 casts)** — NOT a smell. The casts (`{} as MappedType` then populate, `ref(x) as Ref<unknown>`, `Object.keys(defs) as (keyof TFields)[]`) are the idiomatic incremental-mapped-type-builder pattern. They are fully encapsulated; the public surface (`FormState<TFields>`, `FieldHandle<...>`) is precisely typed and infers correctly for all 11 popup consumers. No leakage, no consumer cost.
- **`useEntityCrud<T>` + settings `*-helpers.ts` (claimed per-entity CRUD dup)** — NOT a dedup smell. `useEntityCrud` cleanly unifies the list-state CRUD (fetch + identity-keyed splice on add/update/delete) for all 5 consumers. The `*-helpers.ts` files are genuinely per-entity domain logic, not CRUD: `authwit-helpers.ts` (kind-decoration + kind-aware sort + search), `fpc-helpers.ts` (type→label mapping + synthetic-row union + sort order), `connected-app-helpers.ts` (capability label + session-param flatten). They share no extractable shape; collapsing them would be incidental-similarity over-abstraction. The residual page-glue (confirm-dialog wiring) lives in out-of-scope L6 pages.

## Out-of-focus notes
- **(typing, cross-package, out of scope)** The wrapper's `size`/`variant` are stringly-typed because the base itself is — `packages/design/src/ui/Button.vue:8-26` declares `size`/`variant` as bare `type: String` (while `tag` uses `PropType<"button"|"a">`). A literal-union `PropType` on the base would propagate type safety to all wallet `<Button>` call sites; the regression originates upstream, not in the extension wrapper.
- **(doc drift)** `composables/useEntityCrud.ts:20` JSDoc says the default identity is `e => (e as any).id`, but the code (`:47-53`) uses the typed `(entity as { id?: string | number }).id`. Harmless but misleading.
- **(style, excluded by rules)** The activity cards duplicate the title-separator + transfer-chip CSS verbatim across `TransactionAwaitingCard.vue:113-133`, `TransactionTerminalCard.vue:100-118` (and per the comments, the settled card + incoming card) for visual parity. Component logic is already well-factored via `TransactionCardLayout`; the repetition is scoped CSS the repo deliberately mirrors with parity comments — flagged only for awareness.

## Summary
5 findings (4 high-confidence, 1 moderate). Highest-value: **Q1 `useFullBackupImport`'s untyped backup envelope** — ~24 casts incl. 7 `as never` at a restore trust boundary with no `FullBackup` type or shared `RestorableServiceClient` interface.
