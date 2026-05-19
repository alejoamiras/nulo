# Contacts export UX rework — popup-close survival + loading state + parallel network fan-out

Date: 2026-04-29
Branch (continuing): `pre-a11/contacts-export-isSender`
Status: DRAFT — awaiting dual-audit (codex xhigh + Plan agent) before execution.

## Context

PR #15 (`pre-a11/contacts-export-isSender`) shipped contacts export/import with sender persistence. QA on a single-network setup with the configured node offline surfaced three real UX issues:

1. **Popup-close cancels mid-export.** The export handler runs in popup-process. Slow `getNodeStatus` retries on an offline network mean the popup hangs ~5–7s during the sender-union query. If the user closes the popup during that window, the export is silently lost (no file, no toast, no recovery surface). The SW-side query keeps running but its response has nowhere to land — the popup-side `await` never resumes.
2. **No loading feedback.** Click → silence for ~5–7s → file appears or warning toast. The user can't tell whether the click registered.
3. **Serial network fan-out.** `getSendersAcrossActiveNetworks` iterates networks in a `for...of` loop. Each network's `getNodeStatus` retry burns its own ~5s budget when down. Worst case: N networks × 5s. For one-network users (most pre-launch), parallelization is no help; for multi-network users it cuts the worst case to `max(network)` instead of `sum(networks)`.

The user wants all three fixed in one branch.

## Decisions confirmed by user

- Deliver all three in one branch (continuing `pre-a11/contacts-export-isSender`).
- Loading UX: toast is acceptable. User asked for alternatives; recommended primary is toast with status replacement, secondary suggestion documented below.

---

## Loading UX — toast vs. alternatives

The `useToast()` composable is a singleton ref with `openToast(newToast, duration)` and `closeToast()` (`packages/extension/src/composables/toast.js`). `openToast` replaces the active toast; `closeToast` clears it immediately.

Alternatives considered:

| Option | Visibility | Implementation | Notes |
|---|---|---|---|
| **Toast w/ status replacement** (recommended) | Medium — bottom-of-screen, easy to miss visually | Existing composable, replace on completion | Simplest, fits codebase precedent; brutalist styling already there |
| Inline spinner in `SubPageHeader` trailing slot | High — replaces the three-dot icon during export | Modest — pass an `isBusy` prop to the SubPageHeader trailing dropdown trigger | Strongest signal but ties UI to the contacts page and complicates SubPageHeader API |
| Page-wide blocking modal/overlay | Highest — blocks all interaction | Heavy — new modal component, blocks legit user actions | Brutalist-incompatible, overkill for a 5–7s op |
| Disabled dropdown menu item with spinner | Low — only visible if user reopens menu | Modest, but dropdowns auto-close on click — user wouldn't see it without re-opening | Doesn't solve the "did my click register" question |
| Page-level loading bar (browser-style) | Medium | New primitive | No precedent in codebase |

**Recommendation**: toast w/ status replacement. Primary choice.

**If toast feels too soft after QA**, fallback: add an `isBusy` ref to the contacts page that swaps the SubPageHeader's trailing three-dot for a small inline spinner during export. That's a 10-line additive layer on top of the toast — would not require redesigning the toast.

---

## Implementation plan

### 1. Move export to SW (issue 1)

`chrome.downloads.download` is callable from a SW context in MV3 with a blob URL. The Aztec wallet's MV3 SW already has long-running ops (transactions, fee estimation) that survive the popup. Moving the export there:
- Survives popup close — the user's file lands in Downloads even if they navigate away.
- Frees the popup to show or skip a loading toast as appropriate.
- Reverses the audit's Option B (popup-direct) decision **for the export side only**. Import stays popup-direct because the `ImportContactsPopup` user-confirmation step in the middle is hard to route through SW. Mixed but justified.

#### ContactService changes (SW-side)

`packages/extension/src/wallet/services/contact/service.ts`:

- Inject `AccountStateService` in `init`.
- Update `exportContacts(): Promise<string>` to return the v2 envelope JSON with `isSender` per contact (currently this method is dead code per the prior audit; we revive it as the canonical builder).
- Add `exportContactsAndDownload(filename: string): Promise<void>`:
  - Calls `this.exportContacts()` to build the JSON.
  - Wraps the JSON in a `Blob` with `application/json` MIME type.
  - Creates a blob URL via `URL.createObjectURL(blob)`.
  - Calls `chrome.downloads.download({url, filename})`. Wraps the callback API in a Promise.
  - Cleans up via `URL.revokeObjectURL(url)` in a `finally`.
  - Throws on download failure (caller surfaces).

