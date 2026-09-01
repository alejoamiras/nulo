# popup-shell-state — round-2 plan 7 (blueprint light, BL/C batch + M/E rider)

Scope (binding): [`../complexity-residue-round-2/scope.md`](../complexity-residue-round-2/scope.md) § 7.
Recon: [`recon.md`](recon.md). Burns **13 directives, 62 → 49** — the round's target — PR-a 9
(`useContactImportExport.ts` ×3, `stores/app.store.ts`, `RecentActivityView.vue`, `utils/activity-rows.ts`,
`pages/auth.vue`, `popups/NewNetworkPopup.vue`, `popup/index.ts`), PR-b 4 (`DropdownRoot.vue` ×2,
`packages/design/src/ui/Input.vue`, `utils/files.ts`). Owner-ACCEPTED neighbours (`activity.store.ts`,
`utils/amount.ts`, `JsonViewer/creator.js`, the test-harness directives) are untouched.

Behavior-preserving only, with the await-parity toolkit: sync helpers for zero-await spans; an awaited
helper only where the caller already awaited that exact span under the caller-side guard;
register-immediately and resolution-to-completion spans stay ONE continuation (the await in the
caller, the classifier sync); helpers creating cancellable/registered resources own create→register;
**a promise that settles synchronously today must keep settling synchronously** (a `.then(resolve,
reject)` relay defers it by a microtask); narrowing does not survive extraction — pass the narrowed
value. Never raise a ceiling, hand-edit the manifest, or ship a generator-inserted directive.

## Assumptions

Facts (verified in the tree at dev; codex audit corrections folded):
- F1 `useContactImportExport` (`:30-258`) holds two closures; `importContacts` (`:88-255`) awaits
  `pickFile` → `file.text()` → a locally created `importPromise` whose `{ resolve, reject }` CONTROLS are
  registered on `cacheStore.importPromise` before `popupStore.open("import_contacts")` — one synchronous
  unit; then per row the contact upsert (awaited, errors collected with their ORIGINAL error objects for
  ordered logging) settles before that row's `addSender` attempt (counted even when the upsert failed);
  contact-error toast takes precedence over sender failures; `finally` clears `cacheStore.importContacts`
  / `importPromise`. Existing suite: 13 tests (cap, minimal rows, dedupe/canonicalization, adds-only
  senders, decoupled sender-count toasts).
