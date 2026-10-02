# q03-wallet-assets-activity — codex

**Scope read:**

- Production implementations, helpers, and service contracts under `apps/extension/src/wallet/services/{incoming-transfer,token,token-balance,note,activity-protocol,price,operation-journal}/`.
- `apps/extension/src/utils/{amount,token-amount,token-aggregate,token-fold,token-order,token-search,incoming-dust}.ts`.
- Selected tests: incoming-transfer repository/scenarios, token-balance service, activity-protocol coordinator, and token seeder harness registration.
- Boundary checks: `apps/extension/src/wallet/runtime.ts`, `apps/extension/src/wallet/base/index.ts`, `packages/wallet-core/src/base/index.ts`, `apps/extension/src/core/adapters/chrome-browser-api.ts`, `apps/extension/vite.config.ts`, and `apps/extension/scripts/pages-options.ts`.
- `CLAUDE.md`, `implementations-plan/lessons.md`, complexity-baseline manifest, supplied repository maps, production clone leads, and both prior quality reports.

Read-only inspection; no files modified or tests executed. History counts below use file-level `git log --format=%h -- <path>`, without `--follow`. They measure file churn, not changes specifically to the cited functions.

## q03-wallet-assets-activity-X-1: First-receive trust policy is duplicated across receipt sources

**Title:** First-receive trust policy is duplicated across receipt sources.

**Smell name:** Duplicate Code — Fowler. **RECURRING (prior: 2026-08-16 Q-01, incoming-transfer workflow portion)**, narrowed to the surviving shared policy.

**Maintenance impact:** Local, high confidence. One production file, two discovery paths, and a third prompt-replay path. `incoming-transfer/service.ts`: **22 commits total; 22 since 2026-06-01**.

**Concrete evidence:**

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:1433-1452` — `resolveNoteTrust`.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:2126-2150` — `resolvePublicTrust`.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:1547-1556` — pending-event construction during replay.

Both discovery paths read current trust, preserve an existing decision, transition `unknown` to `pending`, emit the trust change, check visibility, and construct the same pending-transfer event. Replay constructs that event a third time.

The public path additionally checks its epoch after the trust read. That guard is a real behavioral distinction to preserve.

**Why it harms future change:** Changing when a newly received asset prompts the user requires editing both discovery paths. Changing the prompt’s token metadata projection requires editing three event constructions. These copies are separated by hundreds of lines despite implementing the same receipt policy.

**Smallest safe refactoring:** Extract Function inside `IncomingTransferService` for the pending transition and visibility-gated notification. Keep the callers’ trust reads and source-specific epoch checks in place. Extract a synchronous pending-event builder used by both discovery paths and replay. The existing `_setTrustStateLocked` at `service.ts:605-615` already owns write-and-notify behavior and should be considered during this extraction.

**What disappears:** One duplicate pending-transition/visibility implementation and two duplicate eight-field event constructions.

**Instances:**

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:1433`
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:1547`
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:2126`

## q03-wallet-assets-activity-X-2: Incoming scope deletion repeats its lifecycle and storage inventory

**Title:** Incoming scope deletion repeats its lifecycle and storage inventory.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** Structural, high confidence. Two production files, with separate profile and chain implementations in each. History: `incoming-transfer/service.ts` **22/22 commits**; `incoming-transfer/repository.ts` **4/4 commits**, total/since 2026-06-01.

**Concrete evidence:**

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:702-729` — profile deletion.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:731-755` — chain deletion.
- `apps/extension/src/wallet/services/incoming-transfer/repository.ts:221-231` — profile storage purge.
- `apps/extension/src/wallet/services/incoming-transfer/repository.ts:234-244` — chain storage purge.

Both service methods acquire the service lock, bump the epoch before awaiting, remove scan episodes, evict fee-cache entries, delete persistent state, rebuild schedulers, and repeat cache eviction in `finally`. Both repository methods separately enumerate the same five stores: records, trust, cursors, outbox, and arrivals.

The variable parts are the scope prefix and cache-eviction strategy.

**Why it harms future change:** Adding another incoming-transfer store requires updating two storage inventories. Changing purge/rebuild ordering requires updating two lifecycle implementations. The duplicated `finally` eviction already carries comments explaining the same timing requirement in both methods, so maintaining that invariant depends on synchronized edits.

