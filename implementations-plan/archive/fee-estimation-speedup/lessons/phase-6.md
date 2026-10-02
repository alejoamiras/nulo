# Phase 6 — End-to-end validation + stub-gas measurement

## Stub-gas measurement (the follow-up charter's entry data)

Method: throwaway instrumentation (never committed — reverted before the clean gates) wrapping the SW-side `PxeServiceClientBase.simulateTx` to record `{stub, skipTxValidation, totalGas, teardownGas}` per call into `chrome.storage.local`, dumped to a file by a temporary tail step in `tx-sendTx-default.test.ts`, run against the real sandbox with real proving.

Captured (one dApp token-transfer flow, canonical Sponsored FPC):

| sim | stub | skipTxValidation | DA gas | L2 gas |
|---|---|---|---|---|
| discovery (dApp op) | **true** | true | 1,088 | 755,890 |
| strategy fast path (same op) | false | false | 1,088 | 755,890 |
| other flow sims (cap-grant/fixture) | false | false | 768 | 683,322 / 683,406 / 683,559 |

**Headline: the stub-vs-real delta for the same operation is exactly ZERO** — the stubbed discovery sim and the unstubbed strategy sim measured identical gas to the unit (DA 1,088 = 1,088; L2 755,890 = 755,890), with the option sets matching today's discovery-vs-strategy split exactly. The 683k-row triplet shows normal block-state variance (±240 L2 gas, ~0.03%) across repeated sims of a similar op — an order of magnitude below the 1.05 padding.

Caveats for the follow-up decision: n=1 operation shape (public token transfer + sponsor call); no private-note-heavy op measured; the stub swap only affects the ACCOUNT contract's own execution, which for this account is apparently gas-identical. Data supports the charter's single-sim direction strongly, but a private-transfer + authwit-requiring shape should be measured before flipping.

### Capture-channel lessons (3 failed attempts first)

1. Piping a measurement run through `tail -40` discards mid-run output — never filter a run you need to mine afterwards.
2. The e2e reporter does NOT surface test-process `console.log` — write artifacts to a file from the test instead.
3. Offscreen-side `chrome.storage.local.set` writes silently failed (swallowed by the guard catch); the SW-side client wrapper worked first try. If instrumenting again, instrument the SW.
4. **The smoke suite does not build** — `global-setup-smoke.ts` points at existing `dist/chrome`. Env-armed runs against a stale unarmed dist produce confusing timeouts (see below).

## Gates

- `bun run audit:vue` → PASS (typecheck:all 13/13, 3813 tests, lint exit 0, build ✓).
- `bun run test:e2e` (smoke) → **PASS armed**: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build && NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` → 23 files / 79 passed, 0 failed. Two red runs preceded this, both self-inflicted invocation errors, not regressions: (a) unarmed local runs fail the pre-existing arming-contract guard by design (CI arms it in `_smoke-e2e.yml`; guard predates this branch — zero commits here touch it); (b) env-armed runs against the unarmed `audit:vue` dist time out in the migration-fixture tests because the sentinel migration isn't compiled in — the arm must be baked at BUILD time. Clean rebuild performed afterwards (fixture hygiene).
- **Full `bun run e2e:agent` (network suite)** → 66 files: **64 passed, 1 skipped, 1 failed** (`account-switch-isolation.test.ts`, 2 tests — the incoming-poll discovery gate never parks at `discovery-held`). Disposition: **pre-existing-environmental, not this branch** — proven by bisect, not assumed: the file fails IDENTICALLY (same 2 tests, same assertion) in isolation on this branch AND in a scratch worktree at clean `origin/dev` on this machine. Nothing in this plan touches the incoming-poll/siloing arc. Per the gates rule the check is not neutralized: the PR-required `network-e2e-status` on CI hardware is the authoritative arbiter and must be green to merge. Every fee-estimation-relevant network file (transfers, tx-sendTx-default, tx-sendTx-sponsoredFpc, fee-methods' unskipped cases, frozen-account arc files) passed.

## Gate result: PASS (with the documented pre-existing-environmental exception above)

