# Fee-estimation init race in `FeeSettingsCard`

**Branch:** `fix/fee-estimation-init-race`
**Date:** 2026-05-09
**Author:** alejoamiras + claude
**Iteration:** v2.1 (after codex audit at xhigh; rebased over master @ `9fb68df` PR #66)
**Base:** master `9fb68df` ("fix(send): disable zero-balance fee methods + skip simulation")

## TL;DR

`FeeSettingsCard` sometimes pushes `feeSettings === undefined` to its parent
v-model on first paint, which silently disables fee estimation in both
`pages/send.vue` and `windows/execute/index.vue`. The user observed that
re-selecting "the same option" from the dropdown unsticks it. Root cause is
a race between the synchronous `selectedMethod` watcher and the async
`init()` pipeline, plus a tangle of imperative side effects in the same
watcher. This plan replaces the imperative shape with:

1. A pure `computed` that derives settings from fully-resolved state.
2. Explicit save calls at user-action boundaries (no deep-watcher save).
3. A separate display-only `previewSelection` for the trigger label during init.
4. Semantic-key resolution of saved selections against fresh live methods.

## Affected surfaces

| Caller | Path | Symptom |
|---|---|---|
| Send page | `packages/extension/src/popup/pages/send.vue` | Confirm button stays disabled because `feeEstimate` never lands; user types amount + recipient and sees no fee summary. |
| dApp Approval window | `packages/extension/src/popup/windows/execute/index.vue` | Per-operation `feeEstimate` map never populates; the operation card shows nothing or "estimating…" depending on which placeholder `<FeeCostReadout>` renders. |

Both consume the same `FeeSettingsCard`; one fix covers both.

## Diagnosis (verified)

### The deterministic case: saved `fj`

1. `FeeSettingsCard` mounts. `gasBalances` initial value:
   `{ publicFeeJuice: "0", privateFeeJuice: null }`
   (`FeeSettingsCard.vue:56`).
2. `onBeforeMount` calls `init()` → `runInit()`.
3. `runInit` reads saved selection from `chrome.storage.local` and assigns
   *before* the slow PXE fetch, so the dropdown trigger doesn't flash
   "Select method" (`FeeSettingsCard.vue:185-188`).
4. The `selectedMethod` watcher (`:226-236`) fires synchronously with
   `gasBalances.value.publicFeeJuice === "0"`. `settingsForMethod` for
   `type: "fj"` early-returns `undefined` (`fee-helpers.ts:96-98`).
   `settings.value = undefined`. No save (because `next` is falsy).
5. `Promise.all` resolves. `gasBalances` updates. The watcher does NOT
   re-fire (gasBalances isn't a dep). The reconciliation block at
   `:200-204` is fpc-only — no-op for `fj`.
6. Parent `feeSettings` stays undefined → estimation watcher cancels.
7. Re-picking from the dropdown emits a new method object (different
   identity), watcher fires, gas is now fresh, settings becomes valid.

### The conditional case: saved `DefaultFpc`

The bug fires **iff** the persisted `method.balance` snapshot was zero (or
absent), because then the first watcher fire's `isZeroBalance(method)` is
true and `settingsForMethod` returns undefined. If the stored snapshot was
non-zero, the first fire returns valid settings (using stale balance — a
separate correctness concern called out below). The reconciliation block
at `:200-204` mutates `selectedMethod.value.balance = fpcBalance.value`
only when `fpcBalance.value` is truthy; if there's no current balance for
the fpc's asset on this account (fresh account, balance not yet indexed),
the reconciliation is a no-op and the bug sticks.

The stored object is the whole `FeeMethodOption`, including `balance` and
`inPublic` — which means staleness is baked in and recovered only by the
reconciliation step. v2 addresses this by **resolving saved selections
against fresh live methods by semantic key** instead of reusing the stored
object wholesale (see Architecture §4).

### Cases that don't bite

- **Saved DefaultSponsoredFpc** — no gas/balance gate in
  `settingsForMethod`; first watcher fire returns valid settings.
- **Auto-selected sponsored** (no saved entry) — `selectedMethod.value`
  is assigned in the `else` branch *after* `Promise.all`, so gas is
  fresh on first fire.

### PR #66 expanded the surface

Master `9fb68df` ("fix(send): disable zero-balance fee methods + skip
simulation") added a `gasPrivateFeeJuice` parameter to `settingsForMethod`
so `private_fpc` zero-balance settings stop reaching simulation
(`fee-helpers.ts:113-114`):

```ts
case "private_fpc":
  if (!method.fpc) return undefined
  if (!gasPrivateFeeJuice || gasPrivateFeeJuice === "0") return undefined
```

Before #66, saved `private_fpc` was unaffected by the init race
(no gas gate). After #66, it IS affected: `gasBalances.value.privateFeeJuice`
starts as `null` (line 56), the new gate triggers, settings is undefined.
**The bug now fires for saved `fj` AND saved `private_fpc`**, plus the
conditional DefaultFpc-with-zero-stored-balance case. The watcher in
`FeeSettingsCard.vue:226-236` was updated to pass
`gasBalances.value.privateFeeJuice` but **not** to depend on it — the
race is identical in shape.

## Why a watcher-dep band-aid is wrong

The first instinct (add `gasBalances.value.publicFeeJuice` to the watcher
deps) papers over the real problems:

1. **Conflated state.** `selectedMethod` carries both "what the trigger
   displays during the loading shim" and "the resolved selection used
   for derivation." Pre-fill mutates computational state.
2. **Imperative watcher as driver.** Settings derivation (pure) is
   colocated with side effects (storage write + cacheStore push).
3. **Deep watcher fans side effects out.** `onBalanceUpdated` /
   `onFpcUpdated` deep-mutate `selectedMethod`. Adding gas as a dep
   (or keeping deep:true on the save watcher) compounds spurious
   re-saves.
4. **Stale-on-clear.** `onBalanceDeleted` / `onFpcDeleted` clear
   `selectedMethod = undefined` (`:107-110`, `:117-121`), but the
   current watcher's `if (!m) return` early-exit leaves `settings.value`
   pointing at the last-valid value. **The parent's `op.feeSettings`
   can stay truthy after the card visually clears.** This is a real
   correctness bug, not just an init issue, and codex flagged it as
   blocking — v2 addresses it.

## Goals

1. **Correctness end-to-end.** `feeSettings` reflects the *current*
   resolved state every time it's read by the parent, including:
   - On first paint after init.
   - When `selectedMethod` is cleared (balance/fpc deleted).
   - When the user picks a method during the brief init window.
2. **Side-effect isolation.** Storage writes and cacheStore mutations
   fire only on explicit user-intent boundaries (dropdown pick, toggle,
   embedded ↔ manual switch). No saves from data-refresh handlers.
3. **No init-window overwrite.** A user pick during the
   `Promise.all`-await is preserved through to `isInitComplete`.
4. **No async TOCTOU on storage.** The chrome.storage.local
   read-modify-write sequence isn't trivially racy with concurrent
   user actions.
5. **Testability.** New `FeeSettingsCard.test.ts` covers the bug pin
   plus all new contracts.
6. **No UX regression.** Trigger continues to display the saved title
   during init.

## Non-goals

- Refactoring `settingsForMethod` itself (already pure, well-tested).
- Touching `useFeeEstimation` / `useFeeEstimationMap` composables.
- Send-page or execute-window changes.
- Fixing the embedded-fee path's separate quirk where clicking
  "Override with my method" doesn't kick `runInit` (balances/fpcs
  never load if the operation arrives with embedded fee). Documented
  as out-of-scope follow-up.
- Persisting auto-selected sponsored to storage — current behavior
  saves it; v2 drops that save (auto-select is deterministic from
  fresh fpc list, no need to persist), removing one TOCTOU surface.
  Will note this is a behavioral change and verify nothing depends
  on it.

## Proposed architecture (v2)

### 1. Three refs, three responsibilities

```ts
// What the dropdown trigger shows during the init loading window.
// Display-only; never read by derivation. Cleared once selectedMethod resolves.
const previewSelection = ref<{ title: string; subtitle: string } | undefined>()

// The resolved, fresh-from-buildFeeMethods selection used for derivation.
// Set exactly once per init (or by user action thereafter).
const selectedMethod = ref<FeeMethodOption | undefined>()

// The init-complete gate. False during runInit; flips true at the end.
// Reset to false at the top of every runInit so prop changes re-arm honestly.
const isInitComplete = ref(false)
```

Trigger renders `selectedMethod.value?.title ?? previewSelection.value?.title ?? "Select method"`. Achieved by passing `previewSelection` as a new optional prop to `FeeMethodSelector` (small additive change).

### 2. Settings as a `computed`, never imperatively assigned

Replace the imperative `settings.value = ...` watcher with a pure
`computed` and a one-line v-model sync:

```ts
const derivedSettings = computed<FeeSettings | undefined>(() => {
  if (useEmbeddedFee.value) return { paymentMethod: { kind: "embedded" } }
  if (!isInitComplete.value) return undefined
  const m = selectedMethod.value
  if (!m) return undefined
  return settingsForMethod(
    m,
    selectedPriority.value,
    gasBalances.value.publicFeeJuice,
    gasBalances.value.privateFeeJuice,   // ← added in PR #66
  )
})

watch(derivedSettings, (val) => {
  settings.value = val
}, { immediate: true })
```

Properties:
- **Always emits.** When `selectedMethod` is cleared by `onBalanceDeleted`,
  `derivedSettings` re-derives to `undefined`, the watcher syncs
  `settings.value = undefined`. Parent's `op.feeSettings` is never stale.
- **Embedded path preserved.** `useEmbeddedFee` is a separate ref that
  toggles on `handleUseEmbedded` / off on `handleUseOwnMethod`.
  Derivation respects it ahead of `isInitComplete` — embedded ops
  emit the embedded settings even before init completes (matching
  current behavior).
- **No side effects in derivation.** Save logic is entirely separate.

### 3. Explicit save calls at user-intent boundaries

Drop the deep-watcher save entirely. Replace with explicit calls in the
handlers that represent user intent:

```ts
const handleMethodPicked = (m: FeeMethodOption) => {
  selectedMethod.value = m
  void persistSelection(m)
}

const handleToggleVisibility = () => {
  if (!selectedMethod.value) return
  // Replace the object so the computed's reactivity tracks it cleanly.
  const next = { ...selectedMethod.value, inPublic: !selectedMethod.value.inPublic }
  selectedMethod.value = next
  void persistSelection(next)
}

const handleUseEmbedded = () => {
  useOwnMethod.value = false
  useEmbeddedFee.value = true
  selectedMethod.value = undefined
  // No persist — embedded is dictated by the operation, not user pref.
}

const handleUseOwnMethod = () => {
  useOwnMethod.value = true
  useEmbeddedFee.value = false
  // Triggers init() via watcher (see §6) so balances/fpcs load.
}
```

`onBalanceUpdated` / `onFpcUpdated` continue to update the `balances` /
`registeredFpcs` refs but **do not** call `persistSelection`. They MAY
update `selectedMethod`'s balance via a fresh-object replacement so
`settingsForMethod` reads the current value:

```ts
const onBalanceUpdated = (balance) => {
  if (balance.account !== props.account?.address) return
  const idx = balances.value?.findIndex((b) => b.id === balance.id)
  if (idx !== -1) balances.value[idx] = balance
  if (selectedMethod.value?.balance?.id === balance.id) {
    selectedMethod.value = { ...selectedMethod.value, balance }
  }
}
```

Object-identity replacement (rather than deep mutation) means the
`computed` re-derives once per balance update, but no save fires —
because saves come from `handle*` not from this handler.

### 4. Resolve saved selection against fresh live methods

Replace the "use stored object wholesale" pattern with a semantic-key
resolver:

```ts
function resolveSaved(
  saved: PersistedSelection | undefined,
  fresh: FeeMethodOption[],
  balances: TokenBalance[],
): FeeMethodOption | undefined {
  if (!saved) return undefined
  switch (saved.type) {
    case "fj":
      return fresh.find((m) => m.type === "fj")
    case "private_fpc":
      return fresh.find((m) => m.type === "private_fpc")
    case "fpc": {
      const match = fresh.find((m) => m.type === "fpc" && m.fpc?.id === saved.fpcId)
      if (!match) return undefined
      const balance = match.fpc?.asset
        ? balances.find((b) => b.token.contract === match.fpc!.asset)
        : undefined
      return { ...match, balance, inPublic: saved.inPublic }
    }
    default:
      return undefined
  }
}
```

Persisted selection becomes a thin record (`type`, `fpcId?`, `inPublic?`)
instead of the whole `FeeMethodOption`. Storage migration: old records
with extra fields are still readable; the new resolver ignores anything
not in the thin shape. Old rename / asset / balance staleness becomes
impossible by construction.

### 5. `runInit()` shape after the change

```ts
const runInit = async () => {
  try {
    if (!props.network || !props.account || (isCustomMethod.value && !useOwnMethod.value)) return

    isInitComplete.value = false

    const saved = await readSaved()
    if (saved?.[props.account.address]) {
      previewSelection.value = pickPreview(saved[props.account.address])
    }

    // Snapshot user-set selection so we can detect user picks during the await.
    const selectionAtStart = selectedMethod.value

    isLoading.value = true
    const [gasResult, tokenBalances, fpcs] = await Promise.all([
      executionService.getGasBalances(props.network.id, props.account.address),
      tokenBalanceService.getTokenBalances(undefined, props.account.address),
      fpcService.getFpcs(props.network.chainId),
    ])
    gasBalances.value = gasResult
    balances.value = tokenBalances
    registeredFpcs.value = fpcs ?? []

    // If the user picked something during the await, respect it. No reconciliation, no auto-select.
    if (selectedMethod.value === selectionAtStart) {
      const resolved = resolveSaved(saved?.[props.account.address], methods.value, balances.value)
      if (resolved) {
        selectedMethod.value = resolved
      } else {
        const sponsored = methods.value.find((m) => m.fpc?.type === FpcType.DefaultSponsoredFpc)
        if (sponsored) selectedMethod.value = { ...sponsored, balance: undefined, inPublic: undefined }
      }
    }

    isInitComplete.value = true
    previewSelection.value = undefined  // selectedMethod is now the source of truth
  } catch (e) {
    console.error("Failed to init", getErrorData(e))
    error.value = getErrorMessage(e)
  } finally {
    isLoading.value = false
  }
}
```

Properties:
- **No tail save.** Auto-selected sponsored is not persisted (deterministic
  from fresh fpc list). Removes the async TOCTOU codex flagged.
- **User pick during init is preserved** via the `selectionAtStart`
  identity check.
- **Saved-selection resolution is fresh.** Stored object is never
  trusted for balance / fpc.name; we look those up against the
  freshly-loaded refs.
- **Existing `initInFlight` / `initRequested` coalescing** is preserved
  (it sits one level up in `init()`, see lines 153-175 of the current
  file). v2 doesn't change that wrapper.

### 6. New watcher: `useOwnMethod` triggers init

```ts
watch(useOwnMethod, async (val) => {
  if (val && !isInitComplete.value) {
    await init()
  }
})
```

Tiny additive fix: clicking "Override with my method" now kicks the
fetch pipeline so balances/fpcs are loaded for the dropdown. Currently
this is broken (init returns early when isCustomMethod && !useOwnMethod
on mount, and useOwnMethod toggling doesn't re-fire init). Listed in
non-goals as an unrelated pre-existing bug, but cheap enough to fix
here. **Decision pending — flag in PR description and let reviewer
decide.**

### 7. `persistSelection` shape

```ts
type PersistedSelection =
  | { type: "fj" }
  | { type: "private_fpc" }
  | { type: "fpc"; fpcId: string; inPublic?: boolean }

async function persistSelection(method: FeeMethodOption): Promise<void> {
  const record: PersistedSelection | undefined =
    method.type === "fj" ? { type: "fj" }
    : method.type === "private_fpc" ? { type: "private_fpc" }
    : method.type === "fpc" && method.fpc ? { type: "fpc", fpcId: method.fpc.id, inPublic: method.inPublic }
    : undefined
  if (!record) return

  const fpms = (await chrome.storage.local.get(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
  fpms[props.account.address] = record
  await chrome.storage.local.set({ [FEE_METHOD_LS_KEY]: fpms })

  if (record.type === "fpc" || record.type === "private_fpc") {
    const idx = cacheStore.feePaymentMethods.findIndex((m) => m.id === methodId)
    const entry = { id: methodId, fpc: method.fpc }
    if (idx === -1) cacheStore.feePaymentMethods.push(entry)
    else cacheStore.feePaymentMethods[idx] = entry
  }
}
```

The TOCTOU on `chrome.storage.local.get` → `set` is preserved (single
read-modify-write window). Mitigated because v2 only persists from
explicit user actions — concurrent user-action races are vanishingly
rare in a popup, and even if they occur, the loser is just an older
selection, not a corrupted one. Keeping it sequential keeps the diff
small. If we ever observe a real race, switch to a `chrome.storage.local`
mutex pattern in a follow-up.

## Phase breakdown

Validate after each phase: `bun run typecheck && bun run lint && bun run test src/popup/components/modules/send && bun run build`. Fail-fast on first error.

### Phase 0 — Capture the bug as a failing test

Add `FeeSettingsCard.test.ts` with the saved-fj bug pin:

- Mount with stubbed services where `getGasBalances` returns a
  manually-resolved promise.
- `chrome.storage.local.get` returns a saved `fj` selection.
- Before the gas promise resolves, assert `update:modelValue` was NOT
  emitted with truthy settings.
- Resolve the gas promise.
- After `nextTick`, assert `update:modelValue` was emitted with
  `{ paymentMethod: { kind: "fj" } }`.

Commit failing test first; current `master` should fail this. Confirms
Phase 1 actually fixes the regression.

### Phase 1 — Implement the architectural change

Apply changes 1–7 from the architecture section. After Phase 1:
- Phase 0 test passes.
- All new contracts (computed-derivation, explicit save, semantic
  resolver, snapshot guard, no tail save) are in place.

### Phase 2 — Backfill the remaining test inventory

Below, in the Test Inventory section. Aim for ≥15 tests on the
component.

### Phase 3 — Manual smoke

Build, load extension, manually verify each scenario in the matrix.
Test via playground for the execute window. Specifically test the
codex-flagged scenarios:
- Balance-deleted clears `op.feeSettings` in the execute window.
- User picks a method during init, doesn't get overwritten.
- Open multiple cards (execute window with multi-op payload), each
  card maintains independent state.

### Phase 4 — Pre-PR gate + ship

`bun run audit:vue` then `gh pr create`.

## Test inventory

All in `packages/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts`.

**Mounting & init contract:**
1. ❌→✅ **(BUG PIN)** Mount with saved `fj` + delayed gas: emits valid
   settings only after gas resolves.
2. ❌→✅ **(BUG PIN, post-#66)** Mount with saved `private_fpc` + delayed
   gas (privateFeeJuice starts null): emits valid settings only after
   gas resolves with non-zero privateFeeJuice.
3. ❌→✅ **(BUG PIN)** Mount with saved DefaultFpc that has zero stored
   balance + delayed gas: emits valid settings only after gas + balance
   resolve.
4. Mount with no saved method, sponsored available: auto-selects
   sponsored, emits valid settings exactly once.
5. Mount with no saved method, no sponsored: emits no truthy settings
   (stays undefined).
6. Mount with saved DefaultFpc + matching current balance: emits valid
   settings with `inPublic` carried through from saved.
7. Mount with saved DefaultFpc + zero current balance: emits
   `undefined` (correct — can't pay with 0 balance).
8. Mount with saved DefaultSponsoredFpc: emits valid settings.
9. Mount with stale saved record (fpcId no longer in fresh fpcs):
   resolveSaved returns undefined, falls through to sponsored auto-
   select.

**User actions:**
9. Pick `fj` from dropdown after init: emits valid settings, calls
   `chrome.storage.local.set` with `{ type: "fj" }`.
10. Pick same DefaultFpc twice: `chrome.storage.local.set` called
    twice (idempotent), `cacheStore.feePaymentMethods` has exactly one
    entry for this `methodId`.
11. Toggle `inPublic`: emits new settings with toggled `inPublic`,
    persistSelection called.
12. `handleUseEmbedded`: emits `{ paymentMethod: { kind: "embedded" } }`,
    `selectedMethod` is undefined, persistSelection NOT called.
13. `handleUseOwnMethod` after embedded: useEmbeddedFee=false, init
    runs and loads balances.
14. Priority change: emits settings with `priorityLevel` set; payment
    method preserved.

**Reactivity & lifecycle (codex's gap-fillers):**
15. `onBalanceDeleted` clears `selectedMethod`: settings re-emitted as
    `undefined`. **(parent must not retain stale settings)**
16. `onFpcDeleted` clears `selectedMethod`: settings re-emitted as
    `undefined`.
17. `onBalanceUpdated` updates the selected method's balance: settings
    re-emitted with new balance reflected; persistSelection NOT called.
18. `onFpcUpdated` renames the selected fpc: name display updates;
    persistSelection NOT called.
19. User picks a method during init (between pre-fill and Promise.all
    resolution): user's pick is preserved; reconciliation does not
    overwrite.
20. Account prop change: `runInit` re-fires, `isInitComplete` cycles
    false→true, settings re-emitted for the new account's saved record.
21. Concurrent `init()` calls coalesce (existing `initInFlight` guard
    still works).
22. Unmount during in-flight init: queued re-run suppressed via
    `isMounted` guard; no errors thrown post-unmount.

**Side-effect isolation:**
23. Saved fj race scenario from test 1: `chrome.storage.local.set` is
    NOT called during init (auto-resolution doesn't persist).
24. User picks same method as the auto-resolved one: storage IS
    written (intent — even if same value).

Stubs: `executionService.getGasBalances`, `tokenBalanceService` events
+ method, `fpcService.getFpcs`, `chrome.storage.local.{get,set}` (the
last via the global `chrome` stub at `tests/vitest.setup.ts:88-113`).
Use `createTestingPinia` for cacheStore.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| `previewSelection` prop on `FeeMethodSelector` adds API surface. | Optional prop with default `undefined`. Existing call sites unaffected. New test 1 / 2 cover the trigger label fallback path. |
| `useOwnMethod` triggering init opens a new path that wasn't covered before. | Test 13 covers it explicitly; Phase 3 manual test against the playground confirms execute-window embedded → override flow. |
| Storage-record migration: old records have extra fields (`title`, `balance` snapshot, etc.). | New resolver ignores extra fields (TS typing is loose at the storage boundary). New writes use the thin shape. No breaking change. |
| Auto-select-of-sponsored no longer persists — first-load behavior changes. | Auto-select runs deterministically every load given the same fpc list, so user-visible behavior is identical. Removes one TOCTOU surface. Worth a release-note line. |
| `chrome.storage.local` get-then-set TOCTOU on rapid double-clicks. | Already exists in master; v2 doesn't worsen it. Real fix is a serialization layer; deferred unless observed. |
| Pre-existing `useOwnMethod` no-init bug — fix may surface in unexpected ways. | Phase 3 manual smoke against execute window playground. If risky, drop §6 from this PR and ship as a follow-up. |

## Open questions for review

1. Does removing the auto-select-sponsored persistence have any caller
   that depends on the storage entry existing? **Hypothesis:** no —
   `cacheStore.feePaymentMethods` is the only cross-component read,
   and we still push for fpc selections on user action.
2. Should §6 (`useOwnMethod` triggers init) ship in this PR or as a
   follow-up? **Default:** include it — small additive fix, well-tested
   in isolation.
3. Are there any other consumers of `chrome.storage.local[FEE_METHOD_LS_KEY]`
   we need to keep backwards-compatible for? **Hypothesis:** none,
   based on grep.

## Changelog vs v1

- **Critical fix:** derivation is now a `computed` that always emits
  current state, not a watcher with early-return that leaves stale
  parent state on `selectedMethod = undefined`.
- **Critical fix:** save side effects moved to explicit user-action
  handlers; deep-watcher save dropped.
- **High fix:** snapshot-based guard on the init-window overwrite
  scenario.
- **High fix:** dropped tail `await saveSelectedMethod`; removed the
  init-vs-user-action TOCTOU surface.
- **Medium fix:** persisted record is now a thin semantic key, not the
  whole FeeMethodOption snapshot. resolveSaved looks up against fresh
  methods.
- **Medium fix:** test inventory grew from 16 → 24 to cover
  `onBalance{Updated,Deleted}` / `onFpc{Updated,Deleted}` /
  user-pick-during-init / stale-record scenarios.
- **Diagnosis refinement:** DefaultFpc bug condition spelled out
  precisely (depends on stored balance snapshot).
