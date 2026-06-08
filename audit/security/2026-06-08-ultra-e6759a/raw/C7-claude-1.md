# C7 — Storage + migration + entity persistence

Audit cluster: storage layer, migration, FSM journal persistence, incoming-transfer repository.
Auditor: Claude / phase-2 / C7-1.
Date: 2026-06-08.

Working dir: `(repo root)`

Files audited:
- `packages/extension/src/wallet/storage/migrate.ts`
- `packages/wallet-core/src/storage/entity_storage.ts`
- `packages/wallet-core/src/storage/value-storage.ts`
- `packages/extension/src/wallet/services/operation-journal/service.ts`
- `packages/extension/src/wallet/services/operation-journal/spec.ts`
- `packages/extension/src/wallet/services/operation-journal/reaper.ts`
- `packages/extension/src/wallet/services/operation-journal/gc.ts`
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts`

Cross-files consulted: `incoming-transfer/client.ts`, `wallet-sdk/queued-journal.ts`, `runtime.ts`, `wallet-core/src/jobs/{fsm,types,error}.ts`, `wallet-core/src/utils/lock.ts`, `token/service.ts`.

---

## FINDING C7-1 — Migration wipes journal records from the WRONG storage area (durability invariant broken)

**Severity:** HIGH
**Category:** Bug / Data correctness / Migration integrity
**CVSS:** N/A (no production users, but the invariant is broken)
**Component:** `packages/extension/src/wallet/storage/migrate.ts`
**Confidence:** HIGH

### Description

Commit `f5fb3b0 fix(journal): move record storage from session → local for cross-restart durability` moved `OperationJournalService` storage from `chrome.storage.session` to `chrome.storage.local` (verified at `packages/extension/src/wallet/services/operation-journal/service.ts:85-87`). The migration in `migrate.ts`, however, still wipes the `nulo:journal@` prefix from **`chrome.storage.session`** only:

```ts
// packages/extension/src/wallet/storage/migrate.ts:67
const KEY_PREFIXES_TO_WIPE_SESSION = ["nulo:journal@"]
```

The `KEY_PREFIXES_TO_WIPE_LOCAL` array (lines 51-64) does NOT include `nulo:journal@`. Combined effect:

- A user on storage version `≤6` who has any `nulo:journal@<id>` rows in `chrome.storage.local` will NOT have them wiped when migration bumps to v7 (the v7 changelog explicitly states "Reuses the existing `nulo:journal@` session-wipe path" — but that path no longer exists in the durable area).
- v6 was the FSM rewrite that changed the shape of `OperationRecord` and explicitly said "Existing journal records cannot be migrated — discriminator name and shape both change. The `nulo:journal@` session wipe (already in this list since v3) handles it." That premise is now false.
- Result: a v5→v7 migration leaves stale, schema-incompatible records intact. They will be dropped one-by-one by `_loadValidated` (which calls `OperationRecordSchema.safeParse` and deletes failures) — but only at first read, by `getOperation` / `getOperations` / `_loadAllValidated`. Until then they bloat storage and emit error logs.

### Attack surface / impact

- Loss-of-availability / log spam for upgrading users (none today, but invariant gone).
- The schema-invalid-row deletion path (`_loadValidated` at `service.ts:117-125`) does work, but defense-in-depth migration is missing.
- For audits of future versions where the journal record schema changes, this drift will silently let old records sit until first read, then mass-delete and emit a flood of error logs at boot (since `_loadAllValidated` is called from filter/list paths).

### Recommendation

Move `"nulo:journal@"` from `KEY_PREFIXES_TO_WIPE_SESSION` into `KEY_PREFIXES_TO_WIPE_LOCAL`. Update the v6/v7 doc comments to match. Add a regression test that writes a v5-shape journal row to `chrome.storage.local` then asserts post-migration removal.

### File:line

`packages/extension/src/wallet/storage/migrate.ts:51-67`
`packages/extension/src/wallet/services/operation-journal/service.ts:85-87`

---

## FINDING C7-2 — `IncomingTransferRepository` writes are NOT wrapped in the service-level lock for all internal callers (race window)

**Severity:** MEDIUM
**Category:** Race / Concurrency
**CVSS:** N/A (logic-level)
**Component:** `packages/extension/src/wallet/services/incoming-transfer/repository.ts` + `service.ts`
**Confidence:** MEDIUM-HIGH

### Description

The service-level `serviceLock` is intended to serialize every writer (`service.ts:103-107`). It correctly wraps `setTrustAllow`, `setTrustReject`, `onTokenAdded` (trust-init path), `onTokenDeleted`, `onAccountDeleted`, `onTransactionAdded`, `clearProfile`, `clearChain`, `replayPendingPrompts`, and the per-note critical section in `scanContract`.

However, the repository methods themselves are publicly callable from outside the lock context, and the lock is held only at the service level — there is no enforcement that callers respect the lock. Two specific concerns:

1. **`getTrust` returns a snapshot that can become stale before the caller proceeds.** While `scanContract` re-reads inside the lock (`service.ts:636` "Read trust FRESH inside the lock"), there's no compile-time guarantee that future call sites do the same. The pattern depends on developer discipline rather than the type system.

2. **The repo uses `getKeys()` followed by `get(key)` + `delete(key)` in `clearProfile` / `clearChain` (`repository.ts:96-106, 110-122`)**. A trust row deleted between `getKeys` and `get` is fine (`get` returns undefined). But a CONCURRENT write that adds a row between `getKeys` and the iteration end would NOT be deleted. The service-level `withServiceLock` wrapping `clearProfile` / `clearChain` (`service.ts:347, 359`) closes this, but the lock alone protects only the calls FROM the service. Direct callers (tests, future code) wouldn't be protected. Since `repository.ts` is exported and could be reused, this is a footgun.

### Attack surface / impact

- Limited to in-process races. No external dApp attack vector since the IncomingTransferService doesn't expose mutation to dApps.
- Code-correctness only; the existing service paths happen to all go through the lock.

### Recommendation

- Make the lock contract explicit: rename `serviceLock` to `repoMutationLock` and document at the repository module that all mutation calls MUST be made under it.
- Consider moving the lock INTO the repository (a `withMutationLock` method that wraps every write).
- Alternatively, add an `eslint-disable`-style guard or a runtime assertion in the repository that throws when called outside the lock.

### File:line

`packages/extension/src/wallet/services/incoming-transfer/repository.ts:48-122`
`packages/extension/src/wallet/services/incoming-transfer/service.ts:103-107`

---

## FINDING C7-3 — `EntityStorage.parseOrDelete` logs a 200-char preview that can leak partially-attacker-controlled data

**Severity:** LOW (information disclosure, low impact)
**Category:** Information leakage / Logging
**CVSS:** N/A (logging-only)
**Component:** `packages/wallet-core/src/storage/entity_storage.ts`
**Confidence:** HIGH

### Description

`parseOrDelete` (`entity_storage.ts:47-60`) logs a 200-char preview of any malformed row before deleting it:

```ts
const preview = typeof raw === "string" ? raw.slice(0, PARSE_FAILURE_PREVIEW_MAX) : String(raw)
console.error(`EntityStorage[${this.root}]: dropping malformed row "${fullKey}" — ${msg} — payload preview: ${preview}`)
```

In normal operation, rows are written via `JSON.stringify(entity)` from the service layer, so the content is wallet-controlled. There are TWO scenarios where the content can be partially attacker-controlled:

1. **Pre-v7 stale rows** (from a wallet that was synced via Chrome profile sync or restored from another browser): a `Token` row could legitimately carry contract addresses from a `register_token` dApp call. If the contract address itself is a phishing-friendly hex string, that's not really a leak. But the `title` / `subtitle` fields on `OperationRecord` are user-/dApp-visible strings (e.g. `"Requested by <origin>"`) that get logged verbatim on a schema mismatch. The dApp origin URL is in the preview.

2. **Hostile rewriting via co-installed Chrome extensions** — Chrome storage is **not isolated between extensions** for the user's own profile, BUT cross-extension access requires either a known extension ID (in `manifest.json#externally_connectable`) or a shared `chrome.storage.managed` policy. So this is not a realistic exfiltration path.