**Smallest safe refactoring:** Extract Function at each existing layer:

- A private service helper owns epoch advancement, episode removal, eviction, persistent deletion, scheduler hydration, and final eviction. Callers supply the scope and eviction/deletion operations.
- A private repository `clearScopePrefix(prefix)` owns the five-store inventory. Preserve key-based deletion, including the `note:`/`pub:` record prefixes; value-based enumeration would change malformed-row handling.

Keep profile-wide versus network-specific cache eviction explicit in the callers.

**What disappears:** One duplicate service lifecycle frame, one duplicate five-store deletion inventory, and repeated explanations of the shared ordering invariant.

**Instances:**

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:702`
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:731`
- `apps/extension/src/wallet/services/incoming-transfer/repository.ts:221`
- `apps/extension/src/wallet/services/incoming-transfer/repository.ts:234`

## q03-wallet-assets-activity-X-3: Balance purges duplicate the same fenced deletion protocol

**Title:** Balance purges duplicate the same fenced deletion protocol.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** Local, high confidence. One production file and two public purge entry points. `token-balance/service.ts`: **19 commits total; 19 since 2026-06-01**.

**Concrete evidence:**

- `apps/extension/src/wallet/services/token-balance/service.ts:546-561` — token-scoped purge.
- `apps/extension/src/wallet/services/token-balance/service.ts:579-601` — account-scoped purge.

Both hold the same lock across a typed-row sweep and malformed-row sweep. Each matching typed row is invalidated and deleted, then conditionally emits a deletion event only if the live token still matches the row’s identity. Both subsequently purge attributable malformed rows and log the same message.

Only the selection predicates differ. The token purge additionally removes matching entries from the token map afterward.

**Why it harms future change:** A change to deletion-event eligibility, invalidation ordering, or malformed-row diagnostics must be applied twice. The existing tests separately pin these behaviors for token and account purges, demonstrating that the repeated sequence implements an important shared contract.

**Smallest safe refactoring:** Extract Function as a private `purgeMatchingBalancesLocked` helper in `TokenBalanceService`, accepting typed-row and malformed-row predicates. Reuse the existing `invalidateAndDelete` and `rowMatchesToken` helpers. Keep lock acquisition in the current callers and keep token-map eviction in `purgeForTokens`.

**What disappears:** One duplicate typed-row sweep, identity-gated notification block, and malformed-row purge/logging frame.

**Instances:**

- `apps/extension/src/wallet/services/token-balance/service.ts:546`
- `apps/extension/src/wallet/services/token-balance/service.ts:579`

## q03-wallet-assets-activity-X-4: Default-token deployment addresses have two configuration owners

**Title:** Default-token deployment addresses have two configuration owners.

**Smell name:** Shotgun Surgery — Fowler; configuration duplication. Changing one deployed asset’s identity requires synchronized edits in the seeding and pricing modules.

**Maintenance impact:** Structural, high confidence. Two production files contain six definitions representing three shared addresses. History: `token/default-tokens.ts` **8/8 commits**; `price/price-map.ts` **6/6 commits**, total/since 2026-06-01.

**Concrete evidence:**

| Asset | Seed definition | Price definition |
|---|---|---|
| Clean USDC | `apps/extension/src/wallet/services/token/default-tokens.ts:43-44` | `apps/extension/src/wallet/services/price/price-map.ts:36` |
| Mainnet bridged USDC | `apps/extension/src/wallet/services/token/default-tokens.ts:55-59` | `apps/extension/src/wallet/services/price/price-map.ts:37-39` |
| Testnet USDC | `apps/extension/src/wallet/services/token/default-tokens.ts:66-71` | `apps/extension/src/wallet/services/price/price-map.ts:40-42` |

The duplicated information is the contract address identifying each built-in asset. The price-map comment explicitly identifies its testnet address as the same address used by the seed.

This coordinated change already occurs: commit `1d63ca40`, dated **2026-09-28**, updated both files when switching the testnet USDC deployment.

**Why it harms future change:** Repointing a default token requires remembering an independent price-address definition. A partial edit can leave the newly seeded token without its intended price mapping. The September change provides an actual maintenance example rather than a hypothetical extension requirement.

**Smallest safe refactoring:** Extract shared constants and Move Field to a dependency-free extension module such as `apps/extension/src/utils/known-token-addresses.ts`, alongside the existing shared chain identifiers. Both services import the addresses. Keep seed eligibility, class pins, and pricing policy in their current modules: the seed and price-map memberships intentionally differ.

