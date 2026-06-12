# C2 — wallet-service fleet patterns (Claude instance 1)

Scope audited: `packages/extension/src/wallet/services/{token,transaction,contact,config,network,fpc,auth-registry,account,profile,dapp-session}/service.ts`, `profile/repository.ts`, `profile/session-manager.ts` (context), `packages/extension/src/wallet/runtime.ts`, `packages/extension-messaging/src/background/service.ts` (base-class context). All map claims below re-verified against source; counts are from fresh greps, not the map.

## F1: backup()/restore() accumulate-loop copy-pasted across 9 services, already diverging

1. **Title**: backup/restore accumulate loop duplicated ×9 with shape drift.
2. **Smell name**: Duplicate Code (Fowler). The orchestrator (`src/composables/useFullBackupImport.ts` + `src/utils/full-backup-helpers.ts:73-87`) depends on every copy producing the same `Restored<T>` shape, so this is also incipient Shotgun Surgery: changing the restore-error contract means touching 9 files plus the collector.
3. **Bucket**: structural. Blast radius: 9 service files + the UI collector. Change frequency: each service file 1-3 commits/3mo, but the family is touched whenever any service adds a backed-up field or a new service joins the backup surface.
4. **Evidence**: identical `for (item) { try { persist; result.push(item) } catch (err) { result.push({ ...item, restoreError: err instanceof Error ? err.message : err }) } }` loop in:
   - `config/service.ts:43-59`
   - `account/service.ts:213-234`
   - `contact/service.ts:290-319`
   - `token/service.ts:532-558`
   - `transaction/service.ts:302-324`
   - `network/service.ts:614-657`
   - `fpc/service.ts:470-520`
   - `auth-registry/service.ts:285-311`
   - `profile/service.ts:830-975` (single-entity variant, same `restoreError` catch shape at :898-902 and :959-963)
   Drift already present: `contact/service.ts:310` pushes the raw error object (`restoreError: err`) while every other copy pushes `err.message` — the collector at `full-backup-helpers.ts:85` treats both as truthy, so the divergence is invisible until someone renders the log. Second duplicated sub-shape: `transaction/service.ts:279-300` and `auth-registry/service.ts:262-283` are line-for-line the same backup loop (active-profile guard → iterate networks → iterate accounts → concat rows).
5. **Why it harms future change**: any change to the restore contract (typed errors, partial-success reporting, dry-run mode, progress events) is a 9-file edit where each copy has quietly mutated (contact's raw `err`, fpc's extra type-rejection branch, account's up-front intersection throw vs everyone else's per-item catch). Reviewers cannot tell intentional divergence from rot.
6. **Smallest safe refactoring**: Extract Function — a generic `restoreEntities<T>(items, persist: (item) => Promise<T>): Promise<Restored<T>[]>` next to `Restored<T>` in `wallet-core/base`, with each service supplying only its persist closure (id-remap, dedupe). Plus Extract Function for the shared networks×accounts backup walk used by transaction + auth-registry.
7. **What disappears**: ~140 lines of loop scaffolding, the `err instanceof Error` ternary ×8, and the possibility of per-copy error-shape drift; the restore contract becomes one function signature.
8. **Instances**: all locations in field 4.

## F2: profile-deleted / chain-purge cascade loop duplicated in 8 services with inconsistent lock discipline

