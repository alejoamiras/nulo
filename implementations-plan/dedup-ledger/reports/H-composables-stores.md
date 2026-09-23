## Cluster verdict

This cluster (composables + stores, ~6,250 non-test LOC) is noticeably *better* factored than the "LLM slop" prior suggests: the fee-estimation engine, `useEntityCrud`, `usePopupEntity`, `useProfileNameField`, `useDappApprovalWindow`, and the full-backup restore split are all evidence of *deliberate* prior dedup passes (several files' own comments say "extracted for its Nth user"). The security-critical files (`useFullBackupImport.ts`, `full-backup-restore.ts`, `full-backup-helpers.ts`, `balances.store.ts`, `activity.store.ts`) are dense but the density buys real invariants (race fences, attacker-controlled-input handling) — verbosity there is not slop. The actual issues are narrower: (1) a password-validity predicate + strength-hint string are copy-pasted verbatim across 3 composables in this cluster (and 3 more Vue files outside it), (2) one composable (`useProfileBootstrap.ts`) still hand-rolls a generation-fence idiom that was already extracted into `runFence.ts` and adopted by two other call sites, (3) a near-duplicate activation-wait helper (`waitForProfileActive.ts`) is a strict subset of a newer one (`unlockWait.ts`) and could be deleted outright, and (4) one composable breaks the documented C1 dispose-lifecycle convention that every other composable in the folder follows. Total realistic removable/consolidatable LOC: roughly 150-200 lines, concentrated in F1 and F2.

## Findings

### F1 [duplication] New-password validity predicate + strength-hint string, copy-pasted across 3 composables (and 3 more Vue files)

**Where:**
- `apps/extension/src/composables/useProfileCreateFlow.ts:50-65` (`strengthHint` computed + `isAllowedToContinue`)
- `apps/extension/src/composables/useProfileImportFlow.ts:281-289` (`isAllowedToContinue` + `isAllowedToImportBySeedPhrase`)
- `apps/extension/src/composables/useFullBackupImport.ts:743-751` (`isAllowedToImportBackup`, same predicate inlined)
- (outside this cluster, same exact 4-line hint verbatim) `apps/extension/src/popup/pages/settings/security/change-password.vue:54-66`, `apps/extension/src/components/composite/import/ImportSecretForm.vue:27-31`, `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:26-30`

**Evidence:**

`useProfileCreateFlow.ts`:
```ts
const strengthHint = computed(() => {
    if (authMethod.value === "passkey") return ""
    if (!password.value || password.value.length < 8) return "At least 8 characters"
    if (password.value !== repeatedPassword.value) return "Passwords don't match"
    if (password.value.length > 24) return "Long enough. Don't forget it."
    return "Strong password"
})
const isAllowedToContinue = computed(() => {
    if (authMethod.value === "passkey") return true
    if (!password.value || password.value.length < 8) return false
    if (password.value !== repeatedPassword.value) return false
    return true
})
```

`useProfileImportFlow.ts`:
```ts
const isAllowedToContinue = computed(() => {
    if (!password.value || password.value.length < 8) return false
    if (!repeatedPassword.value || password.value !== repeatedPassword.value) return false
    return true
})
```

`useFullBackupImport.ts`:
```ts
if (selectedBackup.value?.profileType === "password") {
    if (!opts.password.value || opts.password.value !== opts.repeatedPassword.value || opts.password.value.length < 8) {
        return false
    }
}
```

`ImportFullBackupForm.vue` / `ImportSecretForm.vue` (byte-identical to each other, and to the non-passkey branch of `strengthHint` above):
```ts
const passwordHint = computed(() => {
    if (!password.value || password.value?.length < 8) return "At least 8 characters"
    if (password.value !== repeatedPassword.value) return "Passwords don't match"
    if (password.value?.length > 24) return "Long enough. Don't forget it."
    return "Strong password"
})
```

**Refactor:** Extract two pure C0 helpers — `isValidNewPassword(password: string, repeated: string): boolean` and `passwordStrengthHint(password: string, repeated: string): string` — into a new small module, e.g. `apps/extension/src/utils/password.ts` (pure, no Vue/chrome/service deps, so `utils/` is the right home per the C0/C1 split, not a new composable). Update the 3 composables in this cluster to call the helper instead of re-deriving the predicate; the two out-of-cluster Vue files and `change-password.vue` can adopt the same helper as a follow-up (not this cluster's file, but worth flagging to whoever owns L4-L6/pages). `useProfileCreateFlow`'s passkey-aware branches stay as thin wrappers (`authMethod.value === "passkey" ? "" : passwordStrengthHint(...)`).

**LOC delta:** -25 to -30 in this cluster alone (3 call sites collapse to 1-line calls against a ~12-line shared helper); an additional -20 if the 3 Vue files outside the cluster are also migrated.

**Risk / tests:** low — pure string/boolean logic, no state. Covered by `useProfileCreateFlow.test.ts`, `useProfileImportFlow.test.ts`, `useFullBackupImport.test.ts` / `useFullBackupImport.stages.test.ts`, which assert on the gate booleans and hint strings already.

**Confidence:** high.

---

### F2 [duplication] `waitForProfileActive.ts` is a strict subset of `unlockWait.ts`'s `awaitProfileActivation` — both watch the same store shape, one call site each

**Where:**
- `apps/extension/src/composables/waitForProfileActive.ts:1-47` (whole file)
- `apps/extension/src/composables/unlockWait.ts:1-61` (whole file, the superset)
- Sole callers: `apps/extension/src/popup/pages/import.vue:17,71` (`waitForProfileActive`) and `apps/extension/src/popup/pages/auth.vue:15,163` (`awaitProfileActivation`)

**Evidence:**

`waitForProfileActive.ts` (2-signal wait):
```ts
export function waitForProfileActive(store: ProfileActivationSubject, expectedId: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (store.isLogined && store.profile?.id === expectedId) return resolve()
        const timer = setTimeout(() => { stop(); reject(new Error("Profile activation timeout")) }, timeoutMs)
        const stop = watch([() => store.isLogined, () => store.profile?.id], ([logged, id]) => {
            if (logged && id === expectedId) { clearTimeout(timer); stop(); resolve() }
        })
    })
}
```

`unlockWait.ts` (3-signal wait — same two signals plus `bootstrapFailure`, typed errors):
```ts
export function awaitProfileActivation(store: ProfileActivationWithFailureSubject, expectedId: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (store.isLogined && store.profile?.id === expectedId) return resolve()
        const initialFailure = store.bootstrapFailure
        if (initialFailure && initialFailure.profileId === expectedId) return reject(new BootstrapFailedError(initialFailure.message))
        const timer = setTimeout(() => { stop(); reject(new UnlockTimeoutError()) }, timeoutMs)
        const stop = watch([() => store.isLogined, () => store.profile?.id, () => store.bootstrapFailure], ([logged, id, failure]) => { ... })
    })
}
```

`appStore` (`apps/extension/src/stores/app.store.ts:48`) already carries `bootstrapFailure = ref<{ profileId: string; message: string } | null>(null)`, so it structurally satisfies `ProfileActivationWithFailureSubject` already. `import.vue`'s only consumer is `completeImportWithRecovery` (`apps/extension/src/composables/completeImportWithRecovery.ts:52-67`), whose `catch` block treats **any** rejection the same way (falls through to `recover()`), so swapping in `awaitProfileActivation` changes nothing observable for the success path and fails faster (not slower) on a genuine bootstrap failure.

**Refactor:** Delete `waitForProfileActive.ts` and its test. In `apps/extension/src/popup/pages/import.vue:71`, change `waitForActive: (ms) => waitForProfileActive(appStore, profile.id, ms)` to `waitForActive: (ms) => awaitProfileActivation(appStore, profile.id, ms)` and swap the import to `@/composables/unlockWait`.

**LOC delta:** -47 (module) + -74 (test file) = **-121**.

**Risk / tests:** med — behavior is compatible (verified above) but this changes which module owns the only production activation-wait path used by two different pages; `completeImportWithRecovery.test.ts`, `useProfileBootstrap.test.ts`, and `unlockWait.test.ts` exercise the pieces, but there's no existing test that pins `import.vue`'s wiring end-to-end, so add/adjust one assertion there when making the change.

**Confidence:** high.

---

### F3 [duplication] `useProfileBootstrap.ts` hand-rolls the generation-fence idiom `runFence.ts` already extracted (and 2 other call sites already use)

**Where:**
- `apps/extension/src/composables/useProfileBootstrap.ts:43,124-127` (hand-rolled)
- `apps/extension/src/composables/runFence.ts:1-21` (the shared extraction — its own doc comment names this exact file as the motivating case)
- Existing adopters: `apps/extension/src/popup/network-switch.ts:45`, `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:142-144`

**Evidence:**

`runFence.ts`'s own header:
```ts
/**
 * Generation fence for supersedable async runs. `begin()` bumps the shared
 * generation and hands back an `isCurrent` closure for THAT run — any later
 * `begin()` permanently invalidates every earlier run's closure. The idiom
 * `useProfileBootstrap` hand-rolls, extracted for its 2nd and 3rd users ...
 */
```

`useProfileBootstrap.ts` still hand-rolls exactly that idiom:
```ts
let bootstrapGeneration = 0
...
const runBootstrapCore = (profileId: string): Promise<void> => {
    const existing = inFlightBootstraps.get(profileId)
    if (existing && existing.gen === bootstrapGeneration) return existing.promise
    const myGeneration = ++bootstrapGeneration
    const isCurrent = () => bootstrapGeneration === myGeneration
    ...
}
```

**Refactor:** Replace `bootstrapGeneration`/`myGeneration`/`isCurrent` with a module-level `const fence = createRunFence()`; store `{ isCurrent, promise }` instead of `{ gen, promise }` in `inFlightBootstraps`, and change the join check from `existing.gen === bootstrapGeneration` to `existing.isCurrent()` (equivalent: an `isCurrent` closure returns false the instant any later `begin()` fires, which is exactly "still current"). Drop the module-level `bootstrapGeneration` variable and its explanatory comment block (now redundant with `runFence.ts`'s own doc).

**LOC delta:** -10 to -12 (removes the counter, the duplicated comment block explaining the fence, and the manual increment/compare; adds one `import` + one `createRunFence()` call).

**Risk / tests:** low — same semantics, mechanically substitutable. Covered by `useProfileBootstrap.test.ts` (which specifically exercises the B-27 single-flight/supersede behavior) and `runFence.test.ts`.

**Confidence:** high.

---

### F4 [inconsistency] `fullscreenPopupSetting.ts` is the only composable in the folder that owns its own mount/unmount hooks instead of exposing `dispose()`

**Where:** `apps/extension/src/composables/fullscreenPopupSetting.ts:22-44`

**Evidence:**
```ts
export function useFullscreenPopupSetting(): Ref<boolean> {
    const showFullscreen = ref<boolean>(defaultConfig().showPopupFullscreen)
    const client = new ConfigServiceClient()
    client.onUpdate.add((setting) => { ... })
    onMounted(async () => { ... })
    onBeforeUnmount(() => {
        client.disconnect()
    })
    return showFullscreen
}
```

Every other C1 composable in this same directory that owns a service client follows the documented convention instead (construct, expose `dispose()`, let the parent call it in its own `onBeforeUnmount`): `useFeeEstimation.ts` (`onScopeDispose(engine.dispose)` + exported `dispose`), `useDappInteractionPayload.ts` (`dispose` + `onScopeDispose(dispose)`), `useIncomingTransfers.ts` (same pattern), `usePrices.ts` (returns `dispose`, no lifecycle hook at all — parent-managed). CLAUDE.md's "Cleanup order in `onBeforeUnmount`" section states plainly: "Composables MUST NOT own their own `onUnmounted`" (the carve-out is for non-service DOM/timer cleanup via `onScopeDispose`, not for a composable that itself constructs and disconnects a service client).

**Refactor:** Convert to the same shape as its siblings: return `{ showFullscreen, dispose }` where `dispose = () => client.disconnect()`; move the `onMounted` initial-fetch logic into an exported `init()`/`start()` the parent calls (mirroring `useDappApprovalWindow`'s `start`/`dispose` split) or, if the auto-fullscreen behavior is only ever needed at mount, keep the internal `onMounted` for the DOM-only fullscreen check but stop the composable from owning the client's lifecycle itself.

**LOC delta:** ~0 net (this is a shape fix, not a size fix) — maybe +2 lines for the returned `dispose`.

**Risk / tests:** low; check `fullscreenPopupSetting.test.ts` and its sole consumer (`PopupCard.vue`) for the exact mount/unmount ordering before changing, since the file's own comment says it "mirrors the prior PopupCard.vue lifecycle 1:1."

**Confidence:** med (this is a convention violation, not a bug — flagging it as inconsistency per the review brief's category 4, not as broken behavior).

## Not worth it

- `useFeeEstimation.ts` / `useFeeEstimationMap.ts` — look like they could be merged (both are thin adapters over `internal/fee-estimation-engine.ts`), but they already share 100% of the actual logic through that engine; the two adapters differ in return shape (single vs. per-key `Record`) enough that merging them would just reintroduce a generic-key branch the engine's split avoids. Already the "good" shape.
- `balances.store.ts`'s `fetchGas`/`fetchFpc` single-flight wrappers (`:431-451` and `:526-536`) are structurally parallel but `fetchGas` carries extra forced-run bookkeeping `fetchFpc` doesn't need; the size difference (21 vs 11 lines) and per-brief "twice-only needs >20 lines each" rule means this isn't worth abstracting.
- `useSecretCountdown.ts`'s own 1-second `setInterval` could theoretically reuse the shared `useTicker(1000)` refcounted ticker in `ticker.ts`, but the savings are ~5 lines and the composable's own `start()`/`disable()` API shape doesn't map cleanly onto `useTicker`'s always-on ref.
- `useFullBackupImport.ts` + `full-backup-restore.ts` + `full-backup-helpers.ts` (1,800 combined lines) look like an obvious dedup target by size alone, but on read they're already a deliberate 3-way split (composable orchestration / stage functions / pure helpers) with no repeated logic between them — the verbosity is attributability comments for a genuinely adversarial-input security surface, not slop.
- `useAppStore`'s `withScopeChangeAllowed` (`app.store.ts:96`) is a `@deprecated` alias with zero production callers (only a shape-pin test references it) — genuinely dead, but at 1 line it's far under the ≥20-line dead-code bar to report as a standalone finding.
- `activity.store.ts`'s accepted 122-line Pinia closure (`biome-ignore` at line 103) — read it looking for an extractable duplicate given the accepted-complexity flag; `clearScope`/`clearProfile`/`clearAll` share a 2-line `advanceIncarnation(); touch()` tail, too small to be worth a new helper.
