# R3 / P16b — dApp approval-window shell: behavioral characterization (frozen oracle)

**Purpose.** Freeze the CURRENT behavior of the three dApp approval windows BEFORE extracting a
shared "approval window shell" (round-2 phase R3, plan §R3). This is the oracle a behavior-preserving
refactor is graded against. Ordering is load-bearing — the disconnect sequence and the
`beforeunload → reject` routing are trust-sensitive. Nothing here proposes a change; it records what
is, with `file:line` citations, verbatim.

**Subjects** (all paths repo-relative):
- `apps/extension/src/popup/windows/execute/index.vue` (584 lines — most complex; the only one with a wrong-profile reject)
- `apps/extension/src/popup/windows/capabilities/index.vue` (434 lines — account-select surface)
- `apps/extension/src/popup/windows/discover/index.vue` (269 lines — simplest)
- Shared composable: `apps/extension/src/composables/useDappInteractionPayload.ts`
- Shared overlay: `apps/extension/src/components/composite/DappCancelledOverlay.vue`
- Existing tests: `apps/extension/src/popup/windows/discover/index.test.ts` (12 cases, isReady race)

**Two-layer `reject` — read this first, it governs sections 2–5.** Each window has TWO things named
"reject":
1. The **composable** `reject(reason)` — destructured as `rejectViaInteractionService`. It only calls
   `interactionService.rejectInteraction(requestId, reason)`; it is a no-op if already cancelled or no
   requestId; it does NOT close the window (`useDappInteractionPayload.ts:104-107`).
2. The **window-local** `reject()` (no args) — calls `rejectViaInteractionService("User rejected")`
   then `closeWindow(true)`. This is what `beforeunload` and `onActiveProfileChanged` are wired to.

Throughout this doc, "reject()" = the window-local one unless it says "composable reject".

---

## 1. Mount / session wait / auth redirect / payload fetch

All three register the active-profile listener at `<script setup>` top-level (synchronously, before
mount) then run an identical `onMounted(async …)` skeleton. Only the **connect set** and the **init()
body** differ.

**Top-level (pre-mount) registration** — identical shape:
| Window | `new ProfileServiceClient()` + `onActiveProfileChanged.add(onActiveProfileChanged)` |
|---|---|
| execute | `execute/index.vue:408-409` |
| capabilities | `capabilities/index.vue:238-239` |
| discover | `discover/index.vue:133-134` |