1. **Title**: filter→delete→emit purge cascade copy-pasted ×11 sites.
2. **Smell name**: Duplicate Code (Fowler), graduating to Shotgun Surgery: changing cascade semantics (batched storage writes, purge ordering, error policy) touches 8 files.
3. **Bucket**: structural. Blast radius: 8 service files. Change frequency: the cascade was the subject of the recent purge-coordinator work (`network/service.ts:551-600`), so this shape is actively evolving.
4. **Evidence**: the same "getValues → filter by profileId/chainId/account → loop delete → emit *Deleted" block at:
   - `account/service.ts:43-50` (clearChainState) and `:194-202` (onProfileDeleted)
   - `token/service.ts:72-79` and `:515-521`
   - `transaction/service.ts:74-82` and `:166-174` (onAccountDeleted)
   - `contact/service.ts:256-270`
   - `fpc/service.ts:71-80` and `:447-461`
   - `dapp-session/service.ts:325-338`
   - `auth-registry/service.ts:56-70` (inline listener in init)
   - `network/service.ts:671-691` (coordinator variant)
   The registration one-liner is itself duplicated verbatim: `registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))` at `account/service.ts:35`, `token/service.ts:64`, `transaction/service.ts:55`, `fpc/service.ts:64`.
   Concrete drift inside the family: contact/fpc/dapp-session run the purge under `this.lock`; account, token, and transaction purge with no lock at all; `token/service.ts:517-520` delegates to `deleteToken` (re-acquiring the lock per row) while its own `clearChainState` at :72-79 deletes the same rows lock-free. Three different concurrency answers to the same question in one file family.
5. **Why it harms future change**: a new profile-scoped service must hand-write the loop and silently picks one of the three lock disciplines; changing the cascade (e.g. single batched `storage` write per purge instead of N sequential deletes, or purge-failure reporting) requires finding all 11 sites — and the variation makes mechanical search-and-replace unsafe.
6. **Smallest safe refactoring**: Extract Function — `purgeWhere<T>(storage, predicate, onEach: (row: T) => void)` in `@/wallet/storage` (or a protected helper on a thin shared subclass), so each service supplies only its predicate + emit. Lock policy is decided once at the helper boundary.
7. **What disappears**: ~90 lines of loop scaffolding, the three-way lock-discipline divergence, and the per-service decision about purge ordering.
8. **Instances**: all locations in field 4.

## F3: active-profile guard and row-ownership guard repeated ~50 times with four different error literals

