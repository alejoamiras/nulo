conditional approve (with conditions: B1 keeps `=== true` for the addressBook pair and registerContract's address extraction; B5 never hoists the `handleSendTx` guard; D2 gains a raw single-key read and is shaped as functions, not a class; D4 keeps `getNetwork` outside the try; C2 names its microtask delta or is dropped; X4's helper owns the map write; H2's bootstrap-failure short-circuit is logged as a deviation; the wrong Facts are corrected)

# Fable audit — dedup-p3-service-wrappers

## Adversarial / security

- **B1** `packages/wallet-bridge/src/method-scope-checkers.ts:72,84,98` gate with truthy `c.canRegister &&`; `:358,372,385` gate with `=== true`. One factory with one comparison turns a legacy `{addressBook: "yes"}` grant from deny into allow; `scope-enforcement.test.ts:43-49` pins only `true`/`false`. Keep two factories with their own comparison. `checkRegisterContract:67` reads `instance?.address ?? instance`, the others `args[0]`; `contractsAddressChecker(method, flag)` has no slot for that — add an `address(args)` parameter or leave registerContract inline.
- **B5** `dispatcher.ts:850-859`: the `handleSendTx` guard runs *after* `resolveNetworkAndAccount`, which throws "No accounts found for profile …" first (`:1470`). Hoisting `requireSession` changes the error a session-less sendTx gets; nothing pins it. Keep it at line 858 or exclude the site.
- **D2** `account-integrity/blocked-repository.ts:41-44` `isBlocked` is a single-key raw presence read; `restore-pending-repository.ts:45-59` `get` is tri-state. The plan's API (`get/rawIds/validPayloads/corruptIds`) serves neither without a full scan or a re-decode; add `getRaw(id)`. The tests' fake storage (`blocked-repository.test.ts:24`) would not notice a scan substitution.
- **G1** 16 uniform bodies, typed schema lookup — safe. But `validateParams` returns zod's copy; the helper must spread the raw `params` into `request`. No client-side test exists.
- **D1** safe: `Methods` has 22 keys, all forwards positional; `wrapParams` (`packages/extension-messaging/src/utils.ts:16`) records `n`, so `[name]` and `[name, undefined]` arrive identically. `client.test.ts` covers only `subscribeActiveProfile`.
- **C2** nine uniform sites, `sendTxTask` rightly excluded, but `execution/mark-failed-unless-cancelled.ts:11-19` records that an async wrapper adds a microtask and that this was once a real ordering regression. `runTaskStep` is that wrapper; nothing pins it. Say so in the plan or skip C2 — "zero behaviour change" is not literally true.
- **F3 / X4** fences survive. X4: `schedulers.set` precedes the initial kick (`incoming-transfer/service.ts:847-852`); the helper must take the map and write it before polling, not return the interval.

## Assumptions

**Facts**: 1–4, 7, 8 and the bridge counts in 6 verified. Wrong: Fact 5 says F3 adds to `invalidatedBalanceIds` 3× — it is 4 (`token-balance/service.ts:408,523,542,578`), and the emit differs (`getTokenBalanceInfo(tb, token)` at 525 vs `getTokenBalanceInfo(tb)` at 547/584; equivalent, since the one-arg form resolves the same live token). Fact 6: `entity_storage.ts` builds `${this.root}@` 11×; the five scans are `:194-268`.

**Inferences**: 22 pure forwards — true. Every other `task.fail` catch is bare — true. `import.vue` — the catch is `composables/completeImportWithRecovery.ts:57`, bare; but `awaitProfileActivation` rejects on `bootstrapFailure` at once, so a failed bootstrap enters `recover` immediately instead of after 30 s — a failure-path change to log. Runtime `TokenFnKind` list — none; `TOKEN_FN_DESCRIPTORS` is `satisfies Record<TokenFnKind,…>`, so `Object.keys` needs a cast; nothing throws in the resolvers, so order is unobservable. `fullscreenPopupSetting.test.ts:37-44` pins mount→getValue and unmount→disconnect through `makeHost`, which must itself call `start/dispose` after H4; `PopupCard.vue:12` has no hooks today and `src/components/Popup` has zero tests.

**Asks**: none beyond the conditions.

## Implementation critique

- **D2** over-engineered: two of four repos never scan. Two module functions — `decodeRow(schema, raw)` and `prefixedEntries(all, prefix)` — remove the same lines, keep each repo's raw-vs-valid choice beside its audit comment, and the second also serves **A1** (`entity_storage.ts:194-268` is the same loop; the recon did not connect them). If the class stays, add `getRaw`.
- **A1** `scopedEntries(): [id, unknown]` loses the full key `decodeRow(k, v)` needs (`:200,218`); yield `[key, id, value]`.
- **A3** `fake-browser-api.ts:123` removes the first occurrence, `transport-harness.ts:91,151` every occurrence, and `:79-112` are per-service maps. One bag cannot keep both; scope A3 to the flat sites or skip it.
- **C6** adopt the utility arm's `Array.isArray(values)` count (`batched-view-simulation.ts:524`) for all three; move the "arity, never the values" comment into the helper.
- **D4** `getNetwork` sits outside every try (`account-state/service.ts:63,75,120`); moving it inside relabels a missing network as "PXE request failed".
- **F2** two `Map`s force `!` at 18 literal fields; a `resolveTokenFns(artifact): Record<TokenFnKind, {candidates, fn}>` in `functions/runtime.ts` with one internal cast reads better.
- **I1** `{timeoutMs, onTimeout}` misses two divergences: proof/restore gates `session.remove` on finish, incoming does not; restore's re-check is `still?.at !== at`. Add `stillHeld` and `onFinish`.
- **D1** adds a `biome-ignore noUnsafeDeclarationMerging` as all 16 factory clients do; say so before the codex loop flags it.

## Outline

Single arc. The owner's contract is five PRs; a sixth buys no coverage the medium ids lack. Their risk is design (D2's shape, H2's deviation), which the conditions fix, not merge order. One id per commit so D2/H2 review in isolation.

## Gates

Real: root `lint`/`typecheck:all` (extension is `@nulo/extension`), the three package `test` scripts and vitest configs exist, every listed path exists. Nits: the README says Bash refuses `cd` chains in worktree sessions — use `bun run --cwd apps/extension test src/…`; `src/components/Popup` has 0 tests and `src/popup/pages` has no `import.vue` test. Not caught by any gate: B1 truthiness, B5 hoist, D2 scan-for-key, D4 relabel, G1 parsed-vs-raw params, C2 tick, A3 remove-all, I1's restore predicate (only the proof gate is tested).

## Looks fine

D1, D3, C1, C5 (`operation-planner.ts:150` `fn?.buildArgs` normalises harmlessly), F1, E4, E6 (3 of 4 sites; source `"wallet-sdk-bg"`), B2 (`deriveCapabilityMap` filters `!== null`, the rest `!== undefined`), B3, I2, X4 with the map condition, I1's e2e placement (`.github/workflows/_build-extension.yml:111` negative grep is real).
