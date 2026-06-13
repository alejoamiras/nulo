## F1: Entry log bootstrap is copy-pasted across four runtimes
1. Title: Entry log bootstrap is copy-pasted across four runtimes.
2. Smell name: Duplicate Code.
3. Maintenance impact: structural; blast radius is 4 entrypoints (`wallet`, `popup`, `offscreen`, `onboarding`); 3-month history shows these files are active enough to matter (`wallet/index.ts` 2 edits, `offscreen/index.ts` 2, `popup/index.ts` 1, `onboarding/index.ts` 1).
4. Concrete evidence: each entrypoint builds a logger, loops `consoleMethods`, assigns `self["on<method>"]`, and wires `self.onunhandledrejection` locally: `packages/extension/src/wallet/index.ts:49-67`, `packages/extension/src/popup/index.ts:1-17`, `packages/extension/src/offscreen/index.ts:20-47`, `packages/extension/src/onboarding/index.ts:8-23`. `offscreen` adds one special-case branch, but it is layered on top of the same bootstrap skeleton.
5. Why it harms future change: any change to console forwarding, rejection normalization, log domains, or the method set requires synchronized edits in four different runtime shells, so one context can drift even when the intended policy is global.
6. Smallest safe refactoring: Extract Function, e.g. a shared `installRuntimeConsoleForwarding({ logger, logDomain, unhandledRejectionPolicy })`.
7. What disappears: the repeated console loop, repeated rejection handler setup, and the need to remember four bootstraps for one logging-policy change.
8. Instances: `packages/extension/src/wallet/index.ts:49-67`, `packages/extension/src/popup/index.ts:1-17`, `packages/extension/src/offscreen/index.ts:20-47`, `packages/extension/src/onboarding/index.ts:8-23`.

## F2: Vite and unit-Vitest keep hand-copied config fragments
1. Title: Vite and unit-Vitest keep hand-copied config fragments.
2. Smell name: Duplicate Code.
3. Maintenance impact: structural; blast radius is 2 top-level config entrypoints; 3-month history shows `vite.config.ts` changed 2 times and `vitest.config.ts` 1 time, so drift risk is real even with low churn.
4. Concrete evidence: `resolvePackageFile` is duplicated line-for-line in `packages/extension/vite.config.ts:8-17` and `packages/extension/vitest.config.ts:13-22`; the same alias responsibilities are duplicated in `vite.config.ts:44-55` and `vitest.config.ts:37-44`; the same package metadata defines (`__VERSION__`, `__SENTINEL__`, `__AZTEC_VERSION__`, `__NAME__`, `__DISPLAY_NAME__`) are duplicated in `vite.config.ts:310-315` and `vitest.config.ts:46-51`. The Vitest file even carries a literal “Keep in sync” comment at `vitest.config.ts:9-12`.
5. Why it harms future change: changing one artifact alias, adding one build-time metadata constant, or adjusting package-file resolution requires touching both build and test config by hand, with comments rather than code enforcing consistency.
6. Smallest safe refactoring: Move Function / Extract Function into a shared config helper module that returns common aliases, defines, and `resolvePackageFile`.
7. What disappears: the “keep in sync” comment, the duplicated alias/define blocks, and the two-file edit burden for one tooling change.
8. Instances: `packages/extension/vite.config.ts:8-17`, `packages/extension/vitest.config.ts:13-22`, `packages/extension/vite.config.ts:44-55`, `packages/extension/vitest.config.ts:37-44`, `packages/extension/vite.config.ts:310-315`, `packages/extension/vitest.config.ts:46-51`.