**`onMounted` — verbatim ordered steps** (the skeleton is byte-identical except step 1's connect list):
| Step | execute | capabilities | discover |
|---|---|---|---|
| 1. Eager connects | `profileService.connect()`, `interactionService.connect()`, `tokenService.connect()` (`:412-414`) | `profileService.connect()`, `interactionService.connect()` (`:242-243`) | `profileService.connect()`, `interactionService.connect()` (`:137-138`) |
| 2. Session-ready wait | `:416-429` | `:245-258` | `:140-153` |
| 3. Auth redirect (early return) | `:431-435` | `:260-264` | `:155-159` |
| 4. `await init()` | `:437` | `:266` | `:161` |
| 5. `window.addEventListener("beforeunload", reject)` | `:438` | `:267` | `:162` |

**Step 2 — session-ready wait** is IDENTICAL across all three (a `watch` on `appStore.isSessionChecked`
with `{ immediate: true }` that resolves + stops when checked):
```ts
if (!appStore.isSessionChecked) {
  await new Promise<void>((resolve) => {
    const stop = watch(() => appStore.isSessionChecked, (checked) => {
      if (checked) { stop(); resolve() }
    }, { immediate: true })
  })
}
```

**Step 3 — auth redirect** is IDENTICAL across all three; on `!appStore.isLogined` it sets
`pageAwaitingAuth`, pushes `/popup/auth`, and **returns before init() and before the beforeunload
listener is added**:
```ts
if (!appStore.isLogined) {
  appStore.pageAwaitingAuth = router.currentRoute.value.fullPath
  router.push({ path: "/popup/auth" })
  return
}
```
Consequence to preserve: when not logged in, `init()` never runs AND no `beforeunload` listener is
registered. The whole template is additionally guarded by `<Flex v-if="appStore.isLogined">`
(`execute:451`, `capabilities:278`, `discover:173`), so nothing renders either.

**Step 4 — `init()` bodies (per-window payload fetch)** — the ordered awaits inside init:

*Shared prefix (all three):* `profile.value = await profileService.getActiveProfile()` → then
`await loadInteractionPayload()`.
| Window | getActiveProfile | loadInteractionPayload | readiness commit |
|---|---|---|---|
| execute | `:153` | `:154`, guard `if (!payload.value) return` `:155-156` | `initComplete.value = _operations.length > 0` `:266` (AFTER wrong-profile check + full operations materialization + `accountService`/`networkService` disconnect at `:267-268` + token prefetch `:273-293`) |
| capabilities | `:104` | `:105`, guard `if (!payload.value) return` `:106` | `initComplete.value = true` `:146` (AFTER delta/account-selection resolution `:108-138` + `buildCapabilityItems` `:143`) |
| discover | `:74` | `:75` | `isReady.value = true` gated on `profile && requestId && dapp` `:81` |

All three wrap init in `try/catch` that **swallows** the error into `setError("Something went wrong")`
(`execute:294-297`, `capabilities:147-150`, `discover:82-85`). Because init swallows, it never
propagates to `onMounted`, so **step 5 (beforeunload add) always runs after init returns — even on
init failure or the execute wrong-profile throw.** This is the invariant that guarantees a
half-loaded / failed popup can still reject the pending request on close. PIN IT.

`loadInteractionPayload` (composable `load()`, `useDappInteractionPayload.ts:78-102`) sets
`requestId.value` FIRST (`:84`), THEN awaits the payload and sets `payload.value`/`dapp.value`
(`:88`,`:93`). So `requestId` is truthy before `dapp`/`payload` — the exact race the discover
`isReady` gate defends (`discover/index.test.ts` case 12).

---

## 2. `beforeunload` rejection (close-without-decision → reject the pending request)

The registration/removal is IDENTICAL across the three; the handler is the window-local `reject`.

| Concern | execute | capabilities | discover |
|---|---|---|---|
| Register (in onMounted, after init) | `:438` | `:267` | `:162` |
| Handler | window-local `reject` (`:370-374`) | window-local `reject` (`:225-229`) | window-local `reject` (`:116-120`) |
| Removed by `closeWindow(true)` | `:377` | `:232` | `:124` |
| Removed in `onUnmounted` | `:446` | `:273` | `:168` |

**Handler behavior on unload** — window-local `reject()`:
1. Guard (divergent — see §6): execute `if (isInteractionCancelled.value || !requestId.value) return`
   (`:371`); discover same (`:117`); **capabilities `if (isInteractionCancelled.value) return` — NO
   `!requestId` clause** (`:226`).
2. `rejectViaInteractionService("User rejected")` (composable reject; itself a no-op if cancelled or
   no requestId — `useDappInteractionPayload.ts:105`).
3. `closeWindow(true)`.

**Critical routing invariant.** `beforeunload` is removed by `closeWindow(true)` (the decided path)
but LEFT ATTACHED by `closeWindow()` (no-arg, the overlay-dismiss path — §3). So:
- Approve/reject click → `closeWindow(true)` → listener removed → the ensuing window close does NOT
  re-fire reject (no double-reject).
- Overlay OK (`@dismiss="closeWindow()"`, no arg) → listener stays → `chrome.windows.remove` unloads
  the page → `beforeunload` fires → window-local `reject()` runs. **Dismiss is implemented AS
  reject-via-unload**, not a direct reject call. This is how the execute wrong-profile overlay and the
  cancelled overlays turn "user clicked OK" into a request rejection (or a no-op, when already
  cancelled). PIN the "dismiss routes through beforeunload" mechanism.

---

## 3. Completion cleanup (approve / reject / dismiss)

`closeWindow(interactionCompleted?)` is BYTE-IDENTICAL across all three
(`execute:376-381`, `capabilities:231-236`, `discover:122-131`):
```ts
const closeWindow = (interactionCompleted?: boolean) => {
  if (interactionCompleted) window.removeEventListener("beforeunload", reject)
  chrome.windows.getCurrent(undefined, (window) => {
    if (window.id) chrome.windows.remove(window.id)
  })
}
```

Completion paths and their cleanup:
| Path | execute | capabilities | discover | Cleanup |
|---|---|---|---|---|
| Approve success | `approve()` → `approveInteraction(requestId, executable, {type,name})` `:358-361` → `closeWindow(true)` `:362` | `approve()` → `resolveInteraction(requestId, {granted, selectedAccounts, accountAliases})` `:211-215` → `closeWindow(true)` `:216` | `approve()` → `resolveInteraction(requestId, {approved:true})` `:106` → `closeWindow(true)` `:107` | remove beforeunload, then close |
| Reject click | window-local `reject()` → composable reject + `closeWindow(true)` `:373` | `:228` | `:119` | remove beforeunload, then close |
| Overlay dismiss | `@dismiss="closeWindow()"` (no arg) `:536`,`:540` | `:399` | `:235` | beforeunload KEPT → fires reject on unload (§2) |
| Approve failure | `catch → setError(...)`, window stays open, `isLoading=false` in `finally` `:363-367` | `catch → setError("Something went wrong")`, `finally isLoading=false` `:217-222` | `catch → setError`, `finally isLoading=false` `:108-113` | none (window stays) |

Note: on approve/reject the composable's `onInteractionCancelled` listener is NOT torn down here — it
is removed only by the composable's own `dispose()` via `onScopeDispose` when the component scope is
torn down (`useDappInteractionPayload.ts:109-115`). No window calls `dispose()` explicitly.

---

## 4. Disconnect ORDER in the unmount hook (load-bearing — verbatim)

**All three use `onUnmounted`, NOT `onBeforeUnmount`** (`execute:441`, `capabilities:270`,
`discover:165`; the `vue` import at each file's `:3` brings in `onMounted, onUnmounted`). The
CLAUDE.md "Cleanup order in `onBeforeUnmount`" convention (service.disconnect before
composable.dispose before timer clear) is a DIFFERENT hook and does not literally apply here — these
windows predate/diverge from it. Do not "normalize" the hook name during extraction; that is a
behavior change.

Verbatim, top-to-bottom:

**execute** (`:441-447`):
```
1. profileService.disconnect()        // :442
2. interactionService.disconnect()    // :443
3. executionService.disconnect()      // :444
4. tokenService.disconnect()          // :445
5. window.removeEventListener("beforeunload", reject)  // :446
```

**capabilities** (`:270-274`):
```
1. profileService.disconnect()        // :271
2. interactionService.disconnect()    // :272
3. window.removeEventListener("beforeunload", reject)  // :273
```

**discover** (`:165-169`):
```
1. profileService.disconnect()        // :166
2. interactionService.disconnect()    // :167
3. window.removeEventListener("beforeunload", reject)  // :168
```

**Connect/disconnect asymmetry to preserve (execute only).** onMounted eagerly connects exactly
`{profile, interaction, token}` (`:412-414`) but onUnmounted disconnects `{profile, interaction,
execution, token}` (`:442-445`). `executionService` is constructed at `:82` and **never eagerly
`.connect()`-ed** — the base client lazily readies its transport on first `request()`
(`packages/extension-messaging/src/core/base-client.ts:109-110`, `ensureTransportReady()`), and
execute only touches it via the fee-estimation composable's `estimateOperationFee`
(`execute/index.vue:135`). So the `executionService.disconnect()` is NOT dead code — it tears down a
possibly-lazily-opened transport. The extraction must NOT "fix" this into a symmetric connect (that
would change when the execution transport opens), NOR drop the disconnect. Also note the
transient `accountService`/`networkService` clients created inside init are disconnected inline at
`:267-268`, entirely separate from the unmount hook.

Invariant across all three: **`removeEventListener("beforeunload", reject)` is ALWAYS the last step**,
after every `disconnect()`.

---

## 5. execute's wrong-profile reject (execute-only)

Two distinct profile guards live in execute; only the first is unique to execute.

**(a) init-time profile mismatch → overlay + throw** (`execute/index.vue:157-161`):
```ts
if (profile.value?.id !== payload.value.session.profileId) {
  // TODO: redirect to sign in page with preconfigured profile id
  isWrongProfile.value = true
  throw new Error("Sign in with another profile")
}
```
- Runs INSIDE `init()`, AFTER `loadInteractionPayload()` (so `requestId` is already set) and after the
  `if (!payload.value) return` guard.
- It THROWS. init's own `try/catch` (`:294-297`) swallows it → `setError("Something went wrong")` is
  also set. So both `isWrongProfile=true` AND `processingError` are set, but the template shows the
  wrong-profile overlay because its `v-if` wins the precedence chain (`:532` before `:537`).
- It does NOT call reject() directly and does NOT close the window. The pending dApp request is only
  rejected later: template renders `<DappCancelledOverlay v-if="isWrongProfile"
  message="You are signed in to a different profile…" @dismiss="closeWindow()" />` (`:532-536`); OK →
  `closeWindow()` (no arg) → beforeunload stays → window unload → window-local `reject()` → requestId
  set + not cancelled → `rejectViaInteractionService("User rejected")`. So the wrong-profile
  rejection is delivered via the §2 beforeunload path, not an inline reject. PIN this indirect route.
- `isWrongProfile` is declared at `:68`, only ever set true here; the overlay is the sole consumer.

**(b) runtime active-profile change → immediate reject** — `onActiveProfileChanged`. This one is
SHARED (all three windows), not unique to execute:
| Window | handler | body |
|---|---|---|
| execute | `:300-302` | `if (!_profile || _profile.id !== profile.value?.id) reject()` |
| capabilities | `:167-169` | `if (!_profile || _profile.id !== profile.value?.id) reject()` |
| discover | `:88-92` | `if (!_profile || _profile.id !== profile.value?.id) reject()` (multi-line) |
Registered pre-mount (§1); fires when the background emits an active-profile change; calls the
window-local `reject()` (composable reject "User rejected" + `closeWindow(true)`). capabilities and
discover have NO init-time `session.profileId` check — they trust the runtime guard alone.

---

## 6. Per-window DIFFERENCES (genuinely divergent vs merely similar-looking)

### 6.1 Services constructed + connected
| | execute | capabilities | discover |
|---|---|---|---|
| Constructed | profile `:408`, interaction `:83`, execution `:82`, token `:84`, + transient account/network in init `:163-164` | profile `:238`, interaction `:67` | profile `:133`, interaction `:46` |
| Eager-connected (onMounted) | profile, interaction, token | profile, interaction | profile, interaction |
| Disconnected (onUnmounted) | profile, interaction, execution, token | profile, interaction | profile, interaction |

### 6.2 Readiness gate (the approve-guard flag)
| | flag | truth condition | approve pre-guard on fail |
|---|---|---|---|
| execute | `initComplete` `:80` | `_operations.length > 0` `:266` | silent `return` (`:322`); ALSO `tokenMetadataLoading` `:325` + `needsFeeSelection` `:330-333` |
| capabilities | `initComplete` `:65` | `true` after build `:146` | **throws** `Error("capabilities approve() called before init()…")` `:176-178`; ALSO `noAccountsAvailable` return `:179-183`, empty-selection warning `:184-187` |
| discover | `isReady` `:44` | `profile && requestId && dapp` `:81` | **throws** `Error("discover approve() called before init()…")` `:100-102` |
This is a REAL divergence: execute's approve returns silently pre-init; capabilities and discover
throw loudly. Both patterns are deliberate (comments cite the "19-iteration silent-guard" incident).
Preserve each verbatim — do not unify the fail mode.

### 6.3 approve() call + payload
| | RPC | args |
|---|---|---|
| execute | `interactionService.approveInteraction` `:358` | `(requestId, executable: Operation[], {type: OriginType.DAPP, name})` — plus operation validation `assertExecutableOperation`, fee-selection gate, register_token `previewedInterface` threading `:340-357` |
| capabilities | `interactionService.resolveInteraction` `:211` | `(requestId, {granted, selectedAccounts, accountAliases})` — capability filtering + account-select assembly `:190-209` |
| discover | `interactionService.resolveInteraction` `:106` | `(requestId, {approved:true})` |

### 6.4 `dappOf` getter passed to the composable
| execute | capabilities | discover |
|---|---|---|
| `p.session.dappMetadata` `:120` | `p.session.dappMetadata` `:79` | `p.params.dappMetadata` `:57` |
discover pulls dApp identity from `params`, the other two from `session`. discover also never reads
`payload.value` at all (it does not even destructure `payload` — `:48-58`).

### 6.5 window-local reject() guard (behavioral divergence, not cosmetic)
| execute `:371` | capabilities `:226` | discover `:117` |
|---|---|---|
| `isInteractionCancelled ‖ !requestId → return` | `isInteractionCancelled → return` (NO requestId clause) | `isInteractionCancelled ‖ !requestId → return` |
Consequence: with `requestId` undefined, execute/discover `reject()` bails BEFORE `closeWindow(true)`;
**capabilities `reject()` proceeds to `closeWindow(true)`** (composable reject is still a no-op, but the
window still closes + removes the listener). Any unified shell must reproduce this exact asymmetry or
explicitly note it as an intentional normalization for owner sign-off.

### 6.6 Overlays + status strip
| | overlays | strip |
|---|---|---|
| execute | `isWrongProfile` (custom msg) `:532-536` THEN `isInteractionCancelled` (custom msg) `:537-541` | `SignerIdentityStrip` (signerAccounts/networks) `:452` |
| capabilities | `isInteractionCancelled` `message="Capability request was cancelled"` `:396-400` | `DappStatusStrip` (account/network) `:279-283` |
| discover | `isInteractionCancelled` default msg `:235` | `DappStatusStrip` `:174-178` |

### 6.7 Window-specific content (NOT shell)
- execute: operation materialization (9+ op-kind switch `:181-259`), fee estimation
  (`useFeeEstimationMap` `:125-141`, `handleFeeUpdate` `:304-315`), `register_token` metadata prefetch
  (`:270-293`), `showJson` popup (`:401-406`), signer strips.
- capabilities: `buildCapabilityItems` (`:143`), account-selection state (`needsAccountSelection`,
  `availableAccounts`, `selectedAccounts`, `accountAliases`, `noAccountsAvailable` `:40-53`), card
  expand/collapse, capability toggling.
- discover: none — a static trust-copy body (`:190-194`).

### 6.8 `stripStatus` computed — IDENTICAL across all three (shared)
`cancelled → loading → ready`, same source (`execute:385-389`, `capabilities:84-88`, `discover:66-70`).
`setError`/`clearError` also identical (discover has only `setError`, no `clearError` — it never
clears). The `useDappHostname(dapp)` wiring is identical (`execute:123`, `capabilities:82`,
`discover:60`).

---

## What can be extracted into the shell vs what must stay per-window

### Safe to extract (verbatim-identical, or identical-modulo-a-config-value)
1. **Session-ready wait** (§1 step 2) — byte-identical `watch(isSessionChecked)` promise. Pure; move as-is.
2. **Auth redirect** (§1 step 3) — byte-identical; move as-is. Preserve the early-return semantics
   (no init, no beforeunload when redirected).
3. **`closeWindow(interactionCompleted?)`** (§3) — byte-identical. Move as-is; keep the
   remove-only-when-completed semantics EXACTLY (it is what makes dismiss route through beforeunload).
4. **`beforeunload` register (after init) + remove (in closeWindow(true) + unmount-hook last step)**
   (§2, §4) — identical wiring; move as-is, keeping "add after init, even on init failure" and
   "remove is the last unmount step."
5. **`onActiveProfileChanged` guard** (§5b) — identical logic; parameterize over the window's
   `profile` ref + `reject`.
6. **`stripStatus`, `setError`/`clearError`, `useDappHostname` wiring** (§6.8) — identical.
7. **Composable ownership pattern** — `useDappInteractionPayload` is already the extracted
   payload/reject/cancel unit; the shell should thread it, not re-implement it. `onScopeDispose`
   already owns the `onInteractionCancelled` teardown.

### Must stay per-window (or be injected as config, NOT flattened into one path)
1. **The connect set + disconnect ORDER** (§4). The shell may own "connect these, then wait/redirect,
   then init, then add beforeunload" and "disconnect these in this order, then remove listener," but
   the LIST and ORDER are per-window data. execute's 4-service ordered disconnect and its
   connect(3)/disconnect(4) asymmetry (lazy execution transport) MUST be reproduced exactly.
2. **`init()` body** — wholly different per window. The shell can own the pre-flight
   (getActiveProfile → loadInteractionPayload → `if (!payload) return`) but the post-payload
   materialization is window-specific.
3. **Readiness flag + its failure mode** (§6.2) — silent-return (execute) vs throw (capabilities,
   discover). Different by design; do not unify.
4. **approve() body + RPC + validation** (§6.3).
5. **execute's init-time wrong-profile check + `isWrongProfile` overlay** (§5a) — execute-only.
6. **`dappOf` getter** (§6.4) — `params` vs `session`.
7. **window-local reject() guard** (§6.5) — capabilities' missing `!requestId` clause. Either
   reproduce the asymmetry or get explicit owner sign-off to normalize.
8. **Overlays/strip/content** (§6.6, §6.7).

### Traps (things that "look shared" but diverge)
- The `onMounted` skeleton looks identical but the connect list differs (execute + token).
- `reject()` looks identical but capabilities drops the `!requestId` guard → different window-close
  side effect.
- `initComplete` exists in both execute and capabilities but has DIFFERENT truth conditions and
  DIFFERENT approve-guard fail modes.
- The unmount hook is `onUnmounted`, not the `onBeforeUnmount` the CLAUDE.md convention describes —
  do not "correct" it.
- Wrong-profile rejection is INDIRECT (via beforeunload on dismiss), not an inline reject call.

---

## Characterization test plan (frozen-oracle suite to land BEFORE extraction)

Existing coverage: `discover/index.test.ts` already pins discover's isReady gate, deny-vs-allow
predicate asymmetry, approve-throws-pre-init, error-keeps-allow-disabled, init-failure paths, and the
requestId-set-but-payload-half-loaded regression (12 cases). **capabilities and execute have NO
window-level component test today** — they need equivalents before the shell lands. The refactor is
graded green when these pass unchanged against both pre- and post-extraction code.

### A. Shell-level ORDERING pins (author for all three windows; these are the load-bearing ones)
1. **Eager-connect set + order.** onMounted calls exactly the window's connect list in order
   (execute: profile, interaction, token; cap/discover: profile, interaction). Assert call order via
   a shared spy sequence, and assert `executionService.connect` is NEVER called for execute (lazy).
2. **Session gate blocks init.** With `isSessionChecked=false`, `getActiveProfile`/`loadInteractionPayload`
   are NOT called and `beforeunload` is NOT added; flip to true → init proceeds. (Pins §1 step 2.)
3. **Auth redirect short-circuits.** With `isLogined=false`: `pageAwaitingAuth` set to `fullPath`,
   `router.push('/popup/auth')` called, `init` NOT called, `beforeunload` NOT added. (Pins §1 step 3.)
4. **beforeunload added AFTER init, ALWAYS.** `addEventListener('beforeunload', …)` fires after init
   resolves — AND still fires when init throws internally (mock `loadInteractionPayload`/profile
   mismatch to throw). One listener, exactly once. (Pins the "even on failure" invariant, §1.)
5. **Unmount disconnect ORDER — verbatim.** Assert the exact sequence via a single ordered spy log:
   - execute: `[profile.disconnect, interaction.disconnect, execution.disconnect, token.disconnect, removeEventListener]`
   - capabilities / discover: `[profile.disconnect, interaction.disconnect, removeEventListener]`
   `removeEventListener('beforeunload', reject)` MUST be last in all three. (Pins §4.)
6. **closeWindow(true) removes the listener; closeWindow() does NOT.** Two assertions on
   `removeEventListener` call count, plus `chrome.windows.remove` called in both. (Pins §3.)
7. **No double-reject on decided close.** approve/reject → `closeWindow(true)` removed the listener, so
   a subsequent simulated `beforeunload` dispatch does NOT call `rejectInteraction` again.

### B. Reject / dismiss routing pins
8. **window-local reject() = composable reject("User rejected") THEN closeWindow(true).** Order-asserted.
9. **reject() guard divergence.** With `requestId` undefined + not cancelled: execute/discover
   `reject()` calls neither `rejectInteraction` nor `closeWindow`; **capabilities `reject()` still
   calls `closeWindow(true)`** (and removes the listener) while `rejectInteraction` stays un-called.
   (Pins §6.5 — the trust-sensitive asymmetry.)
10. **Already-cancelled reject() is inert on the request.** With `isCancelled=true`: `rejectInteraction`
    NOT called (composable no-op), window still closes per each window's guard.
11. **Dismiss routes through beforeunload.** Overlay `@dismiss` → `closeWindow()` (no arg) leaves the
    listener attached; a simulated unload then invokes window-local reject. Assert `rejectInteraction`
    is reached via that path (not a direct dismiss→reject call).

### C. onActiveProfileChanged pin (all three)
12. **Active-profile change → reject.** Invoke the registered handler with `undefined`, and with a
    different `id`, and with the SAME id: first two call window-local `reject()`; same-id is a no-op.

### D. execute-specific pins
13. **Wrong-profile init check.** `profile.id !== payload.session.profileId` → `isWrongProfile=true`,
    init throws (caught → also sets processingError), operations NOT committed, `initComplete` stays
    false, wrong-profile overlay `v-if` wins over the cancelled overlay. `beforeunload` STILL added.
14. **Wrong-profile rejection is delivered on dismiss.** From the state of pin 13, dismiss →
    `closeWindow()` (no arg) → simulated unload → window-local reject → `rejectInteraction(requestId,
    "User rejected")` (requestId was set by loadInteractionPayload before the check). (Pins §5a's
    indirect route.)
15. **approve gating stack.** approve() no-ops (silent) when: `isCancelled`/`isLoading` (`:318`),
    `!initComplete || operations.length===0` (`:322`), `tokenMetadataLoading` (`:325`); and sets the
    "select a fee" warning when `requiresFeeSelection` (`:330-333`). Confirm button `:disabled`
    mirrors these (`:525`).
16. **Connect/disconnect asymmetry.** execution transport never eager-connected; `executionService.disconnect`
    IS called on unmount (pin 5 already covers order — this one asserts the never-connect half).

### E. capabilities-specific pins
17. **approve throws pre-init** (mirror of discover case 5): `!initComplete` → throws the diagnostic
    Error (`:176-178`).
18. **noAccountsAvailable blocks approve.** delta has `accounts` but `availableAccounts` empty →
    `noAccountsAvailable=true`, error set in init (`:130-136`), approve() returns without
    `resolveInteraction` (`:179-183`).
19. **Empty account selection warns.** `needsAccountSelection` true + `selectedAccounts` empty →
    approve() sets the "Select at least one account" warning, no RPC (`:184-187`).
20. **Single available account auto-selects** (`:119-121`) but still requires an Approve click.
21. **approve() assembles granted + selectedAccounts + aliases** correctly for the account-selection
    path (`:190-215`).

### F. Composable-order pin (shared; already partly covered by discover case 12)
22. **load() sets requestId before dapp/payload.** Assert `requestId` is truthy while `dapp`/`payload`
    are still null mid-`load()`. This is why each readiness gate must include more than `requestId`.
    (Add the equivalent for capabilities + execute so the shell can't regress any window to a
    requestId-only gate.)

**Gate for R3 (per plan §R3):** these window component units + this characterization + smoke + FULL
network (dApp connect/execute flows). The ordering pins (A5, A6, A7, B8, B9, B11, D14) are the ones a
naive "unify the shell" refactor is most likely to break — treat any red among them as a real
behavior change, never a flake.
