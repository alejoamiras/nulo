## Findings

### 1. Lock ownership protocol is reimplemented across 71 critical sections

**Smell:** Duplicate Code, with a Shotgun Surgery consequence. The same acquire → execute → `finally` release protocol is repeated around `Lock`, sometimes through locally invented wrappers such as `runExclusive` and `withServiceLock`, instead of being owned by `Lock` itself.

**Impact bucket:** architectural. A migration would touch the shared lock plus 14 production modules. The involved production files appear in 27 commits in the available git history; change frequency is therefore moderate-to-high.

**Evidence:** `Lock` exposes separate `enter()` and `leave()` operations at `packages/wallet-core/src/utils/lock.ts:19` and `:47`, requiring every caller to reproduce the ownership protocol. Two services have already independently extracted local versions at `profile/service.ts:169` and `incoming-transfer/service.ts:208`, while the remaining critical sections repeat it inline. Variants such as `token/service.ts:217-266` additionally maintain a `holdsLock` flag.

**Why it harms future change:** If lock acquisition later gains cancellation, ownership tokens, tracing context, or a different release contract, every critical section must be found and audited. The existing variants—acquire inside `try`, acquire before `try`, conditional release, and local wrappers—make that migration especially broad and easy to apply inconsistently.

**Smallest safe refactoring:** **Extract Function** into `Lock.runExclusive<T>(fn: () => Promise<T>)`. Migrate the straightforward critical sections first while preserving the few outer `catch`/journal-transition behaviors. The repeated `enter()`/`try`/`finally`/`leave()` scaffolding and the two service-local exclusive wrappers then disappear.

**Instances:** Each pair is `enter` / corresponding `leave`.

