# C6 — core libs + infra/config — Claude instance 2

Scope audited: `packages/wallet-core/src/**`, `packages/wallet-crypto/src/**`, `packages/extension/src/utils/**`, entry points (`src/{wallet,popup,offscreen,onboarding}/index.ts`, `content-script/content.ts`, `setup/`), build/test configs (`vite*.{ts,mts}`, `vitest*.ts`, `manifest/*`), `scripts/e2e/*`, e2e fixtures (`extension.ts`/`helpers.ts`, harness duplication only). All claims verified against source; grep evidence cited. Repo history is short (53 commits since 2026-05-19), so change-frequency signals are weak everywhere — noted per finding.

## F1: Console-hijack + unhandled-rejection block copy-pasted across all four entry shells (plus a test re-implementation)

1. **Title**: Console-hijack quadruplication across entry points.
2. **Smell name**: Duplicate Code (Fowler). Secondary: the loader side is Config Sprawl — the sniffer module is wired four different ways (3 HTML `<script>` tags + 1 static import).
3. **Impact bucket**: structural. Blast radius: 5 files (4 entries + `tests/vitest.setup.ts`) plus 3 HTML files. Change frequency: low-moderate (`src/wallet/index.ts` ×2, `src/offscreen/index.ts` ×2 in the visible history — entry shells get touched whenever logging/boot policy changes).
4. **Evidence**: the loop `for (const [method, level] of consoleMethods) { (self as any)[\`on${method}\`] = (...args) => logger.log(<channel>, level, ...args) }` + `self.onunhandledrejection = (e) => logger.log(<channel>, LogLevel.Error, getErrorData(e.reason))` appears, near-verbatim, in:
   - `packages/extension/src/wallet/index.ts:56-67` (target `LoggerStore`, channel `"wallet"`)
   - `packages/extension/src/popup/index.ts:6-17` (target `LoggerServiceClient`, channel `"ui"`)
   - `packages/extension/src/onboarding/index.ts:13-23` (target `LoggerServiceClient`, channel `"ui"`)
   - `packages/extension/src/offscreen/index.ts:21-47` (channel `"pxe"`, plus the benign-SW-disconnect demotion variant)
   The hook receiver (`src/utils/console-sniffer.ts:1-32`) is loaded via `<script>` tag in `popup/index.html:8`, `offscreen/index.html:6`, `onboarding/index.html:8` but via static import in `wallet/index.ts:14`. `tests/vitest.setup.ts:9-14` re-implements the `console._<method>` alias half of the shim a fifth time so unit tests don't explode.
5. **Why it harms future change**: any change to the forwarding contract — adding a console method, changing the level mapping, adding the benign-rejection demotion to the popup (it currently exists only in offscreen), or fixing a bug in the pending-logs flush interplay — must be replayed in four entries with three structurally different logger targets, and the test shim must be kept honest by hand. Offscreen already diverged (try/catch + `isBenignSwDisconnect`); the next divergence will be accidental rather than deliberate.
6. **Smallest safe refactoring**: Extract Function — `installConsoleForwarding(log: (level: LogLevel, ...args: unknown[]) => void, opts?: { onRejection?: (reason: unknown) => boolean })` colocated with `consoleMethods` in `src/wallet/logger/`, where each entry passes its own logger + channel binding and offscreen passes its demotion filter. The vitest alias shim can import the same `consoleMethods` constant instead of re-listing the six method names.
7. **What disappears**: 4 hand-copied hijack blocks collapse to 4 one-line calls; the duplicate method list in `vitest.setup.ts` goes away; the offscreen demotion becomes an explicit, reusable option instead of an inline fork.
8. **Instances**: `packages/extension/src/wallet/index.ts:56-67`, `packages/extension/src/popup/index.ts:6-17`, `packages/extension/src/onboarding/index.ts:13-23`, `packages/extension/src/offscreen/index.ts:21-47`, `packages/extension/tests/vitest.setup.ts:9-14`; loader split: `src/wallet/index.ts:14` vs `src/{popup,offscreen,onboarding}/index.html` script tags.

## F2: Four parallel mappings over `JobError.kind` in journal-state.ts

