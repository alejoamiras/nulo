# Audit — Plan agent (architect perspective)

Date: 2026-04-29
Reviewer: Plan agent (Opus 4.7, 1M ctx)

The plan is broadly sound and addresses three real bugs surfaced in QA. Most of the proposed work is verifiable in code. There is **one BLOCKING issue around the SW URL.createObjectURL contract** that needs an explicit decision (data URL vs blob), and **two SHOULD-FIX architectural gaps**: the OR-query already lives on `AccountStateService` so `ContactService` does not need an `AccountStateService` dependency at all — that's the cleaner answer and it dissolves the mixed Option-A/Option-B headline. There's also a second-look needed at the loading UX recommendation; toast is fine, but the inline-spinner alternative is cheaper than the plan reads it as.

---

## BLOCKING

### 1. `URL.createObjectURL` from an MV3 service worker is not portable; pick data URL

The plan asserts (`plan-v1.md:48`) that `chrome.downloads.download` "is callable from a SW context in MV3 with a blob URL." That is half-true at best.

`URL.createObjectURL` for `Blob` was added to ServiceWorkerGlobalScope eventually, but it has long been a portability footgun in MV3 service workers — the API is missing in older Chrome stables, was unsupported entirely in Firefox MV3 service workers for a while, and even on current Chrome the lifetime of the blob URL is tied to the service-worker realm, not the document. Compare that with the popup's `utils/files.ts:60` flow, where the blob URL is a window-scoped URL: the download manager picks up bytes synchronously when `chrome.downloads.download` is invoked, the URL is then revoked, and the file lands. In SW-land, the picture is murkier — there are reports of the URL being torn down before the download manager can stream from it if the SW is suspended mid-download.

Crucially the project ships **both** Chrome and Firefox manifests (`packages/extension/manifest/manifest.firefox.config.ts:13` configures a `scripts: ["src/wallet/index.ts"]` rather than a `service_worker`). On Firefox the background context is a non-persistent event page, not a SW. That's a different platform where blob URL semantics are again different and have historically been more reliable.

**Recommendation**: prefer a **data URL** for the SW-side path:

```ts
const json = await this.exportContacts()
const dataUrl = `data:application/json;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(json)))}`
await chrome.downloads.download({ url: dataUrl, filename })
```

Reasons:

- Data URLs avoid `URL.createObjectURL` entirely. No SW-realm lifetime question, no Firefox-vs-Chrome divergence, no revoke ordering.
- The MV3 CSP at `manifest.config.ts:36` (`script-src 'self' 'wasm-unsafe-eval'`) does not block data URLs in `chrome.downloads.download` (CSP scopes script execution, not downloads). Data URLs are widely used for SW-initiated downloads in MV3.
- Contacts JSON is small (per-row ~80 bytes; even 1000 contacts is <100KB). The base64 inflation is irrelevant.
- The popup-side path at `utils/files.ts` keeps using blob URL — that's the correct DOM context for it. The SW path picks the SW-portable variant.

The plan's "Open question 2" already raises this; the answer should be data URL, not blob URL. Mark this as decided before execution.

