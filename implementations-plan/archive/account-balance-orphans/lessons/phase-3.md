# Phase 3 — purge, registration, split ordering, fail-fast

## What landed

- `TokenBalanceService.purgeForAccounts(scopes, profileId)` — tuple-scoped
  (`profileId` + `chainId` + `address`), one hold with the creators, fence before every
  delete, emit guarded by `this.tokens.has` (the scope's profile is typically not active),
  raw second pass on new-shape fields only (old-shape rows deliberately left to the init
  legacy sweep).
- `AccountService.registerAccountPurgeSubscriber` (mirrors `registerChainPurgeSubscriber`)
  + `reconcileImportedAccounts` restructured to list → awaited registered purges → delete
  with a per-row key-absence re-check → return only the scopes actually deleted
  (`{chainId, address}[]` — spec + client untouched beyond the return type).
- `TokenBalanceService.init` registers the purge — **no new RPC surface**.
- Composable: catch-and-continue removed; a reconcile/purge failure escapes to the
  pre-finalize rollback (test pins `deleteProfile("new-id")` + no finalize).

## RED runs (mutation-verified, reverted byte-exact)

**RED 1 — bare-address purge** (profileId check dropped from the typed pass):

```
× spares the sibling profile's rows at the SAME address — bare-address scoping would destroy them
Tests  1 failed | 34 passed (35)
```

**RED 2 — address+profile purge** (chainId dropped from the scope tuple):

```
× spares the SAME profile's rows on ANOTHER chain — address+profile scoping would destroy them
Tests  2 failed | 33 passed (35)   ← also reds the raw-pass exactness pin
```

Both reverted (backup-copy restore); post-revert run 35/35 green.

## Test inventory added

- service.test.ts P3 describe: sibling-profile spare + fence; same-profile multi-chain
  spare; empty/foreign token-map completion (fable C-3); raw-pass new-shape-only; purge
  racing a parked creation (either serialization order valid, half-states forbidden).
- import-export.test.ts: purge-before-delete ordering + subscriber-throw abort (row
  survives); mid-purge key-install → account kept, excluded from return (codex round-2
  condition 3); **real-graph composition test** — real AccountService + real
  TokenBalanceService via `build(withBalances)`, keyless import's rows purged with the
  account through the actual registration.
- useFullBackupImport.test.ts: fail-fast pre-finalize rollback.

## Findings

- The `svc()` fakes don't auto-provide methods: registering the purge in
  `TokenBalanceService.init` required `registerAccountPurgeSubscriber: () => {}` stubs in
  16 account fakes (token-balance service.test + cross-profile) — same pattern the
  `networkStub` comment already documents for `registerChainPurgeSubscriber`.
- `reconcileImportedAccounts`' RPC spec return type is compile-enforced
  (`ServiceSpec<Methods>` TS2416) — the spec edit was forced by the compiler, which is
  exactly the drift-guard working.
