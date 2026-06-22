# Draft plan (opus subagent) — wallet-bridge MethodDescriptor registry (Q1)

> One of three independent `deep` drafts. Captured from the opus Plan subagent.

## Executive position

Fold the six method-name-keyed tables into ONE flat `Record<MethodName, MethodDescriptor>` in a new `packages/wallet-bridge/src/method-registry.ts`; DERIVE all six old tables via pure functions. Leave the two kind→Operation switches untouched. Kind-sets (`NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS`) derived by aggregation over a per-method `routing` field, NOT stored separately.

Non-negotiable safety: a parity-test harness proven green against CURRENT tables BEFORE the registry is introduced, plus a build-failing exhaustiveness check that every live `WalletSchema` method has a descriptor.

Chooses shape **(a) flat Record** with a discriminated `routing` field + per-method optional `scopeCheck` closure. Rejects (b) discriminated union (capability/routing/scopeCheck don't partition along one discriminant — a DU buries the orthogonal axes and re-creates the coupling inside one type; exhaustiveness is a coverage-of-universe property a DU can't give) and (c) builder/DSL (mutable construction defeats `as const`, harder to diff vs snapshot, complicates AUDIT-marker-as-data).

## Full cross-table matrix (the latent-bug hunt — locked decision #2 due diligence)

| Method | capMap | exempt | METHOD_TO_KIND | scopeChecker | Routing |
|---|---|---|---|---|---|
| getChainInfo | — | yes | aztec_getChainInfo (NETWORK_ONLY) | — | sink |
| requestCapabilities | — | yes | — | — | handler |
| batch | — | yes | — | — | handler |
| createAuthWit | accounts | — | aztec_createAuthWit (ACCOUNT) | yes | sink |
| registerToken | accounts | — | — | — | handler (popup) |
| isTokenRegistered | contracts | — | — | yes | handler (reader) |
| getAccounts | accounts | — | — | yes | handler |
| registerContract | contracts | — | aztec_registerContract (NETWORK_ONLY) | yes | sink |
| getContractMetadata | contracts | — | aztec_getContractMetadata (NETWORK_ONLY) | yes | sink |
| getContractClassMetadata | contractClasses | — | aztec_getContractClassMetadata (NETWORK_ONLY) | yes | sink |
| simulateTx | simulation | — | aztec_simulateTx (ACCOUNT) | yes | sink |
| executeUtility | simulation | — | aztec_executeUtility (ACCOUNT) | yes | sink |
| profileTx | simulation | — | aztec_profileTx (ACCOUNT) | yes | sink |
| sendTx | transaction | — | (handler-only) | yes | handler (popup) |
| grantPublicAuthwit | transaction | — | — | yes | handler (popup) |
| getPrivateEvents | data | — | aztec_getPrivateEvents (NETWORK_ONLY) | yes | sink |
| getAddressBook | data | — | aztec_getAddressBook (NETWORK_ONLY) | yes | sink |
| registerSender | data | — | aztec_registerSender (NETWORK_ONLY) | yes | sink |

**The matrix is internally consistent — NO latent silent-authz bug on current `dev`.** Every capability-mapped method that flows to the execution sink has both a kind and a scope checker; every popup/handler-routed method is intentionally absent from `METHOD_TO_KIND`. The F1 bug is already fixed + pinned (`dispatcher.test.ts:1459-1544`). → The locked-decision-#2 bug-fix discipline must be ARMED but the default expectation is a pure behavior-preserving refactor; "parity exact on first derivation" is the proof, and "no inconsistency surfaced" is itself a ledger entry.

## Descriptor shape (illustrative)

```ts
type MethodRouting =
  | { via: "network-operation"; kind: Operation["kind"] }
  | { via: "account-operation"; kind: Operation["kind"] }
  | { via: "handler" }
type ScopeCheck = (args: unknown[], grants: GrantedCapabilityRecord[]) => void
interface MethodDescriptor {
  capability: CapabilityType | null
  exemptReason?: string          // exempt === (capability === null && !!exemptReason)
  routing: MethodRouting
  scopeCheck?: ScopeCheck         // omitted = no scope dimension
  audit?: string                  // preserved F-/AUDIT markers
  note?: string                   // rationale migrated verbatim from inline comments
}
```

Derived: `METHOD_CAPABILITY_MAP`/`EXEMPT_METHODS`/`METHOD_TO_KIND`/`NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS`/`METHOD_SCOPE_CHECKER` all `= derive*(METHOD_REGISTRY)`. Public API (`getRequiredCapability`, `isCapabilityExempt`, `enforceScope`, `enforceScopeWithSession`) keeps identical signatures, just reads derived maps.

## Two genuinely hard derivation decisions

