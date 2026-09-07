# Cluster X — cross-cutting sweep (apps/extension/src + wallet-core/wallet-crypto/extension-messaging/aztec-runtime/wallet-bridge)

## Cluster verdict

The layer boundaries and several base abstractions (`BaseService`/`BaseServiceClient`, `usePopupEntity`, `fee-estimation-engine.ts`, `formatBaseUnits`, `@nulo/wallet-core/utils/encoding`) are genuinely well-factored — this codebase has already been through at least one dedup pass, and several files carry comments documenting a past "N sites hand-copied this" cleanup. The remaining duplication is not architectural, it's **call-site drift**: helpers exist but a meaningful fraction of call sites reimplement the same 1–6 line idiom instead of importing them. The single biggest lever is the `err instanceof Error ? err.message : String(err)` ternary, reimplemented inline **38 times across 29 files** despite `getErrorMessage` already existing in `wallet-core` and being used 38 other places — including one reimplementation inside `wallet-core` itself. The second biggest is a `copyToClipboard(...)` wrapper pattern hand-copied at **17 Vue call sites**. Rough total removable: **150–200 LOC**, concentrated in 3 findings; the rest of the sweep (base64 helpers, deferred-promise idiom, one in-file scheduler pair, three popups not adopting an existing composable) is smaller but still real.

## Findings

### F1 [duplication] `copyToClipboard(...)` wrapper hand-copied at 17 Vue call sites

- **Where:**
  - `apps/extension/src/utils/clipboard.ts:30` — the shared primitive (fine, keep).
  - `apps/extension/src/components/header-copy-address.ts:11` — the ONE existing higher-level wrapper (`copyAddressToClipboard`), used only by `Header.vue:150`.
  - 17 sites re-implement the wrapper inline instead of calling a shared one: `apps/extension/src/composables/useProfileImportFlow.ts:71`, `apps/extension/src/popup/pages/tx/[id].vue:108`, `apps/extension/src/popup/components/modules/general/BalanceView.vue:137`, `apps/extension/src/popup/components/popups/TokenMetadataPopup.vue:43`, `apps/extension/src/popup/components/popups/ReceivePopup.vue:30`, `apps/extension/src/popup/components/popups/EditFpcPopup.vue:153`, `apps/extension/src/popup/components/popups/AccountsPopup.vue:49`, `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:134`, `apps/extension/src/popup/pages/settings/about.vue:23`, `apps/extension/src/popup/pages/settings/accounts/index.vue:73`, `apps/extension/src/components/ScopeClassId.vue:24`, `apps/extension/src/popup/pages/settings/fpcs/index.vue:76`, `apps/extension/src/components/ScopeAddress.vue:53`, `apps/extension/src/popup/pages/settings/contacts/index.vue:123`, `apps/extension/src/components/JsonViewer/JsonViewer.vue:78`, `apps/extension/src/popup/pages/settings/advanced/account-state/senders/index.vue:63`, `apps/extension/src/popup/pages/tokens/[id].vue:105`.

- **Evidence** (all 17 sites share this exact failure branch verbatim):
  ```ts
  // apps/extension/src/popup/pages/settings/about.vue:22-27
  const handleCopy = (target) => {
      void copyToClipboard(target, openToast, {
          success: { label: "Version is copied" },
          failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
      })
  }
  ```
  ```ts
  // apps/extension/src/popup/pages/tokens/[id].vue:104-109
  const handleCopy = (value, label) => {
      void copyToClipboard(value, openToast, {
          success: { label: `${label} is copied` },
          failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
      })
  }
  ```
  ```ts
  // apps/extension/src/components/header-copy-address.ts:11-18 (the one existing wrapper — only Header.vue uses it)
  export async function copyAddressToClipboard(address: string | null | undefined, openToast: ToastFn): Promise<boolean> {
      if (!address) return false
      return copyToClipboard(address, openToast, {
          success: { label: "Address is copied", icon: "copy" },
          failure: { label: "Couldn't copy address", icon: "warning", duration: 3_000 },
          sanitize: true,
      })
  }
  ```
  Two sites (`AccountsPopup.vue:44-56`, `senders/index.vue:60-70`) additionally hand-roll an identical "flash then reset after N ms" `isCopied`/`copiedAddress` ref around the same call.

