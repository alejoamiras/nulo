# apps/extension/src/wallet/services — repo map

29 service directories. LOC = service.ts + client.ts + spec.ts only (helper files excluded from the roundup below unless noted).

## 1. Service inventory

| Service | Purpose | service+client+spec LOC |
|---|---|---|
| account | Aztec account rows (frozen-regime derivation, visibility) | 395+42+129 |
| account-integrity | Blocks UI when a stored account fails re-derivation | 190+56 (no client; coordinator) |
| account-state | Normalizes/caches PXE-synced account state | 336+43+72 |
| activity-protocol | Aggregates recent activity across sub-protocols | 268+70 (coordinator, no client) |
| auth-registry | Public authwit registry rows | 476+44+102 |
| backup | Full-backup export/import + migration engine glue | 168+359+394 (no client/spec; migrator+registry+row-map-migration) |
| config | Simple key/value settings | 92+31+16 |
| contact | Address-book CRUD | 290+44+91 |
| dapp-interaction | In-flight dApp RPC request queue/state | 554+41+124 |
| dapp-session | Per-origin dApp connection + capability grants (MAC-integrity-checked) | 377+50+116 |
| execution | Tx/estimate orchestration — by far the largest surface (26 files, 6615 LOC incl. helpers) | 914+41+108 |
| fpc | Fee-paying-contract selection rows | 478+42+95 |
| incoming-transfer | Public-event indexed incoming-transfer detection | 2001+59+397 (largest single service.ts) |
| logger | Log sink | 25+23+14 |
| log-viewer | Reads persisted logs for the debug UI | 34+35+12 |
| network | Per-profile RPC endpoint/chain config | 911+135+355 |
| note | Note-tagging for notes/UTXOs | 304+30+67 |
| operation-journal | Durable operation records (gc+reaper sidecars) | 561+127+377 |
| passkey | WebAuthn passkey request/response bridge | 130+30+81 |
| price | Fiat price fetch/cache | 401+25+50 |
| profile | Profile lifecycle, session, recovery — largest package (10 files, 3253 LOC) | 1613+158+319 |
| profile-deletion | Cross-service profile-purge coordinator | 134+27 (no client/spec) |
| pxe | Shallow PXE port wrapper (+ fake for tests) | 51 (client only; no service.ts, thin) |
| task | Generic async-task tracking (wraps promises) | 247+35+137 |
| token | Token registry + default-token seeding | 771+44+241 |
| token-balance | Per-account token balance projection (job-queued) | 372+37+94 |
| transaction | Persisted transaction records | 560+37+218 |
| wallet-sdk | `@aztec/wallet-sdk` background bridge (content-script validation, queued journal) | 778 (background.ts; no service/client/spec triple) |
| window-manager | Extension window lifecycle (popup/expanded) | 193 (single file, no client/spec) |

Note: 6 dirs (`account-integrity`, `activity-protocol`, `backup`, `profile-deletion`, `pxe`, `wallet-sdk`, `window-manager`) deviate from the service/client/spec triple — they're coordinators, framework glue, or thin wrappers, not RPC-exposed services in the standard shape.

## 2. Shared infrastructure (absorbs a lot — cite before flagging duplication)

- **`packages/extension-messaging/src/core/base-service.ts`** (220 LOC) + **`base-client.ts`** (300 LOC): own request lifecycle, RPC-surface guard, 3-tier send, correlator/pending-map, timeout/settle. Every `service.ts`/`client.ts` triple sits on top of these via the `background/service.ts` (`Service`) and `background/client.ts` (`ServiceClient`) transport subclasses.
- **`definePassthroughs` + `MethodsSpec`** (`extension-messaging/core/service-client-factory.ts` presumably) — installs passthrough RPC methods on a client prototype from a name-array; used by all client.ts.
- **`EntityStorage<T>`** (`@/wallet/storage`) — the row-keyed storage codec. Used directly by: account, network, auth-registry, contact, token, fpc, operation-journal, transaction (8 services). `ValueStorage` used by price (1).
- **`Lock`** (`@/wallet/utils`) — mutex used directly in service.ts by: dapp-session(12), network(14), fpc(7), auth-registry(6), contact(5), token(5), transaction(4), dapp-interaction(1), profile(1), activity-protocol/coordinator(2) — 9 services, 57+ call sites of the `try { await this.lock.enter() } finally { this.lock.leave() }` idiom.
- **`requireActiveProfile`** (`@/wallet/services/profile/require-active-profile.ts`) — 16 files call it.
- **`requireOwnedRow`** (`@/wallet/services/require-owned-row.ts`) — ownership-check helper, 5 files.
- **`nextRandomId`** (`@/wallet/services/id-allocators.ts`) — 4 files.
- **`purgeRows`** / **`restoreRows`** (`@/wallet/services/{purge-rows,restore-rows}.ts`) — profile-delete purge / backup-restore row helpers, 10 and 4 files respectively.
- **`ProfileService`** — the most-imported cross-service dependency (54 references across service.ts/helper files); `NetworkService` (28), `TaskService` (16), `PxeService` (16).

