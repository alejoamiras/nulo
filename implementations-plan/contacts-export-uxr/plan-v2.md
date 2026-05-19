# Contacts export UX rework — plan v2

Date: 2026-04-29
Supersedes: `plan-v1.md`
Audits: `audit-codex.md` (gpt-5.4 xhigh), `audit-plan-agent.md` (Opus 4.7, 1M ctx — written inline below in the audit-plan-agent file)

## Headline changes from v1

| Topic | v1 | v2 |
|---|---|---|
| Export ownership | Moves to SW (ContactService injects AccountStateService) | **Stays popup-orchestrated** (Plan-agent pivot). SW gets a tiny thin download primitive only. Zero domain coupling. |
| URL form for `chrome.downloads.download` | Blob URL via `URL.createObjectURL` | **Data URL** (both audits flagged BLOCKING — `URL.createObjectURL` not available in MV3 SW; also dual-platform Firefox event-page concern) |
| Loading UX | Toast w/ status replacement (30s safety duration) | **Inline spinner in SubPageHeader trailing slot + completion toast** (Plan-agent rec). Side-steps the toast composable's orphan-setTimeout bug entirely. |
| Filename resolution | Popup-side | Popup-side (kept; matches popup-orchestrated shape) |
| Parallelism test | "Throw on one network, assert other was called" | **Deferred-promise / pending-microtask approach** (codex flagged the throw-test doesn't actually prove parallelism — serial impl catches and continues). |
| Commit structure | One follow-up commit | **Three commits on the same branch** (parallelism / loading-state / SW download primitive). Better bisect granularity. |
| AccountStateService injection into ContactService | Yes | **No.** Avoids re-introducing the sender-domain coupling the previous audit specifically warned against. |
| ContactService `exportContacts(): string` revival | Yes (canonical builder) | **No** — popup builds JSON inline as today. The "dead-code revival" from the prior audit is unrelated to popup-close survival; don't pile improvements. |

## Decisions confirmed (post-audit)

- **Popup-orchestrated everywhere** (Plan-agent's pivot). Mixed Option-A/Option-B framing dissolves: both export AND import stay popup-driven; the SW just owns the bare download primitive.
- **Data URL** for `chrome.downloads.download` (the SW-safe form).
- **Inline spinner** is the primary loading signal; completion toast remains for success/failure.
- **Three commits** on `pre-a11/contacts-export-isSender`.

## Audit-finding deltas

### From codex (xhigh)

- **BLOCKING #1**: `URL.createObjectURL` not in SW. → Adopted: data URL.
- **SHOULD-FIX #2 (orphan-timer affects flow)**: a pending "Address copied" or "Contact deleted" toast (1.5–4s) overlaps the export click; the orphan timer would clear the loading toast early. → Side-stepped by removing the loading toast (inline spinner instead). If we ever reintroduce a loading toast we'll fix the composable too.
- **SHOULD-FIX #3 (filename in SW)**: codex argues moving filename to SW closes the last popup-close gap. → Rejected in favor of Plan-agent's popup-orchestrated shape; the gap between popup-side JSON build and SW dispatch is microseconds (no real survival risk).
- **SHOULD-FIX #4 (parallelism test invalid)**: throw-test doesn't prove parallelism in current serial impl. → Adopted: deferred-promise test.
- **NICE #1 (test stubs)**: `chrome.downloads` not in vitest setup. → Will add stubs in the test file.
- **NICE #2 (concurrent click guard)**: Naturally handled by inline spinner (the menu trigger transforms into the spinner; can't double-click).
- **VERIFIED**: manifest + permission gesture chain + RPC popup-close semantics all sound.

### From Plan agent (architect)

- **BLOCKING #1**: Same as codex — blob URL in SW. → Adopted: data URL.
- **SHOULD-FIX #2/#3 (don't inject AccountStateService into ContactService; mixed shape unstable)**: → **Adopted as the headline pivot**. Popup-orchestrated; SW only owns the download primitive.
- **SHOULD-FIX #4 (inline spinner > toast for loading)**: → Adopted as primary signal. Toast remains for completion only.
- **SHOULD-FIX #5 (more tests)**: filename sanitization, concurrent click, callback edge cases. → Adopted, see test plan.
- **SHOULD-FIX #6 (popup-close success "ghosts" without an OperationJournal record)**: → Out of scope for this branch; worth a follow-up issue. Pre-launch: download-folder presence is the signal.
- **SHOULD-FIX #7 (orphan-timer doesn't actually trigger in our flow)**: agrees the loading→completion sequence is safe. But codex disagrees with a concrete trigger (pending toast pre-export). Codex's argument is sharper. → Side-stepped via inline spinner.
- **SHOULD-FIX #8 (3 commits)**: → Adopted.
- **SHOULD-FIX #9 (30s loading-toast duration is wrong)**: → Moot — no loading toast.
- **NICE #11 (OperationJournal export record)**: → Out of scope; follow-up.

## Final architecture

```
popup (handleExportContacts):
  1. ensurePermissions({downloads})              ← gesture-bound, must be first
  2. isExporting = true                          ← inline spinner appears
  3. senderUnion ← accountStateService.getSendersAcrossActiveNetworks()  ← already SW-side via RPC
  4. profile name → filename                     ← ProfileServiceClient round-trip
  5. JSON.stringify(v2 envelope)                 ← in-popup, fast
  6. await contactService.downloadAsFile(filename, json)  ← THIN SW primitive
  7. closeToast() / openToast(success|failure)   ← brutalist completion
  8. isExporting = false                         ← spinner gone

SW (ContactService.downloadAsFile):
  1. data URL ← `data:application/json;charset=utf-8;base64,${utf8ToBase64(json)}`
  2. await chrome.downloads.download({url, filename})
  3. throw on chrome.runtime.lastError or undefined downloadId
```

If popup closes between step 6 dispatch and SW completion, the SW request keeps running per repo's RPC transport semantics (`extension-messaging/src/background/service.ts:62-101`); the file lands in Downloads regardless. The popup-side toast is gone but the goal is met.

## Implementation plan

### Commit 1 — Parallelize cross-network sender query

`packages/extension/src/wallet/services/account-state/service.ts` `getSendersAcrossActiveNetworks`:

```ts
public async getSendersAcrossActiveNetworks(): Promise<string[]> {
  await this.ensureInitialized()
  const networks = await this.networkService.getNetworks()
  if (!networks.length) return []

  const seenChainIds = new Set<number>()
  const uniqueNetworks = networks.filter((n) => {
    if (seenChainIds.has(n.chainId)) return false
    seenChainIds.add(n.chainId)
    return true
  })

  const results = await Promise.allSettled(
    uniqueNetworks.map(async (n) => {
      const status = await this.networkService.getNodeStatus(n.id)
      if (status !== NodeStatus.Active) return [] as string[]
      return await this.getSenders(n.id)
    }),
  )

  const union = new Set<string>()
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === "fulfilled") {
      for (const addr of r.value) union.add(addr)
    } else {
      this.logError(`Failed to read senders on network ${uniqueNetworks[i].id}`, getErrorMessage(r.reason))
    }
  }
  return [...union]
}
```

**Test addition** (`account-state/service.test.ts`):

```ts
test("parallelizes — fast network result observable while a slow network is still pending", async () => {
  networkService.networks = [makeNetwork("net-a", 1), makeNetwork("net-b", 2)]
  networkService.statuses.set("net-a", NodeStatus.Active)
  networkService.statuses.set("net-b", NodeStatus.Active)

  const aDeferred = defer<string[]>()
  let bCalled = false
  vi.spyOn(accountStateService, "getSenders").mockImplementation(async (id) => {
    if (id === "net-a") return aDeferred.promise
    if (id === "net-b") { bCalled = true; return ["0xbob"] }
    return []
  })

  const promise = accountStateService.getSendersAcrossActiveNetworks()
  // Flush microtasks so the parallel dispatch completes
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(bCalled).toBe(true)  // serial-with-await impl wouldn't have called B yet

  aDeferred.resolve(["0xalice"])
  expect(new Set(await promise)).toEqual(new Set(["0xalice", "0xbob"]))
})
```

Helper `defer<T>()` lives in the test file. ~10 LoC.

### Commit 2 — Inline spinner loading state + completion toast

`packages/extension/src/popup/pages/settings/contacts/index.vue`:

1. Add `const isExporting = ref(false)` at the top of script.
2. In template, replace the SubPageHeader trailing dropdown trigger:
   ```vue
   <template #trailing>
     <Spinner v-if="isExporting" size="14" color="secondary" />
     <Dropdown v-else>
       <button ...><MaterialIcon name="more_vert" .../></button>
       <template #popup>...</template>
     </Dropdown>
   </template>
   ```
3. In `handleExportContacts`, set `isExporting = true` after permission grant, and `false` in `finally`.
4. Replace per-step toasts with: optional success toast on completion, failure toast on error. No loading toast (avoids the orphan-timer bug entirely).

Failure toast on permission denial stays as-is.

### Commit 3 — SW-side download primitive (popup-close survival)

`packages/extension/src/wallet/services/contact/spec.ts`: add to `Methods`:

```ts
/**
 * Materialize the given JSON string as a download via chrome.downloads.
 * Caller (popup) is responsible for ensuring the downloads permission is
 * already granted (gesture-bound — the SW cannot trigger the permission
 * prompt). The download survives popup-close per the RPC transport
 * contract.
 */
downloadAsFile(filename: string, json: string): void
```

`packages/extension/src/wallet/services/contact/service.ts`:

```ts
public async downloadAsFile(filename: string, json: string): Promise<void> {
  await this.ensureInitialized()

  // Data URL, not blob URL — URL.createObjectURL is not available in
  // MV3 service workers (Plan-agent + codex BLOCKING). Base64 keeps
  // unicode-safe via UTF-8 encoding.
  const utf8 = new TextEncoder().encode(json)
  let binary = ""
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i])
  const base64 = btoa(binary)
  const dataUrl = `data:application/json;charset=utf-8;base64,${base64}`

  await new Promise<number>((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "Download failed"))
        return
      }
      if (downloadId === undefined) {
        reject(new Error("Download cancelled"))
        return
      }
      resolve(downloadId)
    })
  })
}
```

`packages/extension/src/wallet/services/contact/client.ts`: add the RPC route.

`packages/extension/src/popup/pages/settings/contacts/index.vue`: replace `await downloadFile({...})` with `await contactService.downloadAsFile(filename, jsonString)`. Drop the popup-side `downloadFile` import + `ensurePermissions` import (they're no longer needed in this handler — wait, `ensurePermissions` is still needed because the popup must request the permission before the SW call). Keep `ensurePermissions`. Drop `downloadFile`.

### Test plan (consolidated)

#### `account-state/service.test.ts`

- (existing tests still pass)
- (new) parallelism test via deferred-promise (commit 1)

#### `wallet/services/contact/service.test.ts`

- (new) `downloadAsFile` calls `chrome.downloads.download` with a data URL beginning with `data:application/json;charset=utf-8;base64,` and the provided filename.
- (new) `downloadAsFile` resolves on success.
- (new) `downloadAsFile` rejects on `chrome.runtime.lastError`.
- (new) `downloadAsFile` rejects on `downloadId === undefined`.
- (new) `downloadAsFile` is unicode-safe (test with a contact name containing emoji).

Vitest setup needs `chrome.downloads` stubbed. Add to `tests/vitest.setup.ts` or scoped to the test file:

```ts
const downloadMock = vi.fn((opts: any, cb: (id: number) => void) => cb(1))
vi.stubGlobal("chrome", {
  ...globalThis.chrome,
  downloads: { download: downloadMock },
  runtime: { ...globalThis.chrome?.runtime, lastError: undefined },
})
```

#### `popup/pages/settings/contacts/index.vue` (component, optional)

Defer to manual QA. The handler is straightforward and exercising it via component test would require Vue test scaffolding the contacts page doesn't have today.

### Manual QA

1. **Happy path**: 2 contacts, mark Alice as sender. Click Export → permission prompt → spinner appears → file lands. Open file: v2 envelope, Alice has `isSender: true`. ✓
2. **Popup-close mid-export**: trigger an offline-network slow path (~5s sender union retries). Click Export → permission prompt → spinner appears → close popup. **File should still land in Downloads** (~5s later). Reopen popup: spinner is gone (popup state reset). ✓
3. **Concurrent click**: with inline spinner, the dropdown trigger is replaced — second click is impossible. ✓
4. **Permission denied**: deny the prompt. Failure toast: "Permission for downloads not granted". Spinner doesn't appear (or briefly appears + gone). ✓
5. **Filename with special chars**: profile name with `/`. Sanitize popup-side via existing `sanitizeString` before prepending. (Add: `sanitizeString(profile.name, 32)`.)
6. **Pending toast at click time**: copy a contact's address, then click Export within 1.5s. With inline spinner (no loading toast), no race. ✓ (Side-stepped.)

### Bump

0.13.37 → 0.13.38.

## Risks (consolidated)

1. **Inline spinner placement**: SubPageHeader trailing slot is consumer-owned, no API change required. Verified.
2. **Data URL size**: contacts JSON < 100KB even at 1000 contacts. Base64 inflation 33%. Well within `chrome.downloads.download` limits (no documented cap; data URLs up to several MB work). Acceptable.
3. **SW eviction during the brief download dispatch**: dispatched-and-running counts as activity; `chrome.downloads.download` keeps the SW alive for the call. Risk near-zero.
4. **Popup-close before SW dispatch**: tiny window between `JSON.stringify` and `await contactService.downloadAsFile(...)`. Microseconds. User can't physically close the popup that fast.
5. **OperationJournal "ghost success" gap**: if popup closes mid-export and reopens after completion, no surface notes the recent export. Pre-launch acceptable; download-folder presence is the signal. Follow-up: add a `contacts_export` journal kind.
6. **Toast composable orphan-timer**: side-stepped by skipping the loading toast. If we ever add a loading toast back, fix the composable first.
7. **Single-network purgatory still ~5s**: parallelism doesn't help the user with one offline network. Time-bounding `getNodeStatus` is risky (false-Inactive on blip); deferred.

## Open questions for user

1. **Inline spinner vs toast for loading state**. Plan-agent's audit flipped my v1 recommendation. The inline spinner is more visible, naturally suppresses double-clicks, and avoids the toast composable bug. Confirm switch?

2. **Toast composable orphan-timer fix**. Codex flagged it as a real trigger (pending "Address copied" toast at click time clearing a fresh export toast early). With the inline-spinner approach, we side-step it — the loading toast goes away. **OK to leave the orphan-timer bug as-is**, given we're not relying on the loading toast anymore? Or fix it as a tiny separate PR while we're in the area?

3. **OperationJournal `contacts_export` kind**. Plan-agent flagged that closing the popup mid-export "ghosts" the success — file lands but no popup-side surface notes the success on re-open. Follow-up issue, OR include in this branch?

4. **Filename sanitization**. The handler currently uses `sanitizeString(profile.name, 20)` already in scope. Plan-agent flagged that profile names with `/`, null bytes, etc. would crash `chrome.downloads.download`. Confirm we pass profile name through `sanitizeString` before prepending?

5. **Concurrent click guard via separate `isExporting` ref**. Inline spinner naturally suppresses but a defensive ref-based guard is one extra line. Worth it?