- **Refactor:** Add one function to `apps/extension/src/utils/clipboard.ts` (or extend `header-copy-address.ts`) — `copyWithToast(value, openToast, successLabel)` — that fixes the `failure: {label:"Couldn't copy", icon:"warning", duration:3_000}` branch and takes only a success label. Every one of the 17 sites collapses from 4–6 lines to a 1-line call. Optionally fold the 2 "flash" sites into a tiny `useCopyFlash()` composable (C0) alongside it. Lives in `apps/extension/src/utils/clipboard.ts` (L below composables, already the layer other copy call sites import from).
- **LOC delta:** ~-60 (17 sites × ~4 lines saved, +~8 for the new helper).
- **Risk / tests:** low. `apps/extension/src/utils/clipboard.test.ts` covers the primitive; `apps/extension/src/components/header-copy-address.test.ts` is the pattern to extend for the new helper. Vue call sites have no dedicated unit tests (L4/L5, not required per CLAUDE.md) — verify via `bun run test:e2e` smoke touching Send/Receive/Contacts/Settings screens that already click copy buttons.
- **Confidence:** high.

### F2 [duplication] `getErrorMessage` reimplemented inline 38 times, including once inside its own package

- **Where:** canonical helper at `packages/wallet-core/src/utils/errors.ts:29`, imported and used correctly at 38 other sites. The inline reimplementation `err instanceof Error ? err.message : String(err)` (or `error`/`e` variants) appears at 38 sites across 29 files, e.g.: `packages/wallet-core/src/migration/migrator.ts:454-456` (a private `function message(err) {...}` duplicate **inside wallet-core itself**), `packages/wallet-core/src/migration/staging.ts`, `packages/wallet-core/src/base/index.ts`, `packages/extension-messaging/src/core/base-client.ts:211`, `packages/aztec-runtime/src/pxe/client.ts:149`, `packages/aztec-runtime/src/pxe/service.ts`, `packages/aztec-runtime/src/pxe/opfs-store.ts`, `packages/aztec-runtime/src/pxe/public-events.ts`, `apps/extension/src/wallet/services/execution/execution-coordinator.ts:96,170`, `apps/extension/src/wallet/services/window-manager/window-manager.ts`, `apps/extension/src/wallet/config/store.ts`, `apps/extension/src/stores/balances.store.ts:513,551`, `apps/extension/src/utils/restore-error.ts:14`, `apps/extension/src/composables/full-backup-restore.ts:195,363`, `apps/extension/src/composables/useProfileImportFlow.ts:65`, `apps/extension/src/composables/useFullBackupImport.ts`, `apps/extension/src/core/adapters/clock-ticker-adapter.ts`, `apps/extension/src/utils/files.ts`, `apps/extension/src/popup/profile-bootstrap.ts`, `apps/extension/src/popup/pages/send-amount.ts`, and 9 popup SFCs (`NewTokenPopup.vue`, `NewEndpointPopup.vue`, `NewNetworkPopup.vue`, `EditEndpointPopup.vue`, `EditFpcPopup.vue`, `change-password.vue`, `networks/[id].vue`, `accounts/import.vue`, `account-state/notes/index.vue`).

- **Evidence:**
  ```ts
  // packages/wallet-core/src/utils/errors.ts:29 — the canonical helper, already imported 38× elsewhere
  export const getErrorMessage = (error: unknown) => (error as Error)?.message ?? (error as string) ?? "Unknown error"
  ```
  ```ts
  // packages/wallet-core/src/migration/migrator.ts:454-456 — reimplemented in the SAME package
  function message(err: unknown): string {
      return err instanceof Error ? err.message : String(err)
  }
  ```
  ```ts
  // apps/extension/src/wallet/services/execution/execution-coordinator.ts:96
  const message = error instanceof Error ? error.message : String(error)
  ```

- **Refactor:** Replace every inline ternary with `getErrorMessage(err)`, importing from `@nulo/wallet-core/utils`. Delete `migrator.ts`'s local `message()` and its call sites. Note: `getErrorMessage` is duck-typed (`(error as Error)?.message`) rather than `instanceof`-gated, and falls back to casting the thrown value to `string` rather than calling `String()` on it — behaviorally identical for `Error` and `string` throws (the overwhelming majority here), but a thrown plain object or number renders differently (`getErrorMessage(42)` → `42`; `String(42)` → `"42"`, same visible text; a thrown non-Error object would differ). Worth a spot check on the 2–3 sites that catch structured cause values (e.g. `execution-coordinator.ts:170`'s `{ cause: error instanceof Error ? ... }`).
- **LOC delta:** ~-20 net (mostly 1-for-1 line swaps plus deleting the migrator.ts duplicate function and its `message` references); the value is eliminating a semantically-inconsistent-in-the-edge-case pattern from 38 sites, not raw LOC.
- **Risk / tests:** low–med (only med on the object/number-throw edge case above). Covered by `packages/wallet-core/src/utils/errors.test.ts`; individual call sites are covered by their own service/composable test files where they exist (e.g. `execution-coordinator.test.ts`, `balances.store.test.ts`).
- **Confidence:** high.

