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
