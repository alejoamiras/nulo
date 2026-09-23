All line references confirmed. Here is the final report.

---

### Finding: `TokenService` hand-unrolls the 9-kind function-descriptor table twice instead of iterating it

**Smell name:** Duplicate Code (Fowler).

**Maintenance impact:** structural. Blast radius: 1 file (`token/service.ts`), but the duplicated shape is internally 2×9-way. Change frequency: `token/service.ts` had 7 commits in the last 90 days — an active file.

**Concrete evidence:** `getTokenInterface` (apps/extension/src/wallet/services/token/service.ts:442-522) and `parseTokenInterface` (apps/extension/src/wallet/services/token/service.ts:533-635) each separately compute candidates/fn-selection for all 9 `TokenFnKind`s (`getName`, `getSymbol`, `getDecimals`, `balanceOfPrivate`, `balanceOfPublic`, `transferPublic`, `transferPrivate`, `transferPrivateToPublic`, `transferPublicToPrivate`) as 9 near-identical statement pairs: lines 466-495 (getTokenInterface) and lines 572-603 (parseTokenInterface), then build a `TokenInterface` object with the same 9×2 fields at lines 497-519 and 605-627. `apps/extension/src/wallet/services/token/functions/descriptors.ts:427-437`'s own header comment states the descriptor map's purpose explicitly: *"Consumers (service assembly, spec completeness, OperationPlanner) iterate this instead of re-threading the 9-way enum"* — the two `TokenService` methods are exactly the re-threading the map was built to avoid.

**Why it harms future change:** adding a 10th token-function kind (a real, plausible event — the descriptor table has grown from a 9-way "old copy-paste module" migration already) requires touching 4 separate 9-item blocks by hand (2 candidate blocks + 2 object-literal blocks) in lockstep; missing one silently drops the new kind from one of the two RPC-facing interfaces.

**Smallest safe refactoring:** Extract Method — a private `buildTokenInterface(artifact, selectFn: (kind, candidates) => Fn | undefined)` that loops `Object.entries(TOKEN_FN_DESCRIPTORS)`, computes `{candidates, fn}` per kind via the injected selector, and assembles the flat `TokenInterface` object from the loop result. `getTokenInterface` passes a selector that reads `token[...]Fn`; `parseTokenInterface` passes `getDefaultTokenFn`.

**What disappears:** the 4 separate 9-way unrolled blocks (~120 lines) collapse into one ~20-line loop + two ~5-line selector closures; a new `TokenFnKind` becomes a single addition to `TOKEN_FN_DESCRIPTORS` with no `service.ts` edit.

**Instances:** token/service.ts:466-495, token/service.ts:497-519, token/service.ts:572-603, token/service.ts:605-627.

---

### Finding: `addToken`/`addSeededToken` duplicate the Token-row construction and lock/journal wrapper

**Smell name:** Duplicate Code (Fowler).

**Maintenance impact:** structural. Blast radius: 1 file. Change frequency: 7 commits/90d on `token/service.ts`.

**Concrete evidence:** `addToken` (token/service.ts:178-268) and `addSeededToken` (token/service.ts:283-350) both: look up `findToken` for idempotency, create a journal operation, then under `this.lock.withLock` build an identical 15-field `Token` object literal (compare token/service.ts:231-248 to token/service.ts:317-334 — field order and names are byte-identical) and run the same `transitionOperation("simulating") → set → emit → transitionOperation("succeeded")` / `catch → transitionOperation("failed") → rethrow` sequence.

**Why it harms future change:** the `Token` shape has 15 fields today; adding/renaming one (a real recent-history event — token rows have grown fields for fn descriptors) means editing two 18-line object literals in lockstep, and the "catch must stay inside the lock" invariant documented at token/service.ts:217-219/311 has to be independently preserved in both copies.

**Smallest safe refactoring:** Extract Method — a private `persistToken(existingId: number | undefined, profileId, chainId, contract, name, symbol, decimals, tokenInterface): Promise<Token>` that builds the object once; both public methods become thin wrappers supplying `origin`/`title`/`subtitle` to the journal call and delegating construction to the shared helper.

**What disappears:** one 15-field object literal instead of two; a future field addition is a one-site edit.

**Instances:** token/service.ts:220-267 (addToken body), token/service.ts:312-349 (addSeededToken body), specifically the object literals at token/service.ts:231-248 and token/service.ts:317-334.