1. **Title**: Repeated switches over the stringly-typed `JobError.kind` domain.
2. **Smell name**: Repeated Switches (Fowler, Refactoring 2nd ed.) on top of Primitive Obsession — `kind` is an open `string` (`packages/wallet-core/src/jobs/types.ts:82`) whose value set lives only in a doc comment (`types.ts:75-78`).
3. **Impact bucket**: structural (one file, but four independent dispatch sites over one type code). Blast radius: 1 file + its 3 UI consumers (`RecentActivityView`, `activity.vue`, `journal/[id].vue`) + the emit sites in execution/reaper. Change frequency: `journal-state.ts` ×2 in three weeks — this is a live surface (each new failure-classification feature has grown a new mapping).
4. **Evidence**: four sibling dispatches over the same kind values in `packages/extension/src/utils/journal-state.ts`:
   - `journalTerminalDisplay` — `user_rejected` special-case + the interrupted triple `{sw_restart_post_prove, stale_on_resume, stuck_proving}` (lines 105-121)
   - `humanizeErrorKind` — 12-arm switch (lines 164-193)
   - `categoricalLabel` — 11-arm switch over the same values regrouped (lines 217-255)
   - `failedSubtitleFor` — 3-arm switch + fallthrough (lines 258-273)
   The interrupted triple appears twice (lines 115 and 238-243 group the same kinds). `journal-state.test.ts` (498 lines) pins exhaustiveness per function separately.
5. **Why it harms future change**: adding one `JobError.kind` (the doc comment explicitly says "Phase 2+ may add categories") currently means editing 3-4 switches + 2 set-membership checks + per-function test pins, and nothing but reviewer diligence keeps the four surfaces telling a consistent story for the same kind (e.g. a kind classified "interrupted" in the display map but "Stopped before broadcast" in the categorical map is representable today).
6. **Smallest safe refactoring**: Replace Conditional with Lookup Table (the table-driven variant of Replace Conditional with Polymorphism): a single `KIND_META: Record<string, { label; subtitle; categorical: {label; context}; visual: "cancelled"|"interrupted"|"failed" }>` plus one shared default row; the four functions become one-line projections of the table. A union type `KnownJobErrorKind` derived from `keyof typeof KIND_META` gives the exhaustiveness pin for free.
7. **What disappears**: ~90 lines of switch arms collapse to one table; the duplicated interrupted-triple goes away; "add a kind" becomes one row + one emit site; cross-surface inconsistency becomes unrepresentable.
8. **Instances**: `packages/extension/src/utils/journal-state.ts:105-121`, `:164-193`, `:217-255`, `:258-273`; root primitive at `packages/wallet-core/src/jobs/types.ts:73-87`.

## F3: Three divergent JSON-stringify replacers inside wallet-core

1. **Title**: Three bigint/Error-aware stringify variants in one package.
2. **Smell name**: Duplicate Code (Fowler), with Divergent Change pressure — the same concern (safe serialization of hostile/exotic values) evolves independently in three files.
3. **Impact bucket**: structural within `wallet-core`. Blast radius: 3 files + every consumer of `jsonSanitize` (5 sites) and `normalizeError` (journal/execution persistence). Change frequency: dormant (1 commit each) — but these sit under persisted-record and wire formats, where silent divergence is expensive to discover.
4. **Evidence**:
   - `packages/wallet-core/src/utils/serialization.ts:24-57` — `jsonStringify` replacer: bigint → `"123"`, Buffer → base64, Map/Set → arrays, Error → `{name, message, stack?, code?, details?}`.
   - `packages/wallet-core/src/jobs/error.ts:71-77` — `jsonReplacer`: bigint → `"123n"` (different encoding!), Error → `{__error: true, name, message, stack}` (different shape), no Buffer/Map/Set handling.
   - `packages/wallet-core/src/utils/arrays.ts:23-39` — private `safeStringify`: bigint → string, Date → ISO, sorted-key objects, try/catch fallback; no Error/Buffer handling.
   Two of these (serialization, jobs/error) explicitly exist to make values survive `chrome.storage` + the messaging sanitize path — the same survival contract, two encodings.