`packages/extension/src/wallet/services/contact/spec.ts`: add the new methods to the `Methods` type.

`packages/extension/src/wallet/services/contact/client.ts`: add the `exportContactsAndDownload(filename)` RPC route.

**Permission contract**: `chrome.permissions.request` requires a user-gesture context. The popup must call `ensurePermissions` first (gesture-bound), then call into SW (post-gesture is fine — `chrome.downloads.download` doesn't need a gesture once permission is granted). This is exactly the order we already have post-`f2b5d1e`; we keep it.

#### Popup-side `handleExportContacts` rewrite

`packages/extension/src/popup/pages/settings/contacts/index.vue`:

```js
async function handleExportContacts() {
  // 1. Permission ask FIRST (gesture-bound)
  const granted = await ensurePermissions({ permissions: ["downloads"] })
  if (!granted) {
    openToast({ label: "Permission for downloads not granted", icon: "warning" }, TOAST_DURATION.LONG)
    return
  }

  // 2. Resolve filename (still in popup; ProfileService client is light)
  let filename = "contacts.json"
  const profileService = new ProfileServiceClient()
  profileService.connect()
  try {
    const profile = await profileService.getActiveProfile()
    if (profile?.name) filename = `${profile.name}_${filename}`
  } catch (err) {
    console.error("Failed to resolve profile name for filename:", err)
  } finally {
    profileService.disconnect()
  }

  // 3. Loading toast (long duration — completion toast supersedes it)
  openToast({ label: "Exporting contacts…", icon: "download" }, 30_000)

  // 4. SW-side work
  try {
    await contactService.exportContactsAndDownload(filename)
    closeToast()
    openToast({ label: "Contacts exported successfully", icon: "download" })
  } catch (err) {
    closeToast()
    console.error("Export failed:", err.message || err)
    openToast({ label: "Failed to export contacts", icon: "warning" }, TOAST_DURATION.LONG)
  }
}
```

Notes:
- `closeToast()` is destructured from `useToast()` (currently only `openToast` is). One-line change.
- The 30s long-duration on the loading toast is a safety net: if the SW work hangs and the popup stays open, the toast eventually self-clears rather than persisting forever.
- Filename resolution stays popup-side. Could move to SW for a tighter API but ProfileService is also SW-side, so the round-trip count is the same; not worth the diff churn.

#### What happens when popup closes mid-export

- Popup `await contactService.exportContactsAndDownload(filename)` is abandoned.
- SW-side method continues to run.
- SW completes, calls `chrome.downloads.download`, file lands in Downloads.
- The popup's success/failure toast is gone (popup is closed) — but the file is there.
- If the user reopens the popup within a few seconds, no surface notes the recent export. Pre-launch acceptable; download-folder presence is the signal.

### 2. Loading toast (issue 2)

Already detailed in the popup-side block above. Two added behaviors:

- **Loading toast** appears immediately after permission grant: `"Exporting contacts…"` with download icon, 30s safety duration.
- **Completion toast** (success or failure) calls `closeToast()` first to dismiss the loading state, then `openToast()` with the result.

If the toast composable's `closeToast()` interaction with the staged setTimeout has any quirk (the existing implementation reassigns `closeTm` without clearing — an old timer can fire after a new toast appears, but in our flow the second toast finishes before the 30s timer would reach), we accept it. If it bites in QA, we patch the composable separately.

### 3. Parallelize network fan-out (issue 3)

`packages/extension/src/wallet/services/account-state/service.ts`:

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

Effect:
- Networks queried concurrently. Worst case: max(per-network latency) instead of sum.
- Error from one network doesn't abort others (Promise.allSettled).
- Logs preserve per-network failure attribution (we know which network failed).

For one-network users (most pre-launch): no improvement. For 2+: ~N× speedup on the worst case. Same correctness contract as before.

### Test plan

#### ContactService (extend `service.test.ts`)

Existing tests use `FakeProfileService`. The new AccountStateService dependency requires a `FakeAccountStateService` in the test setup. Add the fake at the top of the file; use it in the new tests.

Cases:
1. `exportContacts()` returns valid v2 envelope JSON with empty contacts array when none exist.
2. `exportContacts()` includes `isSender: true` for contacts whose address is in the AccountStateService union, `false` otherwise.
3. `exportContactsAndDownload()` calls `chrome.downloads.download` with the provided filename and a blob URL. Uses `vi.stubGlobal('chrome', {downloads: {download: vi.fn()}})` or similar to mock the API.
4. `exportContactsAndDownload()` revokes the blob URL after download.
5. `exportContactsAndDownload()` propagates download failure (chrome.runtime.lastError or download callback returning undefined).

#### AccountStateService (extend `service.test.ts`)

Existing tests should continue to pass with the parallelization (the OR semantics are unchanged). Add one parallelism-specific test:

6. Two Active networks: one slow, one fast. Use a deferred-resolution stub to verify the fast one's result is gathered without waiting for the slow one to fully resolve. Alternatively: stub the slow network with a `setTimeout` resolution; assert total wall time is closer to max(network) than sum.

(Note: time-based tests are flaky. A simpler proof-of-parallel: have one network's getSenders throw; assert the other network's getSenders was already invoked — which it would be under Promise.allSettled but not under serial-iteration-with-await.)

#### parseContactsExport (`contacts-export-format.test.ts`)

Unaffected. No new tests needed.

### Files touched (summary)

| File | Change |
|---|---|
| `wallet/services/contact/spec.ts` | Add `exportContactsAndDownload` to Methods |
| `wallet/services/contact/client.ts` | Add RPC route |
| `wallet/services/contact/service.ts` | Inject AccountStateService; revive `exportContacts()` with v2 + isSender; add `exportContactsAndDownload` |
| `wallet/services/contact/service.test.ts` | Add FakeAccountStateService; add 5 tests |
| `wallet/services/account-state/service.ts` | Parallelize `getSendersAcrossActiveNetworks` |
| `wallet/services/account-state/service.test.ts` | Add 1 parallelism test |
| `popup/pages/settings/contacts/index.vue` | Replace popup-side export logic with SW call + loading toast |

### Bump

0.13.37 → 0.13.38.

---

## Risks

1. **Architectural reversal** of the audit's prior Option B (popup-direct). We're going Option A for export only; import stays popup-direct because the user-confirmation popup makes a clean SW handoff awkward. Mixed shape; document explicitly.

2. **`chrome.downloads.download` from MV3 SW**: standard API, but worth verifying the project's MV3 setup doesn't have a host_permissions or sandbox quirk. The codebase already uses chrome.downloads from popup-side (`utils/files.ts`); SW invocation is the unverified bit.

3. **Blob URL lifecycle in SW**: `URL.createObjectURL` in SW is supported but the URL must be live during `chrome.downloads.download`'s initiation; it can be revoked once the download has been kicked off (the download itself reads the blob into the destination file before the URL gets revoked). Verify the order in implementation.

4. **Toast composable orphan timers**: `openToast` doesn't clear the previous setTimeout — the orphan can fire on an unrelated subsequent toast. Existing bug, not introduced by this change. Document; patch separately if it bites.

5. **Filename resolution still popup-side**: minor — if popup closes between permission grant and SW call, the SW call never fires (popup-side handler can't dispatch RPC after popup is gone). Acceptable: user just doesn't get the download. Pre-launch acceptable.

6. **SW lifecycle eviction during long downloads**: chrome.downloads usually keeps SW alive while a download is in flight. If SW is evicted (rare for our small JSON), the download may be incomplete. Pre-launch acceptable; document.

7. **Existing ContactService tests**: now need a FakeAccountStateService in setup. ~15 LoC boilerplate. Cost is one-time.

8. **`getSendersAcrossActiveNetworks` time-bounding NOT included**: a single down network still hangs for ~5s on its retry budget. Parallelization helps multi-network users but not single-network. Time-bounding via Promise.race is risky (can falsely mark Active networks as Inactive on momentary blips). Defer; reconsider if the offline-localhost case becomes common.

---

## Open questions for review

1. **Filename in SW vs popup**: marginal preference. Plan keeps it popup-side. Codex / Plan agent: any reason to move it to SW?

2. **Blob URL vs data URL**: blob URL is the standard pattern; data URL with base64 is a fallback if blob URL has any MV3 SW quirk. Plan picks blob URL. Concur?

3. **FakeAccountStateService boilerplate**: should it live in the contact test file, or a shared `wallet/services/account-state/test-helpers.ts` that other tests can reuse later? Initial preference: inline in the contact test file (single consumer); promote when a second consumer appears.

4. **Toast vs SubPageHeader inline spinner as primary loading UX**: plan picks toast. If audit prefers the inline spinner for stronger signal, willing to accept the slightly bigger surface change (modify SubPageHeader + propagate isBusy ref).

5. **Time-bound the network status check** to prevent the single-localhost-down purgatory: in scope or defer? Plan defers.

6. **Should `ContactService.exportContacts(): string` stay as a separate method, or fold into `exportContactsAndDownload`?** Plan keeps both — the string-return form is testable without mocking chrome.downloads. Worth keeping?