### F3 [duplication] hand-rolled "extract resolve/reject from `new Promise`" idiom, 6 sites

- **Where:** `packages/wallet-core/src/utils/rw-guard.ts:20-26` (local `deferred<T>()`), `apps/extension/src/wallet/services/execution/execution-mutex.ts:114-118`, `apps/extension/src/wallet/services/wallet-sdk/session-baton.ts:26-30`, `apps/extension/src/wallet/services/window-manager/window-manager.ts:69-75`, `apps/extension/src/wallet/utils/offscreen.ts:10-13`, `apps/extension/src/wallet/services/wallet-sdk/background.ts:779-783`.
- **Evidence:**
  ```ts
  // packages/wallet-core/src/utils/rw-guard.ts:20-26
  function deferred<T = void>(): Deferred<T> {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((res) => {
          resolve = res
      })
      return { promise, resolve }
  }
  ```
  ```ts
  // apps/extension/src/wallet/services/window-manager/window-manager.ts:69-75
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
  })
  ```
  ```ts
  // apps/extension/src/wallet/services/wallet-sdk/session-baton.ts:26-30
  let resolveBaton!: () => void
  const baton = new Promise<void>((resolve) => {
      resolveBaton = resolve
  })
  ```
  `@aztec/foundation/promise` already ships `promiseWithResolvers<T>(): { promise, resolve, reject }` as a documented polyfill for the native (Node 22+/Chrome 119+) `Promise.withResolvers()` — both already available in this repo's runtime targets.