### 3.1 Kind-sets are kind-keyed — store routing per-method, aggregate up
No kind is network-only for one method and account for another (method→kind injective), so aggregating per-method `routing.via` reproduces the sets exactly. A separate kind-level metadata block would re-introduce the smell at the kind layer. **Parity nuance:** assert the partition is total + disjoint over derived `METHOD_TO_KIND` (network ∪ account = methodToKind.values; network ∩ account = ∅). The `getChainInfo` case (exempt AND network-op routed — carries both `exemptReason` and `routing`) MUST round-trip or the test masks a regression.

### 3.2 Import-cycle break — two-file split
`scopeCheck` references functions in `scope-enforcement.ts`. To avoid registry↔scope-enforcement cycle: `method-registry.ts` holds DATA-ONLY fields (capability/exemptReason/routing/audit/note, imports only types); `scope-enforcement.ts` keeps the checker BODIES + helpers and builds `METHOD_SCOPE_CHECKER` by pairing registry keys with local checkers. Dependency arrow stays one-directional: capability-map/dispatcher/scope-enforcement → method-registry → (types only). The ":9 keep-in-sync comment" is replaced by the exhaustiveness assertion (a method needing a checker but lacking one fails the build).

## Parity + exhaustiveness harness (the proof)

**`method-registry.parity.test.ts`**: derived maps deep-equal FROZEN snapshot literals of each old table (snapshot hand-transcribed from current `dev`, reviewed in Phase 1 before any consumer swap). For `METHOD_SCOPE_CHECKER`: assert key-set equals the 14-name snapshot AND function IDENTITY matches (each derived checker `===` original) — strongest non-behavioral guarantee. Plus the disjoint-partition assertion.

**`method-registry.exhaustiveness.test.ts`**: imports the schema-patch (side-effect, like `dispatcher.test.ts:682`), enumerates live `WalletSchema` keys, asserts every key has a descriptor (build failure otherwise) + reverse-minus-allowlist. Every non-handler, non-popup method with a capability MUST have a `scopeCheck` or an explicit `note` declaring intentional no-scope — the structural replacement for the deleted sync comment.

## Phases

- **Phase 0** — Worktree (`refactor/wallet-bridge-method-descriptor`) + baseline capture (record the matrix as snapshot literals). Gate: `typecheck:all` + `lint` + `--cwd packages/wallet-bridge test` + `bun run test` all green.
- **Phase 1** — ADDITIVE: add `method-registry.ts` (18 data-only descriptors, AUDIT/notes verbatim) + `derive*` + both new test files. Do NOT rewire consumers yet — parity compares derived-vs-snapshot in isolation. Gate: old tests green + parity + exhaustiveness green; `typecheck:all`; `lint`. STOP if parity not exact (transcription wrong).
- **Phase 2** — Swap consumers to derived maps; DELETE the six old literals. Build switches untouched. Replace `:9` comment with pointer to exhaustiveness test. Gate (critical zero-change): ALL existing `dispatcher.test.ts` (incl. F1 guards) + `scope-enforcement.test.ts` green UNCHANGED + parity + exhaustiveness; `typecheck:all` + `lint` + full `bun run test`. Bug-fix discipline fires HERE if a genuine bug surfaces (it shouldn't).
- **Phase 3** — Add-a-method validation (prove the win: one descriptor edit makes a method fully gated; omitting it fails exhaustiveness) + README/docs update. Gate (all 4 layers): `typecheck:all` + `lint` + `test` + `test:e2e` (smoke) + `e2e:agent` (network).
- **Phase 4** — Codex adversarial post-impl audit (no separate /harden).

## Security & Adversarial

Threat: hostile dApp probing for a method that slips past `enforceCapability`/`enforceScope` (the F1 class). Primary duty: make silent omission STRUCTURALLY impossible (exhaustiveness test → build failure), strictly stronger than the comment-only sync today. Least privilege preserved byte-for-byte (parity). F-003/F-004/F-005 checker bodies untouched, referenced by identity. Attacker targets post-refactor: (1) wrong `routing.via` (method marked handler that should be account-op bypasses account resolution) — pinned by parity partition + reachability tests; (2) a `derive*` bug dropping a checker — pinned by function-identity parity. Trusting-we-shouldn't: the hand-transcribed snapshot — mitigated by independent witness (existing behavioral tests stay green) + Phase-1 review. Supply chain: none new; `@aztec/wallet-sdk` stays pinned; layer rule preserved.

## Asks
- **A1:** Confirm `isTokenRegistered`'s `contracts`+`canGetMetadata` gating preserved as-is (note, no behavior change).
- **A2:** Accept data-in-`method-registry.ts` / checker-bodies-in-`scope-enforcement.ts` split vs forcing function refs into the registry (heavier diff).
- **A3:** Is `WalletSchema` alone the exhaustiveness universe, or must the check also union `WalletMethodSchemas` (batch surface)? Recommends union — load-bearing for the silent-omission guarantee.

## Inferences to attack
- No external code consumes the raw tables (only exported functions) — grep + barrel checked, dynamic access unverified.
- Method→kind injective (kind-sets derive exactly).
- `WalletSchema` post-patch is the complete routable universe (contested — A3).
- The two-file split is the right cycle-break.