5. **Why it harms future change**: a fix to one replacer (e.g. "Map values must survive journal persistence" or "bigint round-trip must be reversible") doesn't propagate; a maintainer greps for `jsonStringify`, patches it, and `normalizeError`'s persisted `normalizedRaw` keeps the old behavior. The bigint encodings already disagree (`"123"` vs `"123n"`), so any future "parse it back" feature has to discover which producer wrote the record.
6. **Smallest safe refactoring**: Extract Function — one shared `walletJsonReplacer(opts)` in `utils/serialization.ts` covering bigint/Error/Buffer/Map/Set, consumed by `jsonStringify` and `trySerialize` (jobs/error keeps its truncation + try/catch wrapper, drops its private replacer). `arrays.ts`'s key-derivation stringifier is a different purpose (stable hashing keys, not transport) — either leave it with a comment naming that distinction or fold its scalar arms onto the shared helper.
7. **What disappears**: two of three replacer bodies; the bigint/Error encoding fork; the risk that exotic-value handling improves in one persistence path but not the other.
8. **Instances**: `packages/wallet-core/src/utils/serialization.ts:24-57`, `packages/wallet-core/src/jobs/error.ts:60-77`, `packages/wallet-core/src/utils/arrays.ts:23-39`.

## F4: Build/test config sprawl — duplicated helpers, aliases, define blocks, and an in-place-mutated base config

1. **Title**: Vite/vitest config family kept in sync by comments, with demonstrated drift.
2. **Smell name**: Config Sprawl (community canon) — a form of Shotgun Surgery: one logical knob (alias set, define block, e2e pool policy) is declared in up to 5 files. Secondary: Mutable Data (Fowler 2nd ed.) — the browser wrappers mutate the imported base config object in place.
3. **Impact bucket**: structural at repo-infra level. Blast radius: 8 config files. Change frequency: highest in the cluster's config set — `vitest.e2e.network.config.ts` ×3, `vite.config.ts` ×2.
4. **Evidence**:
   - `resolvePackageFile` copied verbatim: `vite.config.ts:8-17` ↔ `vitest.config.ts:13-22`, the latter carrying a literal "Keep in sync." comment (sync-by-comment).
   - `define` block (`__VERSION__`/`__SENTINEL__`/`__AZTEC_VERSION__`/`__NAME__`/`__DISPLAY_NAME__`): `vite.config.ts:310-316` ↔ `vitest.config.ts:46-52`.
   - Artifact aliases (`@private-fpc-artifact`, `@wonderland-token-artifact`): `vite.config.ts:48-55` ↔ `vitest.config.ts:39-44`.
   - `"@"` alias declared 5×: `vite.config.ts:44`, `vitest.config.ts:38`, `vitest.e2e.config.ts:7`, `vitest.e2e.network.config.ts:7`, `vitest.e2e.all.config.ts:7`.
   - e2e pool policy (`fileParallelism/pool/isolate/retry` + rationale comments): `vitest.e2e.config.ts:21-41` ↔ `vitest.e2e.network.config.ts:29-48`.
   - `server.deps.inline` declared 3× (`vitest.config.ts:73-77`, `vitest.e2e.network.config.ts:51-55`, `vitest.e2e.all.config.ts:27-31`, the last saying "Mirrors vitest.e2e.network.config.ts").
   - **Drift already shipped**: `vitest.e2e.all.config.ts` lacks both the `@aztec/noir-*` nodejs aliases (`vitest.e2e.network.config.ts:17-20`, added specifically to fix `__wbindgen_malloc undefined` on darwin arm64) and `retry: 2` — so the "all" runner regresses on exactly the failure mode the network config documents fixing.
   - Wrapper mutation: `vite.chrome.config.mts:7-18` and `vite.firefox.config.mts:7-18` are 23-line near-identical files (2 strings differ) that `viteConfig.plugins?.push(crx(...))` + assign `outDir` on the **shared imported module object**, then shallow-spread into `defineConfig`. Works today only because each build is a separate process (`package.json` scripts run them via separate `vite build -c` invocations); any future same-process orchestration double-registers the crx plugin.