- `apps/extension/src/wallet/services/profile/service.ts:171/:174`
- `apps/extension/src/wallet/services/token/service.ts:219/:266`, `:313/:350`, `:366/:406`, `:432/:441`, `:739/:754`
- `apps/extension/src/wallet/services/auth-registry/service.ts:147/:159`, `:169/:180`, `:363/:369`, `:383/:395`, `:431/:442`, `:452/:473`
- `apps/extension/src/wallet/services/transaction/service.ts:172/:220`, `:262/:307`, `:416/:447`, `:519/:557`
- `apps/extension/src/wallet/services/account/service.ts:352/:392`
- `apps/extension/src/wallet/services/operation-journal/service.ts:175/:184`, `:197/:206`, `:220/:224`, `:309/:313`, `:410/:426`, `:451/:458`, `:511/:518`, `:542/:558`
- `apps/extension/src/wallet/services/network/service.ts:213/:245`, `:302/:309`, `:321/:335`, `:344/:354`, `:363/:385`, `:408/:418`, `:434/:455`, `:477/:505`, `:514/:530`, `:539/:550`, `:594/:607`, `:740/:786`, `:794/:798`, `:811/:822`
- `apps/extension/src/wallet/services/contact/service.ts:96/:114`, `:123/:140`, `:149/:160`, `:246/:257`, `:273/:287`
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:209/:213`
- `apps/extension/src/wallet/services/dapp-session/service.ts:139/:161`, `:172/:186`, `:192/:211`, `:217/:225`, `:231/:239`, `:245/:253`, `:259/:267`, `:279/:287`, `:299/:310`, `:317/:325`, `:334/:347`, `:357/:374`
- `apps/extension/src/wallet/services/fpc/service.ts:153/:218`, `:261/:276`, `:284/:296`, `:350/:357`, `:365/:376`, `:415/:426`, `:441/:475`
- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:105/:109`, `:115/:119`
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:156/:204`
- `apps/extension/src/wallet/services/dapp-interaction/service.ts:257/:290`

---

### 2. Sixteen clients copy the same compile-time passthrough guard

**Smell:** Duplicate Code. This is boilerplate exceeding the deliberate service/client/spec convention: runtime forwarding is already centralized by `definePassthroughs`, but each client separately recreates the same `Exclude`-based completeness proof, dummy constant, `void` use, declaration-merge explanation, and installation ceremony.

**Impact bucket:** structural. Blast radius is 16 client modules plus `packages/extension-messaging/src/core/service-client-factory.ts`. These clients collectively appear in 8 commits in the available history; individual clients appear in 2–4 commits.

**Evidence:** The factory explicitly tells callers to pair it with a compile-time assertion at `packages/extension-messaging/src/core/service-client-factory.ts:19-21`, but cannot enforce completeness through its current signature at `:28`. Consequently, all 16 clients duplicate the guard locally. For example, `contact/client.ts:25-28` proves completeness and `:44` installs the methods; only the tuple and type names vary.

**Why it harms future change:** A change to how passthrough completeness is expressed—such as supporting symbols, changing `MethodsMap`, tightening key constraints, or replacing declaration merging—requires coordinated edits across every generated-style client. Every new service also has to reproduce roughly the same explanatory and type-only scaffolding.

**Smallest safe refactoring:** **Extract Function** by making the factory curried or otherwise generic over both `Methods` and the inferred literal tuple, with its parameter constrained so `Exclude<keyof Methods, Tuple[number]>` must be `never`. Each client retains its required runtime method-name tuple, but the repeated type alias, sentinel constant, `void` statement, and local completeness documentation disappear.

**Instances:** Locations are method tuple / completeness guard / declaration merge / runtime installation.

- `account-state/client.ts:12/:23/:33/:43`
- `account/client.ts:12/:23/:31/:42`
- `auth-registry/client.ts:12/:22/:32/:44`
- `contact/client.ts:12/:25/:33/:44`
- `dapp-interaction/client.ts:12/:22/:32/:41`
- `dapp-session/client.ts:12/:29/:39/:50`
- `execution/client.ts:11/:24/:34/:41`
- `fpc/client.ts:12/:23/:31/:42`
- `incoming-transfer/client.ts:20/:35/:45/:59`
- `log-viewer/client.ts:12/:16/:26/:35`
- `note/client.ts:11/:15/:23/:30`
- `passkey/client.ts:11/:15/:23/:30`
- `task/client.ts:12/:16/:24/:35`
- `token-balance/client.ts:12/:16/:26/:37`
- `token/client.ts:12/:25/:33/:44`
- `transaction/client.ts:12/:16/:26/:37`

---

### 3. `IncomingTransferService` owns several independently changing subsystems

**Smell:** Large Class, producing Divergent Change. The class is not merely long: it combines private-note scanning, public-event scanning and reorg reconciliation, scheduler lifecycle, trust policy, receipt-fee caching, sync-state projection, transaction suppression, and balance-refresh outbox handling.

**Impact bucket:** structural. The primary blast radius is one 2,001-line service, but it directly coordinates 11 other services and the `IncomingTransferRepository`/`PublicEventIndexer` modules. The file appears in 8 commits in the available history.

**Evidence:**

- Eleven declared service dependencies: `apps/extension/src/wallet/services/incoming-transfer/service.ts:101-116`.
- Separate private and public scheduler state, class-gate cache, lifecycle coordination, fee cache, and sync-state cache: `:139-190`.
- Profile/account/token/transaction lifecycle handling: `:223-394`.
- Query, fee, trust-state, and purge responsibilities: `:396-696`.
- Scheduler hydration and polling: `:697-966`.
- Private-note discovery and commit pipeline: `:967-1175`.
- Public scan, checkpoint, pending-page, and reorg reconciliation pipeline: `:1178-1778`.
- Balance-refresh outbox and task-ledger integration: `:1814-1902`.

These sections depend on different collaborators and change for different reasons, satisfying Divergent Change rather than merely a line-count concern.

**Why it harms future change:** A change to public-event pagination or reorg policy currently requires modifying the same class that owns private PXE polling, trust prompts, scheduler teardown, and balance refresh acknowledgement. Reviewers must retain all of those invariants while changing one subsystem, and the single global lock/lifecycle epoch couples their internal evolution.

**Smallest safe refactoring:** **Extract Class** for the public scanning arm. Move its state and methods—public schedulers/watched sets, class-gate and sync-state caches, cursor persistence, forward scanning, reconciliation, and public record construction—behind a `PublicIncomingTransferScanner`. The existing service remains the lifecycle/RPC coordinator; roughly the `:1178-1778` subsystem and its dedicated fields disappear from it.

**Instances:**

- `apps/extension/src/wallet/services/incoming-transfer/service.ts:86`

## Non-findings

- **Active-profile change handlers:** rejected as Duplicate Code. Price reconciles alarms and refreshes, token-balance rehydrates tokens, task conditionally clears transient tasks, network clears locked node caches, and execution evicts gas balances; only the event source is shared.
- **`ensureInitialized()` plus `requireActiveProfile()` preambles:** rejected. They are short service-boundary guards whose parameters and required ordering vary; extracting them would mainly conceal access semantics.
- **Repeated row-schema prefixes:** rejected as Data Clumps/Duplicate Code. `id`, `profileId`, and `chainId` are persistence identity fields, while each row deliberately applies different lax-versus-wire validation.
- **Service/client/spec triples:** accepted as the declared architecture. Finding 2 is limited to the additional copied exhaustiveness machinery above that convention.
- **Legacy/deprecated branches:** no Dead Code finding. The inspected branches are wired compatibility or migration paths; no symbol met both the absence-of-references and absence-of-registration requirements.