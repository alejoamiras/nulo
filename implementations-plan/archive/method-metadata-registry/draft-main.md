# Draft plan (main) — wallet-bridge MethodDescriptor registry (Q1)

> One of three independent `deep` drafts. Consolidation happens in `plan.md`.

## Problem (re-verified on `dev`)

Six hand-synchronized, method-name-keyed tables in `@nulo/wallet-bridge` restate the same per-method facts. Adding/reclassifying one wallet method is a 6-file edit with silent-omission failure modes (the F1 dead-scope-gate bug: a method in `METHOD_TO_KIND` + `METHOD_SCOPE_CHECKER` but missing from `METHOD_CAPABILITY_MAP` → `enforceCapability` returns `[]` → the scope gate is never reached → silent authz hole).

The six in-scope tables + accessors:

| Table | File | Keyed by | Consumed at |
|---|---|---|---|
| `METHOD_CAPABILITY_MAP` | capability-map.ts:21 | method | `getRequiredCapability` → dispatcher:1003 |
| `EXEMPT_METHODS` | capability-map.ts:18 | method | `isCapabilityExempt` → dispatcher:1001 |
| `METHOD_TO_KIND` | dispatcher.ts:251 | method | dispatcher:392 |
| `NETWORK_ONLY_KINDS` | dispatcher.ts:272 | **kind** | dispatcher:1064 |
| `ACCOUNT_KINDS` | dispatcher.ts:286 | **kind** | dispatcher:1069 |
| `METHOD_SCOPE_CHECKER` | scope-enforcement.ts:379 | method | `enforceScope` → dispatcher:349 |

OUT OF SCOPE (locked): the two kind→Operation build switches `buildNetworkOperation` (:1089) / `buildAccountOperation` (:1138); the three `nulo-schema-patch.ts` copies.

## Key structural facts that constrain the design

1. **The tables cover different method subsets** — the descriptor MUST have optional fields:
   - Popup methods (`sendTx`, `registerToken`, `grantPublicAuthwit`): capability + scopeCheck, **no kind** (short-circuit at dispatcher:382-390 via `DappInteractionService`).
   - `getAccounts`, `isTokenRegistered`: capability + scopeCheck, no `METHOD_TO_KIND` entry (special-routed).
   - `getChainInfo`: **exempt** + has a kind (network-only) + **no scopeCheck**.
   - `requestCapabilities`, `batch`: exempt meta, no kind, no scopeCheck.