If the plan owner insists on blob URL, the plan must include:
- explicit `revokeObjectURL` ordering (after the `chrome.downloads.download` callback fires, not before — current plan's "in a finally" is the right shape but does not address the race in the SW realm),
- a Firefox carve-out (Firefox's event page may behave differently from a Chrome SW),
- a smoke test booting the SW in a real browser context to verify the URL doesn't get GC'd before the download manager reads it.

The data URL option side-steps every one of these.

---

## SHOULD-FIX

### 2. `ContactService` does not need `AccountStateService` at all — call the helper from the popup or invert the dependency

The plan adds `AccountStateService` as a `ContactService.init` dependency (`plan-v1.md:58`) so that `exportContacts()` can return v2 envelope JSON with per-row `isSender`. Re-reading the actual code, this is unnecessarily heavy:

The current shipped popup at `pages/settings/contacts/index.vue:135-141` already calls `accountStateService.getSendersAcrossActiveNetworks()` directly in the popup, and the helper is already on `AccountStateService` (`account-state/service.ts:71-95`). So the OR-query lives where it should — on `AccountStateService`.

The plan's proposed path is:

```
popup → contactService.exportContactsAndDownload(filename)
        ↓
        ContactService.exportContacts()
            ↓ (NEW dep)
            this.accountStateService.getSendersAcrossActiveNetworks()
        ↓
        chrome.downloads.download(...)
```

That dependency is genuinely net-new. It also re-introduces a coupling the prior audit specifically warned against: **sender-domain logic leaking into the address-book service**. The previous audit's recommendation #3 (`audit-plan-agent.md:42-47`) was "put the OR-query on `AccountStateService` itself." The shipped code did that. The plan now consumes the helper but takes the dependency.

**Cleaner alternatives:**

**Option A — keep the OR call popup-side, only the download moves to SW.**

```
popup:
  1. ensurePermissions (gesture-bound)
  2. const senders = await accountStateService.getSendersAcrossActiveNetworks()
  3. const json = build payload (popup-side, same as today)
  4. const filename = build filename (popup-side, same as today)
  5. await downloadService.downloadJson(filename, json)   ← NEW thin RPC
```

The new `downloadService.downloadJson(filename, json)` is a one-method service (or a method on a generic SW-side download helper). ContactService stays untouched. AccountStateService is unchanged. The only new SW surface is "wrap a JSON string in a data URL and call `chrome.downloads.download`." That helper has zero domain coupling.

The trade-off: the long step (the sender union query) still runs popup-side, so popup-close mid-query *can* still abandon the await. But the `getSendersAcrossActiveNetworks` call already runs in the SW (it's an RPC); only the popup-side `await` is what's lost. With Promise.allSettled parallelism (issue 3) the wall time drops to `max(network)` for offline cases — call it ~5s. The user has a loading toast (issue 2) so they know the click registered. The download itself is then the only work that needs to survive popup close, and that download is fast (sync-ish — `chrome.downloads.download` initiates and returns quickly).

**Strong recommendation: Option A.** Reasons:
- The "popup → SW download helper" is the *minimal* SW surface. Anything bigger is over-fitting to one feature.
- Option A keeps the flow grokkable to a future reader. The plan's path requires reading three services to understand a contacts export.
- It also dissolves the architectural-headline tension the user asked about (mixed Option A export / Option B import). Under Option A, *neither* export nor import goes through `ContactService.exportContacts/importContacts`. Both stay popup-direct for the orchestration; the SW handles only the bare primitive (download a string with a filename). The "mixed shape" disappears.

This should be the headline call-out in the plan revision. The plan as written reverses the prior audit's finding by accident.

### 3. Mixed Option A (export through service) + Option B (import popup-direct) is unstable — but the right fix is going Option B everywhere

The user's question 1 asks whether the mixed shape is stable. **It's not stable as the plan articulates it**, but the right resolution is the opposite of what the plan does.

The plan's framing: "export goes through service for popup-close survival; import stays popup-direct because the user-confirmation popup mid-flow makes the handoff awkward."

But:
1. The SW work that needs to survive popup-close is the **download itself**, not the JSON building or the OR-query. The OR-query was already SW-side via RPC; only the popup-side `await` is lost on close.
2. The only thing the plan needs the SW to keep doing across popup-close is `chrome.downloads.download`. That's a primitive, not a domain operation.
3. If you accept finding #2's Option A above, you don't need to route through `ContactService` at all — you just need a SW-side download helper that takes `(filename, json)`.

So the architectural call should be: **export and import both stay popup-orchestrated** (matching the shipped Option B from PR #15 and the prior audit). The only addition is a SW-side download primitive that the popup invokes after the JSON is built.

### 4. Loading UX — toast is acceptable, but the inline-spinner alternative is cheaper than the plan reads it

The user's question 3 asked for a real critique, not a rubber-stamp. The plan's table at `plan-v1.md:30-36` rates the inline spinner as "modest — pass an isBusy prop to the SubPageHeader trailing dropdown trigger."

Looking at `SubPageHeader.vue`, the trailing slot is just `<slot name="trailing" />`. There's no API surface to extend; the consumer (`pages/settings/contacts/index.vue:317-338`) already owns the entire trailing layout. To add a spinner you don't modify SubPageHeader at all — you wrap the existing dropdown trigger with `v-if="!isExporting"` and emit `<Spinner v-else>`. That's ~5 lines, additive, scoped to the contacts page.

A `Spinner` component already exists at `components/ui/Spinner.vue`. Its variants accept `size` and `color`; the three-dot is 18px, the spinner can be size="14" with color="--txt-secondary" — visually consistent.

**Toast vs inline-spinner critique:**

| Dimension | Toast | Inline spinner |
|---|---|---|
| Visibility | Bottom-of-screen, easy to miss | Replaces the click target itself |
| Implementation cost | ~6 lines, uses existing composable | ~5 lines, uses existing primitive |
| Conflicts with other state | Toast composable's orphan-timer bug (#7) | None — pure local ref |
| Dropdown re-open behavior | Independent | Spinner remains visible when dropdown is closed and reopened (good — the user can verify "yep, still working") |
| Brutalist consistency | OK, toast already exists | Stronger — spinner is monochrome, no decorative color |
| Click-suppression | Manual disable needed (or risk concurrent exports) | Naturally suppresses (the menu trigger is gone) |
| Failure surfacing on popup-close | Lost (toast disappears with popup) | Same problem |

**Concretely**: on click → flip a local `isExporting` ref true; the SubPageHeader trailing slot renders `<Spinner v-if="isExporting" /> v-else <Dropdown>...</Dropdown>`. On completion → flip false + open completion toast. No loading toast, just the inline indicator + completion toast. Removes the orphan-setTimeout exposure entirely (no two toasts in 5s).

Worth elevating to the recommended path or at minimum adopting alongside the toast.

### 5. Test plan misses several real cases

The plan lists 6 tests (5 ContactService + 1 AccountStateService). Missing:

- **`URL.createObjectURL` in vitest jsdom**: jsdom *does* implement `URL.createObjectURL` for blobs, but it returns a placeholder URL that isn't actually a real fetchable resource. Tests will need to assert the URL was passed to a stubbed `chrome.downloads.download` rather than asserting on its content. If the plan goes data URL (per finding #1) this is moot — easier to assert on a deterministic data URL string.
- **Concurrent export clicks**: today the dropdown is freely clickable. If the user clicks Export twice (first one slow due to offline network), what happens? Two pending downloads? Two RPC calls? With the inline spinner from finding #4 this is naturally suppressed; with toast-only, the second click should be a no-op or replace the in-flight. Test coverage should pin the behavior.
- **`chrome.downloads.download` callback edge cases**: `chrome.runtime.lastError` set + `downloadId` undefined; `downloadId === undefined` without lastError (browser quirks); user cancels the saveAs dialog. The current `utils/files.ts:64-77` only handles `lastError`. The new SW-side wrapper should match that or improve it.
- **Empty contacts list**: `contactService.exportContactsAndDownload` should be a no-op or surface "nothing to export" — currently the export menu item is `:disabled="!contacts.length"` (`index.vue:330`) but the SW path should be defensive too (popup could reach the call after contacts are deleted).
- **Filename sanitization**: the plan keeps filename resolution popup-side and prepends `${profile.name}_`. If profile.name has `/` or `\` or null bytes, `chrome.downloads.download` will reject. Test or use a sanitizer (the popup-side `sanitizeString` is already in scope at `index.vue:17`).
- **AccountStateService parallelism test approach**: the plan's note (`plan-v1.md:201`) about "throw-vs-resolve" being more reliable than time-based is correct. Use it: stub network A's `getSenders` to throw, network B's to return `["0xalice"]`. Under serial-iteration-with-await, the throw aborts the loop and B is never called. Under `Promise.allSettled`, both are invoked. That's a clean structural test, not a flaky time-based one.

### 6. SW lifecycle + popup-close handoff — verify, don't claim

The plan claims popup-close survival because "the SW continues" (`plan-v1.md:48`, `plan-v1.md:122-126`). Two things to verify:

- **Precedent in the codebase**: The plan says "transactions, fee estimation" already follow this pattern. Looking at `wallet/services/execution/service.ts:350-352`, the comment is "Survives SW restart and popup close/reopen so consumers can recover a consistent view of 'what is this tx doing right now'". The mechanism there is `OperationJournalService` writing to `chrome.storage.session` (`operation-journal/spec.ts:6`). The popup re-reads journal records on re-open. So the *operation* survives, but the *user's awareness* of completion does not — they have to come back and check.

  Apply the same lens to the export plan: if the user closes the popup mid-export, the SW completes, the file lands in Downloads. If the user reopens the popup, **there is no surface that tells them "you successfully exported 5s ago"**. They might not check the Downloads folder. They might think it failed and click Export again, generating a duplicate file.

  The plan's risk register at `plan-v1.md:235` calls this "pre-launch acceptable; download-folder presence is the signal." For pre-launch that's defensible. But it should be more explicit: this is the user-experience cost of going SW-side. The popup-direct flow had the same problem (lost everything), so SW-side is strictly better, but the difference is only "file lands or doesn't." For all the user can tell, both paths look the same when they close the popup.

  An OperationJournal record for export (one row, terminal state on completion, deleted after the popup re-reads it) would close that gap. Out of scope for this branch, but worth a follow-up note.

### 7. Toast composable orphan setTimeout — analysis correct, but recommend bypassing it

The user's question 7 walks through the timing. That analysis is **correct**. Walking through the composable at `composables/toast.js:14-29`:

The orphan-timer bug at `toast.js:18-21` would manifest if the user did `openToast(A, 10000)` then `openToast(B, 1000)` without `closeToast()` between. Then:
- t=0: closeTm = A's timer
- t=0+: closeTm reassigned to B's timer (A's handle is now lost; A's timer cannot be cleared)
- t=1s: B's timer fires → toast.value = null
- t=10s: A's timer fires → toast.value = null again (might wipe a third toast that was opened in between)

Plan's recommended flow (`closeToast()` before the success `openToast`) avoids this.

If the inline-spinner-only path from finding #4 is adopted, you skip the loading toast entirely and the orphan-timer concern is moot.

### 8. Branch / commit structure — split into 3 commits

**Split into 3 commits, all on the same branch** (since the user wants one branch):

1. `fix(contacts-export): parallelize cross-network sender query` — `account-state/service.ts` parallelism + new test. ~30 LoC, isolated, easy to revert if it bites.
2. `fix(contacts-export): show loading state during sender query` — `pages/settings/contacts/index.vue` loading-state UI (toast or inline spinner per finding #4). ~10 LoC, popup-only.
3. `fix(contacts-export): survive popup close via SW download` — the SW download helper + popup integration. The architecturally interesting commit; reviewer focus lands here.

Same branch. One PR. Three commits. No bundling with unrelated work.

### 9. Loading toast 30s timeout is wrong

The plan has `openToast({...}, 30_000)` (`plan-v1.md:100`). 30s is a hedge, but:
- If the SW completes in 5s the toast is replaced anyway. Timeout doesn't fire.
- If the SW completes in 35s (e.g., 7-network setup all flaky), the user sees the toast disappear at 30s, no completion follow-up arrives until 35s, and then a success toast pops. The dead 5s window suggests "it failed" when it didn't.
- 30s is also longer than the plan's `TOAST_DURATION.LONG` (4s). It establishes a new, ad-hoc timeout convention.

**Recommendation**: If you keep the loading toast, use the existing `TOAST_DURATION.LONG` (4s) and accept that on 7-network-flaky cases the toast disappears mid-work. The completion toast still fires when the work is done. This matches the existing pattern at `full.vue:170-174`.

Better: adopt the inline-spinner approach from finding #4 and skip the loading toast entirely.

---

## NICE-TO-HAVE

### 10. Filename resolution placement is fine popup-side

Plan keeps filename resolution in the popup (`plan-v1.md:117`). That's correct.

### 11. Add a journal record for export operations (follow-up)

Per finding #6: an `OperationJournal` record for "exported contacts" would let the popup show "exported N contacts X seconds ago" on re-open. Not in scope for this branch, but the project has the primitive (`operation-journal/spec.ts`). Worth a follow-up issue.

### 12. ImportContactsPopup unaffected

The plan correctly leaves `ImportContactsPopup` alone.

### 13. AccountStateService parallelism: thinking about Promise.race for time-bounding

Risk #8 in the plan defers Promise.race-based time-bounding because of the false-Inactive-on-blip risk. Agreed with the deferral.

### 14. Aggregation test for OR + skip-Inactive + dedupe + parallelism

After parallelization, the existing test at `account-state/service.test.ts:115-128` is the obvious spot to extend with the throw-on-one + verify-both-called proof of parallelism.

---

## VERIFIED

- Pre-PR-15 base: `pre-a11/contacts-export-isSender` is the active branch.
- `chrome.downloads` is an *optional* permission, not granted at install (`manifest.config.ts:34`).
- Manifest CSP at `manifest.config.ts:35-37` does not block `chrome.downloads` data-URL or blob-URL inputs.
- `URL.createObjectURL` is currently used at `utils/files.ts:60` (popup) and `composables/externalImage.ts:49` (popup). **No SW-side usage exists in the codebase yet.**
- `AccountStateService.getSendersAcrossActiveNetworks` exists at `account-state/service.ts:71-95` and is shipped (PR #15).
- `OperationJournalService` survives popup-close + SW restart via `chrome.storage.session`.
- Toast composable orphan-timer at `toast.js:18-21` is a real pre-existing bug; the plan's flow does not trigger it (when the user has no other toast pending).
- Manifest is **dual-platform** (Chrome SW + Firefox event page).
- `Spinner.vue` exists, accepts size/color, and is the loading-state primitive elsewhere.

---

## Branch verdict

- **Architectural backbone needs revision**. Findings #1 and #2/#3 are independent but compounding: dropping the AccountStateService injection (finding #2) makes the "single layering decision" question moot (finding #3) — the answer is: **export and import both stay popup-orchestrated**, with a single SW-side download primitive. This collapses the mixed Option-A/Option-B headline cleanly. Adopt this shape.
- **Issue 3 (parallelism) is solid as-written**. Land that as commit 1 today.
- **Issue 2 (loading state) needs a small choice**: toast vs inline spinner. Either works; inline is more idiomatic and avoids the orphan-timer bug.
- **Issue 1 (popup-close survival) is the architecturally interesting one**. Switch to data URL + a thin SW download primitive (no AccountStateService injection, no canonical builder revival).
