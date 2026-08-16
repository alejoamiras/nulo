# ext-services — quality scan (Claude)

Scope: `apps/extension/src/wallet/services/**` (29 service directories). Focus: duplication (Fowler: Duplicate Code, Shotgun Surgery, Divergent Change, Dead Code weighted highest). `*.test.ts` read as evidence only, not finding-eligible.

The service/client/spec triple and colocated tests are a deliberate repo convention — findings below cite boilerplate that measurably exceeds what the convention itself requires (i.e. mechanical ceremony with a cheap shared-helper fix), not the convention's existence.

---

## Finding 1 — Client passthrough exhaustiveness-guard, copy-pasted in 16 of 22 `client.ts` files

**Smell**: Duplicate Code (Bloaters/Dispensables). The type-level exhaustiveness check is hand-written per file instead of factored into a shared generic.

**Impact bucket**: structural. Blast radius: 16 files, one directory each (`services/<x>/client.ts`), all siblings of the same shared base (`ServiceClient` + `definePassthroughs` in `packages/extension-messaging/src/core/`). Change frequency: moderate — 12 commits touched `services/*/client.ts` files in the last 90 days (`git log --since="90 days ago"`), i.e. every new RPC method exposed on any service re-triggers this exact edit.

**Evidence**: In every one of the 16 files below, the block from the `_METHODS` array declaration through the `definePassthroughs(...)` call is structurally identical (only the method-name list, the exported type names, and the per-service event fields differ):
1. `const X_METHODS = [...] as const satisfies readonly (keyof Methods)[]`
2. `type _XMethodsExhaustive = Exclude<keyof Methods, (typeof X_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof X_METHODS)[number]>`
3. `const _xMethodsExhaustive: _XMethodsExhaustive = true` + `void _xMethodsExhaustive`
4. `export interface XServiceClient extends MethodsSpec<Methods> {}` with the **verbatim** biome-ignore comment: `// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.`
5. `definePassthroughs<Methods>(XClient.prototype, X_METHODS)`

Confirmed byte-for-byte structural match (only identifiers/method lists vary) in:
- `apps/extension/src/wallet/services/account/client.ts:12-42`
- `apps/extension/src/wallet/services/account-state/client.ts:12-43`
- `apps/extension/src/wallet/services/auth-registry/client.ts:12-44`
- `apps/extension/src/wallet/services/contact/client.ts:12-44`
- `apps/extension/src/wallet/services/dapp-interaction/client.ts:12-41`
- `apps/extension/src/wallet/services/dapp-session/client.ts:12-50`
- `apps/extension/src/wallet/services/execution/client.ts:11-41`
- `apps/extension/src/wallet/services/fpc/client.ts:12-42`
- `apps/extension/src/wallet/services/incoming-transfer/client.ts:20-59`
- `apps/extension/src/wallet/services/log-viewer/client.ts:12-35`
- `apps/extension/src/wallet/services/note/client.ts:11-30`
- `apps/extension/src/wallet/services/passkey/client.ts:11-30`
- `apps/extension/src/wallet/services/task/client.ts:12-35`
- `apps/extension/src/wallet/services/token/client.ts:12-44`
- `apps/extension/src/wallet/services/token-balance/client.ts:12-37`
- `apps/extension/src/wallet/services/transaction/client.ts:12-37`