5. **Why it harms future change**: adding an alias, a define, or an e2e stability knob requires knowing the full sibling list; the `e2e.all` drift shows the failure mode is real, silent, and platform-conditional (bites the next darwin contributor who runs the all-suite). The "Keep in sync" comment is the codebase admitting the coupling without enforcing it.
6. **Smallest safe refactoring**: Extract Function / Move Function into a shared module — e.g. `vite.shared.ts` exporting `resolvePackageFile`, `baseAliases()`, `baseDefine()`, and `e2ePoolPolicy()`; configs compose via vite's `mergeConfig` (the documented mechanism) instead of object spread; browser wrappers become `mergeConfig(baseConfig, { plugins: [crx(...)], build: { outDir } })`, eliminating the in-place mutation.
7. **What disappears**: the verbatim helper copy + its sync comment; 5 declarations of `"@"` collapse to 1; the e2e.all/network drift class (one policy function, three importers); the latent double-crx-registration hazard.
8. **Instances**: `packages/extension/vite.config.ts:8-17,44,48-55,310-316`; `vitest.config.ts:13-22,38-44,46-52,73-77`; `vitest.e2e.config.ts:7,21-41`; `vitest.e2e.network.config.ts:7,17-20,29-48,51-55`; `vitest.e2e.all.config.ts:7,10-31`; `vite.chrome.config.mts:7-22`; `vite.firefox.config.mts:7-22`.

## F5: BIP-39 implementation (2,160 lines, 49% of wallet-core) lives in the generic-utils package, not the crypto package