## F3: E2E Vitest settings are spread across near-clone configs
1. Title: E2E Vitest settings are spread across near-clone configs.
2. Smell name: Config Sprawl; this is a close analog of Shotgun Surgery because one e2e-runner policy change now requires synchronized edits across multiple config files rather than one source of truth.
3. Maintenance impact: architectural; blast radius is 3 e2e config entrypoints; 3-month history shows each of `vitest.e2e.config.ts`, `vitest.e2e.all.config.ts`, and `vitest.e2e.network.config.ts` changed recently enough to indicate active tuning.
4. Concrete evidence: all three repeat `resolve.alias["@"]` (`packages/extension/vitest.e2e.config.ts:5-8`, `packages/extension/vitest.e2e.all.config.ts:5-8`, `packages/extension/vitest.e2e.network.config.ts:5-21`); all three repeat the same node-runner shape (`environment: "node"`, `fileParallelism: false`) at `vitest.e2e.config.ts:13-21`, `vitest.e2e.all.config.ts:12-19`, `vitest.e2e.network.config.ts:25-29`; two repeat the same isolation/retry policy (`pool: "forks"`, `isolate: true`, `retry: 2`) at `vitest.e2e.config.ts:33-41` and `vitest.e2e.network.config.ts:39-48`; two repeat the same Aztec inlining workaround at `vitest.e2e.all.config.ts:27-31` and `vitest.e2e.network.config.ts:51-54`.
5. Why it harms future change: adjusting retry policy, worker isolation, dependency inlining, or path aliases means diffing three files and deciding which copies must move together; that is fragile in exactly the area that already needs frequent CI-tuning.
6. Smallest safe refactoring: Extract Function with parameters, e.g. `makeE2eVitestConfig({ include, exclude, globalSetup, needsAztecInlining, retryPolicy })`.
7. What disappears: repeated runner boilerplate, repeated rationale comments, and manual synchronization across smoke/all/network configs.
8. Instances: `packages/extension/vitest.e2e.config.ts:5-41`, `packages/extension/vitest.e2e.all.config.ts:5-31`, `packages/extension/vitest.e2e.network.config.ts:5-54`.

## F4: Browser wrappers mutate a shared imported Vite config
1. Title: Browser wrappers mutate a shared imported Vite config.
2. Smell name: Temporal Coupling; this is the prompt’s named async/ordering analog, and here the coupling is that wrapper correctness depends on mutating a shared config object in the right sequence rather than producing a fresh config per target.
3. Maintenance impact: structural; blast radius is 2 browser-wrapper configs plus the base config object they both mutate; 3-month history shows `vite.config.ts` changed 2 times and each wrapper changed once.
4. Concrete evidence: both wrappers import the same `viteConfig` object from `./vite.config`, then mutate `plugins` and `build.outDir` in place before exporting: `packages/extension/vite.chrome.config.mts:5-21` and `packages/extension/vite.firefox.config.mts:5-21`.
5. Why it harms future change: adding another wrapper, reusing the base config in a script, or changing wrapper-specific plugins requires reasoning about object lifetime and mutation order, not just declarative config shape. The side effect is hidden state, not explicit composition.
6. Smallest safe refactoring: Extract Function / Encapsulate Variable into a pure `createBrowserViteConfig({ manifest, browser, outDir })` that clones shared fragments and returns a fresh object.
7. What disappears: shared mutable config state and the order-sensitive `push`/assignment side effects.
8. Instances: `packages/extension/vite.chrome.config.mts:5-21`, `packages/extension/vite.firefox.config.mts:5-21`.

## F5: Capability fixtures clone the same setup and grant choreography
1. Title: Capability fixtures clone the same setup and grant choreography.
2. Smell name: Duplicate Code.
3. Maintenance impact: structural; blast radius is one large harness file but across 4 fixture variants and 3 capability-grant branches; change frequency is high for the cluster because `packages/extension/tests/e2e/fixtures/extension.ts` is the hottest scoped file in the last 3 months at 7 edits.
4. Concrete evidence: the same `phase` wrapper appears at `packages/extension/tests/e2e/fixtures/extension.ts:383-390`, `407-414`, `468-475`, `524-530`; the same setup ladder `launchExtension → registerProfile → openPopup → waitForHashGeneral → switchToLocalNetwork → connectPlayground` appears at `391-399`, `415-421`, `476-482`, `532-538`; the capability-grant flow is then cloned again at `429-457`, `490-513`, `547-570`. The file’s own comment says to refactor once there are “three or more” such fixtures at `282-296`, and there are now three specialized cap-grant fixtures.
5. Why it harms future change: any change to playground setup, popup timing, account selection, or capability approval semantics now requires edits across several fixture branches in the most frequently touched harness file, which is exactly where drift becomes expensive.
6. Smallest safe refactoring: Extract Method / Template Method analog, e.g. shared `withConnectedPlayground()` plus `grantCapabilities({ bundle, accountSelection })`.
7. What disappears: the repeated phase wrapper, repeated browser/setup ladder, repeated popup-grant choreography, and the stale “duplicate until three” exception.
8. Instances: `packages/extension/tests/e2e/fixtures/extension.ts:282-296`, `383-390`, `391-399`, `407-414`, `415-421`, `429-457`, `468-475`, `476-482`, `490-513`, `524-530`, `532-538`, `547-570`.