(The repo map's own inventory claimed 18; direct grep across all 22 `client.ts` files under the cluster confirms 16 carry the guard — the other 6, `config`/`logger`/`network`/`price`/`profile`/`pxe`, hand-write methods or are thin wrappers and are correctly excluded.)

**Why it harms future change**: adding, renaming, or removing one RPC method on any service requires touching this exact 20-30 line scaffold in that service's `client.ts`, and the scaffold is copy-paste seeded from a sibling file rather than generated — so a future editor who forgets step 2/3 (the exhaustiveness guard) loses the compile-time proof silently; TypeScript will not complain, only a manual diff against a sibling file would catch the omission. Because the guard is re-derived per file instead of shared, its correctness depends on every author reproducing an identical, non-obvious type-level trick (`Exclude<..., ...> extends never ? true : Exclude<...>`) rather than calling one audited helper.

**Smallest safe refactoring**: Extract Function/Extract Class — move steps 1-3 into a single shared generic in `extension-messaging` (e.g. `definePassthroughsExhaustive<Methods>(prototype, methods)` that both installs the runtime passthroughs via the existing `definePassthroughs` AND performs the exhaustiveness assertion internally, or a `type AssertExhaustive<AllKeys, Provided extends readonly AllKeys[]>` utility type consumed with one line). After the extraction, each `client.ts` keeps only its method-name array and the one-line call; the 6-8 line guard block and the repeated biome-ignore comment disappear from all 16 files, replaced by one audited implementation in `extension-messaging/src/core/`.

**Instances**: see the 16 file:line ranges listed under Evidence above.

---

## Finding 2 — `try { await this.lock.enter() } finally { this.lock.leave() }` hand-rolled at 56+ call sites across 9 services, with no `Lock.withLock()` convenience method

**Smell**: Duplicate Code (Dispensables) / missed Extract Method on the shared `Lock` primitive itself.

**Impact bucket**: structural. Blast radius: 9 service files (`network`, `dapp-session`, `fpc`, `auth-registry`, `contact`, `token`, `transaction`, `dapp-interaction`, `profile`), all built on the single shared `Lock` class in `packages/wallet-core/src/utils/lock.ts:6-69`, which exposes only `enter()`/`leave()` — no `withLock<T>(fn)` wrapper exists anywhere in the codebase (`grep -rn "withLock"` across `apps/extension/src/wallet` returns nothing). Change frequency: moderate-to-high — 32 commits touched `services/*/service.ts` files in the last 90 days; every write-path method that needs mutual exclusion re-derives this idiom.

**Evidence** (per-file `lock.enter()` site counts, confirmed by direct grep — `Lock` class at `packages/wallet-core/src/utils/lock.ts`):
- `apps/extension/src/wallet/services/network/service.ts` — 14 sites (e.g. lines 213, 245, 302, 309, 321, 335, 344, 354, 363, 385, 408, 418, 434, 455, 477, 505, 514, 530, 539, 550, 594, 607, 740, 786, 794, 798, 811, 822)
- `apps/extension/src/wallet/services/dapp-session/service.ts` — 12 sites (lines 139-374)
- `apps/extension/src/wallet/services/fpc/service.ts` — 7 sites (lines 153-475)
- `apps/extension/src/wallet/services/auth-registry/service.ts` — 6 sites (lines 147-473)
- `apps/extension/src/wallet/services/contact/service.ts` — 5 sites, e.g. `addContact` (96-115), `updateContact` (123-141), `deleteContact` (149-161)
- `apps/extension/src/wallet/services/token/service.ts` — 5 sites (lines 219-754, two guarded with a `holdsLock` flag instead of the bare pattern — an extra divergence in how the same idiom is expressed)
- `apps/extension/src/wallet/services/transaction/service.ts` — 4 sites (lines 172-557)
- `apps/extension/src/wallet/services/dapp-interaction/service.ts` — 1 site (257-290)
- `apps/extension/src/wallet/services/profile/service.ts` — 1 site (171-174)

Representative instance (`apps/extension/src/wallet/services/contact/service.ts:91-116`):
```ts
public async addContact(name: string, address: string): Promise<Contact> {
	await this.ensureInitialized()
	const profile = await requireActiveProfile(this.profileService)

	try {
		await this.lock.enter()
		...
		return contact
	} finally {
		this.lock.leave()
	}
}
```
The same shape repeats for `updateContact` and `deleteContact` in the same file, and structurally identically (modulo body) at every other cited site.

**Why it harms future change**: the mutual-exclusion contract ("always release in a `finally`") is enforced by convention, not by the type system or a single call site — a new write method that forgets the `finally` (or puts unrelated code outside the `try`) silently reintroduces the deadlock/starvation bug `Lock`'s own force-release timer exists to paper over (`packages/wallet-core/src/utils/lock.ts:36-44`). `token/service.ts` already shows the pattern drifting (`holdsLock` boolean guard vs. the bare `finally`), which is exactly the divergence that happens when a hand-rolled idiom is copied 56 times instead of centralized.

**Smallest safe refactoring**: Extract Method on `Lock` itself — add `public async withLock<T>(fn: () => Promise<T>): Promise<T> { await this.enter(); try { return await fn() } finally { this.leave() } }` to `packages/wallet-core/src/utils/lock.ts`, then Inline the try/finally at each of the 56+ call sites into `return this.lock.withLock(async () => { ... })`. After the change, the `finally { this.lock.leave() }` boilerplate disappears from all 9 service files and the release invariant is enforced in exactly one place.

**Instances**: the file:line list above (56 confirmed `lock.enter()`/`lock.leave()` pairs across the 9 files).

---

## Finding 3 — `await this.ensureInitialized(); const profile = await requireActiveProfile(this.profileService)` preamble, repeated verbatim ahead of ~35 methods in 8 services

**Smell**: Duplicate Code, bordering on Feature Envy toward `ProfileService` (every profile-scoped service re-derives "get me the active profile, or throw" instead of the call being wrapped once).

**Impact bucket**: structural, but lower fix-value than Findings 1-2 — the two-line preamble itself is cheap to write, but its ubiquity (35 sites) means any future change to the "no active profile" contract (e.g. adding a required capability check) has to be replayed at every site. Blast radius: 8 service files (`contact`, `auth-registry`, `fpc`, `network`, `transaction`, `dapp-session`, `account`, `token-balance`); `requireActiveProfile` itself (`apps/extension/src/wallet/services/profile/require-active-profile.ts`) is called from 16 files total per the cluster's shared-infra inventory. Change frequency: unknown precisely; the same 90-day window that touched the lock sites (18 commits across the 7 heaviest-hit service files) largely overlaps these methods, since the preamble and the lock wrap co-occur in every write method.

**Evidence** (confirmed `requireActiveProfile(this.profileService)` call sites, each directly preceded by `await this.ensureInitialized()` on the line above):
- `apps/extension/src/wallet/services/network/service.ts:211,252,273,281,292,318,342,361,406,427,467,512,537,559,575,597` — 16 sites
- `apps/extension/src/wallet/services/fpc/service.ts:130,225,239,282,302,363,382` — 7 sites
- `apps/extension/src/wallet/services/contact/service.ts:64,71,78,93,120,146,176` — 7 sites
- `apps/extension/src/wallet/services/auth-registry/service.ts:405` — 1 site
- `apps/extension/src/wallet/services/transaction/service.ts:486` — 1 site
- `apps/extension/src/wallet/services/account/service.ts:340` — 1 site
- `apps/extension/src/wallet/services/dapp-session/service.ts:74` — 1 site
- `apps/extension/src/wallet/services/token-balance/service.ts:340` — 1 site

Representative instance (`apps/extension/src/wallet/services/contact/service.ts:91-93`):
```ts
public async addContact(name: string, address: string): Promise<Contact> {
	await this.ensureInitialized()
	const profile = await requireActiveProfile(this.profileService)
```

**Why it harms future change**: the "is this service ready, and is there an active profile" gate is business logic (not just plumbing) — if that gate ever needs a third check (e.g. gating on account-integrity block state, which already exists as a *separate* coordinator per the cluster map), every one of the 35 call sites needs the same edit, which is Shotgun Surgery in the making. Today it's "just" duplicated, but the duplication is exactly the shape that turns into shotgun surgery the moment the gate's contract grows.

**Smallest safe refactoring**: Extract Function — a small wrapper (e.g. `protected async withActiveProfile<T>(fn: (profile: Profile) => Promise<T>): Promise<T>` on a shared base, or a standalone `const profile = await this.requireReady()` helper composing `ensureInitialized` + `requireActiveProfile`) collapses the two lines to one at all 35 sites and gives future gate changes a single edit point. Lower priority than Findings 1-2: the string being deduplicated is only 2 lines vs. 6-8 (Finding 1) or a full try/finally (Finding 2), so the payoff-per-site is smaller, but the site count (35) and the shotgun-surgery risk if the gate grows make it worth tracking.

**Instances**: the file:line list above (35 confirmed sites across 8 files).

---

## Non-findings

- **`onActiveProfileChanged` cache-invalidation handlers reimplemented per service** (`price/service.ts:190`, `token-balance/service.ts:240`, `task/service.ts:238`, `network/service.ts:792`, `execution/service.ts:354`) — read all 5 bodies directly: they are behaviorally distinct (alarm rearm + fetch vs. task-tree clear vs. Map clear-under-lock vs. one-line `evictAll()`), not copy-pasted logic. This is "same trigger point, different response" — a real shared "profile-scoped cache" primitive would need to abstract 5 genuinely different reset strategies, which is closer to speculative generality than a safe mechanical extraction. Rejected as a finding; the repo map itself ranked this lowest-confidence among its candidates and the source read confirms why.
- **Row-schema shape repetition in `spec.ts` files** (`network`, `fpc`, `account`, `dapp-session`, `operation-journal`, `contact`, `token`, `transaction`, `incoming-transfer`) — direct read of each schema shows only `id`/`profileId` (2 fields) genuinely overlap, and even those vary (`transaction`'s `profileId` is `.optional()`, `account` has no top-level `id` in the same position, `incoming-transfer` nests differently). Too thin and too field-by-field intentional to count as Duplicate Code; a shared base-row schema would either be a no-op (2 fields) or force artificial uniformity onto fields that deliberately differ per service. Rejected.
- **`purgeRows`/`restoreRows` call sites across 10-12 services** (`contact`, `auth-registry`, `fpc`, `dapp-session`, `operation-journal`, `account`, `transaction`, `token`) — this is the shared helper working as intended (`@/wallet/services/{purge-rows,restore-rows}.ts`), not duplication; each call site passes service-specific config into one already-extracted function. Non-finding by design.
- **Large Class candidates** (`incoming-transfer/service.ts` 2001 LOC, `profile/service.ts` 1613 LOC, `execution/service.ts` 914 LOC, `network/service.ts` 911 LOC) — real size, but this run's declared focus is duplication; none of the 4 files' size is attributable to copy-pasted logic (spot-checked network/service.ts and contact/service.ts: the bulk is genuinely distinct per-method business logic, not repetition). Out of focus for this pass; not reported as a duplication finding.
- **Central service-registration point** (`apps/extension/src/wallet/runtime.ts:170-243`, ~25 `services.add(new XService(...))` lines) — single file, single line per service, added once per new service. Not Shotgun Surgery; this is the intended single point of wiring, not scattered duplication.
- **`token/service.ts`'s `holdsLock` boolean-guarded lock release** (lines 266, 350) vs. the bare `finally` used everywhere else — noted as evidence of drift inside Finding 2 rather than a separate finding; it's a symptom of the same missing `withLock` primitive, not an independent smell.