These ARE the DRY layer already extracted; the duplication candidates below are patterns that recur **on top of** this shared infra, in each service's own code, rather than being pulled into it.

## 3. Coupling surfaces (services importing other services)

Import counts of `from "@/wallet/services/<x>/..."` across all service/helper files (excludes tests):
profile(54) > network(28) > task(16) = pxe(16) > transaction(14) = account(14) > operation-journal(12) = execution(12) > token(8) = require-owned-row(8) = id-allocators(8) > restore-rows(6) > window-manager(4) = price(4) = config(4) > token-balance(2) = passkey(2) = note(2) = fpc(2) = dapp-session(2) = dapp-interaction(2) = contact(2) = auth-registry(2).

`execution` is the heaviest consumer (imports profile, network, account, transaction, token-balance, pxe, fpc across its 26 files) — it's the orchestration hub, consistent with its 6615 LOC size. `profile` is the universal dependency (every profile-scoped service needs `requireActiveProfile`/`onActiveProfileChanged`).

## 4. Apparent duplication candidates

**A. Client-file passthrough boilerplate (~18 files, near-verbatim).** Every client.ts beyond the 4 simplest (config, logger, network, price, profile — which hand-write methods) repeats the SAME 4-part shape: (1) a `const X_METHODS = [...] as const satisfies readonly (keyof Methods)[]` array, (2) an `Exclude<keyof Methods, (typeof X_METHODS)[number]> extends never ? true : ...` exhaustiveness-guard type + a `void` no-op line, (3) a `MethodsSpec<Methods>` declaration-merge interface with the same `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` comment verbatim, (4) `definePassthroughs<Methods>(XClient.prototype, X_METHODS)`. Confirmed identical structure in `contact/client.ts`, `token-balance/client.ts`, `passkey/client.ts`, and matching greps across account, account-state, auth-registry, dapp-interaction, dapp-session, execution, fpc, incoming-transfer, log-viewer, note, task, token, transaction (13+ more). Only the method-name list and event fields differ. This is a deliberate type-safety pattern (framework already extracted the runtime bit via `definePassthroughs`), but the exhaustiveness-guard ceremony (6-8 lines) and the ignore-comment are copy-pasted per file with zero variation — a codegen or shared-macro candidate.

**B. `onActiveProfileChanged` cache-invalidation handler, reimplemented per service.** `price/service.ts:190`, `token-balance/service.ts:240`, `task/service.ts:238`, `network/service.ts:792`, plus an inline `execution/service.ts:354` all wire `this.profileService.onActiveProfileChanged.add(...)` in `init()` and each hand-writes its own "clear an in-memory Map/cache on profile switch, optionally repopulate from storage" body (price re-arms an alarm and refreshes; token-balance clears+rebuilds a token Map; task clears iff the id changed; network clears two Maps under the lock). Same trigger, same intent (profile-scoped in-memory cache reset), 5 independent implementations with no shared "profile-scoped cache" primitive.

**C. `try { await this.lock.enter(); ...; } finally { this.lock.leave() }` write-guard, hand-rolled at every call site.** 57+ occurrences across 9 services (dapp-session 12, network 14, fpc 7, auth-registry 6, contact 5, token 5, transaction 4, dapp-interaction 1, profile 1) — confirmed identical in `contact/service.ts` (`addContact`/`updateContact`/`deleteContact`), `fpc/service.ts` (add/update/delete-fpc), `network/service.ts`. `Lock` itself is shared, but the enter/finally-leave wrapping is copy-pasted per method rather than offered as a `withLock(fn)` helper on `Lock` or the base service.

**D. `await this.ensureInitialized(); const profile = await requireActiveProfile(this.profileService)` two-line preamble, repeated at the top of nearly every public method.** Confirmed verbatim (or with `requireActiveProfile` swapped for a profileId param) in `contact/service.ts` (9 of its ~10 public methods), `fpc/service.ts`, `network/service.ts` (23 ensureInitialized call sites), `account/service.ts`, `token/service.ts`, `operation-journal/service.ts`. 16 files call `requireActiveProfile` total. Each method re-derives "I need the active profile" rather than a decorator/wrapper doing it once.

**E. Row-schema shape repetition in spec.ts.** 9 spec.ts files (`network`, `fpc`, `account`, `dapp-session`, `operation-journal`, `contact`, `token`, `transaction`, `incoming-transfer`) independently declare a zod row schema opening `id: z.string(), profileId: z.string(), chainId: z.number(), ...` — same 2-3 leading fields, same STORAGE_ROOT-constant + SERVICE_NAME-constant + "ROW schema deliberately laxer than WIRE schema" comment convention, re-typed per file rather than composed from a shared base-row schema/type.

Ranking by volume × spread: **A** (18 files, most mechanical/lowest-risk to dedupe via a shared generic) > **C** (57+ call sites, 9 files) > **D** (6+ files, tightly coupled to profile semantics) > **B** (5 files, behaviorally distinct bodies so a shared primitive needs a real design) > **E** (9 files, schema composition, lowest urgency — laxness-vs-strictness intentionally varies per field).