**What disappears:** Three duplicate address literals and the need to synchronize deployment-address changes manually across the two modules.

**Instances:**

- `apps/extension/src/wallet/services/token/default-tokens.ts:44`
- `apps/extension/src/wallet/services/token/default-tokens.ts:59`
- `apps/extension/src/wallet/services/token/default-tokens.ts:71`
- `apps/extension/src/wallet/services/price/price-map.ts:36`
- `apps/extension/src/wallet/services/price/price-map.ts:39`
- `apps/extension/src/wallet/services/price/price-map.ts:42`

The additional matching address in `token/seeder.harness.ts:13` is test-only and excluded.

## q03-wallet-assets-activity-X-5: Activity protocol coordinator has no production consumers

**Title:** Activity protocol coordinator has no production consumers.

**Smell name:** Dead Code — Fowler.

**Maintenance impact:** Structural, high confidence, lower observed churn. Two production files form an unused sequencing/storage subsystem. History: `activity-protocol/coordinator.ts` **3/3 commits**; `activity-protocol/spec.ts` **1/1 commits**, total/since 2026-06-01.

**Concrete evidence:**

- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:1-247` implements incarnation management, sequence allocation/settlement, watermarks, tombstones, and purges.
- `apps/extension/src/wallet/services/activity-protocol/spec.ts:1-70` defines its service name, three storage roots, schemas, and row-key helper.

Tracked-source searches for `ActivityProtocolCoordinator`, `ACTIVITY_PROTOCOL_SERVICE_NAME`, and coordinator imports found **zero executable production references outside these files**. The coordinator’s only external executable references are in `coordinator.test.ts:4,16,37`; another match is a historical comment in `packages/wallet-core/src/utils/keyed-lock.ts:25`. Searches for the schema names and storage-root constants likewise found no production consumers outside the subsystem.

Registration was checked:

- `apps/extension/src/wallet/runtime.ts:469-543` explicitly constructs and registers services; this coordinator is absent.
- `packages/wallet-core/src/base/index.ts:37-52` uses explicit instance registration, without reflective discovery.
- `apps/extension/vite.config.ts:117-141` does not auto-import `wallet/services`.
- `apps/extension/scripts/pages-options.ts:9-15` does not include this directory in file-based routes.
- No `import.meta.glob` or equivalent source discovery was found in extension source.

**Why it harms future change:** The module’s opening documentation states that transaction, journal, and incoming producers obtain sequencing here, while production code never calls it. A maintainer changing activity ordering encounters a substantial, tested implementation that appears authoritative but does not govern runtime behavior. Its storage contracts and tests also remain maintenance obligations.

**Smallest safe refactoring:** Remove Dead Code: delete the coordinator and its exclusively consumed specification, together with tests dedicated to that implementation. The shared `@nulo/wallet-core/activity` package is outside this deletion.

**What disappears:** **317 production lines across two files**, plus the **154-line** dedicated coordinator test file.

**Instances:**

- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:1`
- `apps/extension/src/wallet/services/activity-protocol/spec.ts:1`

## Non-findings considered

- **Prior token-import duplication, 2026-08-16 Q-09:** `addToken` and `addSeededToken` now share `persistToken`; function discovery uses the descriptor-driven resolver. The previous duplicated pipelines are fixed.
- **Prior lock and passthrough scaffolding, 2026-08-14 Q-01/Q-05:** inspected services/clients use the shared lock and passthrough helpers; no recurrence reported for those implementations.
- **Prior alarm scaffolding, 2026-08-16 Q-05:** price and journal maintenance use `AlarmDispatcher`. Their distinct scheduling and boot policies remain justified.
- **Prior keyed-lock extraction, 2026-08-16 Q-08:** the activity coordinator now uses shared `KeyedLock`; its lack of production consumers is a separate finding.
- **Whole incoming scanner merger:** note discovery, forward public scanning, and reorg reconciliation have different identities, cursor behavior, and await boundaries. Similar structure does not justify combining their complete state machines.
- **Amount/decimal parsing:** note decoding, stored-balance validation, user-entered amounts, and USD conversion differ in accepted syntax, missing-value handling, precision, and rounding. Shared `BigInt` operations alone do not establish duplicate policy.
- **Decimal bounds:** seeding’s conservative metadata bounds differ deliberately from the generic amount utilities’ supported range.
- **Balance planning versus locked reconciliation:** repeated identity checks serve planning and commit-time validation; removing the latter as duplication would change the concurrency contract.
- **Retry implementations:** scan health, token seeding, price refresh, and journal send checks use different retry eligibility and persistence rules.
- **Service/spec/client triads, framework conventions, and accepted complexity directives:** no findings based solely on these documented patterns or file size.