1. **Title**: `mnemonic.ts` is misplaced crypto-domain code dominating wallet-core.
2. **Smell name**: Misplaced Class / module-level Feature Envy (Lanza & Marinescu's "Misplaced Class" disharmony; Fowler remedy is Move Function / Move Module). Secondary: Large Module bloater — the 2,048-word inline table is 95% of the file.
3. **Impact bucket**: architectural (wrong package for a security-sensitive concern). Blast radius: tiny mechanically (1 importer), large in review-process terms. Change frequency: dormant (1 commit).
4. **Evidence**: `packages/wallet-core/src/utils/mnemonic.ts` is 2,160 lines — the wordlist occupies lines 1-2050, the actual encode/decode logic (`getMnemonic`/`getEntropy`, SHA-256 checksum bit-twiddling) lines 2052-2160. It exports exactly two functions, consumed by exactly one file: `packages/extension/src/wallet/services/profile/service.ts:12,610,736`. Meanwhile `packages/wallet-crypto/src/index.ts`'s header declares that package the home of "security-critical derivation chains" locked by the key-vector tests (`packages/extension/src/wallet/crypto/key-vectors.test.ts`) — and BIP-39 entropy↔mnemonic conversion is precisely such a chain, yet sits outside that audit boundary in the "pure utilities" barrel next to `sleep` and `arrays`.
5. **Why it harms future change**: anyone auditing or hardening the wallet's key-material paths starts from wallet-crypto (its README says so) and misses the mnemonic codec; conversely wallet-core presents itself as the "Aztec-free, Chrome-free kernel" of generic utilities, so a contributor has no reason to apply crypto-review rigor to edits there. The wordlist also dominates wallet-core's LOC stats and grep surface (any package-wide search wades through 2,048 words).
6. **Smallest safe refactoring**: Move Module — relocate `mnemonic.ts` to `packages/wallet-crypto/src/` (layer-legal: wallet-crypto already depends on wallet-core; the single importer `profile/service.ts` already imports from `@nulo/wallet-crypto`). While moving, Extract Class/data-module: split the wordlist into `bip39-wordlist.ts` so the ~110 lines of logic are reviewable on their own.
7. **What disappears**: the crypto/utils boundary violation (one review surface for all key-derivation code, under the key-vector lock regime); the 2k-line grep/diff noise wad inside the logic file.
8. **Instances**: `packages/wallet-core/src/utils/mnemonic.ts:1-2160`, re-exported via `packages/wallet-core/src/utils/index.ts:5`; sole consumer `packages/extension/src/wallet/services/profile/service.ts:12,610,736`.

## F6: Dead exports across wallet-core/wallet-crypto, plus a dead dependency

1. **Title**: Dead public surface in the two foundation packages.
2. **Smell name**: Dead Code + Speculative Generality (Fowler). The unused `@aztec/stdlib` dependency is the dependency-level analog (depcheck/knip canon: "unused dependency").
3. **Impact bucket**: local, many instances. Blast radius: 8 files. Change frequency: dormant. Note: the extension's auto-import registry covers only `src/{composables,stores,utils,onboarding/composables,components}` (`packages/extension/vite.config.ts:162,175`) — none of these symbols live there, so no reflective registration can be consuming them; grep across all five packages confirms zero external references.
4. **Evidence** (each grep-verified across `packages/`):
   - `packages/wallet-core/src/utils/random.ts:18` — `getRandomElement`: no reference outside its own file.
   - `packages/wallet-core/src/utils/event-handler.ts:1-4` — `IEventHandler`: only use is the `implements` clause in the same file.
   - `packages/wallet-core/src/utils/queue.ts:47-55` — `Queue.dequeueBatch`: zero callers.
   - `packages/wallet-core/src/storage/entity_storage.ts:62-78,80-82,137-142` — `getVersion`/`setVersion`/`findByPredicate`: zero callers outside the class + its own test. Bonus: `getVersion` carries an inline near-verbatim copy of `parseOrDelete`'s log+delete block (lines 65-77 vs 48-59) — deleting the dead method also deletes the file's only duplication.
   - `packages/wallet-core/src/jobs/index.ts:3,10` — `TERMINAL_STAGES` and `canTransition` re-exports: consumers use only `isTerminal`/`assertCanTransition` (grep over extension/aztec-runtime/wallet-bridge shows no other importer).
   - `packages/wallet-core/src/base/index.ts:33-34` — `topologicalPhases`, `DependencyCycleError`, `UnknownDependencyError`, `ServiceNode` re-exports: zero importers outside wallet-core.
   - `packages/wallet-crypto/src/index.ts:19` — `ENCRYPTION_GUARD`, `EncryptedProfileSecret`, `Sealed` package-level exports: zero external importers (the package's own test imports from `./password-secret-box` directly, `password-secret-box.test.ts:10`). Aggravating: the one place that *should* consume `EncryptedProfileSecret` — `packages/extension/src/wallet/services/profile/spec.ts:20-24` — instead re-declares `{ guard: string; secret: string }` structurally, so the frozen storage shape now exists in two unconnected declarations.
   - `packages/wallet-crypto/package.json:15` — `"@aztec/stdlib": "4.2.0"` declared, never imported (`grep 'from "@aztec' packages/wallet-crypto/src` → only `@aztec/foundation`).
5. **Why it harms future change**: dead surface advertises contracts nobody holds — `getVersion`/`setVersion` imply a versioning scheme EntityStorage doesn't have (the migration system lives elsewhere), inviting a future caller down a stale path; the dead dep forces `@aztec/stdlib` through every exact-pin Aztec bump and install for nothing; the structurally-duplicated `EncryptedProfileSecret` means a (migration-requiring) shape change would type-check cleanly while the spec drifts.
6. **Smallest safe refactoring**: Remove Dead Code (per symbol) + drop the dependency; for the profile spec, Replace Inline Type with the imported `EncryptedProfileSecret` (`type Profile = ProfileInfo & ({ type: "password" } & EncryptedProfileSecret | ...)`).
7. **What disappears**: ~80 lines of unreferenced API + one supply-chain edge + the duplicated frozen-shape declaration + `getVersion`'s duplicated parse-failure block.
8. **Instances**: `packages/wallet-core/src/utils/random.ts:18`; `utils/event-handler.ts:1-4`; `utils/queue.ts:47-55`; `storage/entity_storage.ts:62-82,137-142`; `jobs/index.ts:3,10`; `base/index.ts:33-34`; `packages/wallet-crypto/src/index.ts:19`; `packages/wallet-crypto/package.json:15`; `packages/extension/src/wallet/services/profile/spec.ts:20-24`.

## F7: Two token-amount formatting vocabularies coexist in amount.ts — float-legacy and bigint-modern

1. **Title**: Legacy float-based formatters (`comma`/`purgeNumber`/`normalizeAmount`) alongside the bigint pipeline they were superseded by.
2. **Smell name**: Duplicate Code with Divergent Change (Fowler) — one display concern (token amounts), two independently evolving implementations; plus a shared magic regex.
3. **Impact bucket**: structural. Blast radius: `amount.ts` + 2 legacy consumers (`AmountCard.vue`, `SelectBalanceTypePopup.vue`) vs 12+ modern consumers of `balanceFormatted`/`formatBaseUnits`. Change frequency: amount.ts itself dormant, but its consumers (balance/send surfaces) are among the most-touched UI.
4. **Evidence**: `packages/extension/src/utils/amount.ts` lines 11-60 contain the float vocabulary: `comma` (Number.parseFloat → toFixed → manual zero-stripping), `purgeNumber`, `normalizeAmount`. Lines 80-278 contain the bigint vocabulary (`balanceFormatted`, `clampDecimals`, `parseAmountToBaseUnits`, `formatBaseUnits`) whose docstrings explicitly exist to avoid "float math … precision-loss footgun". The thousands-separator regex `/\B(?=(\d{3})+(?!\d))/g` is pasted three times (lines 35, 38, 273). Live consumers of the float path: `src/components/composite/send/AmountCard.vue:33,39,88,91,105,153` (the send amount input!) and `src/popup/components/popups/SelectBalanceTypePopup.vue:131,153` (`comma(option.token?.balance)` — feeding a raw balance into parseFloat). Everything else uses the bigint path (19 `balanceFormatted` call sites). Related specifier hazard: all `balanceFormatted` imports use the suffixed `"@/utils/amount.js"` specifier and `IncomingTrustPopup.test.ts:61` mocks that exact string — a future normalization to `"@/utils/amount"` silently un-applies the mock (test-brittleness analog).
5. **Why it harms future change**: any display-rule change (separator behavior, truncation policy, locale handling) must be implemented twice in two incompatible models; the float path silently corrupts ≥2^53 base-unit balances, so consolidating later means re-validating user-facing send/balance surfaces; new code keeps a coin-flip chance of importing the wrong vocabulary since both live in the same module with similar names.
6. **Smallest safe refactoring**: Migrate the two legacy consumers onto `formatBaseUnits`/`clampDecimals`/`parseAmountToBaseUnits` (Substitute Algorithm at the call sites), then Remove Dead Code for `comma`/`purgeNumber`/`normalizeAmount`. Until then, Extract Function for the thousands-regex so the rule exists once.
7. **What disappears**: the entire float formatting model (50 lines), the tripled regex, and the "which formatter do I use" ambiguity in the send flow.
8. **Instances**: `packages/extension/src/utils/amount.ts:11-60,35,38,273`; `packages/extension/src/components/composite/send/AmountCard.vue:33,39,88,91,105,153`; `packages/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:131,153`; mock-specifier coupling `packages/extension/src/popup/components/popups/IncomingTrustPopup.test.ts:61`.

## F8: e2e fixture `extension.ts` mixes four concerns and triplicates the test password

1. **Title**: 1,249-line fixture module owning lifecycle, vitest fixtures, retry machinery, AND the generic DOM helpers.
2. **Smell name**: Large Class / Divergent Change (Fowler) for the module; Magic Literal duplication (Replace Magic Literal) for the password. (In-scope per cluster: harness duplication.)
3. **Impact bucket**: structural (test harness). Blast radius: all 68 e2e files import from it. Change frequency: **highest in this cluster** — `tests/e2e/fixtures/extension.ts` ×7 in the visible history.
4. **Evidence**: `packages/extension/tests/e2e/fixtures/extension.ts` contains: extension launch + onboarding + register + playground-connect lifecycle (`:18-244`), the `test.extend` fixture graph (`:246+`), popup-open retry/detach machinery (`:900-1086`), and the generic DOM primitives `waitForHash`/`typeIntoInput`/`clickButtonByText`/`replaceInputValue`/`clickSelector`/`clickByTestId` (`:1088-1236`). Meanwhile `helpers.ts` — the designated UI-flow-helper module which hosts the selector-contract doc (`helpers.ts:1-18`) — has to import its DOM primitives back out of the launcher file (`helpers.ts:2`). The canonical test password exists three times: `helpers.ts:20` (`TEST_PASSWORD`, not exported), `extension.ts:170` (local `testPassword` literal), `extension.ts:808` (inline literal in a fixture).
5. **Why it harms future change**: edits to selector/click semantics (the churniest harness concern — 7 changes) land in the same hot file as launch/fixture changes, maximizing merge conflicts between parallel e2e efforts; the un-exported password constant means a password-policy change in the onboarding flow is a 3-site hunt where missing one produces a confusing mid-suite auth failure rather than a compile error.
6. **Smallest safe refactoring**: Extract Module — move the six DOM primitives to a `fixtures/dom.ts` (or into `helpers.ts` beside the selector contract) and export `TEST_PASSWORD` from one place (Replace Magic Literal); `extension.ts` keeps lifecycle + `test.extend`.
7. **What disappears**: the helpers→launcher inverted dependency for DOM primitives; the 3-site password literal; the single-file contention point for unrelated harness changes.
8. **Instances**: `packages/extension/tests/e2e/fixtures/extension.ts:170,808,1088-1236`; `packages/extension/tests/e2e/fixtures/helpers.ts:2,20`.

## F9: `src/setup/` is a dead build entry still shipped in every bundle

1. **Title**: Placeholder `setup` entry built into dist with zero references.
2. **Smell name**: Dead Code (Fowler) — at the build-graph level.
3. **Impact bucket**: local. Blast radius: 4 source files + 2 config lines + shipped artifact. Change frequency: zero since 2026-05-20.
4. **Evidence**: `packages/extension/vite.config.ts:298` lists `setup: "src/setup/index.html"` as a rollup input and `:134-136` registers a pages dir `src/setup/pages` **that does not exist on disk** (`src/setup/` contains only `app.vue`, `index.html`, `index.scss`, `index.ts`). Repo-wide grep for `setup/index` / `setup.html` finds no manifest entry, no `chrome.tabs.create`, no router link, no test — the only mention is `src/onboarding/index.ts:3`'s docstring warning readers NOT to confuse onboarding with it ("NOT setup/index.ts which is a placeholder with no stores"). So a whole Vue app entry (with its own router over `~pages`) is compiled, bundled, and shipped in both browser zips with no way to reach it.
5. **Why it harms future change**: every reader of the entry-point list (and every security reviewer enumerating extension surfaces) must rediscover that one of the four HTML entries is inert — the onboarding docstring proves this confusion already cost someone a clarifying comment; it also inflates the bundle and the auto-routed page namespace (`baseRoute: "setup"`) for nothing.
6. **Smallest safe refactoring**: Remove Dead Code — delete `src/setup/` and the two vite.config.ts references (input at `:298`, pages dir at `:134-136`).
7. **What disappears**: one phantom entry point from the build, the nonexistent pages-dir registration, and the standing "which entry is real?" confusion.
8. **Instances**: `packages/extension/src/setup/{index.html,index.ts,app.vue,index.scss}`; `packages/extension/vite.config.ts:134-136,294-301`.

## F10: `general.js` — untyped JS with a hand-maintained parallel `.d.ts` in a strict-TS repo

1. **Title**: Last remaining `.js` util with duplicate hand-written type declarations.
2. **Smell name**: Duplicate Code across artifact pair (implementation + hand-maintained declaration must co-evolve) — a miniature Shotgun Surgery: one signature change requires two uncoordinated edits with no compiler check linking them.
3. **Impact bucket**: local. Blast radius: 2 files + 3 consumers. Change frequency: dormant.
4. **Evidence**: `packages/extension/src/utils/general.js` (26 lines: `isPrefersDarkScheme`, `debounce`, `ensurePermissions`) is the only `.js` module in `src/utils`; `general.d.ts` (5 lines) hand-declares its signatures. Nothing verifies they agree — e.g. the `.d.ts` constrains `debounce` to `(...args: unknown[]) => unknown` while the `.js` body has no such constraint, and a body change (say, adding a `leading` option) type-checks consumers against the stale declaration. Consumers exist via auto-import (`app.vue:28,54`, `settings/security/index.vue:112`, `useContactImportExport.ts:43`), so the pair is production-wired.
5. **Why it harms future change**: any signature evolution is silently unchecked — the declaration file *asserts* rather than derives types, which is exactly the failure class `strict` TS exists to remove; new contributors must learn the one-file exception to the repo's TypeScript-everywhere rule.
6. **Smallest safe refactoring**: Change Function Declaration via file conversion — rename `general.js` → `general.ts`, type the three functions inline, delete `general.d.ts`. (Optionally Move Function: `debounce` is a pure timer helper whose natural home is `wallet-core/utils` per the repo's layering, but the conversion alone removes the duplication.)
7. **What disappears**: the unverified parallel declaration; the only untyped module in the utils layer; the silent-drift channel between implementation and types.
8. **Instances**: `packages/extension/src/utils/general.js:1-26`, `packages/extension/src/utils/general.d.ts:1-5`.

## Non-findings

- **`lastActiveProfile.ts` vs `core.ts` sentinel helpers** — both are one-key `chrome.storage.local` wrappers (`core.ts:141-149`, `lastActiveProfile.ts:7-14`), but 4 lines each over different keys/concerns; an extraction would add indirection without reducing change amplification.
- **`Lock` vs extension `execution-mutex`** — divergence (timeout/force-release) is documented as deliberate; different semantics, not duplication.
- **`sleep.ts` vs `SystemClock.sleep`** — the adapter *implements* `ClockPort`; inlining the one-liner is the point of a port implementation.
- **`fee-estimation.ts` vs `amount.ts`** — fee-estimation properly delegates to `formatBaseUnits`; half-up (costs) vs truncate (balances) is a documented domain distinction, not a duplicate vocabulary.
- **Manifest ×3** — base + thin chrome/firefox overlays with an explicit incompatible-permissions filter; correct shape, no sprawl.
- **`tx-enrichment.ts:6` re-export of `primary-method` symbols** — two import paths for `FEE_METHODS`/`pickPrimaryMethod`, but the split is a documented layering bridge (wallet services must not import popup-utils' dependency surface; `primary-method.ts:8-11`) and is pinned by tests; cost is one grep hop. Considered Middle Man, rejected as paying its way.
- **`popup/index.ts:68-76`** — two adjacent auth-guard branches with identical outcomes (`isSessionChecked` true/false both route to `popup-auth`); a one-line Consolidate Conditional, cosmetic only.
- **`agent.sh` three grep-assertion blocks** — same shape ×3 but each asserts a distinct propagation contract with distinct messaging; bash-function extraction saves almost nothing.
- **`getErrorMessage`/`getErrorData` vs extension-messaging `WalletError` round-trip** — the cross-layer split is real but its weight sits in `extension-messaging` (cluster C5); within C6 the helpers are single-sourced with 25 healthy import sites.
- **`console.d.ts` hand-written shim** — declares the `console._<method>` aliases the sniffer installs; unlike F10 it types a runtime augmentation that has no `.ts` source to derive from.
- **VITE_* env reads at 5 point-of-use sites** — considered config sprawl; rejected: each var is read once at its owning module and the propagation contract is mechanically enforced by `agent.sh`'s bundle greps, so there's no duplication, only distribution.
- **`files.ts` (277 LOC)** — cohesive single-concern module (download + compression); long but not bloated; no duplication found.
- **`entity_storage.getAll` vs `getValues`** — near-twin loops, but `getValues` delegating to `getAll` costs tuple allocations on the hottest storage read; rejected as not clearly cheaper to maintain than the 8 duplicated lines.

## Out-of-scope observations

- `utils/core.ts:109-127` — `refreshBalances` ignores its `_minutes` parameter and hardcodes `30`, while the only caller (`popup/pages/auth.vue:108`) passes `10`; behavior mismatch + dead parameter.
- `wallet-core/utils/mnemonic.ts` is a hand-rolled BIP-39 implementation rather than a battle-tested library (`@scure/bip39` et al.) — security-policy concern, flagged for the security track.
- `wallet-crypto/README.md` factual drift: claims "250k iterations" vs `PBKDF2_ITERATIONS = 600_000` (`encryption-key.ts:2`), and documents a `recoverFromCredentialData()` that doesn't exist in `passkey-credential.ts`.
- `AmountCard.vue:91` hardcodes a USD rate (`* 3.4`) — display-correctness concern.
- `amount.ts:46-60` — `normalizeAmount` falls through to `undefined` for ordinary valid inputs (no terminal return); surprising contract for consumers.
- `utils/core.ts:44-50,73-79` — `AppServices` typed always-populated but `network`/`transaction`/`account` are `null as unknown as T` until unlock; documented as deferred tightening, trust-boundary adjacent.
- `vitest.e2e.all.config.ts` missing the noir nodejs aliases means the "all" e2e suite likely fails on darwin arm64 (`__wbindgen_malloc`) — correctness-of-tooling, captured structurally in F4.
