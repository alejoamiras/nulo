## Findings

### 1. Address truncation is hand-rolled across nine UI surfaces

**Smell:** Duplicate Code — each location independently keeps the first six and last four address characters and inserts a visual separator, despite the existing configurable `trimAddress` utility.

**Impact bucket:** structural. Blast radius: 10 files across shared utilities, popup windows/pages, and common components. Change frequency: 16 file-touch commits across these files in the available history; individually, each has 1–3 recorded changes.

**Evidence:** The canonical implementation is `apps/extension/src/utils/string.ts:6-8`. The same 6/4 slicing policy is repeated at:

- `apps/extension/src/popup/windows/verify/index.vue:44`
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:76`
- `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:51`
- `apps/extension/src/popup/components/popups/ReceivePopup.vue:64-66`
- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:231`
- `apps/extension/src/popup/components/modules/general/TokenImportRow.vue:27`
- `apps/extension/src/popup/pages/journal/[id].vue:125`
- `apps/extension/src/popup/pages/settings/accounts/index.vue:79`
- `apps/extension/src/components/Header.vue:250`

The copies differ only in separator (`...`, `…`, or `•••`) and, in one case, an explicit short-string guard already supplied by `trimAddress`.

**Why it harms future change:** A change to the compact-address policy—width, short-address behavior, separator accessibility, or masking convention—requires finding and updating nine unrelated render surfaces. The current drift in separators demonstrates that the copies already evolve independently.

**Smallest safe refactoring:** **Extract Function / Replace Inline Code with Function Call.** Extend `trimAddress` with an optional separator parameter while retaining its current default, then replace all nine slice expressions with `trimAddress(address, 6, 4, separator)`. The repeated slicing and length-check logic disappears without forcing a visual change.

**Instances:**

- `apps/extension/src/utils/string.ts:6-8`
- `apps/extension/src/popup/windows/verify/index.vue:44`
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:76`
- `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:51`
- `apps/extension/src/popup/components/popups/ReceivePopup.vue:64-66`
- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:231`
- `apps/extension/src/popup/components/modules/general/TokenImportRow.vue:27`
- `apps/extension/src/popup/pages/journal/[id].vue:125`
- `apps/extension/src/popup/pages/settings/accounts/index.vue:79`
- `apps/extension/src/components/Header.vue:250`

### 2. Both logger entry points duplicate the complete publication pipeline

**Smell:** Duplicate Code — `log` and `logWithContext` repeat filtering, record construction, buffering, flush scheduling, event publication, and console output. Only the context value differs.

**Impact bucket:** local. Blast radius: one file/module, `LoggerStore`; both locally generated and forwarded logs are affected. Change frequency: 2 recorded file-touch commits in the available history.

**Evidence:**

- `apps/extension/src/wallet/logger/store.ts:27-43`
- `apps/extension/src/wallet/logger/store.ts:46-62`

Both blocks perform:

1. `level < this.logLevel` filtering.
2. Incrementing `nextId` and taking `Date.now()`.
3. Trimming data.
4. `this.logs.add(log)`.
5. `this.scheduleFlush()`.
6. `this.onLog.invoke(log)`.
7. `print(log)`.

The sole policy difference is `context: "sw"` versus `context ?? "sw"`.

**Why it harms future change:** Adding log metadata, changing trimming, altering publication order, or introducing another sink requires parallel edits. Missing either branch would make forwarded popup/offscreen logs behave differently from service-worker logs.

**Smallest safe refactoring:** **Extract Function.** Add one private `publish(context, source, level, data)` method containing the shared pipeline; make both public methods delegate to it. The two 16-line implementations collapse to argument adaptation plus one shared implementation.

**Instances:**

- `apps/extension/src/wallet/logger/store.ts:27-43`
- `apps/extension/src/wallet/logger/store.ts:46-62`

### 3. `simulate` constructs the same `FunctionCall` on both execution branches

**Smell:** Duplicate Code — the utility and transaction branches instantiate an identical eight-argument `FunctionCall`.

**Impact bucket:** local. Blast radius: one module, with indirect impact on token metadata simulation callers. Change frequency: 4 recorded file-touch commits, including two substantive changes related to Aztec dependencies/security.

**Evidence:**

- `apps/extension/src/wallet/utils/fn.ts:69-78`
- `apps/extension/src/wallet/utils/fn.ts:83-92`

Both constructions pass, in the same order, `viewFn.name`, `contractAddress`, `fnSelector`, `viewFn.type`, `false`, `viewFn.isStatic`, `encodedArgs`, and `viewFn.getReturnTypes()`.

**Why it harms future change:** Any Aztec `FunctionCall` signature change or new call metadata must be applied identically in both branches. This is especially costly at a dependency boundary that has already changed during the available history.

**Smallest safe refactoring:** **Slide Statements / Consolidate Duplicate Conditional Fragments.** Construct `call` once immediately before the `FunctionType.UTILITY` branch and reuse it in both paths. One complete constructor block disappears.

**Instances:**

- `apps/extension/src/wallet/utils/fn.ts:69-78`
- `apps/extension/src/wallet/utils/fn.ts:83-92`

## Non-findings

- **`comma` versus `formatBaseUnits`:** not Duplicate Code. `comma` formats already-decimal UI strings using rounding, while `formatBaseUnits` converts integer base units under an explicit truncate-only contract; merging them would conflate different input and rounding semantics.
- **Activity-display utilities:** `stageSubtitle` handles in-flight stages, `journalTerminalDisplay` handles terminal pre-broadcast records, `tx-enrichment` labels calls, and `activity-rows` merges sources. Their responsibilities are adjacent but do not duplicate the same state transition.
- **Other address abbreviations:** the 8/8 recipient display and 4/4 transaction-hash displays encode different width/entity policies, so they are not instances of the identified 6/4 address duplication.
- **`utils/files.ts`:** it combines picker, download, MIME, and compression logic, but these form one import/export boundary and no repeated change protocol or dispersed edits were found.
- **`storage/migrations/template.ts`:** unreferenced at runtime, but explicitly documented and referenced as developer scaffolding; it is not accidental Dead Code or part of the production bundle.
- **E2E gates and migration fixtures:** intentionally injected only by statically stamped E2E builds and tree-shaken from production, so they are not dead production code.
- **Wallet-core barrels and service/client/spec triples:** deliberate compatibility/layering conventions rather than duplicated implementations.