- **Refactor:** Export one `deferred<T>()` from `packages/wallet-core/src/utils/` (promote the existing `rw-guard.ts`-local one, or call `promiseWithResolvers` from `@aztec/foundation/promise` directly since it's already a dependency of `aztec-runtime`/consumers). Replace the 5 other hand-rolled sites. Lives in `wallet-core` (bottom of the layer stack — every other site already depends on it).
- **LOC delta:** ~-20 (6 sites × ~4 lines → 1-line calls, +4 for the exported helper).
- **Risk / tests:** low. Each site has its own unit coverage (`execution-mutex.test.ts`, `session-baton.test.ts`, `window-manager.test.ts`); `rw-guard.test.ts` covers the source implementation.
- **Confidence:** high.

### F4 [duplication] `startScheduler` / `startPublicScheduler` — near-identical epoch-fenced interval setup

- **Where:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:831-848` (`startScheduler`) and `:859-873` (`startPublicScheduler`).
- **Evidence:**
  ```ts
  // service.ts:831-848
  private startScheduler(profileId: string, networkId: string, accountAddress: string): void {
      const key = this.schedulerKey(networkId, accountAddress)
      if (this.schedulers.has(key)) return
      const bornAtEpoch = this.serviceEpoch
      const interval = setInterval(() => {
          if (this.serviceEpoch !== bornAtEpoch) return
          this.poll(profileId, networkId, accountAddress).catch((err) => {
              this.logWarn(`Poll failed: ${getErrorMessage(err)}`)
          })
      }, this.pollIntervalMs)
      this.schedulers.set(key, interval)
      this.poll(profileId, networkId, accountAddress).catch((err) => {
          this.logWarn(`Initial poll failed: ${getErrorMessage(err)}`)
      })
  }
  ```
  ```ts
  // service.ts:859-873
  private startPublicScheduler(profileId: string, networkId: string, contract: string): void {
      const key = this.publicSchedulerKey(networkId, contract)
      this.publicWatched.set(key, { profileId, networkId, contract })
      if (this.publicSchedulers.has(key)) return
      const bornAtEpoch = this.serviceEpoch
      const interval = setInterval(() => {
          if (this.serviceEpoch !== bornAtEpoch) return
          this.pollPublic(key).catch((err) => this.logWarn(`Public poll failed: ${getErrorMessage(err)}`))
      }, this.pollIntervalMs)
      this.publicSchedulers.set(key, interval)
      this.pollPublic(key).catch((err) => this.logWarn(`Initial public poll failed: ${getErrorMessage(err)}`))
  }
  ```
  Both implement identical semantics: guard on existing key → capture `serviceEpoch` → epoch-fenced `setInterval` → store handle in a map → immediate kick with the same error-swallow-and-log shape.
- **Refactor:** Extract a private helper `private scheduleEpochFencedPoll(key: string, map: Map<string, Timer>, pollFn: () => Promise<void>, failLabel: string): void` that both call with their own `pollFn`/label/map. Stays inside `incoming-transfer/service.ts` (private, same file) — no layer move needed.
- **LOC delta:** ~-15.
- **Risk / tests:** low–med (epoch-fencing is a documented subtle invariant — the comments at both sites explicitly warn about stale-interval races during hydrate/clear). Covered by `apps/extension/src/wallet/services/incoming-transfer/service.test.ts` and `service.scenarios.test.ts`.
- **Confidence:** med (mechanical extraction, but the epoch-fence comments suggest past bugs here — merge carefully and keep both comments attached to the shared helper).

### F5 [inconsistency] 3 popups hand-roll the watch+keydown-listener dance that `usePopupEntity` already extracted

- **Where:** `apps/extension/src/composables/usePopupEntity.ts` (the extracted composable, whose own doc comment says "Five popups hand-copied this exact predicate; this is its single source of truth"). Not yet migrated to it: `apps/extension/src/popup/components/popups/NewTokenPopup.vue:265-299` (uses `isPopupSubmitKey` directly but keeps its own `watch(props.show)` + `addEventListener`/`removeEventListener` wiring around 3 service-client disconnects), `apps/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue:98-122`, `apps/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:149-179`.
- **Evidence:**
  ```ts
  // ChangeAuthwitsRegistryPopup.vue:98-122 — disconnect BEFORE removeEventListener
  watch(
      () => props.show,
      async () => {
          if (props.show) {
              await fetchRegistryStatus()
              document.addEventListener("keydown", onKeydown)
          } else {
              isRegistryEnabled.value = undefined
              isLoading.value = false
              error.value = null
              authwitsService.disconnect()
              document.removeEventListener("keydown", onKeydown)
          }
      },
  )
  ```
  `usePopupEntity`'s own doc comment states the canonical order is "remove-before-onHide" — the opposite of what this popup does (`disconnect()` runs before `removeEventListener`). `RevokeAuthwitsPopup.vue` has the identical shape and ordering.
- **Refactor:** Migrate `ChangeAuthwitsRegistryPopup.vue` and `RevokeAuthwitsPopup.vue` to `usePopupEntity(show, { submit: handleChangeRegistry, onShow: fetchRegistryStatus, onHide: () => {...; authwitsService.disconnect()} })`, moving their custom `isAllowedToExecute && !isLoading` submit guard inside the `submit` callback. `NewTokenPopup.vue` needs `submitWaitsForShow` (its `onShow` does an async `tokenService.getTokens` before submit should be live) and its 3-service-disconnect `onHide`. All three keep their app-specific enter-guards; only the wiring boilerplate moves. Composable already lives at C1 (`apps/extension/src/composables/usePopupEntity.ts`).
- **LOC delta:** ~-45 (3 sites × ~15 lines of watch/listener wiring collapse to a single `usePopupEntity(...)` call each).
- **Risk / tests:** med — this is exactly the kind of order-sensitive migration `usePopupEntity`'s own doc comment warns is easy to get subtly wrong (it explicitly preserves "same listener add/remove ORDER" from the hand-rolled originals, which itself is proof the order differs today). `usePopupEntity.test.ts` covers the composable in isolation; these 3 popups have no dedicated unit tests (L5, not required) — verify via e2e flows touching authwit revoke/registry-change and add-token.
- **Confidence:** med (real, but the differing per-popup submit guards make this a "flag for the owner to migrate deliberately" rather than a pure mechanical extraction).

### F6 [inconsistency] base64 ⇄ bytes done via `Buffer` in some files, via the Buffer-free `wallet-core` helpers in others

- **Where:** canonical helpers `packages/wallet-core/src/utils/encoding.ts:21` (`toBase64`) and `:34` (`fromBase64`), already imported correctly by `apps/extension/src/utils/full-backup-helpers.ts:7`, `apps/extension/src/wallet/utils/passkey-ceremony.ts:21`, and `packages/aztec-runtime/src/account/account-export.ts:22`. Reimplemented via Node `Buffer` instead: `apps/extension/src/composables/useFullBackupImport.ts:391` and `apps/extension/src/wallet/services/dapp-session/integrity.ts:51,58`.
- **Evidence:**
  ```ts
  // useFullBackupImport.ts:391
  const encryptedBytes = new Uint8Array(Buffer.from(sealed, "base64"))
  ```
  ```ts
  // dapp-session/integrity.ts:50-58
  export async function signDappSession(key: CryptoKey, row: SignableDappSession): Promise<string> {
      const mac = await crypto.subtle.sign("HMAC", key, canonicalizeDappSession(row))
      return Buffer.from(new Uint8Array(mac)).toString("base64")
  }
  export async function verifyDappSession(key: CryptoKey, row: SignableDappSession, mac: string): Promise<boolean> {
      let macBytes: Uint8Array<ArrayBuffer>
      try {
          macBytes = new Uint8Array(Buffer.from(mac, "base64"))
      } catch { return false }
  ```
  vs. the sibling that already does it the canonical way:
  ```ts
  // full-backup-helpers.ts:7,46
  import { fromBase64 } from "@/wallet/utils"
  const bytes = fromBase64(trimmed)
  ```
- **Refactor:** Swap both sites to `toBase64`/`fromBase64` (already re-exported at `@/wallet/utils`). `fromBase64` already returns `Uint8Array<ArrayBuffer>`, so `useFullBackupImport.ts:391` drops the `Buffer.from`+wrap entirely; `integrity.ts` drops both `Buffer.from(...).toString("base64")` and `new Uint8Array(Buffer.from(mac, "base64"))`. (Not proposing this for `wallet/services/account/service.ts` or `wallet/services/profile/service.ts`, which also use `Buffer.from(..., "base64")` around secret-key material — those interleave with `zeroize()` calls and in one case need an actual `Buffer` instance for `GrumpkinScalar.fromBuffer`/`Fr.fromBuffer`, so touching them is a security-review-worthy change, not a mechanical dedup.)
- **LOC delta:** ~-8.
- **Risk / tests:** low for the 2 proposed sites (no secret zeroization involved). Covered by `apps/extension/src/composables/useFullBackupImport.test.ts` and `apps/extension/src/wallet/services/dapp-session/integrity.test.ts`.
- **Confidence:** med (small in isolation; flagged mainly because it's an inconsistency against an already-established, actively-used shared helper in the same layer).

## Not worth it

- **`trimAddress` "three separator styles" duplication** (`apps/extension/src/utils/string.ts:6-13`) — checked the hand-rolled `.slice(0,N)…slice(-M)` truncations in `TransactionCard.vue`, `RecipientCard.vue`, `TokenMetadataPopup.vue`, etc.; `trimAddress`'s own doc comment explicitly documents this as an **owner-deferred decision** ("Unifying the visual style is a deliberate owner decision, not a refactor side effect") — not proposing a fix.
- **`OperationKind` defined in both `operation-journal/spec.ts` and `wallet-bridge/operation.ts`** — same name, unrelated domains (journal-entry kind vs. wallet-sdk dispatch kind); not duplication.
- **`EventMessage`/`RequestMessage`/`ResponseMessage` in `extension-messaging/src/messages.ts` and `offscreen/messages.ts`** — the offscreen versions are intersection types over the base ones (`BaseEventMessage<T> & MessageExt`), a legitimate extension, not a copy.
- **`background/service.ts` vs `offscreen/service.ts`** (`export abstract class Service<...> extends BaseService<...>` in both) — genuinely different transport implementations (persistent `chrome.runtime.Port` fan-out vs. one-shot `sendMessage` + keepalive) sharing lifecycle via `BaseService`; a working template-method split, not duplication.
- **debounce** — already centralized: generic `debounce()` in `apps/extension/src/utils/general.ts`, and the fee-estimation-specific debounce consolidated into `apps/extension/src/composables/internal/fee-estimation-engine.ts`, consumed by both `useFeeEstimation.ts` and `useFeeEstimationMap.ts`. No action.
- **Storybook `Default`/`VariantMatrix`/`StateMatrix`/`WithTrailing` export-name collisions** — all in `*.stories.ts` dev-tooling files, out of scope for production dedup.