1. **Title**: `getActiveProfile()` + throw guard duplicated fleet-wide; error message already drifted 4 ways.
2. **Smell name**: Duplicate Code (Fowler); the string literals are also Primitive Obsession (auth state signalled by ad-hoc `Error(string)` instead of a typed error like the existing `InvalidPasswordError` in `@nulo/extension-messaging/errors`).
3. **Bucket**: structural. Blast radius: 8 cluster files (+ execution, token-balance, dapp-interaction outside the cluster carry the same copy). Change frequency: every new RPC method on any profile-scoped service adds another copy.
4. **Evidence**: guard-literal counts per file (grep `throw new Error("Profile locked"|"Wallet is locked"|"Wallet locked"|"unauthorized")`): network 14, fpc 7, contact 7, token 2, dapp-session 2, account 2, transaction 1, auth-registry 1, profile 1. Message drift: `"Profile locked"` (majority), `"Wallet is locked"` (`dapp-session/service.ts:112`), `"Wallet locked"` (`token/service.ts:468`), `"unauthorized"` (`account/service.ts:189`). The companion row-ownership guard `x?.profileId !== profile.id → throw` repeats network ×12, fpc ×5, contact ×3, account ×3 — with its own casing drift: `"Invalid id"` (network/fpc/dapp-session) vs `"invalid id"` (`contact/service.ts:66,130,163`) vs `"unknown account address"` (`account/service.ts:173`).
5. **Why it harms future change**: the popup classifies lock-state failures by matching error content; four live literals for one condition mean any UI handling (or e2e assertion, or telemetry grouping) keyed to the lock state must enumerate all spellings, and the next copy-paste can mint a fifth. Converting to a structured `WalletError` subclass (the codebase's established pattern — base `Service` already round-trips `WalletError` payloads, `extension-messaging/src/background/service.ts:85-99`) is currently a ~50-site edit.
6. **Smallest safe refactoring**: Extract Function — `requireActiveProfile(): Promise<ProfileInfo>` (one throw site, one literal or one typed error) on ProfileService or a small shared helper; same for `requireOwnedRow(row, profile)`. Mechanical per-call-site replacement.
7. **What disappears**: ~50 three-line preambles collapse to one call each; the four-literal drift collapses to one definition; future "make lock errors typed" becomes a one-line change.
8. **Instances**: counts above; representative lines `network/service.ts:171,206,216,226,239,265,285,309,333,374,423,451,475,496`, `contact/service.ts:50,60,76,90,123,155,191`, `fpc/service.ts:118,219,240,294,320,390,415`, `dapp-session/service.ts:47,112`, `token/service.ts:526,468`, `account/service.ts:207,189`, `transaction/service.ts:282`, `auth-registry/service.ts:265`.

## F4: two parallel startup-ordering mechanisms — declared `dependencies` used by 2 of 21 services, everyone else hand-writes `ensureInitialized()` preambles

1. **Title**: dual init-ordering mechanism; 81 hand-maintained `ensureInitialized()` preambles in the cluster alone.
2. **Smell name**: Temporal coupling (named analog — operations must happen in order, init-before-RPC, but enforcement is per-method convention, not structure). The preamble repetition itself is Duplicate Code; the coexistence of topological phases (`wallet-core/src/base/topology.ts`) and the 30s poll fallback (`extension-messaging/src/background/service.ts:187-199`) for the same concern is Divergent Change at the mechanism level — two places to understand and evolve "when is a service usable".
3. **Bucket**: architectural. Blast radius: all 21 services + both base classes. Change frequency: every new RPC method confronts the "do I need the preamble?" decision; the topology mechanism was added recently and is being adopted one service at a time.
4. **Evidence**: `dependencies` is declared only at `contact/service.ts:19` and `incoming-transfer/service.ts:68`; the other 19 services land in phase 0 (`wallet-core/src/base/index.ts:21-31` documents the fallback reliance explicitly). Preamble counts vs public-async-method counts per service: profile 24/25, network 17/19, fpc 9/10, contact 8/10, account 7/10, token 7/13, auth-registry 4/8, dapp-session 3/17, transaction 2/7, config 0/6. A reader cannot distinguish omission-by-design (method touches no late-bound dep, e.g. `dapp-session.updateDappSession`) from omission-by-accident (`token.getTokens` hits `this.tokens` only, but `token.deleteToken` emits while `getTokenInterface` needs `this.networks` — the guard placement encodes a per-method dependency analysis that exists only in the author's head).
5. **Why it harms future change**: adding a collaborator to an existing method silently changes whether the preamble is required, and nothing flags the gap — the 30s poll converts a missing guard into a hard-to-diagnose timeout instead of a startup error (exactly what topology.ts's header says it was built to eliminate). Two mechanisms means migration work is permanently "in progress": each new service copies whichever pattern its author saw last.
6. **Smallest safe refactoring**: Form Template Method / Move Statements to Callers' caller — hoist `await this.ensureInitialized()` into the base `Service.onMessage` dispatch (`extension-messaging/src/background/service.ts:62-102`), one site gating the whole RPC surface; in-process cross-service calls are covered by declaring `dependencies` (mechanism already exists and is tested). Then delete the per-method preambles mechanically.
7. **What disappears**: ~81 preamble lines in this cluster (more fleet-wide), the per-method "did you remember the guard" review burden, and eventually the 30s poll fallback itself.
8. **Instances**: counts in field 4; mechanism sites `extension-messaging/src/background/service.ts:187-199`, `wallet-core/src/base/topology.ts:53-105`, `wallet-core/src/base/index.ts:65-70`, declarations `contact/service.ts:19`, `incoming-transfer/service.ts:68`.

## F5: PxeServiceClient constructed independently inside 8 services' init() instead of at the composition root

1. **Title**: per-service `new PxeServiceClient(this.logger)` ×8 bypasses the composition root.
2. **Smell name**: Shotgun Surgery (Fowler) — changing PXE-client construction (signature, ports migration, shared caching) is an 8-file edit. Secondary: the deliberate composition root (`runtime.ts` header: "Dependencies are explicit... any side effect the runtime has on the outside world goes through a port") is violated by a hidden transport dependency, a form of Inappropriate Intimacy with the offscreen transport.
3. **Bucket**: architectural. Blast radius: 8 service files + `runtime.ts`. Change frequency: execution/service.ts (one of the 8) is the repo's hottest file (9 commits/3mo); the ports migration the runtime header promises will hit all 8 sites.
4. **Evidence**: `new PxeServiceClient(this.logger)` at `token/service.ts:57`, `transaction/service.ts:52`, `network/service.ts:163`, `fpc/service.ts:60` (cluster scope), and same root cause at `note/service.ts:46`, `execution/service.ts:342`, `token-balance/service.ts:67`, `account-state/service.ts:36`. Contrast: `WindowManager` is built once in `runtime.ts:114` and injected into the two services that need it; `ConfigStore` likewise (`runtime.ts:113,125`). The PXE client is the only shared collaborator each consumer news up privately. Each instance is a full `ServiceClient` with its own port lifecycle and its own `ensureOffscreenRunning` hook (`services/pxe/client.ts:9-19`).
5. **Why it harms future change**: when `PxeServiceClient` grows a constructor parameter (the runtime's stated browserApi-port migration, or an injected fake for tests), all 8 `init()` bodies change; tests for any of the 8 services cannot substitute a fake PXE without monkey-patching, which is consistent with the map's "zero tests" list covering token, transaction, fpc, auth-registry. A single shared instance also gives one place to add cross-cutting behavior (retry, metrics) instead of eight.
6. **Smallest safe refactoring**: Move Function (creation) to the composition root — construct one `PxeServiceClient` in `runtime.ts` and pass it through the constructors exactly like `WindowManager`/`ConfigStore`/`browserApi` already are (no new mechanism needed).
7. **What disappears**: 8 construction sites → 1; the hidden transport dependency becomes an explicit, fakeable constructor parameter; the ports migration for PXE becomes a one-line change.
8. **Instances**: the 8 file:line locations in field 4.

## F6: EntityStorage construction seam half-migrated — browserApi ternary copy-pasted ×4, `chrome.storage.local` hard-coded in 7 services

1. **Title**: storage-area selection duplicated as a ternary in migrated files and as a banned-elsewhere global in the rest.
2. **Smell name**: Duplicate Code (the ternary ×4) + hardcoded-dependency seam — a named analog of Shotgun Surgery: completing the ports migration that `runtime.ts:105-108` explicitly promises ("remaining services still reach into chrome.* directly until their migration lands") requires touching every service constructor and re-copying the same fallback boilerplate each time.
3. **Bucket**: structural. Blast radius: 11 files. Change frequency: migration is in flight (contact, profile, operation-journal already converted), so each conversion PR re-encounters this.
4. **Evidence**: the identical optional-`browserApi` fallback ternary at `contact/service.ts:37-39`, `profile/repository.ts:42-46`, `profile/session-manager.ts:130-132` (ValueStorage variant), `operation-journal/service.ts:85-87`. Hard-coded `chrome.storage.local` field initializers at `account/service.ts:23`, `token/service.ts:42`, `transaction/service.ts:36`, `network/service.ts:143`, `fpc/service.ts:43`, `auth-registry/service.ts:29-30` (two storages), `dapp-session/service.ts:29`; network additionally calls `chrome.storage.local` raw at `network/service.ts:687,752,758` for the active-network pointer.
5. **Why it harms future change**: the 7 hard-coded services cannot take a `FakeBrowserApi` in unit tests — they require a stubbed global `chrome.*`, which matches the map's observation that exactly these services (token, transaction, fpc, auth-registry, account, dapp-session, config) have zero service tests while the browserApi-accepting ones (contact, profile, operation-journal) are well-tested. Every future migration PR re-writes the same ternary; every new service flips a coin on which pattern to copy.
6. **Smallest safe refactoring**: Extract Function — `entityStorageFor<T>(root: string, browserApi?: BrowserApi)` in `@/wallet/storage` encapsulating the fallback once (or a defaulted `area` parameter on `EntityStorage` itself). Then converting a service is a constructor-signature change only, with no boilerplate to re-copy.
7. **What disappears**: 4 copies of the ternary; the decision logic for "which storage area" lives in one place; per-service migration diffs shrink to the constructor line, and the fallback can be deleted fleet-wide in one commit when the migration completes.
8. **Instances**: all locations in field 4.

## F7: lock idiom hand-expanded ~67 times; keyed/serialized variants hand-rolled with visible decay

1. **Title**: `try { await this.lock.enter() } finally { this.lock.leave() }` boilerplate ×67 plus two divergent hand-rolled lock variants.
2. **Smell name**: Duplicate Code (Fowler). The hand-rolled variants are evidence the shared `Lock` primitive (`wallet-core/src/utils/lock.ts`) lacks the affordances callers need — an Incomplete Library Class analog (Fowler) within the repo's own core package.
3. **Bucket**: local (pervasive micro-idiom). Blast radius: 7 cluster files (more fleet-wide). Change frequency: every mutator method added to any service re-types the frame.
4. **Evidence**: `lock.enter()` frames per file: profile 21, network 13, dapp-session 12, fpc 7, contact 5, auth-registry 5, token 4. Drift within the idiom: (a) only network (`network/service.ts:155`) and fpc (`fpc/service.ts:44`) construct named locks with a logger — the other five get bare `new Lock()`, silently losing the slow-wait/force-release diagnostics that Lock only emits when a logger is present (`lock.ts:21-44`); (b) `token/service.ts:151-201` invents a `holdsLock` boolean variant of the same frame; (c) `account/service.ts:118-136` hand-rolls a per-key serialization (`serializePerTuple`) because Lock has no keyed variant — and its cleanup `finally` at :129-135 is entirely dead code (the guard `this.tupleLocks.get(key)?.then === undefined` can never be true for a Promise, and no statement follows the early return), so the comment about "cleanup the slot" describes behavior that does not exist.
5. **Why it harms future change**: a `withLock` wrapper is the standard place to enforce "always released, always named, always observable"; without it, each new method re-decides naming/logging (currently 5 of 7 services are unobservable under contention), and one-off variants like `holdsLock` and the dead `serializePerTuple` cleanup accumulate — each future reader must reverse-engineer whether the deviation is load-bearing.
6. **Smallest safe refactoring**: Extract Function / Replace Inline Code with Function Call — add `Lock.run<T>(fn: () => Promise<T>): Promise<T>` (and a `KeyedLock` for the account use case) to `wallet-core/utils`, then mechanically replace frames. Delete the dead `finally` in `account/service.ts:129-135` (Remove Dead Code).
7. **What disappears**: ~67 four-line frames become one-liners; the named-vs-bare observability gap closes by construction; the `holdsLock` and dead-cleanup variants become unnecessary.
8. **Instances**: counts in field 4; variants `token/service.ts:151-201`, `account/service.ts:118-136`; bare locks `token/service.ts:43`, `contact/service.ts:26`, `auth-registry/service.ts:31`, `profile/service.ts:30`, `dapp-session/service.ts:30`.

## F8: TokenService interface assembly duplicated wholesale; PXE ensure-registered block repeated ×4 across token + fpc

1. **Title**: `getTokenInterface` vs `parseTokenInterface` are ~85-line near-twins built on a 9-family data clump.
2. **Smell name**: Duplicate Code (Fowler) + Data Clumps (the nine `<X>Fn` / `<X>FnCandidates` pairs that always travel together through `Token`, `TokenInterface`, and both assembly methods).
3. **Bucket**: local (token/service.ts, fpc/service.ts). Blast radius: 2 files, plus `token/spec.ts` shapes. Change frequency: token triple at 3 commits/3mo (map §8 hotspot list).
4. **Evidence**:
   - `token/service.ts:275-359` (`getTokenInterface`) and `:361-449` (`parseTokenInterface`) share the PXE resolution prologue and the 9× `X.getCandidates(artifact)` enumeration verbatim; they differ only in fn selection (stored `token.x` vs `X.getDefault(...)`) and task wrapping. Adding a tenth token function family means editing 4+ parallel blocks (both methods, both 14-field object literals at `:166-181` and `:229-246`, plus spec).
   - The "ensure contract registered" block (`getContractInstance → getContractArtifact → getContracts → registerContract if missing`) appears 4×: `token/service.ts:289-305`, `token/service.ts:374-390`, `fpc/service.ts:245-261`, `fpc/service.ts:347-357` — with the fpc copies already diverging in error wording.
5. **Why it harms future change**: the function-family list is the most likely thing to change in token support (new transfer kinds), and today that change is a multi-block shotgun within the file; the two assembly methods have already begun to drift (one wraps in tasks, one doesn't), so a fix to the PXE resolution applied to one path can silently miss the other.
6. **Smallest safe refactoring**: Extract Function ×2 — (a) `ensureContractRegistered(pxe, address): Promise<{instance, artifact}>` shared by token + fpc; (b) drive the 9 families from a single declarative table (`const TOKEN_FN_KINDS = [GetNameFn, GetSymbolFn, ...]`) so both assembly methods and both object literals iterate one list (Replace Duplicated Code with Loop over data).
7. **What disappears**: ~120 duplicated lines in token/service.ts, 2 of the 4 PXE-registration copies, and the requirement to touch 4+ blocks per new token-function family.
8. **Instances**: `token/service.ts:275-359, 361-449, 166-181, 229-246, 289-305, 374-390`; `fpc/service.ts:245-261, 347-357`.

## F9: profile password/passkey method pairs duplicate the snapshot→unlocked-work→revalidate→open skeleton

1. **Title**: parallel three-phase structure hand-copied between password and passkey twins in ProfileService.
2. **Smell name**: Duplicate Code with repeated type dispatch — the password/passkey split is Fowler's Switch Statements smell smeared across method pairs (12 literal `type === "passkey"/"password"` comparisons plus the `restore()` switch), and the shared three-phase skeleton is a textbook Form Template Method candidate.
3. **Bucket**: structural (wrong shape within the module). Blast radius: 1 file (1053 lines, the cluster's second-largest), but profile/service.ts is a 3-commits/3mo hotspot and the wallet's security-critical surface, where divergent twins are most expensive to re-review.
4. **Evidence**: `unlockProfile` (`profile/service.ts:144-203`) and `unlockPasskeyProfile` (`:281-344`) implement the identical phase structure (locked snapshot + type guard → unlocked expensive credential work → locked revalidate-against-snapshot → `sessionManager.open` → zeroize in finally), differing only in the credential step and the revalidation fields. Same skeleton again in `createProfile` (`:104-136`) vs `createPasskeyProfile` (`:214-259`), and in the two `restore()` branches (`:851-908` vs `:909-970`). Type-dispatch guards repeat at `:153,186,273,292,329,433,498,634,650,683,723,1013` — each new entry point re-implements both the guard and the phase ordering by hand.
5. **Why it harms future change**: the revalidation rules (the subtle part — what must be re-checked under the lock after the unlocked credential work) exist in N hand-synced copies; a hardening fix applied to one twin (e.g. the F-007 credential-binding check added to `unlockPasskeyProfile:318-320`) has no structural reason to appear in its sibling, so every security review must diff the twins manually.
6. **Smallest safe refactoring**: Form Template Method (Fowler) — one private `threePhase<T>(snapshotAndGuard, unlockedWork, revalidateAndOpen)` driver capturing the lock/zeroize/finally ordering, with the password/passkey variants supplying the three closures. (Full Replace Conditional with Polymorphism over profile type is the larger follow-up; the template method alone removes the skeleton duplication safely.)
7. **What disappears**: 3 hand-synced copies of the lock/revalidate/zeroize ordering; the invariant "expensive credential work never holds the facade lock" becomes enforced by one function instead of by comment blocks at `:138-143` and `:261-266`.
8. **Instances**: `profile/service.ts:104-136, 144-203, 214-259, 281-344, 851-908, 909-970`; dispatch sites listed in field 4.

## F10: fresh-random-id generation loop duplicated ×9 across five files

1. **Title**: `do { id = getRandomHex(n) } while (await storage.contains(id))` idiom copy-pasted fleet-wide.
2. **Smell name**: Duplicate Code (Fowler).
3. **Bucket**: local. Blast radius: 5 files. Change frequency: low per-site, but every new entity service re-types it.
4. **Evidence**: `contact/service.ts:96-99` (add) and `:299-302` (restore, while-variant); `network/service.ts:713-719` (`_freshStored8`), `:721-728` (`_fresh8`, in-memory variant), `:641` (restore); `fpc/service.ts:191-194` and `:490-493`; `dapp-session/service.ts:118-121`; `profile/repository.ts:101-107` (`generateUniqueId` — the only copy with the documented locked-re-verify contract). Network is the only service that bothered to extract local helpers; everyone else inlines.
5. **Why it harms future change**: id-generation policy (length, alphabet, collision strategy, the lock-re-verify contract that `profile/repository.ts:73-100` documents at length) is decided independently at 9 sites; dapp-session uses 64 hex chars, everything else 8 — a reader can't tell whether that asymmetry is a security decision or copy-paste drift without archaeology.
6. **Smallest safe refactoring**: Extract Function — `freshId(contains: (id) => Promise<boolean>, hexLen = 8)` in `@/wallet/utils` next to `getRandomHex`; network's two local helpers inline into it.
7. **What disappears**: 9 hand-rolled loops; the collision-retry contract gets one home (and one place to document the locked-re-verify caveat instead of a 28-line JSDoc on one of nine copies).
8. **Instances**: all locations in field 4.

## Non-findings

- **spec/service/client triple**: house convention, explicitly excluded by the prompt; only its measurable duplication costs were assessed (F1-F4).
- **Added/Updated/Deleted EventHandler triples ×10 services**: 3 declaration lines each, doubling as the events map per the base-class design; no logic duplicated beyond declarations — convention, not a smell.
- **`export * from "./spec"` at the top of every service**: consistent convention, zero drift observed.
- **ConfigService having no `ensureInitialized` preambles**: not an instance of F4's drift — it has no `init()` and its only collaborator is constructor-injected; omission is structurally safe, not accidental.
- **`fpc/service.ts:44` field initializer referencing `this.logger`**: legal (initializers run after `super()` assigns logger); considered as fragile-ordering, rejected — TypeScript class semantics guarantee it.
- **`network/service.ts` zod `validateParams` on most-but-not-all methods**: the unvalidated ones (`getNode`, `getNodeForUrl`, `getNetworkInfo`, `purgeChain`) are internal/cross-service entry points, not popup RPC; intent is discernible, no clear duplication cost. (The network-only adoption of zod schemas is a fleet inconsistency, but flagging "others should adopt" would be speculative generality.)
- **`transaction/service.ts:176-194` infinite `runWorker` polling loop**: considered as a missing-abstraction smell vs chrome.alarms; it's a deliberate MV3-keepalive-adjacent design choice with no in-cluster duplicate — single instance, not a catalog smell.
- **DEFAULT_SEEDS / chainId XOR literals in network/service.ts:66-95**: magic-number-ish, but each carries an explanatory comment and lives in exactly one place — no duplication, rejected.

## Out-of-scope observations

- `account/service.ts:118-136` `tupleLocks` map entries are never removed (dead cleanup, see F7) — unbounded growth over a long SW lifetime; correctness/resource concern.
- `dapp-session/service.ts` mutators (`updateDappSession`, `setCapabilityGrants`, etc.) operate by sessionId with no active-profile ownership check, unlike every other service's row guards — trust-boundary question for the security track.
- `account/service.ts:138-167` `changeAccountName`/`changeAccountVisibility` skip `ensureInitialized` AND the per-tuple serialization that `createAccount` documents as race-critical — potential lost-update window; correctness track.
- `transaction/service.ts:192` polls every 1s forever even with zero pending txs across SW lifetime — perf concern, separate track.
- `contact/service.ts:197` `JSON.parse(data)` result is mapped with an unvalidated cast before sanitization — input-validation question for the security track.