2. **`NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS` are KIND-keyed**, currently 1:1 with methods through `METHOD_TO_KIND`. → model as a per-method `context: "network" | "account"` field, aggregate up to kind-sets. (Aggregation is well-defined while the method→kind map stays injective; assert injectivity in the parity test so a future many-to-one mapping can't silently mis-derive the kind-sets.)
3. **`METHOD_SCOPE_CHECKER` holds real closures**, not data — each checker (`checkRegisterContract`, `checkGrantPublicAuthwit`, …) carries logic + F-00x audit markers and depends on module-private helpers (`matchesScope`, `grantsOfType`, `inAddressList`, the type-guards). The descriptor's `scopeCheck` field is a **function reference**, and the import topology must stay acyclic.

## Design fork — descriptor shape (my position: **(a) flat record + typed exhaustiveness guard**)

```ts
type MethodDescriptor = {
  /** null = no capability required (exempt or meta). */
  capability: CapabilityType | null
  /** true = skips enforceCapability entirely (getChainInfo, requestCapabilities, batch). */
  exempt?: boolean
  /** absent = popup/special-routed (no METHOD_TO_KIND entry). */
  kind?: Operation["kind"]
  /** only meaningful with `kind`; derives NETWORK_ONLY_KINDS / ACCOUNT_KINDS. */
  context?: "network" | "account"
  /** absent = no scope dimension (getChainInfo, requestCapabilities, batch). */
  scopeCheck?: (args: unknown[], grants: GrantedCapabilityRecord[]) => void
  /** F-00x markers that pair with security tests, carried verbatim. */
  audit?: string
}
const METHOD_REGISTRY: Record<string, MethodDescriptor> = { ... }
```

**Why flat record:** the six tables are already flat method-keyed maps; a flat record is the minimal-surprise, lowest-parity-risk mapping. Adding a method = one object literal. Derivation helpers (`getRequiredCapability`, `isCapabilityExempt`, `deriveMethodToKind`, `deriveNetworkOnlyKinds`, `deriveAccountKinds`, `getScopeChecker`) read the registry; existing call sites keep their current symbols (`METHOD_TO_KIND` becomes `= deriveMethodToKind(METHOD_REGISTRY)`), so call-site blast radius ≈ 0.

**Why NOT (b) discriminated union:** methods don't partition cleanly — capability, kind, and scope are independent axes. A union by capability would force `kind`/`scopeCheck` into every variant anyway; it fights the data and complicates exhaustiveness.

**Why NOT (c) builder/DSL:** indirection with no parity benefit; a builder that emits six maps is harder to diff against the frozen snapshot than a literal record.

**Exhaustiveness (the anti-F1 guard):** a build-failing test that enumerates the canonical dispatchable method set and asserts every member has a descriptor (and every descriptor member is reachable). Canonical set = `WalletSchema` runtime keys (from `@aztec/wallet-sdk`, after the schema patch) ∪ the Nulo-custom names. If `WalletSchema` keys aren't enumerable at runtime, fall back to a hand-maintained `KNOWN_METHODS` const that the dispatcher's `dispatch()` switch is itself checked against — see Asks.

**Import topology (the cycle hazard):** `METHOD_REGISTRY` references checker closures that live in `scope-enforcement.ts`, whose checkers need module-private helpers. Resolution: keep the **helpers + checker definitions** in `scope-enforcement.ts` and `export` the checkers; the registry **imports the checkers** (one direction). Move the lookup entry points `enforceScope`/`enforceScopeWithSession` so they consult the registry WITHOUT `scope-enforcement.ts` importing the registry back. Concretely: the registry file imports checkers from `scope-enforcement.ts`; `enforceScope` either (i) moves into the registry module, or (ii) stays in `scope-enforcement.ts` and receives the checker via `getScopeChecker(method)` passed in by the dispatcher. Prefer (i): one registry module owns method→checker; `scope-enforcement.ts` becomes pure checkers+helpers. No cycle.

## Phases

### Phase 0 — Frozen baseline + parity/exhaustiveness harness (no production change)
Capture the CURRENT six tables as a frozen literal snapshot in a new test (`method-registry.parity.test.ts`): for every method, its required capability (via `getRequiredCapability`), exempt bit (`isCapabilityExempt`), kind (`METHOD_TO_KIND`), the two kind-sets, and scope-checker presence + identity. Assert the live accessors match the snapshot (proves the snapshot is faithful). Also assert method→kind injectivity. This snapshot is the contract the derivation must reproduce — latent bugs included.
- **Gate:** `bun run typecheck:all` + `bun run lint` + `bun run test --filter @nulo/wallet-bridge` all exit 0; the new parity test green against current (pre-refactor) code. Layers: typecheck/lint + unit.

### Phase 1 — Registry (data fields) + derive the 4 non-closure tables
Add `method-registry.ts` with `MethodDescriptor` + `METHOD_REGISTRY` (capability/exempt/kind/context/audit only). Rewrite `getRequiredCapability`/`isCapabilityExempt` to delegate; replace `METHOD_TO_KIND`/`NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS` literals with `derive*(METHOD_REGISTRY)`. Add the exhaustiveness test.
- **Gate:** typecheck/lint + `test --filter @nulo/wallet-bridge` (parity unchanged + exhaustiveness green + existing `dispatcher.test.ts` reachability green). Layers: typecheck/lint + unit.

### Phase 2 — Fold scope checkers into the registry
Make `scope-enforcement.ts` export its per-method checkers + helpers; add `scopeCheck` refs to the registry; derive `METHOD_SCOPE_CHECKER` (or move `enforceScope` lookup to the registry per the topology decision). Remove the verbatim "keep in sync" comment (scope-enforcement.ts:9) — the registry IS the sync point now.
- **Gate:** typecheck/lint + `test --filter @nulo/wallet-bridge` (parity extended to scope-checker identity, all green). Layers: typecheck/lint + unit.

### Phase 3 — Latent-inconsistency sweep + inline fixes
With the registry as one view, audit for genuine bugs (capability without a matching scopeCheck where args are attacker-controlled; a kind+context mismatch; an exempt method that shouldn't be). For each real bug: (a) bug-pin test of the OLD behavior, (b) fix in the registry, (c) corrected-behavior test, (d) `AUDIT Qx` marker + decision-ledger entry. If none found, record "sweep clean" with the reasoning. The frozen snapshot from Phase 0 is updated ONLY for entries a documented fix intentionally changes — every snapshot delta maps to a ledger entry (this is what keeps real-fix vs regression auditable).
- **Gate:** typecheck/lint + `test --filter @nulo/wallet-bridge` (bug-pin + corrected tests green; snapshot deltas all ledgered). Layers: typecheck/lint + unit.

### Phase 4 — Live validation (smoke + network e2e)
Prove the security path still routes + scope-checks against a real network.
- **Gate:** `bun run test:e2e` (smoke) green; `bun run e2e:agent` (network) green — at minimum a dApp `sendTx`/`simulateTx` routes, a scope-violating call is rejected, and a `grantPublicAuthwit` scope-checks. Layers: smoke e2e + network e2e.

### Phase 5 — Docs + cleanup
Update `packages/wallet-bridge/README.md` "Custom RPC methods" to name the registry as the single edit point; update `CLAUDE.md`'s custom-RPC note if it references the old tables; update `implementations-plan/index.md`.
- **Gate:** `bun run lint` + `bun run audit:vue` (typecheck→test→lint→build) exit 0. Layers: typecheck/lint + unit + build.

## Security & Adversarial Considerations

- **Threat model:** a malicious/compromised dApp probes for a method whose scope enforcement was silently dropped during the refactor (the F1 class) — it would gain an unscoped capability (e.g. authorize an out-of-scope `sendTx`/`grantPublicAuthwit`). The whole refactor's risk is concentrated here.
- **Primary mitigation:** the exhaustiveness test makes silent omission a BUILD FAILURE — a method without a descriptor (or a descriptor that should carry a scopeCheck but doesn't, cross-checked against the frozen snapshot) fails CI. This is strictly stronger than the status quo (no such guard exists today; sync is enforced only by a comment).
- **Least privilege:** no new credentials, tokens, or network surface; pure in-package restructure. CI tokens unchanged.
- **Input validation:** the RPC trust boundary (`dispatch()`) is unchanged; checkers keep their exact arg-shape parsing. The refactor must not alter the order `enforceCapability` → `enforceScope` (dispatcher:326-349) or the F-005 `enforceScopeWithSession` fast-path-closing behavior.
- **Inline-fix risk:** Phase 3 changes behavior on the authz boundary. The bug-pin-then-fix discipline + ledgered snapshot deltas keep real fixes auditably distinct from regressions; codex post-impl audit reviews each delta adversarially.
- **Supply chain:** none new. No dependency changes expected.

## Assumptions

**Facts** (verified):
- The six tables + their consumption sites are exactly as tabulated above (capability-map.ts:18,21,60,67; dispatcher.ts:251,272,286,326-349,392,1001-1003,1064,1069; scope-enforcement.ts:379,409,430).
- `METHOD_SCOPE_CHECKER` closures depend on module-private helpers in scope-enforcement.ts (matchesScope:33, grantsOfType:47, inAddressList:42, type-guards:234-248).
- Popup methods short-circuit before the kind lookup (dispatcher.ts:382-390); they have no `METHOD_TO_KIND` entry.
- F-003/F-004/F-005 markers live as comments on checkers (scope-enforcement.ts:306,325,352) and on `METHOD_CAPABILITY_MAP.getAccounts` (capability-map.ts:14,27); F1 rationale at capability-map.ts:43-48.
- `wallet-bridge` does not depend on `aztec-runtime` (per CLAUDE.md package boundaries).

**Inferences** (attack these):
- `WalletSchema` exposes enumerable runtime keys usable for the exhaustiveness check. If false, a hand-maintained `KNOWN_METHODS` is the fallback (weaker guarantee — must itself be cross-checked against `dispatch()`).
- The method→kind map is injective today and the kind-set derivation depends on that. (Assert it; don't assume it stays true.)
- No latent inconsistency exists that would force a large Phase 3 — i.e., the inline-fix scope is small. (Could be wrong; Phase 3 is bounded by "document and fix what the one-view sweep surfaces," not open-ended.)
- Moving `enforceScope` into the registry module won't break the `enforceScopeWithSession` F-005 wrapper or its dispatcher call site. (Verify during Phase 2.)

**Asks** (user decisions):
- None outstanding — scope, behavior policy, validation layers, and hardening were answered in Phase 0. The only latent ask is the exhaustiveness source (WalletSchema keys vs `KNOWN_METHODS`); resolve during Phase 1 against the actual SDK export rather than surfacing now.

## Adversarial self-review
- Worst case if the descriptor shape is wrong: an optional field defaulting silently (e.g. `context` undefined → method dropped from BOTH kind-sets → `buildOperation` throws "unknown kind" at runtime, a loud failure, not a silent authz hole). The dangerous direction is the opposite — a method losing its `scopeCheck` silently; the exhaustiveness + snapshot-identity test is specifically designed to catch that, and it's the test I'd write first.
- The kind-set aggregation is the subtlest derivation; injective-map assertion is the guard.

## Assumption-attack self-review
- The "WalletSchema keys are enumerable" Fact is actually an Inference — correctly bucketed. If the schema is a Zod/io-ts object, keys may be enumerable; if it's a type-only construct, runtime enumeration fails and the fallback is mandatory. Resolve empirically in Phase 1, do not ship on the assumption.
- "No large latent inconsistency" is the riskiest inference; if Phase 3 balloons, that's a STOP-and-resurface signal, not a license to expand scope.