## Incidental bugs noticed (for the bugs run)

None confirmed within the inspected scope.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

Confidence: **high** in the source distinctions below.

- **C-1 — Partially agree.** The trust-transition duplication is real, but the complete commit pipelines differ: note timestamp lookup and record construction precede dirty-marking (`apps/extension/src/wallet/services/incoming-transfer/service.ts:1469-1482`); public commits check epochs after dirty-marking and after the visibility await (`:2165-2170`). An extracted emission helper must preserve that post-await check. The pending payload also has a third copy at `:1547-1556`, missing from Claude’s instances.

- **C-2 — Partially agree.** The authwit/balance scope matcher and restore guard are duplicates. Transaction purge is meaningfully different: it handles optional profile ownership and legacy unscoped rows through `soleOwner` (`apps/extension/src/wallet/services/transaction/service.ts:301-316`). Also, the balance creation key is **token ID + account**, not chain ID + account (`apps/extension/src/wallet/services/token-balance/service.ts:339`); it must not join the proposed scope-key extraction. A purge matcher does not belong in the restore-specific fence module.

- **C-3 — Partially agree.** A helper for repeated active-map lookups is reasonable; “12 interchangeable sites” and Feature Envy are overstated. The service owns its map, and identity logic already lives in `apps/extension/src/wallet/services/token-balance/balance-identity.ts:16-18`. Creation uses `pairTokens` (`service.ts:327-332`), backup deliberately uses authoritative `owned` tokens (`:665-672`), and the projector performs asynchronous resolution (`balance-projector.ts:77-80`). Those distinctions must survive extraction.

- **C-4 — Agree.** Both note-scheduler teardown copies exist (`apps/extension/src/wallet/services/incoming-transfer/service.ts:447-451,1226-1229`), as does the profile/chain clearing scaffold (`:702-755`). The repository adds another duplicated layer, described below.

- **C-5 — Mostly disagree; retain only the small rate-helper extraction.** Seeder bounds explicitly govern zero-interaction admission (`apps/extension/src/wallet/services/token/seeder.ts:31-34`); UI bounds constrain exponentiation (`apps/extension/src/utils/token-amount.ts:8-15`). These are different knobs. Field decoding, missing-balance handling, and positive-arrival eligibility also have different contracts. The rounding functions share validation and can accept a rounding parameter (`apps/extension/src/wallet/services/price/convert.ts:24-46`). The incidental hex counterexample is false: `parseNoteAmount` canonicalizes `"0x10"` to `"16"` before persistence (`incoming-transfer/service.ts:2449-2450`). The proposed epoch race remains unverified.

**2. What Claude missed that I found**

- **X-1, additional instance:** Pending-prompt replay duplicates the event projection at `apps/extension/src/wallet/services/incoming-transfer/service.ts:1547-1556`.
- **X-2, repository half:** Profile and chain deletion separately enumerate all five stores at `apps/extension/src/wallet/services/incoming-transfer/repository.ts:221-244`; C-4 covers only the service scaffold.
- **X-3, broader shared protocol:** Both balance purges duplicate the entire locked typed-delete → identity-gated notification → malformed-row sweep at `apps/extension/src/wallet/services/token-balance/service.ts:546-561,579-601`, beyond C-3’s notification fragment.
- **X-4:** Deployment addresses are duplicated between `apps/extension/src/wallet/services/token/default-tokens.ts:44,59,71` and `apps/extension/src/wallet/services/price/price-map.ts:36,39,42`; commit `1d63ca40` demonstrates synchronized changes.
- **X-5:** `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:77` and its `spec.ts:1-70` have no production consumers; references are tests/comments, and runtime registration plus framework discovery exclude them. Claude considered its arithmetic helper but missed the unused subsystem.

**3. What BOTH of us missed**

No additional finding established in this light pass.