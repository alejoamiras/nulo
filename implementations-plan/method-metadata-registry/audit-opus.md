# Opus audit transcript — Q1 plan (deep)

Two opus passes: (1) independent draft (`draft-opus.md`), (2) fresh hostile audit on the consolidated `plan.md` (no prior context). This file = Round 2.

## Round 2 — fresh hostile audit

**Verdict:** `reject` (1 substantive blocking issue + 4 secondary tightenings; all confirmed against source by main). Baseline confirmed green: 134 tests in 2 files.

### Blocking (the substantive issue — A3)
- **`WalletMethodSchemas` is not a public export** (module-private const, wallet.js:272). The plan's recommended `WalletSchema ∪ WalletMethodSchemas` universe is unimplementable; the "silent-omission killer" is built on an unimportable symbol.
- **Import-order dependency.** The custom trio (`registerToken`/`isTokenRegistered`/`grantPublicAuthwit`) are `WalletSchema` keys ONLY after the cross-package `nulo-schema-patch` side-effect import runs (extension/.../nulo-schema-patch.ts:38-101). The plan never makes the ordering a hard, tested precondition → the guard can silently under-cover the three highest-risk Nulo methods (incl. the F1 method).
- **Real universe = the method-name literals `dispatch()`/`handleBatch` branch on** (dispatcher.ts:354-394, 492-500), not a schema's keys. `BatchedMethodSchema` excludes the custom trio (built from the stock `WalletMethodSchemas`). Re-spec A3 to enumerate dispatcher branch literals ∪ patched-schema keys before approval.

### Secondary (fix on respin)
- **D5 cites the wrong test.** `dispatcher.test.ts:1344` is the `grantPublicAuthwit` reachability describe header. The binding retired-method guards are `:817` (`getCompleteAddress`) + `:824` (`simulateViews`), both `/Unsupported wallet method/`. The dispatch-entry guard must reproduce that exact string.
- **D5 throw-ordering shift** — today unknown methods flow through `enforceCapability` (returns [], dispatcher.ts:1004) and throw at the END (:393); D5 throws at the TOP. Observationally fine but unanalyzed; no test asserts ordering (verified).
- **D6 identity-parity vacuous for the 3 lifted arrows** — `sendTx`/`simulateTx`/`profileTx` have no stable pre-existing identity; comparing the derived ref to the freshly-named fn is tautological. Real for the 11 named checkers; the 3 rest on existing behavioral tests. Scope the D6 claim.
- **D4 leaf-module cycle-break HOLDS** — per-method checkers depend only on module-private helpers (`matchesScope`/`inAddressList`/`grantsOfType`) + `./capabilities` types; `validateAccountScopes` (F-005) correctly stays in the facade. No hidden back-edge from the checker split. (codex separately caught the `CapabilityType` import back-edge.)

### Assumption-attack
- **Stale comment hazard (authz-adjacent).** `enforceCapability`'s doc comment (dispatcher.ts:987) lists `getAccounts` as exempt, but `EXEMPT_METHODS` (capability-map.ts:18) does NOT contain it (F-003 removed it; :14,:27). The descriptor migration could mis-transcribe this into `exemptReason` for `getAccounts` → re-creates an F1-class hole on the `canGet` sub-grant. Flag this SPECIFIC comment; the parity snapshot must pin `getAccounts` as `capability:accounts`/not-exempt.
- Facts slip: capability-map.ts:60,67 are the accessor FUNCTIONS, not tables (minor).
- README divergence not surfaced: README Custom-RPC table (line ~221) documents only `registerToken`, but code has three customs — Phase 5's doc update inherits a larger reconciliation than stated.
- Injectivity (D3) is a CONSTRAINT being imposed (build-break on violation), not a pre-existing property — present it as such.
- Risk inversion on Phase 3: the plan asserts so confidently it'll be a no-op that a real surfaced inconsistency (e.g. the stale getAccounts comment) might be rationalized away rather than bug-pinned.

### Phasing
- Harness location sound (additive Phase 1, prove zero-change at Phase 2 swap). Gates are real commands (verified). But the proof is only as good as A3 — fix A3 or the harness can go green while hollow.
- Phase 3 adequately fenced; Phase 4 e2e scenarios sufficient.

## Round 1 — independent draft
See `draft-opus.md`.
