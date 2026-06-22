# Independent verification — Q9-Q16 (verifier B)

Method: anti-anchoring protocol — instances read first, source opened and judged before claim text; every cited instance checked; auto-import coverage checked for dead-code claims.

## Q9 — CONFIRMED (high)

Pre-read: only `contact` (service.ts:19) and `incoming-transfer` (service.ts:68-75) declare `dependencies`; everyone else leans on per-method `await this.ensureInitialized()` backed by a 500ms-poll/30s-timeout loop (`extension-messaging/src/background/service.ts:187-199`). `ServiceCollection.start()` (`wallet-core/src/base/index.ts:54-70`) already provides topological phases.

Claim check: all four anchor instances exhibit. Preamble counts reproduced exactly by grep: profile 24, network 17, fpc 9, contact 8, account 7, token 7, auth-registry 4, dapp-session 3, transaction 2, config 0 (denominators not re-derived; not load-bearing). Temporal coupling + per-method drift is real — config has zero preambles. "21 services" is approximate (24 service dirs); immaterial. Refactoring (gate at dispatch boundary) is behavior-preserving; no parity constraint touched.

## Q10 — CONFIRMED (high)

Pre-read: `runtime.ts:105-130` comment literally states "Services migrated to ports accept `browserApi`; remaining services still reach into `chrome.*` directly until their migration lands." Three fallback seams (contact ctor, profile repository ctor, session-manager) all do the `browserApi ? ... : chrome.storage.*` ternary.

Claim check: every cited hard-coded-storage site verified (account:23, token:42, transaction:36, network:143/687/752/758, fpc:43, auth-registry:29-30, dapp-session:29) and all eight `new PxeServiceClient(...)` sites verified (token:57, transaction:52, network:163, fpc:60, note:46, execution:342, token-balance:67, account-state:36). Acknowledged in-flight migration, but the change-amplification cost is measurable, so the "pre-existing pattern" exclusion doesn't apply. Honest "Potential architectural"/disagreement labeling. No non-exhibiting instances.

## Q11 — CONFIRMED (high)

Pre-read: dispatcher.ts is 1,011 lines; class spans ~207-1011 (~805 lines). Method map shows routing (`dispatch`), grant flows (`handleRequestCapabilities`, `enrichGrantedCapabilities`), capability enforcement, operation building (`buildOperation`/`buildNetworkOperation`/`buildAccountOperation`), and account resolution all co-located.

Claim check: all five session-account resolution sites (347-358, 494-497, 599-600, 721-747, 989-997) exhibit the same `resolveNetwork → getAccounts(profileId, chainId) → getSessionAccountAddresses → filter/project` pipeline; 721-747 reimplements `formatSessionAccounts`'s caip/alias projection inline rather than calling it. Minor imprecision: "1011-line class" is the file length. Refactoring caution: `formatSessionAccounts` comment pins wire-format parity via dispatcher unit tests, and `dispatcher.test.ts` pins the three-copy `nulo-schema-patch` shape — internal extraction must preserve both; neither blocks the proposed refactor.

## Q12 — CONFIRMED (high)

Pre-read: `fixtures/extension.ts` (1,249 lines) has four identical inline `const phase = async ...` wrappers (383, 407, 468, 524), four repetitions of the launch→registerProfile→openPopup→waitForHash→switchToLocalNetwork→connectPlayground ladder, and three near-identical cap-grant choreographies (approveCapabilities at 454, 510, 567). `openOnboarding` (104-137) and `openPopupOnce` (997-1018) duplicate the newPage/patchPagePolling/viewport/bringToFront/console-collector bootstrap. `helpers.ts:2` imports generic DOM helpers back from the launcher file; `helpers.ts:20` `TEST_PASSWORD` is unexported and re-declared in at least four test files.

Claim check: all instances exhibit. Scope: explicitly in-cluster ("fixtures/{extension,helpers}.ts (harness duplication only)" — clusters.md:30), so the test-code exclusion is satisfied. The in-file comment documenting intentional duplication sets a "refactor once we have three or more such fixtures" threshold — now met (3 cap-grant fixtures), so the finding aligns with, not violates, the documented constraint.

## Q13 — CONFIRMED (high)

Pre-read: `spec.ts` `Methods` = 21 methods (counted); `IPXE` (ipxe.ts:27-50) = 18, omitting getNoteSchemas/getBlockTimestamp/clearChainState; `PXEProxy` (proxy.ts:32-102) hand-writes the same 18 network-currying delegations; `PxeServiceClientBase` (client.ts:72+) restates each method with per-method zod parsing; extension `pxe/client.ts:24` is the documented re-export shim.