## F6: wallet-core splits one serialization policy across three helpers
1. Title: wallet-core splits one serialization policy across three helpers.
2. Smell name: Divergent Change; changing one concern, “how core safely serializes arbitrary values,” requires edits in multiple unrelated modules.
3. Maintenance impact: structural; blast radius is 3 wallet-core modules; 3-month history shows `arrays.ts`, `serialization.ts`, and `jobs/error.ts` each changed in the available history, so this is live code, not archival dead weight.
4. Concrete evidence: `packages/wallet-core/src/utils/arrays.ts:23-39` defines `safeStringify` for arbitrary key values, `packages/wallet-core/src/utils/serialization.ts:24-57` defines `jsonStringify` for Buffers/Maps/Sets/Errors/BigInt, and `packages/wallet-core/src/jobs/error.ts:60-77` adds yet another safe-serialization path for job errors. BigInt handling is repeated in all three (`arrays.ts:27-29`, `serialization.ts:26-27`, `jobs/error.ts:71-72`), while Error/unknown-value formatting is separately reimplemented in `serialization.ts:36-52` and `jobs/error.ts:52-77`.
5. Why it harms future change: if the package needs a new rule for Error objects, BigInt text, deterministic object ordering, or unsupported values, maintainers must discover and reconcile multiple serializers whose behavior already differs by accident and by context.
6. Smallest safe refactoring: Move Function / Extract Function into one shared serializer policy module, then layer only local concerns such as truncation on top.
7. What disappears: repeated BigInt/Error handling, ad hoc safe-stringify logic, and the need to audit three modules for one serialization-policy change.
8. Instances: `packages/wallet-core/src/utils/arrays.ts:23-39`, `packages/wallet-core/src/utils/serialization.ts:24-57`, `packages/wallet-core/src/jobs/error.ts:52-77`.

## F7: EntityStorage duplicates malformed-payload cleanup logic
1. Title: EntityStorage duplicates malformed-payload cleanup logic.
2. Smell name: Duplicate Code.
3. Maintenance impact: local; blast radius is one class, but on two separate recovery paths inside its core API; 3-month history shows `packages/wallet-core/src/storage/entity_storage.ts` changed recently enough to count as maintained code.
4. Concrete evidence: the `parseOrDelete` catch block at `packages/wallet-core/src/storage/entity_storage.ts:47-59` and the `getVersion` catch block at `65-77` both compute a preview, format an error message, log a “dropping malformed …” line, asynchronously remove the bad key, and log removal failure. The only real variation is whether the subject is a row or the version key.
5. Why it harms future change: if malformed-storage policy changes, for example preview length, delete behavior, log wording, or follow-up telemetry, maintainers must remember to update two recovery branches that are easy to miss in ordinary test coverage.
6. Smallest safe refactoring: Extract Method, e.g. a shared malformed-entry handler reused by both `parseOrDelete` and `getVersion`.
7. What disappears: duplicated recovery boilerplate and duplicated malformed-key logging templates.
8. Instances: `packages/wallet-core/src/storage/entity_storage.ts:47-59`, `packages/wallet-core/src/storage/entity_storage.ts:65-77`.

## Non-findings
- `packages/wallet-core/src/utils/mnemonic.ts` is very large, but almost all of the size is static BIP-39 data; I did not find a second concrete change amplifier beyond file length itself.
- `packages/extension/src/utils/general.js` plus `general.d.ts` is awkward, but it is only three helpers and I did not find actual cross-file drift or repeated downstream adaptations in scoped files.
- `packages/extension/src/setup/*` is explicitly wired into `packages/extension/vite.config.ts:295-300`, so it is not dead code.
- `packages/extension/src/utils/journal-state.ts`, `card-subtitle.ts`, and `activity-rows.ts` already look like successful extractions from prior UI duplication rather than fresh smells in this cluster.
- `packages/extension/src/content-script/content.ts` is a thin adapter around the wallet-sdk handler; I did not find an in-scope maintainability smell strong enough to clear the prompt bar.

## Out-of-scope observations
- `packages/wallet-core/src/storage/value-storage.ts:18-23` does not perform the malformed-JSON self-healing that `EntityStorage` does; that is a resilience/correctness difference, not a quality-smell finding.
- `packages/extension/scripts/e2e/resolve-ports.ts:18-25` intentionally accepts a build-to-spawn port race and relies on later revalidation; that is an operational correctness tradeoff, not a maintainability finding.