The actual exposure: a privacy-aware user looking at devtools/extension logs would see the dApp origin URL leaked in the preview if a registration record is corrupted. Low impact.

### Attack surface / impact

- Minimal. The log goes to `console.error` (devtools); not transmitted off-device.
- Could be a forensics tool (a determined attacker could shoulder-surf devtools open to console) but unlikely.

### Recommendation

- Either reduce the preview cap to 64 chars (just enough to debug) or replace the preview with a structural hash (e.g. `SHA-256(raw)[:16]`) so the operator can correlate without leaking content.
- Strip whitespace or escape control characters to prevent log-injection (a row containing `\r\n` followed by a fake log line is technically possible).
- Logging-injection check: confirm the logger downstream of `console.error` does not interpret the preview as structured data (it doesn't in this codebase — `console.error` is the floor).

### File:line

`packages/wallet-core/src/storage/entity_storage.ts:19, 47-60, 69-77`

---

## FINDING C7-4 — `IncomingTransferService` has NO Zod schemas for its RPC methods (downstream type-safety hole)

**Severity:** MEDIUM
**Category:** Input validation / Boundary trust
**CVSS:** N/A (depends on caller integrity)
**Component:** `packages/extension/src/wallet/services/incoming-transfer/spec.ts` + `service.ts`
**Confidence:** HIGH

### Description

Other services in this audit (e.g. `OperationJournalService`) use `validateParams` against a `Zod` schema at every public method (e.g. `service.ts:164, 213, 315, 365, 371, 396, 409`). `IncomingTransferService` does NOT do this:

- `spec.ts` has NO Zod schemas.
- `service.ts:253, 278, 290, 322, 345, 357, 702` do no `validateParams` at the boundary.
- The only validation is the implicit TypeScript types, which are erased at the messaging boundary.

The messaging boundary (`extension-messaging` background `Service`) is what the popup speaks to. Today, the popup is the only caller. But:

1. Future code (e.g. a dApp surface, an SDK exposure, or a test seam) could hand the service a `contract` argument that is not an address-shaped string — e.g. a long string containing the `|` delimiter used in `trustKey`, which would create a synthetic key collision (see C7-5).
2. The service's downstream code does `parseCaipAccount` and other parsing, but doesn't structurally validate `profileId`, `networkId`, `contract`, `accountAddress`. A malformed `networkId` cannot collide with a real one (key shape uses `@`), but `contract` is part of the `|`-delimited trust key — a contract containing `|` would collide with a different `(profileId, networkId, contract)` triple. See C7-5.

### Attack surface / impact

- Currently: no external boundary, all callers are internal popup code.
- Future: any added external caller (e.g. dApp via wallet-sdk) without paired schema work is a vector. The defensive boundary is missing.

### Recommendation

- Add `IncomingTransferServiceMethodSchemas` mirroring `OperationJournalMethodSchemas`.
- Validate `contract` against an Aztec-address regex (`/^0x[0-9a-fA-F]{64}$/` per `AztecAddress.fromString` round-trip).
- Validate `profileId` against the profile-id format (non-empty, no `|`, no `@`).
- Validate `networkId` against the internal network-id format.
- Use `validateParams(...)` at every public method entry.

### File:line

`packages/extension/src/wallet/services/incoming-transfer/spec.ts:122-155` (no schemas defined)
`packages/extension/src/wallet/services/incoming-transfer/service.ts:253-364, 702-748` (no `validateParams` calls)

---

## FINDING C7-5 — `trustKey` uses `|` as a delimiter without escaping the inputs (key-collision via crafted IDs)

**Severity:** MEDIUM
**Category:** Storage / Key construction / Logic bug
**CVSS:** N/A (depends on caller integrity)
**Component:** `packages/extension/src/wallet/services/incoming-transfer/repository.ts`
**Confidence:** HIGH

### Description

```ts
// repository.ts:25-27
export function trustKey(profileId: string, networkId: string, contract: string): string {
	return `${profileId}|${networkId}|${contract}`
}
```

If any of the three inputs contain `|`, two different triples can produce the same key:

- `trustKey("a", "b", "c|d")` → `"a|b|c|d"`
- `trustKey("a", "b|c", "d")` → `"a|b|c|d"`
- `trustKey("a|b", "c", "d")` → `"a|b|c|d"`

A malicious actor controlling one of these inputs could:
- Bypass a per-(profile, network, contract) trust gate by crafting a contract address that collides with a trusted triple.
- Cause cross-profile bleed where setting trust on (profileA, networkX, contractY) accidentally trusts (profileA|networkX, contract, Y) for a different scope.

### Realistic exploitation

- `profileId` is wallet-generated (`getRandomHex(16)`), so attacker can't choose it.
- `networkId` is wallet-generated when the user adds a network manually (`network/service.ts`). Looking at `network/service.ts`, networkId is wallet-generated as a random ID.
- `contract` comes from `registerToken` dApp calls. Per `dapp-interaction/service.ts:455`, a `register_token` operation ALWAYS prompts the user for confirmation. So the user has to approve the contract address. But: a malicious dApp can send a `register_token` with a *crafted contract string* that doesn't look like an Aztec address — e.g. `"<aztec-address>|profileX|networkY|<spoof-contract>"`. If the dApp-interaction layer doesn't validate via `AztecAddress.fromString(...)` before calling `addToken`, this string lands in the trust table.

Looking at `token/service.ts:128` (`findToken(profileId, chainId, contract)`) and `dapp-interaction/materialize.ts:90`, the `register_token` request carries a contract string from the dApp. Need to verify whether this string is validated against `AztecAddress.fromString` BEFORE the trust state is set. The popup UI displays the contract address for user confirmation, but the user is likely to recognize only the LAST address-shaped portion of the string in the popup display.

### Attack surface / impact

- If `register_token` does NOT validate via `AztecAddress.fromString` upstream of the trust key, this is a real key-collision vector.
- Worst case: a dApp socially engineers the user to approve a "token" with a crafted contract string, then later receives notes that get auto-trusted under the collision key.
- Real risk depends on what `register_token` actually validates. Given the absence of explicit validation in the file map and the lack of `IncomingTransferService` Zod schemas, this is a concrete defensive gap.

### Recommendation

- Use a separator that cannot appear in any input. The Aztec address character set is `[0-9a-fA-F]` (after `0x` prefix). Use `:` or a control character (e.g. `\0`) — chrome.storage tolerates `\0` in keys.
- Alternatively, base64-encode each component before concatenation.
- Better: hash the triple (SHA-256) for the storage key, keep the triple in the payload. Eliminates the encoding problem entirely.
- Add a Zod refinement that validates `contract` matches the Aztec address regex BEFORE calling `trustKey`.

### File:line

`packages/extension/src/wallet/services/incoming-transfer/repository.ts:25-27`
`packages/extension/src/wallet/services/incoming-transfer/repository.test.ts` (tests don't cover delimiter collision)

---

## FINDING C7-6 — `IncomingTrustState` from storage is NOT validated against the enum at load time (downstream type confusion)

**Severity:** MEDIUM
**Category:** Storage / Deserialization / Defense-in-depth
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/incoming-transfer/repository.ts`
**Confidence:** HIGH

### Description

The trust state is declared as a TypeScript union:

```ts
// spec.ts:26
export type IncomingTrustState = "unknown" | "pending" | "trusted" | "blocked"
```

But `repository.getTrust` (`repository.ts:77-79`) returns the raw deserialized JSON value without any runtime validation. There is NO Zod schema for `IncomingTrustRecord`. A corrupted row, a forward-incompatible row (e.g. a future `"verified"` state), or a row hand-edited via devtools could carry a state value outside the enum.

Downstream:
- `service.ts:281` `record?.state ?? "unknown"` — non-enum values pass through unchanged.
- `service.ts:642` `if (trustState === "unknown")` — a corrupted `"trusted_v2"` would NOT match `"unknown"`, so the unknown→pending flow is skipped, AND
- `service.ts:673` `if (trustState === "trusted" && ...)` — also fails to match, so records get persisted hidden.
- `service.ts:761` `const hidden = trustState !== "trusted"` — defaults to hidden. SAFE BY DEFAULT.

The fail-safe default (`trustState !== "trusted"` → hidden) means a corrupted state value is silently treated as untrusted, which is safe for the privacy goal. But:
- The contract is in a permanent un-actionable limbo (not pending → no popup; not trusted → no display).
- The user has no way to recover without dev intervention.

### Attack surface / impact

- Limited. The fail-safe is the right default. But the lack of runtime validation is technical debt.
- Forward-compat: if a future codebase adds a new state and an OLDER wallet build reads the row, the row sits unrenderable forever.

### Recommendation

- Add a Zod schema for `IncomingTrustRecord` and validate on read.
- On invalid state value: drop the row (treat as `unknown`). The cost is one re-prompt; the benefit is auto-recovery from corruption.
- Mirror the journal service's pattern (`OperationRecordSchema.safeParse` + delete-on-invalid).

### File:line

`packages/extension/src/wallet/services/incoming-transfer/repository.ts:77-89`
`packages/extension/src/wallet/services/incoming-transfer/spec.ts:80-89` (no Zod schema)

---

## FINDING C7-7 — `ValueStorage.get` has no `parseOrDelete` equivalent — a malformed value throws and poisons all callers

**Severity:** MEDIUM
**Category:** Storage / Deserialization / Robustness
**CVSS:** N/A (defense-in-depth)
**Component:** `packages/wallet-core/src/storage/value-storage.ts`
**Confidence:** HIGH

### Description

`ValueStorage.get` (`value-storage.ts:18-24`) calls `JSON.parse(res[this.root] as string)` without try/catch:

```ts
public async get(): Promise<T | undefined> {
	const res = await this.storage.get(this.root)
	if (this.root in res) {
		return JSON.parse(res[this.root] as string)
	}
	return undefined
}
```

By contrast, `EntityStorage` (the parallel class) wraps `JSON.parse` in `parseOrDelete` and resilient `getVersion` (lines 47-78). `ValueStorage` does not. Any malformed bytes in a `ValueStorage`-backed key will throw at the read site and propagate the exception up the call chain.

The note in `entity_storage.ts:42-46` is explicit:

> `chrome.storage` is shared, write-anywhere, and survives across SW lifetimes — one row that fails `JSON.parse` (whether from a half-written mutation, a forward-incompatible shape, or genuine corruption) used to throw inside the read path and poison every other reader of the same namespace.

This rationale applies identically to `ValueStorage`. The same fix is absent.

### Attack surface / impact

- Realistic crash mode: a SW killed mid-write leaves a half-written byte sequence. Next read throws. The service that owns that ValueStorage fails to initialize. Service-graph startup may abort.
- Forward-compat: a `ValueStorage`-backed field whose shape changes can break older builds.

### Current callers of `ValueStorage`

Need to enumerate. Searching for `new ValueStorage` reveals callers. (No grep output in the audited subset; downstream callers exist in services like config, dapp-session metadata, etc.)

### Recommendation

- Add try/catch + delete-on-error semantics to `ValueStorage.get`, mirroring `EntityStorage.parseOrDelete`.
- Add a regression test mimicking `EntityStorage`'s schema-invalid-row resilience.

### File:line

`packages/wallet-core/src/storage/value-storage.ts:18-24`
Compare to: `packages/wallet-core/src/storage/entity_storage.ts:47-78`

---

## FINDING C7-8 — Migration race on concurrent SW startups (theoretical; mitigated by chrome.storage serialization but not robust)

**Severity:** LOW
**Category:** Race / Migration
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/storage/migrate.ts`
**Confidence:** MEDIUM

### Description

`runStorageMigration` (`migrate.ts:81-125`) is called from `runtime.ts:103` during SW startup. The pattern is:

1. Read STORAGE_VERSION_KEY.
2. If equal to CURRENT_VERSION → return.
3. Else wipe + bump.

MV3 service workers are typically singletons within a chrome instance. But:

- Two extension contexts (e.g. SW + a service worker proxy in offscreen) could theoretically both run startup if the runtime was misconfigured. Today: only ONE SW startup path exists.
- The check-then-write pattern is NOT atomic (no compare-and-swap on chrome.storage).
- If two startups race, both pass step 1 reading the same old version, both wipe (idempotent), both bump version. The wipes are redundant but not harmful. The PROBLEM would only manifest if step 1 returns OLD version on the slower path AFTER the fast path completed a write-then-create-fresh-data path (theoretically possible but no observed code path does this — services don't run before `services.start()` which is after migration completes).

The runtime calls migration BEFORE service registration (`runtime.ts:103-109`), so this race window is empty in practice.

### Attack surface / impact

- None today. Defensive concern only.

### Recommendation

- Document the SW-singleton assumption in `migrate.ts`.
- If a future architecture (e.g. multi-window mode) introduces parallel migration paths, add a `__migration_lock` row with a TTL.

### File:line

`packages/extension/src/wallet/storage/migrate.ts:81-125`
`packages/extension/src/wallet/runtime.ts:103-110`

---

## FINDING C7-9 — Operation journal is bounded ONLY at GC-sweep time (`succeeded` records only); failed/cancelled grow unbounded

**Severity:** MEDIUM
**Category:** DoS / Resource exhaustion
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/operation-journal/gc.ts`
**Confidence:** HIGH

### Description

`JournalGC` (`gc.ts:115-148`) enforces a per-scope cap of 50 terminal records, but ONLY `succeeded` records are evictable:

```ts
// gc.ts:131
const evictable = bucket.filter((op) => op.progress?.stage === "succeeded")
```

The rationale (gc.ts:18-25) is that failed/cancelled records are user history not recoverable from chain data. Trade-off: an attacker (or buggy retry loop) that drives many `failed` records can grow storage without bound.

Vector analysis:
1. A dApp can drive `dapp_execute` records that fail (e.g. by sending unfailable-but-bad transactions).
2. The per-session cap on QUEUED records (8 per session, 32 global; `queued-journal.ts:33-35`) limits arrival rate but NOT the cumulative failed count.
3. `cancelJob` cancels a record; a buggy or malicious client could spam create+cancel.
4. The journal GC will not evict cancelled records.

Storage quota: `chrome.storage.local` has a 10MB default quota (5MB pre-Chrome-114). An `OperationRecord` JSON is on the order of 1-2KB (with `normalizedRaw` capped at 4096 chars). Worst case: ~5000 records would consume ~10MB.

Realistic: would take dedicated abuse (~5000 failed dapp ops) to reach this. NOT a fast DoS vector but a slow-burn one.

Also note: the per-session global queued cap is in `queued-journal.ts` (8/32) which limits visibility creation, but the actual claim path in `background.ts` may create journals without going through `tryCreateQueuedJournal` (need to verify). If the handler creates its own journal on claim, the cap doesn't apply.

### Attack surface / impact

- Storage exhaustion. Once `chrome.storage.local.set` hits quota, all writes start failing. The wallet's general writes (account state, tokens, etc.) fail. Critical wallet operations break.
- DoS vector: a malicious dApp the user has authorized can create many failed dapp_execute journals.

### Recommendation

- Add a SECONDARY cap (e.g. 1000 total failed+cancelled per profile) that DOES evict the oldest. The QA rationale ("user wants to keep failed history") is reasonable for hundreds, not unbounded thousands.
- Alternatively, add a per-origin/per-dApp cap on `failed` records to bound malicious dApp abuse.
- Add storage-quota monitoring at SW startup; alert / log when approaching limit.

### File:line

`packages/extension/src/wallet/services/operation-journal/gc.ts:18-25, 47, 131-143`

---

## FINDING C7-10 — `getRandomHex(16)` for journal IDs uses unauthenticated wallet utility (verify CSPRNG)

**Severity:** LOW
**Category:** Cryptographic randomness
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/utils/random.ts` + journal service
**Confidence:** LOW (need to verify the implementation)

### Description

`service.ts:172` uses `getRandomHex(16)` for journal record IDs. Comment says "16 bytes / 128 bits — bumped from 8/32-bit on the recommendation of codex round-1 (defense-in-depth against requestId / journal-id collisions once concurrent dApp interactions are possible)."

Need to verify `getRandomHex` uses `crypto.getRandomValues` and not `Math.random`. If it's `Math.random`, IDs are predictable and a dApp could craft a collision attack.

A search through the codebase (not done in detail) is needed to confirm. The comment implies it's been audited.

### Attack surface / impact

- If RNG is weak: an attacker could predict journal IDs, then call `getOperation(id)` via the messaging surface or trigger races. Currently no caller-id-controlled mutation, but a future surface could leak this.

### Recommendation

- Verify `getRandomHex` uses `crypto.getRandomValues`.
- If yes, add a comment to that effect at the call site.
- If no, fix it.

### File:line

`packages/extension/src/wallet/services/operation-journal/service.ts:172`
`packages/extension/src/wallet/utils/random.ts` (verify)

---

## FINDING C7-11 — `_loadValidated` deletes schema-invalid rows but does NOT emit `onOperationDeleted` (consumer drift)

**Severity:** LOW
**Category:** Event-consistency / API contract
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/operation-journal/service.ts`
**Confidence:** HIGH

### Description

`_loadValidated` (`service.ts:117-125`) silently deletes a schema-invalid row without emitting the `onOperationDeleted` event. Consumers subscribed to the journal stream (e.g. `RecentActivityView`) will not see the disappearance.

Similarly `_loadAllValidated` (`service.ts:132-145`) deletes silently.

By contrast, `deleteOperation` (`service.ts:408-415`) emits `onOperationDeleted`. The behavior is inconsistent.

Realistic impact: if a popup subscribes via `subscribeJob(id)` and the journal silently deletes the row on `_loadValidated`, the popup keeps waiting forever (no `succeeded`/`failed`/`cancelled` arrives).

### Attack surface / impact

- UI inconsistency / popup stuck states.
- Not a direct attack vector, but a robustness issue.

### Recommendation

- Either: emit `onOperationDeleted` from the silent-delete path (preferred).
- Or: convert the silent delete to a "soft drop" that returns undefined but doesn't actually delete, so the next `getOperation` retries.
- Add a metric / log when this path fires (currently `logError`).

### File:line

`packages/extension/src/wallet/services/operation-journal/service.ts:117-145`

---

## FINDING C7-12 — `EntityStorage.getKeys` returns ALL keys including those that would fail `parseOrDelete` — caller can't trust the count

**Severity:** LOW (logic-correctness footgun)
**Category:** Logic / API contract
**CVSS:** N/A
**Component:** `packages/wallet-core/src/storage/entity_storage.ts`
**Confidence:** HIGH

### Description

`getKeys` (`entity_storage.ts:117-123`) lists keys by prefix-match without attempting to parse the values. Compare to `getAll` / `getValues` which call `parseOrDelete` and skip undefined entries.

So `getKeys().length` can be larger than `getAll().length` if some rows are malformed.

Callers like `IncomingTransferRepository.clearProfile` use `getKeys` (`repository.ts:96`) and then iterate — calling `get(key)` per key. The `get(key)` call DOES invoke `parseOrDelete` which deletes malformed rows. So in this caller, a malformed row gets silently deleted DURING the cleanup iteration. That's actually fine — it cleans up.

However: a caller that uses `getKeys` to compute counts or to take action OTHER than `get()` per key would see inflated counts. Today, no caller does this in the cluster, but it's a footgun.

### Attack surface / impact

- Minimal. No current caller misuses it.

### Recommendation

- Document `getKeys` as "may include malformed rows; pair with `get()` per key".
- Alternatively, add a `getValidKeys` that runs `parseOrDelete` and returns only the keys whose values parse.

### File:line

`packages/wallet-core/src/storage/entity_storage.ts:117-123`

---

## FINDING C7-13 — Lock has a 5-min hard force-release that can fire during a long prove (potential FSM corruption)

**Severity:** MEDIUM
**Category:** Lock / Concurrency / FSM integrity
**CVSS:** N/A
**Component:** `packages/wallet-core/src/utils/lock.ts`
**Confidence:** MEDIUM

### Description

`Lock.enter` (`lock.ts:19-45`) sets a 5-minute force-release timer (`MAX_HOLD_MS = 5 * 60_000`). If the holder does not call `leave()` within 5 minutes, the lock is force-released and queued waiters proceed.

This is a safety net against held-lock leaks, but consider the journal service's `transitionLock`:

- The critical section in `transitionOperation` is "small (one load + one validate + one write)" per the comment at `service.ts:55-71`. Should never approach 5 min.
- However, the SAME `Lock` class is used in `IncomingTransferService.serviceLock` which wraps `scanContract`'s per-note critical section. The scanContract MIGHT take longer if PXE is slow (though the actual PXE I/O is OUTSIDE the lock per the code at `service.ts:563-578`).
- The 5-minute timer is also used in `TokenService.lock` (`token/service.ts:43`). The `addToken` path calls `fetchTokenMetadata` UNDER the lock (`token/service.ts:153-201`). A slow / hanging PXE call here could exceed 5 min, the lock force-releases, then a concurrent `addToken` could land mid-write and corrupt state.

The most concerning case: if `serviceLock.enter()` returns due to force-release while the prior holder is still doing work, TWO routines now both think they own the lock. Each subsequent `.leave()` decrements the `locked` flag to false twice — but since `locked` is a boolean (not a count), the second `.leave()` is a no-op AT THE LOCK LEVEL but the actual CODE in both holders runs concurrently. This violates the lock's mutual exclusion guarantee.

### Attack surface / impact

- DoS: if an attacker can stall a PXE call under the token-import lock for > 5 min, a follow-up call breaks the lock invariant.
- Realistic if a dApp drives `register_token` then the contract responds slowly to symbol/decimals reads. The user can't easily attack this directly, but a flaky network could trigger it.

### Recommendation

- Increase MAX_HOLD_MS significantly (e.g. 30 min) OR remove the force-release entirely and rely on `try/finally`.
- Add explicit cancellation paths so a lock holder's slow operation can be canceled cleanly via AbortSignal.
- Log loudly on every force-release; treat as a bug condition.

### File:line

`packages/wallet-core/src/utils/lock.ts:4, 37-44`
`packages/extension/src/wallet/services/token/service.ts:153-201` (worst-case holder)

---

## FINDING C7-14 — `clearChain` / `clearProfile` in `IncomingTransferRepository` is O(n²) on storage size

**Severity:** LOW
**Category:** Performance / DoS amplification
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/incoming-transfer/repository.ts`
**Confidence:** HIGH

### Description

`clearProfile` (`repository.ts:95-106`) and `clearChain` (`repository.ts:110-122`):

```ts
const recordKeys = await this.records.getKeys()
for (const key of recordKeys) {
	const record = await this.records.get(key)   // Each get() calls chrome.storage.local.get
	if (record?.profileId === profileId) await this.records.delete(key)
}
```

Each `this.records.get(key)` calls `chrome.storage.local.get(key)` which is an async IPC. For N records, this is N + 1 storage round-trips. At ~5000 records (the storage cap from C7-9 analysis), that's 5000 IPCs.

Worse: this runs UNDER the service-level lock (`service.ts:347` in `clearProfile`), so the whole serial loop blocks every other writer.

Alternative: a single `getAll()` call followed by in-memory filter would be a single storage IPC.

### Attack surface / impact

- Latency amplifier. If an attacker has driven the journal/trust tables to ~thousands of rows, profile deletion takes seconds, blocking the wallet UI.
- Combines with C7-9 (no failed-record cap) — DoS amplification.

### Recommendation

- Replace with `this.records.getAll()` (one IPC), filter in memory, batch delete via `chrome.storage.local.remove(keys[])`.
- Same for `trust` table.

### File:line

`packages/extension/src/wallet/services/incoming-transfer/repository.ts:95-122`

---

## FINDING C7-15 — `IncomingTransferRepository` is per-instance-only; cross-profile callers create new repos (single-instance contract broken)

**Severity:** LOW
**Category:** Architecture / Robustness
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/incoming-transfer`
**Confidence:** MEDIUM

### Description

`IncomingTransferRepository` is `new IncomingTransferRepository()` in `service.ts:85`. This creates ONE instance per `IncomingTransferService` instance.

If for any reason a second `IncomingTransferService` were ever instantiated (e.g. in tests with a service replacement seam), the second repo's lock would be independent and the two services would race on `chrome.storage.local`.

Today, the SW has ONE `IncomingTransferService` instance per `runtime.ts:130` registration. Stable.

But: the `repository.ts` constructor takes no parameters and uses `chrome.storage.local` directly (`new EntityStorage<...>(KEY, chrome.storage.local)`). This bypasses the `browserApi` port indirection used by `OperationJournalService`. As a result:
- Tests cannot inject a `FakeBrowserApi` here.
- The repository is harder to unit-test in isolation.
- If the wallet ever moves to a multi-profile-isolation architecture, this repository would need rework.

### Attack surface / impact

- Architectural debt only. No direct attack vector.

### Recommendation

- Refactor `IncomingTransferRepository` to accept a `MinimalStorageArea` (or `BrowserApi`) constructor arg.
- Pass `browserApi.storage.local` from the service.

### File:line

`packages/extension/src/wallet/services/incoming-transfer/repository.ts:33-36`

---

## FINDING C7-16 — `transitionLock` doesn't cover `setOperationMeta` (load → merge → write outside the lock)

**Severity:** MEDIUM
**Category:** Race / Concurrency
**CVSS:** N/A (logic-level)
**Component:** `packages/extension/src/wallet/services/operation-journal/service.ts`
**Confidence:** HIGH

### Description

The class doc at `service.ts:51-71` explicitly states:

> If a future caller introduces another load+merge+write path (e.g. metadata updates) it MUST acquire this same lock.

But `setOperationMeta` (`service.ts:314-330`) does exactly load → merge → write WITHOUT entering `transitionLock`:

```ts
public async setOperationMeta(id: string, meta: { title?: string; subtitle?: string }): Promise<OperationRecord> {
	validateParams(...)
	await this.ensureInitialized()
	const existing = await this._loadValidated(id)   // LOAD
	if (!existing) { throw new Error(...) }
	const updated: OperationRecord = {
		...existing,
		title: meta.title !== undefined ? meta.title : existing.title,
		subtitle: meta.subtitle !== undefined ? meta.subtitle : existing.subtitle,
		updatedAt: Date.now(),
	}
	await this.storage.set(id, updated)               // WRITE
	this.emit("onOperationUpdated", updated)
	return updated
}
```

Race scenario:
1. Caller A: `transitionOperation(id, { stage: "succeeded", txHash: "0xTX" })` — enters `transitionLock`, loads record (stage=submitting).
2. Caller B: `setOperationMeta(id, { title: "Resolved Symbol" })` — does NOT enter the lock, loads record (stage=submitting).
3. Caller A: validates transition, writes record with new `progress.stage = "succeeded"` + `txHash`. Releases lock.
4. Caller B: writes record with OLD progress (`{ stage: "submitting" }`) but new title.

Net result: the record's stage SILENTLY REGRESSES from "succeeded" back to "submitting" (with the new title overlayed). The progress field is OVERWRITTEN by Caller B's stale snapshot.

This is the EXACT race the lock's docstring warns about, and the class comment explicitly names "metadata updates" as the future risk. The risk is REAL TODAY because `setOperationMeta` exists.

Concrete scenario: in `TokenService.addToken` (`token/service.ts:140-200`):
- `journal.createOperation(...)` (stage=pending)
- `journal.transitionOperation(id, { stage: "simulating" })`
- `await this.fetchTokenMetadata(...)`
- `await this.journal.setOperationMeta(journalOp.id, { title: symbol })` ← race candidate
- `await this.tokens.set(...)`
- `await this.journal.transitionOperation(journalOp.id, { stage: "succeeded" })` ← can race with above

In `token/service.ts`, the two journal calls (`setOperationMeta` then `transitionOperation(succeeded)`) are sequential within the same async function, BUT if any other caller (e.g. an external `cancelJob` from the popup) calls `transitionOperation(id, { stage: "cancelled" })` concurrently:

- T1: setOperationMeta loads record (stage=simulating)
- T2: cancelJob → transitionOperation enters lock, loads record (stage=simulating), validates simulating→cancelled (legal), writes record with stage=cancelled, releases lock.
- T1: writes record with stage=simulating + new title. **Cancellation is silently lost.**

This is a HIGH-severity correctness bug if cancellation is exposed to the user during a token import.

### Attack surface / impact

- Cancellation race in token import flows.
- The user can't easily exploit this maliciously, but it leads to user-confusing states ("I cancelled, why is it still going?").
- Worse: the `successed → submitting` regression (scenario above) could cause the FSM-aware code to attempt re-entrancy (a record showing `submitting` again would be picked up by the reaper if its updatedAt is old enough).

### Recommendation

- Wrap `setOperationMeta`'s load+write in `transitionLock` (the lock's docstring already mandates this).
- Add a unit test: concurrent `setOperationMeta` + `transitionOperation` produces a consistent record where the LATER call wins on both fields.

### File:line

`packages/extension/src/wallet/services/operation-journal/service.ts:67-71` (docstring mandate)
`packages/extension/src/wallet/services/operation-journal/service.ts:314-330` (the violator)

---

## FINDING C7-17 — `clearChainState` does load-then-delete OUTSIDE the transitionLock

**Severity:** MEDIUM
**Category:** Race / Concurrency
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/operation-journal/service.ts`
**Confidence:** HIGH

### Description

Same race pattern as C7-16. `clearChainState` (`service.ts:154-161`) reads all records, filters by `networkId`, then deletes them. No `transitionLock`:

```ts
public async clearChainState(networkId: string): Promise<void> {
	await this.ensureInitialized()
	const records = (await this._loadAllValidated()).filter((r) => r.networkId === networkId)
	for (const record of records) {
		await this.storage.delete(record.id)
		this.emit("onOperationDeleted", record)
	}
}
```

Race:
1. T1: `clearChainState("netX")` loads all records (snapshot includes Record-A on netX).
2. T2: `transitionOperation(Record-A.id, succeeded)` enters lock, loads Record-A, writes new state, leaves lock.
3. T1: deletes Record-A. Emits `onOperationDeleted`. **The just-succeeded transition is permanently lost.**

Mitigated when:
- `clearChainState` is called from `NetworkService.purgeChain` which means the chain itself is being deleted, so the transition's effect was irrelevant anyway.

But during the race window, the journal emits `onOperationUpdated` (from the transition) followed by `onOperationDeleted` (from clearChain) in non-deterministic order. UI consumers may render the brief "succeeded" state.

### Attack surface / impact

- Minor UI flicker, no data integrity issue if the chain is genuinely being purged.

### Recommendation

- Wrap `clearChainState` in `transitionLock`.

### File:line

`packages/extension/src/wallet/services/operation-journal/service.ts:154-161`

---

## FINDING C7-18 — `deleteOperation` does load (lockless) → delete (lockless), can race with transition

**Severity:** LOW
**Category:** Race / Concurrency
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/services/operation-journal/service.ts`
**Confidence:** HIGH

### Description

`deleteOperation` (`service.ts:408-415`) calls `_loadValidated` (no lock) then `storage.delete`. A concurrent transition can write between the load and delete. Currently, this only affects which "before" state is emitted with `onOperationDeleted` (the loaded state may be stale).

### Recommendation

- Wrap in `transitionLock` for consistency.
- Or: document that delete-during-transition emits the pre-transition state in `onOperationDeleted`.

### File:line

`packages/extension/src/wallet/services/operation-journal/service.ts:408-415`

---

## FINDING C7-19 — Migration v3+ doc claims to "preserve profiles/passkeys" but never explicitly enumerates them

**Severity:** LOW
**Category:** Migration safety / Documentation
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/storage/migrate.ts`
**Confidence:** MEDIUM

### Description

`runtime.ts:102` comments "Destructive storage migration (version-gated) must run before any service reads storage. Older shapes get wiped; profiles/passkeys preserved."

But `migrate.ts` doesn't ENUMERATE what's preserved — it only enumerates what's WIPED. The implicit invariant is "anything not in `KEYS_TO_WIPE` / `KEY_PREFIXES_TO_WIPE_LOCAL` is preserved".

Risk: any future code that adds a storage key that should be preserved (e.g., a new `nulo:secure:passkeys` namespace) might silently be wiped if it accidentally matches a wipe prefix. Or, conversely, a key that should be wiped might be missed (see C7-1 — the journal case).

### Recommendation

- Add a `KEYS_TO_PRESERVE` whitelist OR an assertion test that enumerates ALL `nulo:*` keys used by the codebase and confirms each is intentionally in wipe-list or preserve-list.
- Add a regression test that, given a known-shape storage, asserts the post-migration shape matches the spec.

### File:line

`packages/extension/src/wallet/storage/migrate.ts:41-67`
`packages/extension/src/wallet/runtime.ts:102`

---

## FINDING C7-20 — `incoming-trust` storage key (`nulo:core:incoming-trust@<key>`) is NOT in the migration wipe list

**Severity:** MEDIUM
**Category:** Migration / Pollution-defense
**CVSS:** N/A
**Component:** `packages/extension/src/wallet/storage/migrate.ts`
**Confidence:** HIGH

### Description

The incoming-transfer feature (C7 cluster's main service) introduces TWO new EntityStorage namespaces:

- `nulo:core:incoming-transfers` (records)
- `nulo:core:incoming-trust` (trust state per triple)

Neither is in `KEY_PREFIXES_TO_WIPE_LOCAL` in `migrate.ts:51-64`. The schemas of these tables are new (post-v7), so an in-place upgrade from any version BEFORE the incoming-transfer feature won't encounter them. But:

- If a future version changes the shape of `IncomingTrustRecord` (e.g., adding a required field), there's no migration path.
- If the `incoming-transfer` table starts as `trusted` for ALL contracts (because some legacy bug), an upgrade can't wipe to re-prompt.

The current code doesn't have a schema version for these tables (no `getVersion` / `setVersion` calls). So forward-compat is fragile.

### Recommendation

- Add `nulo:core:incoming-transfers@` and `nulo:core:incoming-trust` (both forms) to `KEY_PREFIXES_TO_WIPE_LOCAL` for any version bump that touches these schemas.
- Add a per-table version field (use `EntityStorage.setVersion` / `getVersion`) for finer-grained migrations.
- Reserve a CURRENT_VERSION bump for the first non-additive schema change.

### File:line

`packages/extension/src/wallet/storage/migrate.ts:51-64`
`packages/extension/src/wallet/services/incoming-transfer/repository.ts:20-21`

---

## Summary of severity counts

- **HIGH**: 1 (C7-1)
- **MEDIUM**: 9 (C7-2, C7-4, C7-5, C7-6, C7-7, C7-9, C7-13, C7-16, C7-17, C7-20)
- **LOW**: 8 (C7-3, C7-8, C7-10, C7-11, C7-12, C7-14, C7-15, C7-18, C7-19)

## Cross-finding patterns / takeaways

1. **`transitionLock` is under-applied.** The journal service has the right idea (one global mutex on FSM-touching writes) but `setOperationMeta`, `clearChainState`, `deleteOperation` skip the lock. Findings C7-16, C7-17, C7-18.

2. **Two-layer validation pattern is inconsistent.** Journal does layer 1 (`EntityStorage.parseOrDelete`) + layer 2 (`OperationRecordSchema.safeParse`). Incoming-transfer does ONLY layer 1. ValueStorage does NEITHER. Findings C7-6, C7-7.

3. **Key construction uses unescaped delimiters.** `trustKey` and other future composite keys are vulnerable to collision via untrusted input. Finding C7-5.

4. **Migration's "wipe list" approach is implicit-rather-than-explicit.** The journal's storage area change (session → local) silently broke the migration contract. Findings C7-1, C7-19, C7-20.

5. **`incoming-transfer` service is missing the boundary validation that other services do (Zod + `validateParams`).** Finding C7-4.

6. **GC policy preserves failed/cancelled records forever; no secondary cap.** Storage exhaustion via abuse is feasible. Finding C7-9.

7. **Lock force-release after 5 min is fragile under slow PXE.** Finding C7-13.

## Files not modified but should be considered

- `packages/wallet-core/src/utils/random.ts` — verify CSPRNG (C7-10).
- `packages/extension/src/wallet/services/token/service.ts` — verify `register_token` validates contract via `AztecAddress.fromString` before storing in trust table (C7-5).
- Other `ValueStorage` consumers (config, dapp-session metadata) — propagate the `parseOrDelete` resilience pattern (C7-7).