Claim check: exactly as claimed — manual subset, no mapped-type derivation, no drift-pinning test. IPXE is Nulo-owned (header doc), not a verbatim upstream-interface mirror, so deriving it from `Methods` violates no upstream-mirror constraint; only the behavioral "mirrors upstream BaseWallet.simulateTx" comment exists. Caveat for the proposed refactor: a mapped type must drop the `network` param and promisify, and client.ts's per-method zod response validation can't be fully generated — partial mechanization only.

## Q14 — ADJUSTED (high)

Pre-read: a try/persist/catch→`push({...entity, restoreError})` accumulation loop recurs across restore() implementations, with drift: contact stores raw `err` (contact:308-310) while peers normalize to `.message`; lock usage inconsistent (transaction/account/config lockless).

Claim check, two adjustments. (1) `profile/service.ts:830-975` does NOT exhibit the loop — it's a single-entity restore (returns `Restored<ProfileInfo>`, not an array loop); it shares only the `restoreError` catch shape. (2) Two missed instances that DO exhibit the exact loop: `account-state/service.ts:183-240` (twice, nested for senders/contracts) and `token-balance/service.ts:256-272`. So the family is 10 loop sites + 1 profile variant, not "nine services" as titled. Other eight cited instances verified verbatim. Root cause and proposed `restoreEntities` extraction stand; service-specific logic (id reallocation, schema validation, dedup) stays as hooks as proposed.

## Q15 — CONFIRMED (high)

Pre-read: load-all→filter(profileId/chainId)→delete→emit purge loops recur per service for both `clearChainState` and `onProfileDeleted`/`onAccountDeleted` listeners.

Claim check: all 11 cited sites verified and exhibit. Inconsistent lock discipline confirmed: account/token/transaction purge with no lock; contact/fpc/dapp-session/auth-registry/network take `this.lock`. Intra-file strategy divergence confirmed: token's `clearChainState` inline-deletes+emits while its `onProfileDeleted` delegates to `deleteToken`; network's adds nested `purgeChain` error-swallowing plus a raw `chrome.storage.local.remove`. Possible additional family member: `incoming-transfer/service.ts:190` delegates to `clearProfile` (same shape one hop away) — strengthens, doesn't change, the finding. Extraction of a purge helper is behavior-preserving, but emit-order and lock-vs-lockless differences must be preserved per service during extraction.

## Q16 — CONFIRMED (high)

Pre-read/verification per instance (grep across all of `packages/`, including faucet/playground; all three shared packages are `"private": true`, so no external consumers; none of the cited symbols live in the extension's auto-imported dirs — src/utils, src/composables, src/stores, src/components — so auto-import cannot rescue them):

- `lazy-listener.ts` + `subscribe-with-snapshot.ts`: zero importers of either subpath; only colocated tests. Production mentions are comments only ("same pattern as"); `profile/client.test.ts` defines its own local helper. Dead. ✓
- `getRandomElement` (random.ts:18), `IEventHandler` (event-handler.ts:1-4), `dequeueBatch` (queue.ts:47-55): zero consumers. ✓
- `getVersion`/`setVersion` + `findByPredicate` (entity_storage): no production callers (findByPredicate test-only). ✓
- `base/index.ts:33-34` topology re-exports: no consumers outside wallet-core/src/base. ✓
- `jobs/index.ts:3,10`: dead symbols are `TERMINAL_STAGES` and `canTransition`; line 10 also carries live exports (`JobCancelledSentinel`, `assertCanTransition` heavily used) — symbol-level, not line-level, deadness. ✓ with caveat
- `wallet-crypto/index.ts:19`: dead bit is `ENCRYPTION_GUARD` (internal+test use only, test imports relatively); `PasswordSecretBox` on the same line is live. ✓ with same caveat
- `@aztec/stdlib` in wallet-crypto/package.json: declared, never imported (only `@aztec/foundation` is). ✓
- `src/setup/*` + vite.config.ts:134-136,298: built as rollup input, routed dir `src/setup/pages` doesn't exist, zero references in manifest or code; onboarding/index.ts calls it "a placeholder". ✓

Note for the fixer: ENCRYPTION_GUARD removal from the index must not touch the canary tripwire test (relative import); `IllegalTransitionError`'s index export is consumed by operation-journal's test via the package subpath.

## Summary

| Finding | Verdict | Confidence |
|---|---|---|
| Q9 | CONFIRMED | high |
| Q10 | CONFIRMED | high |
| Q11 | CONFIRMED | high |
| Q12 | CONFIRMED | high |
| Q13 | CONFIRMED | high |
| Q14 | ADJUSTED (profile instance is a non-loop variant; +2 missed loop instances: account-state:183, token-balance:256) | high |
| Q15 | CONFIRMED | high |
| Q16 | CONFIRMED (two line-level cites bundle live symbols; deadness is symbol-level) | high |