---

### Finding: restore()'s try/catch→restoreError loop is hand-rolled in 5 services despite the extracted `restoreRows` helper

**Smell name:** Duplicate Code (Fowler) — specifically incomplete adoption of an existing extraction.

**Maintenance impact:** structural. Blast radius: 5 files (`account`, `network`, `auth-registry`, `transaction`, `config`). Change frequency: account 8, network 15, auth-registry 6, transaction 8, config 2 commits/90d — all but config are active files. `restore-rows.ts` itself had only 1 commit in 90 days, i.e. it hasn't been touched since extraction even though 5 of 8 call sites never adopted it.

**Concrete evidence:** `apps/extension/src/wallet/services/restore-rows.ts` centralizes exactly this shape (`for (row of rows) { try { push(await writeOne(row)) } catch(err) { push({...row, restoreError}) } }`) and is correctly used by `contact/service.ts:258-271`, `fpc/service.ts:427-458`, and `token/service.ts:739-748`. But the identical loop is hand-rolled again in:
- `account/service.ts:345-390` (for loop at 361-386)
- `network/service.ts:703-752` (for loop at 717-749)
- `auth-registry/service.ts:431-456` (for loop at 438-455)
- `transaction/service.ts:505-547` (for loop at 511-543)
- `config/service.ts:64-87` (for loop at 67-84)

Each of the 5 independently reimplements `push(result); catch(err) { push({...row, restoreError: toRestoreError(err)}) }` with `toRestoreError` imported identically in 4 of them (account/service.ts:2, network/service.ts:2, transaction/service.ts:2, config/service.ts:2).

**Why it harms future change:** the restore-error envelope shape (or its error-classification logic) has already changed once in this codebase's history (per the map's backup/migration surface); a future change to `toRestoreError` wrapping, or to the loop's abort-vs-continue semantics, requires 8 edits instead of 3, and 5 of the 8 can silently drift from each other (e.g. `account`'s loop adds an extra pre-loop `hasIntersectionByKeys` collision check that the others don't need — a legitimate service-specific addition, but it's buried inside a hand-copied loop rather than layered on top of a shared one).

**Smallest safe refactoring:** Extract Method / adopt the existing extraction — rewrite each of the 5 `restore()` bodies as `return await restoreRows(rows, async (row) => { /* service-specific validate+id+write, throw to reject */ return writtenRow })`, keeping any service-specific pre-loop logic (e.g. `account`'s intersection check, `config`'s allowlist filter) as code around the `restoreRows` call rather than inside a re-implemented loop.

**What disappears:** 5 duplicate for/try/catch blocks (~140 lines total) collapse to 5 `writeOne` closures; the loop's control-flow guarantee ("never aborts on one bad row") lives in exactly one place.

**Instances:** account/service.ts:345-390, network/service.ts:703-752, auth-registry/service.ts:431-456, transaction/service.ts:505-547, config/service.ts:64-87 (contrast: contact/service.ts:258-271, fpc/service.ts:427-458, token/service.ts:739-748 correctly adopt `restoreRows`).

---

### Finding: id-generation collision-avoidance loops duplicated outside `id-allocators.ts`, in two variants

**Smell name:** Duplicate Code (Fowler) — the extraction in `id-allocators.ts` covers "always-fresh" allocation but not the "prefer source id, reroll only on collision" variant every restore path actually needs, and even the "always-fresh" variant is re-implemented instead of called at two sites.

**Maintenance impact:** structural. Blast radius: 5 files. Change frequency: contact 6, fpc 7, network 15, dapp-session 5, task (not measured, low-churn) commits/90d.

**Concrete evidence:**
- **Reroll-preserving variant** (not in `id-allocators.ts`, hand-rolled 3×): `contact/service.ts:259-263` (`let id = contact.id; while (await this.storage.contains(id)) { id = getRandomHex(8) }`), `fpc/service.ts:436-439` (byte-identical logic), `network/service.ts:737-738` (same logic extended with an intra-batch `sourceIds` guard — see the Bug handoffs note below on why the extension exists only here).
- **Fresh-alloc variant duplicating the already-extracted `nextRandomId`** (`id-allocators.ts:18-24`, which already supports a `length` parameter): `dapp-session/service.ts:139-142` (`do { id = getRandomHex(64) } while (await this.storage.contains(id))` against `this.storage`, an `EntityStorage` that already satisfies `nextRandomId`'s `{contains(id)}` interface — this is literally `await nextRandomId(this.storage, 64)` not called) and `task/service.ts:47-50` (same loop shape against an in-memory `Map`, a weaker instance since it's sync).

