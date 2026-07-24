# Security audit — per-scope activity slices + composite storage keys

**Scope:** cluster A (`stores/activity.store.ts`, `stores/app.store.ts`, `utils/activity-rows.ts`,
`RecentActivityView.vue`) and cluster B (`account/spec.ts` + `account/service.ts`,
`incoming-transfer/repository.ts`, `backup/backup-migration-registry.ts`,
`wallet-core/src/activity/scope.ts`).

**Baseline:** `git diff dev...HEAD` at `07c1776` ("fix(activity): close two cross-profile holes
found by the security audit"). That commit landed mid-audit; every finding below was re-verified
against it and F1 is a **regression introduced by that commit**.

**Result:** 3 findings (0 high, 3 medium). Plus a "checked, no finding" section covering the
key-forging questions in the brief — I could not build a concrete exploit for any of them.

---

## F1 — `syncTransactions` writes rows belonging to OTHER profiles and OTHER chains into the ACTIVE slice

### 1. Title
The bulk fetch path routes by "is this row placeable anywhere?" instead of "does this row belong to
the captured scope?", so the active slice is contaminated with foreign-profile and foreign-chain rows.

### 2. Impact / exploitability factors

**Impact**
- **Confidentiality** — the active slice (`appStore.transactions`) holds another profile's
  transaction rows: hash, `calls[]` (contract, method, args), `transfers[]` (from / to / amount),
  fee, block, error string. The isolation boundary the whole branch exists to build is not enforced
  at the store; it is enforced only by two per-surface display filters.
- **Integrity of the stated invariant** — the module docstring
  (`apps/extension/src/stores/activity.store.ts:8-10`) claims "A foreign record cannot reach the
  active view because it is not in that map entry at all, which is a stronger guarantee than a
  filter someone has to remember." That is false as written; the code is back to depending on
  exactly such a filter.
- **Blast radius** — every profile pair that shares an account address (the same mnemonic imported
  twice — the explicitly supported scenario this branch adds support for), plus every multi-network
  profile on the same address across different chains.

**Exploitability**
- **Attack vector:** local / same-device. No remote or dApp vector.
- **Privileges required:** the ability to unlock one of the two profiles.
- **User interaction:** none beyond opening the popup on the affected profile.
- **Complexity:** low — no crafting required; it happens on every `syncTransactions()`.
- **Render reachability today:** the two feed surfaces (`activity.vue` via `buildActivityRows`, and
  `RecentActivityView.vue`) both drop rows whose `profileId` disagrees and rows whose `chainId`
  disagrees, so contaminated rows do not appear in the *feed*. `apps/extension/src/popup/pages/tx/[id].vue:61`
  applies **no** profile / chain / account filter, so a contaminated row renders in full on the tx
  detail page for anyone who reaches `/popup/tx/<hash>`. That route is normally only reached by
  clicking a (filtered) row, which is why this is Medium and not High.

### 3. Evidence confidence
**High** for the store contamination (directly readable from the code, no timing assumption).
**Moderate** for the `tx/[id].vue` render, because reaching that route with a foreign hash requires
a navigation the UI does not currently offer.

### 4. OWASP / CWE
- OWASP A01:2021 Broken Access Control
- CWE-200 Exposure of Sensitive Information to an Unauthorized Actor
- CWE-863 Incorrect Authorization (the check is performed but does not constrain the right thing)

### 5. TRACE

1. `apps/extension/src/wallet/services/transaction/service.ts:90-92`
   `getTransactions(account)` filters **only** on `x.account === account`. The `nulo:core:txs`
   EntityStorage root is shared across every profile and every chain, so this returns every row for
   that address — all profiles, all chains.
2. `apps/extension/src/stores/app.store.ts:191-192`
   `captured = activeScope.value` — the viewing profile's `(profileId, networkId, chainId, address)`.
3. `apps/extension/src/stores/app.store.ts:194`
   `const rows = await managers.transaction.getTransactions(captured.accountAddress)` — the
   cross-profile, cross-chain row set from step 1.
4. `apps/extension/src/stores/app.store.ts:199-202`
   ```ts
   activity.setTransactions(
       captured,
       rows.filter((tx) => txScope(tx, captured, { soleProfile }) !== null),
   )
   ```
   The predicate is `txScope(...) !== null`, i.e. "can a scope be established for this row at all".
5. `apps/extension/src/stores/activity.store.ts:70-73`
   ```ts
   if (tx.profileId && tx.networkId) {
       return { profileId: tx.profileId, networkId: tx.networkId, chainId: tx.chainId, accountAddress: tx.account }
   }
   ```
   A row that carries its own scope returns **its own** scope — non-`null` — so the filter keeps it,
   whatever profile or chain it belongs to. Note this branch returns before the
   `tx.chainId === reference.chainId` check on line 75, so the chain constraint that the
   pre-`07c1776` filter enforced (`tx.chainId === captured.chainId`) is now gone for self-scoped rows.
6. `apps/extension/src/stores/activity.store.ts:156-160`
   `setTransactions(scope, rows)` → `updateSlice(scope, (slice) => { slice.transactions = [...rows] })`.
   No per-row routing: **every** row in the array is written into the `captured` slice, keyed by
   `activityScopeKey(captured)`.
7. `apps/extension/src/stores/activity.store.ts:93` → `apps/extension/src/stores/app.store.ts:150`
   `activeSlice.transactions` is exposed as `appStore.transactions`.
8. Harm manifests at `apps/extension/src/popup/pages/tx/[id].vue:61`
   `const tx = computed(() => appStore.transactions.find((t) => t.hash === route.params.id))` —
   no profile / chain / account guard — and the template renders `calls`, `transfers` (from, to,
   amount), fee, block, hash and error.

### 6. The missing control
The filter must be **scope equality**, not scope existence. `@nulo/wallet-core/activity` already
exports the primitive:

```ts
import { activityScopeKey, scopesEqual } from "@nulo/wallet-core/activity"
const capturedKey = activityScopeKey(captured)
rows.filter((tx) => {
    const s = txScope(tx, captured, { soleProfile })
    return s !== null && activityScopeKey(s) === capturedKey
})
```

Equivalently, route the fetch result row-by-row through `ingestTransaction` (which *does* place each
row in its own slice) instead of calling `setTransactions` with a bulk array. Secondarily,
`tx/[id].vue` should resolve the row from the active slice **and** re-assert
`tx.account === appStore.account?.address && tx.chainId === appStore.network?.chainId &&
!wrongProfile(tx.profileId)`.

### 7. Concrete exploit story
The user imports the same 12-word mnemonic into two profiles: `Work` (`profileId` `a1b2…`) and
`Personal` (`profileId` `c3d4…`). Both derive account `0x1f3a…` at index 0 on chain 11155111
(`poseidon2Hash([profileSecret, chainId, type, index])` is seeded from the mnemonic, so the address
is identical — this is precisely why `accountRowId` was made composite in this branch).

Under `Work`, the user sends 5,000 USDC to a counterparty. That writes
`{ hash: "0xaa…", profileId: "a1b2…", networkId: "net-work", chainId: 11155111, account: "0x1f3a…",
calls: [{ contract: "0xUSDC", method: "transfer", transfers: [{ to: "0xcounterparty", amount: "5000000000" }] }] }`.

The user locks, unlocks `Personal`, and the popup runs `syncTransactions()`. `getTransactions("0x1f3a…")`
returns the `Work` row. `txScope` returns `{ a1b2…, net-work, 11155111, 0x1f3a… }` — non-null — so
the filter keeps it, and `setTransactions` writes it into `Personal`'s slice. `appStore.transactions`
under `Personal` now contains `Work`'s 5,000-USDC transfer, including the counterparty address.
Anyone with the `Personal` password (a different person on a shared device, a "burner profile you
hand to someone", or a forensic dump of the popup's heap) has it. Navigating to `/popup/tx/0xaa…`
renders it in full, with no filter.

The same mechanism also crosses **chains within one profile**: a row from network `net-a`
(chainId 1) is kept and written into the slice for `net-b` (chainId 2) because
`txScope`'s self-scoped branch never compares `tx.chainId` to `reference.chainId`.

### 8. Preconditions
- Two profiles deriving the same address (same mnemonic imported twice), **or** one profile with two
  networks on different chains holding the same address.
- The rows carry `profileId` + `networkId` (i.e. rows written *after* this branch ships). Note this
  is the opposite precondition to the legacy-row case in F2, so the two together cover both the
  pre- and post-release row populations.

### 9. Why existing mitigations fail
- `activityScopeKey`'s per-slice map does not help: `setTransactions` is *told* which slice to write
  to, so the map never sees the rows' real scopes.
- `buildActivityRows` (`apps/extension/src/utils/activity-rows.ts:69-72`) and
  `RecentActivityView.vue:113-116` do filter, but they are the exact "filter someone has to
  remember" the design says it replaced — and the third consumer (`tx/[id].vue:61`) already forgot it.
- The store's own test suite does not cover this: `activity.store.test.ts` exercises
  `ingestTransaction` (which routes correctly) and never drives `setTransactions` with a
  foreign-scope row.

### 10. Instances (same root cause)
- `apps/extension/src/stores/app.store.ts:199-202` — the unrouted bulk write (primary).
- `apps/extension/src/stores/activity.store.ts:156-160` — `setTransactions` accepts a caller-supplied
  scope for a caller-supplied row array with no per-row check; the API shape is what makes the bug
  possible.
- `apps/extension/src/stores/activity.store.ts:70-73` — the self-scoped branch of `txScope` returns
  before the chain check, so `txScope(...) !== null` is not a chain constraint.
- `apps/extension/src/popup/pages/tx/[id].vue:61` — the unfiltered consumer that turns store
  contamination into a render.

---

## F2 — the new `soleProfile` legacy-row quarantine fails OPEN, because it is derived from a UI list that is empty on init and never refreshed on the recovery path

### 1. Title
`soleProfile: profiles.value.length <= 1` treats "I don't know how many profiles exist" as "only one
profile exists", re-enabling cross-profile attribution of unscoped rows on the paths that never
populate `appStore.profiles`.

### 2. Impact / exploitability factors

**Impact**
- **Confidentiality** — an unscoped (pre-stamping) transaction row belonging to profile A is
  attributed to, stored in, and **rendered under** profile B. Unlike F1 this reaches the feed
  surfaces: `wrongProfile(undefined)` is `false` by design
  (`apps/extension/src/utils/activity-rows.ts:62-63`, `RecentActivityView.vue:110-111`), so a row
  with no `profileId` passes every display filter.
- **Blast radius** — every transaction row that exists at the moment this branch ships (none of them
  carry `profileId`/`networkId`), for any two profiles sharing an address.

**Exploitability**
- **Attack vector:** local.
- **Privileges required:** unlock one profile.
- **User interaction:** import a second profile (or an MV3 service-worker restart mid-import, which
  is the documented trigger for the recovery path — see the comment block at
  `apps/extension/src/popup/pages/import.vue:58-72`).
- **Complexity:** low.

### 3. Evidence confidence
**High** that the guard evaluates to `true` on these paths (`profiles` is `ref([])` at
`apps/extension/src/stores/app.store.ts:41` and `hydrateKnownProfile` never assigns it).
**Moderate** on the end-to-end render, which needs the import-recovery timing window.

### 4. OWASP / CWE
- OWASP A01:2021 Broken Access Control
- CWE-636 Not Failing Securely ("Failing Open")
- CWE-1188 Insecure Default Initialization of Resource
- CWE-200 Exposure of Sensitive Information

### 5. TRACE

1. `apps/extension/src/stores/app.store.ts:41`
   `const profiles = ref<ProfileInfo[]>([])` — initial value is the empty array. `0 <= 1` is `true`.
2. `apps/extension/src/composables/useProfileBootstrap.ts:98-118` — `hydrateKnownProfile()`:
   ```ts
   appStore.profile = activeProfile
   await initNetworks()
   await initAccount()
   initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)
   await appStore.syncTransactions()     // line 107
   ```
   It sets `appStore.profile` but **never** `appStore.profiles`. Contrast
   `bootstrapActiveProfile` (line 72), which does refresh it — the two siblings disagree.
3. `apps/extension/src/popup/pages/import.vue:73,79`
   ```ts
   const { hydrateKnownProfile } = useProfileBootstrap()
   recover: async () => (await hydrateKnownProfile())?.id === profile.id && appStore.isLogined,
   ```
   On the SW-restart recovery path this runs *after* the new profile was created. `appStore.profiles`
   still holds the **pre-import** list (populated by `popup/app.vue`'s `loadProfile`), so with one
   pre-existing profile `profiles.value.length === 1`.
4. `apps/extension/src/stores/app.store.ts:198`
   `const soleProfile = profiles.value.length <= 1` → `true`.
5. `apps/extension/src/stores/activity.store.ts:74-77`
   ```ts
   if (!reference) return null
   if (tx.account !== reference.accountAddress || tx.chainId !== reference.chainId) return null
   if (opts.soleProfile !== true) return null      // ← bypassed
   return { ...reference, accountAddress: tx.account }
   ```
   The quarantine added by `07c1776` is skipped; the unscoped row is attributed to the *viewing*
   profile.
6. `apps/extension/src/stores/app.store.ts:199-202` → `activity.setTransactions(captured, rows)` →
   `apps/extension/src/stores/activity.store.ts:156-160`.
7. `apps/extension/src/popup/pages/import.vue:84-86` — on success the flow routes to
   `/popup/general`, which mounts `RecentActivityView`.
8. `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:110-116`
   `wrongProfile(tx.profileId)` with `rowProfileId === undefined` returns `false`, and
   `tx.account`/`tx.chainId` match (same mnemonic, same chain) → **the row renders**.

The same defeat exists in the onboarding shell: `apps/extension/src/onboarding/app.vue:60` calls
`hydrateKnownProfile()` while `appStore.profiles` is still `[]`; the profile list fetched at line 66
goes into a local `const`, never into the store. (Onboarding does not render the activity feed, so
that instance is store-contamination only — but it is the same fail-open.)

### 6. The missing control
The guard must not be inferable from an unpopulated UI ref. Either

- have `hydrateKnownProfile` refresh `appStore.profiles` exactly as `bootstrapActiveProfile` does
  (`useProfileBootstrap.ts:72`) **before** calling `syncTransactions`, **and**
- make the guard fail closed on "unknown": `const soleProfile = profiles.value.length === 1`
  (an empty list then means "unknown" → quarantine), or better,
- resolve the count from the background at decision time (`managers.profile.getProfiles()`), or
- drop the heuristic entirely and quarantine every unscoped row, backfilling `profileId`/`networkId`
  onto existing rows at boot for the single-profile case.

### 7. Concrete exploit story
A user has one profile, `Alpha`, with a year of history — all rows unscoped, because `profileId`
stamping only starts with this branch. They import the same seed phrase again as `Beta` (to keep a
"clean" identity for a new dApp). The MV3 worker is evicted mid-import — the documented wedge at
`import.vue:58-72` — so `completeImportWithRecovery` falls through to `recover()`, which calls
`hydrateKnownProfile()`. `appStore.profiles` is `[Alpha]`, length 1, so `soleProfile === true`.
`syncTransactions()` pulls every `0x1f3a…` row (Alpha's entire history, unscoped) and, because the
quarantine is bypassed and both the account and chain match, attributes it to `Beta`. The user is
routed to `/popup/general` and `Beta` shows `Alpha`'s complete transaction history — recipients,
amounts, contracts — which is exactly the separation the second profile was created to obtain.

### 8. Preconditions
- Two profiles sharing an address (same mnemonic).
- Unscoped rows exist — true for 100% of rows at the moment this branch ships.
- One of the `hydrateKnownProfile` paths runs: the import-recovery timeout
  (`import.vue:79`, `onboarding/pages/import.vue:49`) or the onboarding shell mount
  (`onboarding/app.vue:60`).

### 9. Why existing mitigations fail
- The display filters cannot help: `wrongProfile` is explicitly written to let `profileId === undefined`
  rows through (`activity-rows.ts:61-63` — "Rows written before scope stamping name none and stay
  visible"), which is the correct choice *given* a trustworthy store-side quarantine, and useless
  once the quarantine fails open.
- `activity.store.test.ts:117-142` pins the guard by passing `{ soleProfile }` explicitly, so it can
  never observe that the production caller derives the flag from a ref that is sometimes empty or stale.
- There is no migration backfilling `profileId` onto existing rows (`realMigrations` is `[]` —
  `apps/extension/src/wallet/storage/migrations/index.ts:26`), so the unscoped population does not
  shrink over time; it is the entire pre-release history, forever.

### 10. Instances (same root cause)
- `apps/extension/src/stores/app.store.ts:168`, `:176`, `:184`, `:198` — all four `soleProfile`
  derivations read the same unguaranteed `profiles` ref.
- `apps/extension/src/composables/useProfileBootstrap.ts:98-118` — `hydrateKnownProfile` omits the
  `appStore.profiles` refresh its sibling performs at line 72.
- `apps/extension/src/onboarding/app.vue:60,66` — profile list fetched into a local, never stored.
- `apps/extension/src/popup/pages/import.vue:79` and
  `apps/extension/src/onboarding/pages/import.vue:49` — the recovery callers.

---

## F3 — the account and incoming-transfer roots were re-keyed with no migration, so every delete/purge path silently no-ops on pre-existing rows

### 1. Title
`accountRowId` and `recordKey` changed the storage-key derivation, but every deletion path
re-derives the key from the row's **value**; rows written under the old key are enumerated (and
rendered) but can never be deleted, and are re-inserted as duplicates.

### 2. Impact / exploitability factors

**Impact**
- **Confidentiality (data retention)** — "delete my profile", "delete this account", "remove this
  token" and "purge this chain" all leave the corresponding rows in `chrome.storage.local`. The
  retained data is account addresses + indices + names, and, for incoming transfers, decrypted
  receive metadata: counterparty-visible token contract, raw amount, note hash, tx hash, block
  number. A user who deletes a profile to remove that data from the device does not remove it.
- **Integrity** — incoming-transfer records that cannot be found by `getRecord`/`hasRecord` are
  re-inserted under the new key on the next PXE scan, so the same receive renders **twice** in the
  activity feed; and `onTransactionAdded`'s late-delete (which exists to reclassify your own
  outgoing note that was mis-indexed as an incoming receive) permanently fails, leaving an outgoing
  transfer displayed as an incoming one.
- **Availability** — `AccountService.getAccountContract` reads by the new key, so a legacy account
  row is listed by `getAccounts` (which enumerates values) but cannot be resolved for signing.
- **Blast radius** — every install that already holds rows. Per `CLAUDE.md` § "Persisted-storage
  shape changes", the project is **pre-production**, so this is bounded to developer/tester
  installs. That caps severity; it does not make the delete paths correct.

**Exploitability**
- No attacker needed — it is a deterministic consequence of upgrading an existing install.
  An attacker who later obtains the device gets the retained data.
- **Complexity:** none. **Privileges:** none. **User interaction:** the user performing a delete.

### 3. Evidence confidence
**High.** `realMigrations` is empty (`apps/extension/src/wallet/storage/migrations/index.ts:26`),
`EntityStorage.delete` keys on `${root}@${id}` verbatim
(`packages/wallet-core/src/storage/entity_storage.ts:102-104`), and `getValues()` enumerates by root
prefix regardless of key shape (`entity_storage.ts:126-136`).

### 4. OWASP / CWE
- CWE-459 Incomplete Cleanup
- CWE-212 Improper Removal of Sensitive Information Before Storage or Transfer
- OWASP A04:2021 Insecure Design (the key derivation changed without a key-space migration)

### 5. TRACE

**Accounts**
1. `apps/extension/src/wallet/services/account/spec.ts:22-24` — new key:
   `JSON.stringify(["account", profileId, chainId, address])`. Pre-`acf3fd6` the key was the bare
   `account.address` (see the diff of `service.ts:100`, `:147`, `:180`…).
2. `packages/wallet-core/src/storage/entity_storage.ts:126-136` — `getValues()` returns every row
   under `nulo:core:accounts@`, including rows stored at `nulo:core:accounts@0x1f3a…`.
3. `apps/extension/src/wallet/services/account/service.ts:292` —
   `const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profileId)`
   returns the legacy row.
4. `apps/extension/src/wallet/services/account/service.ts:300-304` —
   `purgeRows(accounts, (account) => this.storage.delete(accountRowIdOf(account)), …)` deletes
   `nulo:core:accounts@["account","a1b2…",11155111,"0x1f3a…"]`, which does not exist. The legacy row
   at `nulo:core:accounts@0x1f3a…` survives profile deletion.
5. Same shape at `apps/extension/src/wallet/services/account/service.ts:76-80`
   (`clearChainState`, the `deleteNetwork` chain purge).
6. Read-side asymmetry: `getAccount` (`service.ts:100`) and `getAccountContract` (`service.ts:212`)
   read by the new key and miss the legacy row, while `getAccounts` (`service.ts:89-95`) enumerates
   values and returns it.

**Incoming transfers**
7. `apps/extension/src/wallet/services/incoming-transfer/repository.ts:36-38` — new key
   `JSON.stringify([profileId, networkId, accountAddress, siloedNullifier])`; previously the bare
   `siloedNullifier` (see the diff of `repository.ts:61-75`).
8. `apps/extension/src/wallet/services/incoming-transfer/service.ts:261-264` (account-deleted fanout)
   — `listForAccount(...)` (value enumeration, returns legacy rows) then
   `this.repo.deleteRecord(record, record.siloedNullifier)` → composite key → no-op. The record is
   emitted as `onIncomingTransferDeleted` (so the UI removes it optimistically) but survives on disk
   and returns on the next `getIncomingTransfers`.
9. `apps/extension/src/wallet/services/incoming-transfer/service.ts:513-516` (`removeToken`) — same
   pattern: `listByContract` enumerates, `deleteRecord` no-ops.
10. `apps/extension/src/wallet/services/incoming-transfer/service.ts:554-559`
    (`onTransactionAdded` late-delete) — `getRecord(record, record.siloedNullifier)` returns
    `undefined` for a legacy row → `continue` → the record is never reclassified.
11. `apps/extension/src/wallet/services/incoming-transfer/service.ts:651` — the scan path's
    `getRecord({ profileId, networkId, accountAddress }, note.siloedNullifier)` misses the legacy
    row, falls into the create branch, and `upsertRecord` writes a second row under the new key
    (`repository.ts:69-71`) → duplicate feed entries.

### 6. The missing control
`EntityStorage` already ships the exact primitive for this, with a docstring that names this bug:
`rawEntries()` (`packages/wallet-core/src/storage/entity_storage.ts:138-162`) — *"The `id` is the
true storage-key suffix — NOT any id embedded in the value — so a caller that deletes by it removes
the row that actually exists at that key. For maintenance paths (e.g. a profile-scoped purge) that
MUST act on every row regardless of validity and cannot trust the row's self-reported id."*

Every purge/delete path above should enumerate with `rawEntries()` and delete by the returned
storage-key suffix. Alternatively (and additionally, for the duplicate/read-miss half), ship a
numbered migration that re-keys both roots — the declarative `defineRowMapMigration` form covers it
and keeps backup import working.

### 7. Concrete exploit story
A tester's install holds `nulo:core:accounts@0x1f3a…` and ~200
`nulo:core:incoming-transfers@0x2b7c…` rows. They update to this build. The activity feed now shows
each historical receive twice (step 11). Alarmed, they delete the profile from Settings. The
`ProfileDeletionCoordinator` awaits `AccountService.purgeForProfile` and
`IncomingTransferRepository.clearProfile`; the account row survives (step 4), and while
`clearProfile` *does* delete correctly (it iterates `getKeys()` at `repository.ts:117-121`), the
account-deleted fanout that runs for the `deleteNetwork` path does not (step 8). They then hand the
laptop to a repair shop believing the wallet data is gone; the account address — which links to the
full on-chain history of that identity — and, on the `deleteNetwork` path, the decrypted receive
metadata, are still in `chrome.storage.local`.

### 8. Preconditions
- An install that already holds rows under the old key scheme, i.e. any upgrade rather than a fresh
  install. Fresh installs are unaffected.

### 9. Why existing mitigations fail
- The migration guardrails in CI (`migrations/registry.test.ts`, the footprint-coverage tests) only
  validate migrations that exist; they cannot detect a key-derivation change that ships *without* one.
- `IncomingTransferRepository.clearProfile`/`clearChain` (`repository.ts:116-142`) *do* iterate
  `getKeys()` and are therefore correct — which masks the problem, because the profile-delete path
  works while the account-delete and remove-token paths silently do not.
- `CLAUDE.md`'s pre-production rule ("do NOT write migrations; devs reinstall fresh") authorises the
  *data-loss* side of a shape change. It does not authorise delete paths that report success while
  leaving the data on disk — and that behaviour persists into production, because the pattern
  (`getValues()` + re-derive the key from the value) is now the standing idiom in both services.

### 10. Instances (same root cause)
- `apps/extension/src/wallet/services/account/service.ts:76-80` — `clearChainState`.
- `apps/extension/src/wallet/services/account/service.ts:300-304` — `purgeForProfile`.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:261-264` — account-deleted fanout.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:513-516` — `removeToken`.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:554-559` — late-delete.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:651` — read-miss → duplicate insert.
- `apps/extension/src/wallet/storage/migrations/index.ts:26` — `realMigrations: Migration[] = []`,
  i.e. no re-key migration accompanies either change.

---

## Checked — no finding (the brief's forging questions)

These were probed for a concrete source-to-sink exploit and none was found. Recorded so the next
reviewer does not re-derive them.

**Key forging via encoding quirks — NOT exploitable.** `activityScopeKey`
(`packages/wallet-core/src/activity/scope.ts:53`), `accountRowId`
(`apps/extension/src/wallet/services/account/spec.ts:23`) and `recordKey`
(`apps/extension/src/wallet/services/incoming-transfer/repository.ts:37`) all use
`JSON.stringify([...])` over a fixed-arity array. JSON string encoding is injective — quotes,
backslashes, control characters, `[`/`]`/`,` and (since ES2019 well-formed `JSON.stringify`) lone
surrogates are all escaped — so two distinct tuples cannot encode identically. Embedded quotes,
brackets and unicode were specifically checked. Numeric `chainId` is stringified as a JSON number,
which cannot be confused with a JSON string, and `-0`/`0` collapse consistently in both the key and
the duplicate check, so they agree rather than diverge.

**`hasIntersectionByKeys` uses a `|` join over verbatim strings, and runs before schema validation —
latent, no exploit.** `packages/wallet-core/src/utils/arrays.ts:41-53` builds
`` `${profileId}|${chainId}|${address}` `` and `safeStringify` passes strings through unchanged
(line 26). Because `chainId` renders as a decimal with no `|`, a key built from real data
(random-hex `profileId`, hex `address`) contains exactly two pipes and therefore has exactly one
3-part decomposition — no second tuple can produce it. A forge would require an *already stored* row
whose `address` or `profileId` contains `|`, which requires a prior hostile restore (`AccountSchema`
does not constrain the address beyond non-empty), and even then the only achievable effect is a
false-positive collision that aborts the attacker's own import. Also note the check at
`account/service.ts:327` runs on the **raw** rows, before `AccountSchema.parse` at line 334; a raw
`chainId: "1"` would compare equal to a stored `chainId: 1`, which again only makes the check
stricter. Worth tightening (JSON-encode the comparison key, or validate before comparing) but not a
finding under the "concrete trace or nothing" rule.

**Hostile backup grafting an account row onto another profile — closed upstream.**
`apps/extension/src/composables/useFullBackupImport.ts:395` calls
`normalizeAllIds(data, "profileId", newProfile.id)` **unconditionally** before
`accountService.restore(data.account)` (line 466), rewriting every child row's `profileId` to the
freshly created profile. `apps/extension/src/utils/full-backup-helpers.ts:109-117` only skips rows
that lack the key entirely, and an account row without `profileId` fails `AccountSchema.parse`
(`account/spec.ts:56`) and is recorded as a restore error. Profile ids are random hex
(`profile/repository.ts:104`), so a crafted backup cannot name a victim profile anyway. The
duplicate-check widening from `["address"]` to `["profileId","chainId","address"]`
(`account/service.ts:327`) is therefore safe: the only rows it newly admits are rows bound to the
just-created profile, which is the intended same-mnemonic-coexistence behaviour.

**Envelope-vs-embedded-scope disagreement in the backup migrator — closed by design.**
`accountAnchor` (`backup-migration-registry.ts:137-145`) presence- and type-guards all three fields
and returns `undefined` (→ hard reject at `normalizeBackupData` line 278) otherwise; `NaN` and
`Infinity` are rejected by `Number.isFinite`. `denormalizeBackupData` (line 343-346) re-derives the
anchor from the post-migration value and rejects on any mismatch with the storage key, so a
migration cannot mutate a row into another scope's key. The compile-time `AssertAnchor` pin
(line 115) prevents the anchor drifting from the `Account` type.

**LRU eviction / `clearAll()` on lock — no leak found.** `evictIfNeeded`
(`activity.store.ts:118-126`) drops only inactive slices and only cache copies (rows are durable),
and never evicts the active key. `clearAll()` is wired to the lock transition:
`SessionManager.close()` → `onChange(undefined)` (`session-manager.ts:243`) →
`ProfileService` emit (`profile/service.ts:142`) → `popup/app.vue:141` `appStore.clearActivity()`,
and every profile switch goes through lock/unlock (`components/Header.vue:25` is the only
`lockActiveProfile` caller; `auth.vue:76` is the only `unlockProfile` caller). Slices from a
different profile are keyed by a different `activityScopeKey`, so even if retained they cannot
render under another profile. `clearProfile` (`activity.store.ts:210-215`) has no callers — dead
code, not a vulnerability.

**Half-resolved scope colliding with a real one — no.** `activeScope`
(`app.store.ts:132-143`) returns `null` unless all four parts are present and `chainId` is a
non-negative safe integer, and `activityScopeKey` independently throws on an empty `profileId`/
`networkId`/`accountAddress` (`scope.ts:46-52`). During a profile switch `initNetworks` nulls
`appStore.network` first (`useProfileBootstrap.ts:24-25`), so the intermediate scope is `null`
rather than a torn tuple; the transient `{newProfile, newNetwork, staleAccount}` window that follows
keys a fresh empty slice and renders nothing.

**Divergent address canonicalization — noted, no trace.** `activityScopeKey` lowercases and trims
the address (`scope.ts:34-36`) while `accountRowId` does not (`account/spec.ts:23`). Two account
rows differing only in address case would therefore share one activity slice while remaining two
distinct account rows. Creating such a pair requires a hostile backup (`AccountSchema` does not
canonicalize addresses), and the display filters compare `tx.account` exactly, so no row renders
under the wrong account. Recorded as a latent inconsistency, not a finding.

**`buildActivityRows` does not apply `wrongProfile` to incoming rows** (`activity-rows.ts:84-98`)
while `RecentActivityView.vue:123` does. No trace to harm: `incomingTransfers` reaching
`activity.vue` comes from `useIncomingTransfers`, which scopes both the fetch and the live-event
merge on `(profileId, networkId, account)` (`useIncomingTransfers.ts:69,80-83`). Consistency gap
only.
