# P3 dedup-p3-service-wrappers — lessons

Base: `worktree-dedup-p2-adopt-helpers` (PR #566). Scope: ledger ids D1 D2 D3 D4 G1 C1 C2 C5 C6 F1 F2 F3 E4 E6 B1 B2 B3 B5 A1 A3 H2 H4 X4 I1 I2.

## Plan audits

- Dual audit: codex (`01a07c5f-47c3-76c0-9ea4-db0d61eeb178`) conditional; fable (Plan agent, `audit-fable.md`) conditional. Final fresh-context codex pass (`01a07c71-bc75-7f10-b79a-c6b0274446f5`) conditional. Every condition adopted — the trail is `plan.md` § Decision ledger and § Audit log. Approval per the ledger README's pre-approval rule.

## Skipped ids

- **H2** — `awaitProfileActivation` rejects at once on a matching `bootstrapFailure`, so the import page would enter recovery immediately instead of after its 30 s wait: a failure-path timing change (both auditors).
- **C2** — an `async` `runTaskStep` wrapper inserts a microtask before `task.complete()`; `execution/mark-failed-unless-cancelled.ts` records that ordering class as a past regression, `buildNoFrom` completes before constructing its return value and `sendTxTask` classifies before failing. Not worth an unpinned ordering change for ~40 lines (fable named the tick; codex had accepted a restricted set).

## Phase 1 — packages (A1, A3, B1, B2, B3, B5) ✓

- A1: `prefixedEntries(all, prefix)` in `wallet-core/src/storage/prefixed-entries.ts` (exported); `EntityStorage`'s five scans go through a private `scopedRows()` over it, keeping the full key for `decodeRow`. Shared with D2 in Phase 4.
- A3: `createListenerBag<T>()` in `wallet-core/src/testing/listener-bag.ts` with a stable `items` array, `remove` (first) and `removeAll`; adopted at the fake's six flat sites (live-array dispatch) and the harness's four (snapshot dispatch, `removeAll`); the harness's keyed maps stay. Two array-only accesses (`.length = 0`, `.splice(0)`) needed `.items`. New `listener-bag.test.ts` covers first-vs-all and add-during-dispatch.
- B1: `requireContractsGrant(method, address, flag, grants)` (truthy flag) under the three contracts checkers, each keeping its own address extraction; `requireAddressBookGrant(method, grants)` (`=== true`) under the two data checkers; `checkGetContractClassMetadata` untouched (different capability and message). New test pins that `addressBook: "yes"` still denies.
- B2: `deriveRecord` / `deriveSet` module-private; the six exported derive functions keep their signatures; frozen-oracle tests unchanged.
- B3 / B5: `logDebug` / `logWarn` wrappers (7 sites); `requireSession` is a TypeScript assertion method so each of the six guards stays a one-line in-place narrowing at its original position.
- Gate: `bun run lint` 0 · `bun run typecheck:all` 0 · wallet-core 246, extension-messaging 202, wallet-bridge 262 tests pass.

## Phase 2 — clients and small service helpers (D1, G1, D3, D4, E4, E6, F1, F3, X4) ✓

- D1: the factory alone was not enough — `ServiceClient` ships an untyped `restore(...unknown[])` convenience stub, and a class member shadows a declaration-merged interface method, so the merged `restore` type collapsed to `(...unknown[]) => Promise<unknown>` and `useFullBackupImport` stopped typechecking. `restore` keeps a typed override (same forward) and stays in the exhaustive list; the other 21 are generated. Worth knowing before P4/P5 touch any client whose `Methods` has a `restore`/`backup` key.
- G1: `NetworkMethodSchemas[method]` under a generic key is a union of every schema, so the helper reads it through the erased `{ params: ZodType<unknown>; result: ZodType<unknown> }` shape and casts the validated result to `ReturnType<Methods[K]>`; raw params go to `request`. New `client.test.ts` pins invalid params → no port message, invalid result → `ValidationError` (the port mock only exists after `connect()`).
- D4 keeps `getNetwork` outside `viaPxe`; E6's closure sits right after the marker read; F1's two helpers are module-level; D3 types the credential as `Awaited<ReturnType<PasskeyService["getKey"]>>`.
- F3 (own commit): `invalidateAndDelete` is synchronous and returns `repo.delete`'s promise; test pins the fence-before-delete order and promise identity.
- X4 (own commit): `startPollScheduler(map, key, poll, labels)`; scenario pins map-before-kick for both arms.
- Gate: lint 0 · extension typecheck 0 · 53 test files / 834 tests (incl. the three new ones).

## Phase 3 — execution and token introspection (C1, C5, C6, F2) ✓

- C1: `sentTxRecorder(sent: SentTx)` builds the post-send closure both arms pass; `SentTx`'s field types are read off `DappSendExecutorDeps["addTransaction"]`'s parameter tuple and the fee-detail helpers, so no extra imports.
- C5: `TRANSFER_FN_BY_TYPE` (`as const satisfies Record<TransferType, …>`) replaces the four-case switch; the two error strings are unchanged and `operation-planner.test.ts` still exercises every branch.
- C6: `decodeInto(...)` logs the defensive arity form at all three arms, comment moved onto it.
- F2: `resolveTokenFns(artifact)` iterates `Object.values(TOKEN_FN_DESCRIPTORS)` by `descriptor.kind` into one typed record (one cast at the accumulator); the `TokenInterface` literal stays explicit.
- Gate: lint 0 · extension typecheck 0 · 56 test files / 722 tests (execution, token, fpc).

## Phase 4 — repositories, composables, utils, e2e seams (D2, H4, I1, I2) ✓

- D2 (own commit): `decodeRow(schema, raw)` in `wallet/utils/raw-row.ts` + wallet-core's `prefixedEntries`; the four repositories shrank by ~55 lines while keeping their raw presence reads, tri-state lookup, compare-and-delete and audit comments in place. `raw-row.test.ts` pins absent / valid / corrupt (including a non-string value).
- H4: `useFullscreenPopupSetting` returns `{ showFullscreen, start, dispose }`; `PopupCard.vue` owns `onMounted(start)` / `onBeforeUnmount(dispose)`. The vitest config auto-imports only `vue` and `vue-router`, so an SFC's bare composable must be supplied with `vi.stubGlobal` in a component test (the repo's existing pattern) — a `vi.mock` of the module does not define the global. `PopupCard.test.ts` pins start-then-dispose.
- I1: `waitForStorageRelease({ key, stillHeld, timeoutMs, onTimeout, onFinish? })` under `src/e2e/`; restore's `stillHeld` is `(await this.read())?.at === at`; proof and restore clear their key in `onFinish`, incoming-poll passes none. Tests cover release-with-onFinish-before-resolve, the check-then-subscribe race, the timeout, and the restore wrapper's matching vs other hold point.
- I2: `COMPRESSION_FORMATS` drives filename, mime and detection; the `.compressed` fallback and the octet-stream default stay.
- Gate: lint 0 (complexity baseline unchanged) · extension typecheck 0 · 108 test files / 1,552 tests across the Phase 4 paths.