**Why it harms future change:** a correctness fix to the id-collision strategy (e.g. the `sourceIds` intra-batch guard `network/service.ts` already needed — see Bug handoffs) has no single place to land; it was applied to network's copy only, and nothing forces the other 2 reroll-preserving copies (or the 2 fresh-alloc copies bypassing `nextRandomId` entirely) to receive the same fix.

**Smallest safe refactoring:** add a `nextRandomIdPreferring(storage, preferredId, length, avoid?: Set<string>)` to `id-allocators.ts` for the reroll-preserving variant (contact/fpc/network's restore paths), and change `dapp-session/service.ts:139-142` to call the existing `nextRandomId(this.storage, 64)` directly.

**What disappears:** 3 duplicate reroll loops become 3 one-line calls to a new shared helper (with the `sourceIds`-guard fix landing once); the `dapp-session` fresh-alloc reimplementation disappears entirely.

**Instances:** contact/service.ts:259-263, fpc/service.ts:436-439, network/service.ts:737-738, dapp-session/service.ts:139-142, task/service.ts:47-50.

---

### Finding: `DappSessionService` repeats a 6-way "load → null-check → patch one field → save → emit" method shape

**Smell name:** Duplicate Code (Fowler).

**Maintenance impact:** local/structural. Blast radius: 1 file. Change frequency: 5 commits/90d.

**Concrete evidence:** `updateDappSession` (dapp-session/service.ts:161-180), `setVerificationHash` (203-212), `setTrustedVerification` (214-223), `setAccountAliases` (225-234), `setCapabilityGrants` (236-245), `setCapabilityRejections` (253-262) each independently repeat: `lock.withLock(async () => { const session = await storage.get(id); if (!session) throw Error("Invalid id"); session.<field> = <value>; await storage.set(id, session); emit("onDappSessionUpdated", session); return session })`, varying only in which field(s) are assigned. The 2 read-only counterparts (`getCapabilityGrants:247-251`, `getCapabilityRejections:264-268`) repeat a shorter "load → null-check → return field ?? []" shape.

**Why it harms future change:** each new per-session mutable field (this file has grown 3 such fields — `verificationHash`, `trustedVerification`, `accountAliases`, `capabilityGrants`, `capabilityRejections` — in its recent history per the map's capability-grant additions) means copy-pasting a whole 9-10 line method instead of adding a field name to a generic patcher; a fix to the shared "Invalid id" error message or the lock/emit sequencing needs 6 edits.

**Smallest safe refactoring:** Extract Method — a private `patchSession(sessionId, patch: Partial<DappSession>): Promise<DappSession>` implementing the shared load/check/merge/save/emit sequence once; the 6 public methods become one-line callers (`setAccountAliases` merges into the existing `accountAliases` object first, the rest pass the patch straight through).

**What disappears:** ~54 lines of repeated method bodies collapse to ~10 lines of shared logic + 6 one-liners.

**Instances:** dapp-session/service.ts:161-180, 203-212, 214-223, 225-234, 236-245, 253-262 (secondary, weaker: 247-251, 264-268).

---

### Finding: `NetworkService.addEndpoint`/`updateEndpoint` share an ~80%-identical 7-step pipeline

**Smell name:** Duplicate Code (Fowler).

**Maintenance impact:** local. Blast radius: 1 file. Change frequency: 15 commits/90d — the highest-churn file in this cluster, which raises the odds this duplication gets touched (and drifts) again.

**Concrete evidence:** `addEndpoint` (network/service.ts:406-436) and `updateEndpoint` (network/service.ts:438-483) both: `validateParams` → `ensureInitialized` → `requireActiveProfile` → peek the network unlocked via `requireOwnedRow` → probe `_getChainId(rpcUrl, peek.kind)` outside the lock → `lock.withLock`: re-fetch the network, throw `ERR_ENDPOINT_CHAIN_MISMATCH` on mismatch, check a URL-collision among `network.endpoints`, construct a `NetworkEndpoint`, persist, `emit("onNetworkUpdated", network)`. They diverge only in push-vs-replace-at-index and (`updateEndpoint` only) transient-cache eviction.

**Why it harms future change:** a change to the "peek unlocked, probe, then re-check inside the lock" race-safety pattern (a subtle, already-commented-on concern in this file — see the "rare deletion race" comment at network/service.ts:411-412) has to be applied to both copies to stay correct.

**Smallest safe refactoring:** Extract Method — a private `resolveEndpointWrite(networkId, profile, rpcUrl, kindHint?)` returning `{network, normalized, probedChainId}` after the peek+probe+lock-reacquire+mismatch-check steps; both callers finish with their own collision-check + splice-vs-push tail.

**What disappears:** the duplicated 6-step preamble (~20 lines) collapses to one shared call; only the genuinely-differing tail (collision rule + cache eviction) remains per method.

**Instances:** network/service.ts:406-436, network/service.ts:438-483.

---

### Finding: `NetworkServiceClient` is the cluster's one holdout from the passthrough-installer convention, hand-rolling validate/request/validate 16×

**Smell name:** Duplicate Code (Fowler), refining a decision already recorded by the prior dedup audit rather than contradicting it.

**Maintenance impact:** structural. Blast radius: 1 file (100 lines of the file's 136 are this pattern). Change frequency: 15 commits/90d.

**Concrete evidence:** 10 of the 14 cluster clients (contact, fpc, dapp-session, auth-registry, token, transaction, account, task, log-viewer, note) use `definePassthroughsExhaustive` — a curried installer that generates every RPC-passthrough method body from a name list. `network/client.ts:35-134` is the only client in this cluster that instead hand-writes all 16 methods with the identical 3-line shape `validateParams(Schema.X.params, [...args], "X"); const result = await this.request("X", ...args); return validateResult(Schema.X.result, result, "X")`. The prior dedup audit (`audit/quality/2026-08-14-dedup-mid/findings/verified/Q-05.md:15,54`) already identified this and correctly declined to force `network`/`operation-journal` into the *existing* pure-forward-only installer, noting zod validation is "incompatible with `definePassthroughs`'s pure-forward body" — that reasoning is sound and I verified it still holds (network/client.ts genuinely validates params/result on every call, unlike the other 13 clients). What Q-05 didn't address is that the 16 validate-wrapped method bodies still duplicate each other *within* network/client.ts.

**Why it harms future change:** `network`'s RPC surface has grown fastest in this cluster (16 methods, 15 commits/90d); every new network method requires hand-copying the 3-line validate/request/validate shape instead of adding one entry to a name list, and a future fix to the validation-error-wrapping behavior (already a documented concern — `ValidationError` `instanceof` support per the client's header comment) needs 16 edits here versus 1 in every other client.

**Smallest safe refactoring:** Extract Method / new named analog — a `defineValidatedPassthroughsExhaustive<M>()(prototype, schemas, names)` installer (sibling to `definePassthroughsExhaustive`) that generates the validate/request/validate body per name from the `NetworkMethodSchemas` map, mirroring the existing installer's shape but wrapping each call in `validateParams`/`validateResult`.

**What disappears:** ~100 lines of hand-copied wrapper bodies collapse to one installer call + a name list, matching the other 13 clients' shape; network/client.ts stops being the cluster's exception.

**Instances:** network/client.ts:35-134 (all 16 methods).

---

### Finding: alarm-consumer ritual — no shared "alarm-backed periodic task" primitive

**Smell name:** Named analog — config/temporal-coupling sprawl (each consumer independently re-derives the same `chrome.alarms` create/clear/dispatch-filter/reconcile lifecycle instead of sharing one primitive).

**Maintenance impact:** architectural (crosses service boundaries and, per this cluster's scope, only `PriceService` is directly in-scope — the other 3 instances live in `profile/` and `operation-journal/`, outside this leg's directory list, so this finding's full remediation is cross-cluster). Blast radius confirmed at 4 files. Change frequency: not measured for the out-of-cluster files; `price/service.ts` is part of an active surface (token/network/price feed work churns frequently per the map).

**Concrete evidence:** `price/service.ts` hand-rolls: alarm name constant (`price/service.ts:24`), `ensureAlarm()` (`price/service.ts:231-233`, wrapping `alarms.create`), reconcile-on-boot (`price/service.ts:113-122`), and dispatch is externally routed by name from the SW shell (`price/service.ts:164-166` doc comment: "dispatched by the SW shell's module-scope alarm listener"). I verified the map's claim that this exact shape (alarm-name constant + `create`/`clear` + an `onAlarm`-registered name-filtering dispatcher) is independently re-implemented in `profile/session-manager.ts:70,148,582-583,625,638` and `operation-journal/{reaper.ts:50,84-85,96,99-100; gc.ts:38,84-85,96,99-100}` — both outside this leg's cluster scope, so I did not audit their internals, only confirmed the pattern's existence via grep.

**Why it harms future change:** a cross-cutting fix (e.g. the reconcile-on-boot "stray alarm from a previous SW lifetime" logic that `price/service.ts:113-122` already needed) has no single place to land; each of the 4 consumers has to independently rediscover and re-implement the same boot-reconciliation and name-filtered-dispatch correctness requirements.

**Smallest safe refactoring:** Extract Class — a shared `AlarmBackedTask` primitive (name, period, tick handler, enabled-predicate) that owns create/clear/boot-reconcile/dispatch-filter once; each of the 4 consumers becomes a thin config + tick-body.

**What disappears:** 4 independent re-implementations of the same alarm lifecycle shrink to 4 thin configurations of one shared primitive.

**Instances (in-cluster):** price/service.ts:24, 113-122, 164-186, 231-233. **Instances (out-of-cluster, corroborating — not owned by this leg):** profile/session-manager.ts:70,148,582-638; operation-journal/reaper.ts:50,84-85,96,99-100,113-142; operation-journal/gc.ts:38,84-85,96,99-100.

---

## Non-findings considered

- Lock-per-service ritual (11+ services independently `new Lock()`) — the substantive duplication (hand-rolled `enter()`/`leave()` frames) was already centralized by Q-01/#375 (`Lock.withLock()` everywhere); I confirmed zero remaining raw `.enter()`/`.leave()` calls in this cluster. What remains is a one-line constructor call per service, which is correct per-service mutex scoping, not duplicated logic — NON-FINDING.
- `token/seeder.ts`'s `doRun()` (~103 lines, token/seeder.ts:185-288) is a Long Method candidate by line count, but its complexity is an irreducible epoch/guard state machine (concurrent-purge safety), is heavily commented on the "why", and has dedicated test coverage (`seeder.test.ts`) — extraction would relocate, not reduce, the complexity. NON-FINDING.
- `task/service.ts`'s `getTask`/`getTaskSync` and `getTasks`/`getTasksSync` pairs look like duplication but are a deliberate, thin (4-line) async-RPC-surface vs. sync-internal-caller split (`WrappedTask` needs synchronous reads) — no duplicated logic beyond the `cleanupStaleTasks()` call. NON-FINDING.
- The per-service `spec.ts`/`service.ts`/`client.ts` 3-file ritual itself is a consistent, load-bearing convention across all 29 service directories (confirmed by the map and my own reads of 14 of them in this cluster) — not measurable duplication on its own; the genuine extractable residue is captured in the findings above (restore-loop, id-generation, passthrough-installer), not the ritual shape itself. NON-FINDING.
- `config/client.ts`, `price/client.ts`, `logger/client.ts` hand-roll their (2-4 method) passthroughs instead of using `definePassthroughsExhaustive` — below the size where adopting the installer measurably pays for itself (contrast with `network/client.ts`'s 16 methods). NON-FINDING.
- `FpcService.getFpcs`'s pre-lock "missingBeforeLock" check and the re-check-under-lock after acquiring (fpc/service.ts:132-148 vs 161-169) look like duplicated filter logic but are a deliberate optimistic-check/locked-recheck pattern to avoid unnecessary lock contention, documented inline — not a duplication smell. NON-FINDING.

## Bug handoffs

- contact/service.ts:259-263 and fpc/service.ts:436-439 restore()'s id-reroll lacks the intra-batch `sourceIds` guard that network/service.ts:712-716,738 added for its documented "finding E" (a rerolled id colliding with a later, not-yet-written source id in the same batch) — worth the bugs audit checking whether either service has batch cross-references that make the same aliasing risk live.