- F2 `useAppStore` (`:22-482`, Biome's 245 non-blank lines) is one Pinia 4.0.3 setup: onboarding flag;
  account activation (`commitAccountTarget` + `setupActiveAccount` with the documented "no await between
  the superseded check and the sync fast path" invariant and the ABA epoch fence); network actions; the
  in-flight tracker (ONE `OperationJournalServiceClient`, listeners added ONCE, `watch(profile.id, …,
  { immediate: true })` registered BEFORE `watch(activeScope, …, { flush: "sync", immediate: true })`);
  `commitScopeChange` (sync commit after one refresh) and its alias `withScopeChangeAllowed`;
  the activity bridge (`onTxAdded`/`onTxUpdated`/`syncTransactions` with the version-checked retry
  loop); a 42-line return. Suites: `app.store.test.ts`, `app.store.setup-active-account.test.ts`.
- F3 `RecentActivityView.vue` (`<script setup>`, JS) `recentActivityRows` (`:85-138`) is NOT
  `buildActivityRows`: journal rows arrive pre-filtered (`sortKey: terminalAt ?? 0`), incoming rows are
  token-scoped by `props.token && inc.tokenId !== props.token.id` (a PRESENT token with an undefined id
  still filters), the fallback-card rule feeds the slot math, and the result is sliced to the remaining
  budget. `buildActivityRows` (`:51-102`) is pure (13 tests); the view has 15 component tests.
- F4 `auth.vue` `handleUnlockWallet` (`:90-179`): every branch of the inner `catch` ends in `return`
  (the `isWrongPassword` assignment precedes the independent torn / user-rejected / timeout / bootstrap
  checks); the passkey branch reads `appStore.profile.id` at TWO sites across its awaits; the post-wait
  tail re-checks identity after each await. 12 component tests.
- F5 `NewNetworkPopup.vue` `handleCreateNetwork` (`:73-133`): `isCreating` spans the whole handler;
  `activateNetworkGuarded` returns `"activated" | "blocked" | "unconfirmed" | "stale"`; every
  non-activated outcome refreshes `networks` then closes (`blocked` / `unconfirmed` toast first, `stale`
  silent); the catch ladder: `DUPLICATE_CHAIN…` toast, `"Failed to fetch node info"` OR `"Failed to
  fetch network info"` → `isUrlHasError`, else the generic toast. 2 component tests.
- F6 `popup/index.ts` `router.beforeEach` (`:57-110`) mounts the app at import; its three early branches
  call `next(...)` SYNCHRONOUSLY, before the first suspension (the cold-boot strand at `:70-75`); the auth
  gate and the profile selection await under guards. Only `auth-guard.ts` is tested.
- F7 PR-b: `DropdownRoot.vue` (JS) — the `nextTick` callback in `openDropdown` (`:145-207`) and
  `onKeydown` (`:217-248`, two near-identical arrow blocks); 33 tests incl. the focus-trap failure
  fallback. `Input.vue` `handleInput` (`:138-179`, sync; 18 tests incl. the pinned int bug). `files.ts`
  `pickFile`'s `onchange` (`:97-141`): input element removed first; a plain file (no compression format,
  or `autoDecompress` off) is RESOLVED SYNCHRONOUSLY inside `onchange`; the cap rejects with a
  `FileTooLargeError` (also rethrown from decompression); other decompression failures warn and resolve
  the original file. `files.test.ts` + `files.caps.test.ts`.
- F8 Biome charges nested functions/lambdas nesting rent: hoisting a closure out of a setup function, a
  `nextTick` callback or an `onchange` handler lowers every branch inside it by one.

Inferences (audited):
- I1 A Pinia 4 setup store may return an explicit object whose members come from module-level factory
  results holding the ORIGINAL refs/computeds/functions: Pinia's unwrapping and `storeToRefs` see the same
  refs, setup-store `$reset` semantics are unchanged (throws in dev / no-op in prod, as today). Pinned:
  `$state` keys, `storeToRefs` keys, per-member state/getter/action classification, return-key ORDER,
  `withScopeChangeAllowed === commitScopeChange`, watcher registration order, one client / listeners once.
- I2 `handleUnlockError(error, activeProfileId)` + `return` is equivalent to the catch ladder ONLY as one
  synchronous side-effect ladder copied literally (not an action classifier); `unlockActiveProfile()`
  re-reads `appStore.profile.id` at each of the two original sites.
- I3 `pickFile`: a sync classifier decides `too-large | plain | <format>`; the plain path and the cap
  rejection settle synchronously inside `onchange` exactly as today; only the decompression path hands
  `resolve`/`reject` to an async settler that owns them (exact rejected object, warn-and-fallback).
- I4 Extracting `recentActivityRows`' math to a `.ts` helper keeps dependency tracking because every
  ref/store value is dereferenced inside the computed before the call; the helper takes the token
  OBJECT (`props.token`), so "present with undefined id" keeps filtering.

Asks: none blocking. `popup/index.ts` cannot be characterized before extraction (mounts on import); the
extracted guard module gets seam pins that include the two cold-boot invariants (stated BL/E for it).

## PR split

- **PR-a (BL/C batch)** — the seven shell/state files; pins committed FIRST where the existing suites
  leave a gap (contact import, app-store shape/order, NewNetworkPopup outcomes); existing suites
  zero-edit are the proof elsewhere.
- **PR-b (M/E rider)** — DropdownRoot, design Input, files; one pre-refactor mechanical pin each where
  codex found a gap (ArrowUp + both wrap boundaries; files settlement order).

## Decomposition — PR-a

- **`useContactImportExport.ts`** → module-level `exportContacts(deps)` / `importContacts(deps)` over a
  `ContactIoDeps` (contacts ref, the two service clients, `openToast`, the three stores); the composable
  is the binder. `importContacts` keeps in its own body: the picker call, the cap check BEFORE
  `file.text()`, the parse, the early exits, the try/catch/finally. Helpers: sync `normalizeImportRows
  (raw)` (`:115-129` verbatim — minimal rows without spread, sanitize/lowercase, first-address-wins);
  sync `openImportSelection(cacheStore, popupStore, rows): Promise<Row[]>` (stages rows, CREATES the
  promise, REGISTERS its controls on `cacheStore.importPromise`, opens the popup, returns the promise the
  caller awaits in its own try/catch); awaited `applyImportRows(deps, rows, contacts, activeNetworkId)`
  (replaces the awaited loop span) from sync-shaped per-row `upsertOneContact(...)` (returns the error
  tuple with the ORIGINAL error object or null) and `registerSenderForRow(...)` (tallies; runs after the
  row's upsert settled); sync `toastImportOutcome(openToast, tally)` (contact errors logged in order then
  their toast, else the sender ladder, verbatim strings).
- **`stores/app.store.ts`** → module-level factories returning NAMED results, called in this order (the
  original statement order, which is also the dependency order): plain refs → `createOnboardingFlag()` →
  `createInFlightTracker({ profile, account, network })` (`inFlightOps/Ready`, the ONE journal client,
  `hasInFlightSend`, `refreshInFlight`, the `watch(profile.id)`, `commitScopeChange`) →
  `createAccountActions({ profile, network, account, accounts, commitScopeChange })` (`commitAccountTarget`,
  `setupActiveAccount`, `selectAccount`, `changeAccountVisibility`, `updateAccount`; the epoch counter
  lives in the factory) → `createNetworkActions({ network, networkStatus, networks })` →
  `createActivityBridge({ activity, profile, profiles, network, account })` (`soleProfile`,
  `activeScope` + its `flush: "sync"` watch, `transactions`, `awaitingTransactions`, add/remove/clear,
  `onTxAdded`, `onTxUpdated`, `syncTransactions`). NOTE: today `setupActiveAccount` is a `const` arrow
  defined before `commitScopeChange` but only CALLED later; passing `commitScopeChange` into the account
  factory preserves the bound-at-call-time behavior and makes the order explicit. The setup returns an
  EXPLICIT object in the original key order (no spreads), including `withScopeChangeAllowed:
  commitScopeChange`.
- **`RecentActivityView.vue`** → colocated `recent-activity-rows.ts`: `remainingRowSlots(...)` and
  `buildRecentActivityRows({ journalOps, transactions, incomingTransfers, scope, token })` from sync
  `scopedTxRows` / `tokenScopedIncomingRows` (the mirror's own rules); the computed dereferences every
  input, then counts → remaining → early `[]` → build → slice.
- **`utils/activity-rows.ts`** → sync `txRows`, `journalRows`, `incomingRows`, `isForeignProfile`;
  `buildActivityRows` concatenates and sorts (stable; equal sort keys keep insertion order — pinned).
- **`pages/auth.vue`** → awaited `unlockActiveProfile()` (the passkey/password branch, re-reading
  `appStore.profile.id` at both sites) and ONE sync `handleUnlockError(error, activeProfileId)` (the ladder
  verbatim, same order, original error object, toasts included); the handler keeps the reentry guard,
  `bootstrapFailure = null`, the try/finally, the bounded wait, both identity checks and the tail.
- **`popups/NewNetworkPopup.vue`** → sync `toastNonActivatedOutcome(result)` (`blocked` / `unconfirmed`
  label+icon, `stale` silent) and sync `reportCreateFailure(error)` (the ladder); latch, awaits, refresh →
  close → toast order stay in the handler.
- **`popup/index.ts`** → new `popup/route-guard.ts`: sync `earlyDecision(to, from, appStore): { kind:
  "proceed" } | { kind: "redirect"; to: RouteLocationRaw } | undefined` for the three synchronous
  branches, and awaited `lateDecision(to, appStore, getActiveProfile, getProfiles): Promise<RouteLocationRaw
  | undefined>` (auth gate → profile selection / register redirect → password-profile requirement, same
  order, same guards). The guard callback: `const early = earlyDecision(...)` → if present, call `next()` /
  `next(target)` SYNCHRONOUSLY and return (no suspension before it) → else `const late = await
  lateDecision(...)` → `late ? next(late) : next()`.

## Decomposition — PR-b (mechanical)

- **`DropdownRoot.vue`**: top-level SFC functions `installFocusTrap()` (the double try/catch) and
  `placeDropdown(triggerRect)` (side switch + `customPosition` + height/overflow), called from the
  `nextTick` callback in the same order with `emit("onOpen")` and `useOutside` left in place;
  `focusAdjacentItem(direction)` for both arrow blocks (wrap-around kept).
- **`Input.vue`**: sync `applyMaxLength()` and `emitParsedValue(event)` (number / int / default; the
  pinned int bug intact).
- **`files.ts`**: sync `classifyPickedFile(file, autoDecompress, maxBytes)`; `onchange` keeps removing
  the element first, rejecting `No file selected`, rejecting the cap synchronously, resolving a plain file
  synchronously; `settleDecompressed(file, format, maxBytes, resolve, reject)` owns the async path
  (FileTooLargeError rethrown as the exact object, warn-and-fallback otherwise).

## Equivalence

- Pins first (PR-a): `useContactImportExport.pins.test.ts` — controls registered on `cacheStore` before
  the popup opens and resolving through them settles the flow; per row the upsert settles before that
  row's sender attempt, which is counted even after a failed upsert; every early exit (no file / too
  large / no rows / cancel / no selection / thrown) clears the cache; partial and total sender-failure
  toasts; contact-error toast precedence with `console.error` receiving the original error objects in
  order. `app.store.shape.pins.test.ts` — `$state` keys, `storeToRefs` keys, member classification,
  return-key order, alias identity, `$reset` behavior, profile watcher registered before the scope watcher,
  one journal client with listeners added once across profile flips. `NewNetworkPopup.pins.test.ts` —
  `blocked` / `unconfirmed` / `stale` / `activated` outcomes (toast text+icon, refresh, close, order);
  both fetch-error strings → `isUrlHasError`; generic failure toast.
- Seam pins with the refactor: `recent-activity-rows.test.ts` (scope filters, token object semantics
  incl. present-with-undefined-id, slicing, slot math incl. the fallback rule, equal-sort-key order),
  `route-guard.test.ts` (decision table; early branches make no service calls; `next` is invoked before
  the guard callback's promise resolves), `activity-rows` equal-sort-key case.
- PR-b pre-refactor pins: `Dropdown.keys.pins.test.ts` (ArrowUp, both wrap boundaries),
  `files.settle.pins.test.ts` (element removed before settlement; plain file resolves synchronously;
  cap rejects with the exact `FileTooLargeError`; decompression failure resolves the original).
- Existing suites zero-edit: contact import (13), app.store (both), RecentActivityView (15),
  activity-rows (13), auth (12), NewNetworkPopup (2), Dropdown (33), Input (18), files (both), auth-guard.
- Gates per PR: `audit:vue` + `test:ci-gating`; extension `bun run test` (units + components); e2e in ONE
  sequential run: senders-advanced · account-switch-isolation · wallet-locked-mid-session ·
  passkey-execution-canary (known flake fingerprints: rerun once; second identical failure = triage).

## Security & adversarial considerations

- Contact import consumes a HOSTILE file: cap before read, minimal rows (never spread), sanitized /
  lowercased fields, first-address-wins dedupe, adds-only senders — all kept in place or moved verbatim;
  the existing suite already proves them and is not duplicated.
- Scope-change guard invariants (`commitScopeChange` check→commit, `setupActiveAccount`
  superseded-check→sync fast path, the ABA epoch) move verbatim inside their factories; the ABA suite pins.
- Unlock: identity re-checks stay after their awaits; the error ladder keeps its order and error objects.
- Route guard: the three synchronous branches call `next` before any await (cold-boot strand) — pinned.
- Never validate by broadcasting: the e2e gates run against the local sandbox only.

## Decision ledger

| Decision | Codex position (blueprint audit, session `01a05ee8…`) | Adopted |
|---|---|---|
| app.store shape | keep factories (partial extraction won't reach 80); explicit named results, documented order, plain refs in the coordinator; strengthened Pinia/resource-order pins | yes |
| Route seam | the `next(await …)` shape defers the early branches by a microtask → discriminated early result + synchronous `next` for terminal early branches; pin "no service calls" + "next before return" | yes |
| Two activity builders | keep both (token filter, upstream journal filter, slot accounting, slicing differ); add equal-sort-key + token-presence coverage | yes |
| `handleUnlockError` | one sync side-effect ladder, not an action classifier; re-read `profile.id` at both sites | yes |
| `pickFile` | plain path settles synchronously today → sync classifier + async settler owning resolve/reject | yes |
| Contact pins | don't duplicate cap/minimal/dedupe/adds-only; add control identity, all early-exit cleanup, partial/total sender toasts, error-object/log order | yes |
| PR-b pins | ArrowUp + wrap boundaries; files settlement order; focus-trap fallback and int bug already pinned | yes |

## Delivery

Two PRs, sequential, each regenerating the baseline (`bun run baseline:complexity`, diff read, zero
inserted). Codex: one session — plan audit (done) → PR-a review → PR-b review. Round close-out after
PR-b: manifest 49, residue-ledger artifact republished, CLAUDE.md § Complexity budgets floor updated.

## Acceptance

- PR-a: 9 directives, 62 → 53, zero inserted; pins first; every listed suite zero-edit; the four e2e
  gates green.
- PR-b: 4 directives, 53 → 49, zero inserted; Dropdown/Input/files suites zero-edit.

## Rollback

Squash revert per PR; no storage, wire, route or store-surface change.
