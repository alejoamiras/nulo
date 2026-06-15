# Plan — wallet-bridge `MethodDescriptor` single-source-of-truth registry (Q1)

**Tier:** `deep` (security-sensitive authz boundary HIGH + blast-radius HIGH; inline authz fixes permitted).
**Origin:** Q1 of the `/harden quality` run `2026-06-11-ultra-50b45d` — *"Wallet method metadata scattered across parallel registries"* (Shotgun Surgery). Re-verified against current `dev` (PR #85/#86 merged): all six tables intact, the smell stands.
**Package:** `@nulo/wallet-bridge` (single package; no `aztec-runtime` coupling).

## Problem

Six hand-synchronized, method-name-keyed tables restate the same per-method facts across three files. Adding/reclassifying one method is a 6-edit scavenger hunt with silent-omission failure modes. The **F1 dead-scope-gate** bug already proved the cost: `grantPublicAuthwit` was present in `METHOD_SCOPE_CHECKER` and handled as a popup method, but **missing from `METHOD_CAPABILITY_MAP`** (popup methods carry no `METHOD_TO_KIND` entry) → `getRequiredCapability` returns `null` → `enforceCapability` returns `[]` → `dispatch()` skips the scope block entirely (it only runs when `grants.length`) → the scope gate becomes dead code → silent authz hole (`capability-map.ts:43-48`, pinned by `dispatcher.test.ts:1459-1544`).

| Table | File:line | Keyed by | Consumed at |
|---|---|---|---|
| `METHOD_CAPABILITY_MAP` | capability-map.ts:21 | method | `getRequiredCapability` → dispatcher:1003 |
| `EXEMPT_METHODS` | capability-map.ts:18 | method | `isCapabilityExempt` → dispatcher:1001 |
| `METHOD_TO_KIND` | dispatcher.ts:251 | method | dispatcher:392 |
| `NETWORK_ONLY_KINDS` | dispatcher.ts:272 | **kind** | dispatcher:1064 |
| `ACCOUNT_KINDS` | dispatcher.ts:286 | **kind** | dispatcher:1069 |
| `METHOD_SCOPE_CHECKER` | scope-enforcement.ts:379 | method | `enforceScope` → dispatcher:349 |

**Out of scope (locked):** the two kind→Operation build switches `buildNetworkOperation` (dispatcher.ts:1089) / `buildAccountOperation` (dispatcher.ts:1138) — they construct Operations from args (behavior, kind-keyed). The three `nulo-schema-patch.ts` copies (pinned house contract).

## The 18-method surface (verified, all three plans agree — no latent authz bug on `dev`)

| Method | capability | exempt | kind (context) | scopeCheck | routing |
|---|---|---|---|---|---|
| getChainInfo | — | ✓ | aztec_getChainInfo (network) | — | sink |
| requestCapabilities | — | ✓ | — | — | handler |
| batch | — | ✓ | — | — | handler |
| createAuthWit | accounts | | aztec_createAuthWit (account) | ✓ | sink |
| registerToken | accounts | | — | — | handler (popup) |
| isTokenRegistered | contracts | | — | ✓ | handler (reader) |
| getAccounts | accounts | | — | ✓ | handler |
| registerContract | contracts | | aztec_registerContract (network) | ✓ | sink |
| getContractMetadata | contracts | | aztec_getContractMetadata (network) | ✓ | sink |
| getContractClassMetadata | contractClasses | | aztec_getContractClassMetadata (network) | ✓ | sink |
| simulateTx | simulation | | aztec_simulateTx (account) | ✓ | sink |
| executeUtility | simulation | | aztec_executeUtility (account) | ✓ | sink |
| profileTx | simulation | | aztec_profileTx (account) | ✓ | sink |
| sendTx | transaction | | — | ✓ | handler (popup) |
| grantPublicAuthwit | transaction | | — | ✓ | handler (popup) |
| getPrivateEvents | data | | aztec_getPrivateEvents (network) | ✓ | sink |
| getAddressBook | data | | aztec_getAddressBook (network) | ✓ | sink |
| registerSender | data | | aztec_registerSender (network) | ✓ | sink |

This consistency is load-bearing for honesty: **the "fix latent inconsistencies inline" path will most likely be a documented no-op.** The discipline stays armed (derivation may surface a string-vs-kind mismatch static reading can't see), but the default expectation is a pure behavior-preserving refactor, and "no inconsistency surfaced — parity exact" is itself a ledger entry.

## Decision ledger

| # | Decision | Chosen | Rejected / from | Why |
|---|---|---|---|---|
| D1 | Descriptor shape | **Flat `Record<method, MethodDescriptor>`** | discriminated-union-by-capability; builder/DSL | UNANIMOUS (main/opus/codex). Capability, routing, scope are orthogonal axes — a DU buries them; a DSL hides a security seam behind helpers. One greppable literal row per method. |
| D2 | kind / context encoding | **`routing` discriminated union with ROUTE-NARROWED kind types** `{via:"network-operation", kind: NetworkOperationKind} \| {via:"account-operation", kind: AccountOperationKind} \| {via:"handler"}` (opus shape + codex narrowing) | loose `kind?`+`context?` (codex+main draft); un-narrowed `kind: Operation["kind"]` (rejected — codex showed `{via:"network-operation", kind:"send_transaction"}` would still typecheck, so the union wasn't actually closed) | Define `NetworkOperationKind` (the 7 network-only kinds) + `AccountOperationKind` (the 4 account kinds) as explicit sub-unions of `Operation["kind"]`. THEN illegal route/kind combos are genuinely unrepresentable — delivering the safety claim. |
| D3 | Kind-sets storage | **Per-method routing, aggregate up to kind-sets** | separate kind-level metadata block | UNANIMOUS. A separate kind-registry recreates the smell at the kind layer. Valid while method→kind is injective — **the parity test IMPOSES injectivity (build-break on violation), it is not a relied-on property.** |
| D4 | Import-cycle break | **New leaf module `method-scope-checkers.ts`** (checker bodies + helpers) + **`CapabilityType` moves OUT of `capability-map.ts`** into the registry/types module (codex back-edge fix) | data-only registry, checkers stay in scope-enforcement (opus); move `enforceScope` into registry (main) | Leaf ← registry ← facades, no cycle. opus confirmed the checker split has no hidden back-edge; codex caught the REAL back-edge — the descriptor importing `CapabilityType` from the facade reverses the seam. Define `CapabilityType` in the registry (or a `types.ts`); `capability-map.ts` re-exports it for its existing consumers. |
| D5 | Runtime defense | **Resolve descriptor at the top of `dispatch()` (after session capture `:322`, BEFORE `enforceCapability` `:326`); unknown method → throw, replacing the old `if(!kind)` at `:392`** (codex placement) | build-time exhaustiveness only | Defense in depth on the F1 class: "supported but missing metadata" impossible at runtime AND build time. Must reproduce the exact `Unsupported wallet method: ${methodName}` string the retired-method guards pin (**`dispatcher.test.ts:813/817/824`** — `getCompleteAddress`/`simulateViews`). Handler branches (`:353`) stay unchanged; do NOT derive handler behavior from `{via:"handler"}`. |
| D6 | Parity strategy | **Frozen 18-row snapshot + function-IDENTITY parity scoped to the 11 NAMED checkers** (opus+codex) | claiming identity for all 14 (rejected — vacuous for the 3 lifted arrows) | Lift inline arrows (`sendTx`/`simulateTx`/`profileTx`, scope-enforcement.ts:384,386,387 — confirmed the ONLY three) into named fns. Identity `===` proves no swap for the 11 pre-named checkers; the 3 lifted arrows have no stable prior identity, so their behavior rests on the existing dispatcher/scope tests (stated, not oversold). |
| D7 | XOR invariant | **`capability` required (`CapabilityType\|null`); `exemptReason` required-when-null** | implicit exempt | codex's "exactly one of capability XOR exempt" — a required field forces explicit intent; the assertion catches a forgotten capability silently meaning "exempt." |
| D8 | registerToken no-scope | **NOT a bug — preserve** (codex non-example) | "fix" it | Its session-account authz is inline in `handleRegisterToken()` (dispatcher.ts:593). Prevents a false-positive Phase-3 fix. Carried as a descriptor `note`. |
| D9 | Sync comments | **Delete the dead sync comments; CORRECT the stale-and-wrong one** | preserve | scope-enforcement.ts:9, scope-enforcement.ts:406 are dead → delete. **dispatcher.ts:987 is WORSE than dead — it is WRONG and authz-adjacent**: `enforceCapability`'s doc lists `getAccounts` as exempt, but `EXEMPT_METHODS` does NOT contain it (F-003 removed it; capability-map.ts:14,27). The descriptor migration must NOT transcribe this into `exemptReason` for `getAccounts` — that re-creates an F1-class hole on the `canGet` sub-grant. The frozen snapshot pins `getAccounts` as `capability:accounts`/NOT exempt; the comment is corrected/removed. (AUDIT/F-markers are PRESERVED as descriptor fields — distinct from the dead sync comments.) |
| D10 | Exhaustiveness universe (was A3) | **wallet-bridge-local: (i) the exhaustiveness TEST imports the schema-patch side-effect (established pattern, `dispatcher.test.ts:682`) and enumerates `Object.keys(WalletSchema)` post-patch (=18); (ii) a SEPARATE assertion over the 7 local `dispatch()` handler-branch literals** (both audits) | `WalletSchema ∪ WalletMethodSchemas` (rejected — `WalletMethodSchemas` is module-PRIVATE, not exported; `BatchedMethodSchema` excludes the customs) | The true choke point is `dispatch()`, not a schema. `requestCapabilities`/`batch`/`getAccounts` ARE upstream `WalletSchema` keys; the 3 customs become keys only post-patch — so the test imports the patch first (as `dispatcher.test.ts` already does), making the post-patch enumeration deterministic. The PRODUCTION runtime guard (D5) needs NO schema — it checks registry membership only, so there is no `extension`→`wallet-bridge` layer violation in production. |

## Descriptor shape (final)

```ts
// method-descriptors.ts — the single source of truth + the CapabilityType definition (D4: moved here from capability-map.ts to keep the seam one-directional)
import type { Operation } from "./operation"
import type { GrantedCapabilityRecord } from "./capabilities"
import * as checkers from "./method-scope-checkers"     // named checker bodies (leaf)

export type CapabilityType =
  | "accounts" | "contracts" | "contractClasses" | "simulation" | "transaction" | "data"

// D2: route-narrowed kind sub-unions so illegal route/kind combos are unrepresentable.
type NetworkOperationKind =
  | "aztec_getChainInfo" | "aztec_getContractClassMetadata" | "aztec_getContractMetadata"
  | "aztec_getPrivateEvents" | "aztec_registerSender" | "aztec_getAddressBook" | "aztec_registerContract"
type AccountOperationKind =
  | "aztec_simulateTx" | "aztec_executeUtility" | "aztec_profileTx" | "aztec_createAuthWit"

type ScopeCheck = (args: unknown[], grants: GrantedCapabilityRecord[]) => void
type MethodRouting =
  | { via: "network-operation"; kind: NetworkOperationKind }   // buildNetworkOperation
  | { via: "account-operation"; kind: AccountOperationKind }   // buildAccountOperation
  | { via: "handler" }                                          // popup / meta / reader (non-sink)

interface MethodDescriptor {
  capability: CapabilityType | null   // null ⟺ exempt (required field forces the choice — D7)
  exemptReason?: string                // required when capability === null (asserted — D7)
  routing: MethodRouting
  scopeCheck?: ScopeCheck              // function ref from the leaf; omit = no scope dimension
  audit?: string                       // F-/AUDIT markers preserved verbatim
  note?: string                        // rationale migrated from inline comments (e.g. D8 registerToken)
}

export const METHOD_REGISTRY: Record<string, MethodDescriptor> = { /* 18 rows */ }
```
> `NetworkOperationKind`/`AccountOperationKind` must stay assignable to `Operation["kind"]`; a compile check (`satisfies`) pins them as subsets so a future kind rename can't drift them silently.

**Derived (one-time at module load), each replacing a deleted table:**
`deriveCapabilityMap` · `deriveExemptSet` · `deriveMethodToKind` · `deriveNetworkOnlyKinds` · `deriveAccountKinds` · `deriveScopeCheckerMap`. Public API unchanged: `getRequiredCapability`/`isCapabilityExempt` (capability-map.ts facade, which now re-exports `CapabilityType` from the registry), `enforceScope`/`enforceScopeWithSession` (scope-enforcement.ts facade).

**Import topology (acyclic, D4):** `method-scope-checkers.ts` (leaf; imports `capabilities` types only) ← `method-descriptors.ts` (registry; owns `CapabilityType` + the kind sub-unions) ← { `capability-map.ts`, `dispatcher.ts`, `scope-enforcement.ts` } (facades). No facade type flows back into the registry. `scope-enforcement.ts` keeps `enforceScope`/`enforceScopeWithSession` + the F-005 `validateAccountScopes` helper (not a per-method checker, confirmed by both audits); the per-method checker bodies + their helpers (`matchesScope`, `grantsOfType`, `inAddressList`, type-guards) move to the leaf.

## The harness (proof of zero behavior change — built BEFORE the swap)

Two new test files (validation infra):

**`method-descriptors.parity.test.ts`** — asserts derived maps reproduce a FROZEN 18-row snapshot literal (hand-transcribed from the table above, reviewed before any consumer swap):
- `deriveCapabilityMap` deep-equals the 15-entry snapshot; `deriveExemptSet` set-equals `{getChainInfo, requestCapabilities, batch}`; `deriveMethodToKind` deep-equals the 11-entry snapshot; `deriveNetworkOnlyKinds`/`deriveAccountKinds` set-equal the 7/4-kind snapshots.
- `deriveScopeCheckerMap`: key-set equals the 14-name snapshot AND each derived checker `===` the original named checker (D6).
- Partition invariant (D3): `network ∪ account == methodToKind.values`, `network ∩ account == ∅`, method→kind injective. The `getChainInfo` edge (exempt AND network-routed) must round-trip.
- XOR invariant (D7): `capability === null ⟺ exemptReason` present.

**`method-descriptors.exhaustiveness.test.ts`** — the silent-omission killer (build failure on violation). Two complementary assertions (D10):
- **(i) Schema surface:** import the schema-patch side-effect FIRST (established pattern, dispatcher.test.ts:682), then `Object.keys(WalletSchema)` (post-patch = the 18) — assert every key has a descriptor + reverse-minus-allowlist (a descriptor key that no method uses is caught). NO reference to the private `WalletMethodSchemas`.
- **(ii) Local choke-point surface:** assert every method-name literal that `dispatch()` branches on (the 7 handler names: `requestCapabilities`, `getAccounts`, `isTokenRegistered`, `sendTx`, `registerToken`, `grantPublicAuthwit`, `batch`) has a descriptor. This pins the TRUE dispatchable surface independent of any upstream schema (codex: the choke point is `dispatch()`, not a schema).
- **Scope-or-note invariant:** every **non-exempt** method must have a `scopeCheck` OR an explicit `note` declaring intentional no-scope. Exempt methods (`getChainInfo`/`requestCapabilities`/`batch`) are excluded by construction, so `getChainInfo` (exempt, network-routed, no checker) does NOT trip it (codex self-consistency catch). `registerToken` (non-exempt, no checker — D8) carries the explicit `note` (authz inline in `handleRegisterToken`). This is the structural replacement for the deleted sync comments (D9).

## Phases

### Phase 0 — Worktree + frozen baseline
Create a parallel-safe e2e worktree (per repo e2e rules). Capture the current six tables as the snapshot literals (from the 18-method table). No production change.
**Gate:** `bun run typecheck:all` + `bun run lint` + `bun run --filter @nulo/wallet-bridge test` + `bun run test` all exit 0 (baseline green). Layers: typecheck/lint + unit.

### Phase 1 — Shadow registry + harness (ADDITIVE; old tables still present)
Add `method-scope-checkers.ts` (lift checker bodies + helpers out of scope-enforcement.ts; **lift the inline `sendTx`/`simulateTx`/`profileTx` arrows into named fns** — D6). Add `method-descriptors.ts` (18 rows, AUDIT/notes verbatim) + the six `derive*` fns. Add the parity + exhaustiveness tests. Do NOT rewire consumers — parity compares derived-vs-snapshot in isolation.
**Gate:** `bun run --filter @nulo/wallet-bridge test` (old tests green + parity + exhaustiveness green) + `bun run typecheck:all` (`noExplicitAny` clean) + `bun run lint`. Pass: parity EXACT against snapshots; exhaustiveness green. **STOP if parity not exact — the transcription is wrong; fix the data, not the test.** Layers: typecheck/lint + unit.

### Phase 2 — Swap consumers to derived maps; delete the six literals (the zero-change gate)
Rewire `capability-map.ts` / `dispatcher.ts` / `scope-enforcement.ts` to the derived exports; delete the six literals; keep `getRequiredCapability`/`isCapabilityExempt`/`enforceScope`/`enforceScopeWithSession` bodies + signatures stable; build switches untouched. Add the **dispatch-entry descriptor resolution** (D5) — placed after session capture (`:322`), before `enforceCapability` (`:326`), replacing the old `if(!kind)` throw (`:392`) — reproducing the exact `Unsupported wallet method: ${methodName}` string. Delete the dead sync comments (scope-enforcement.ts:9, :406); **correct the WRONG `getAccounts`-exempt comment at dispatcher.ts:987** (D9).
**Gate:** `bun run --filter @nulo/wallet-bridge test` — ALL existing `dispatcher.test.ts` (incl. F1 guards :1459-1544, **retired-method guards :813/:817/:824**, getRequiredCapability assertions :830-831) + `scope-enforcement.test.ts` green **UNCHANGED** + parity + exhaustiveness green. `bun run typecheck:all` + `bun run lint` + full `bun run test`. Pass: not one existing test modified; all green (== derived maps reproduce every entry of all six tables). Layers: typecheck/lint + unit. If a genuine bug surfaces here → Phase 3 discipline fires.

### Phase 3 — Latent-inconsistency lane (conditional) + add-a-method proof
Default expectation: clean (record "parity exact; no inconsistency" in the ledger). IF a real bug surfaces: (a) bug-pin test of OLD behavior, (b) fix the descriptor row, (c) corrected-behavior test, (d) `AUDIT Qx` marker + ledger entry; commit as `fix(wallet-bridge):` distinct from the `refactor:` commits. Every frozen-snapshot delta maps to a ledger entry (keeps real-fix vs regression auditable). D8 (registerToken) is a documented non-example — do not "fix." Add the add-a-method meta-proof, **scoped strictly to METADATA** (codex final-pass condition): adding one descriptor row centralizes a method's capability + routing-classification + scope FACTS in ONE place — that is the entire claim. It does NOT make a method "fully routable" in one edit: a sink method that introduces a NEW `Operation` kind still needs a case in the out-of-scope `buildNetworkOperation`/`buildAccountOperation` switches (dispatcher.ts:1089/1138), and a new HANDLER method still needs its own `dispatch()` branch. The win is "the authz/routing METADATA is single-edit + a forgotten method fails the build," not "method wiring is single-edit." Omitting the descriptor fails exhaustiveness + throws at the D5 runtime guard.
**Gate:** `bun run --filter @nulo/wallet-bridge test` (bug-pin + corrected tests green; snapshot deltas all ledgered) + `typecheck:all` + `lint`. Layers: typecheck/lint + unit.

### Phase 4 — Live validation (smoke + network e2e)
**Gate:** `bun run test:e2e` (smoke) green; `bun run e2e:agent` (network) green — at minimum a dApp `sendTx`/`simulateTx` routes, a scope-violating call is rejected, `grantPublicAuthwit` scope-checks, and the exempt `getChainInfo` path works. Layers: smoke e2e + network e2e (parallel-safe per worktree).

### Phase 5 — Docs + cleanup
Update `packages/wallet-bridge/README.md` "Custom RPC methods" / "Adding a capability" to name the registry as the single edit point (preserve the schema-patch ×3 contract verbatim). Update `CLAUDE.md`'s custom-RPC note if it references the old tables. Update `implementations-plan/index.md`.
**Gate:** `bun run lint` + `bun run audit:vue` (typecheck→test→lint→build) exit 0. Layers: typecheck/lint + unit + build.

## Security & Adversarial Considerations

- **Threat model:** a malicious/compromised dApp probes for a method reachable in `dispatch()` but absent from one authz table (the F1 class: `getRequiredCapability` null → `enforceCapability` [] → scope never runs). It would gain an unscoped capability (out-of-scope `sendTx`/`grantPublicAuthwit`).
- **Primary mitigation (defense in depth):** (1) build-time exhaustiveness test → a method without a descriptor fails CI; (2) runtime dispatch-entry resolution (D5) → unknown/descriptor-less method throws. Both strictly stronger than today's comment-only sync.
- **Core invariant (D7):** every supported method has exactly one of `capability` or `exemptReason`. Anything else is an authz hole — asserted.
- **Least privilege preserved byte-for-byte** (parity + function-identity). F-003 (`getAccounts` canGet), F-004 (`getAddressBook`/`registerSender` addressBook), F-005 (account-scope arrays) checker bodies move modules but are referenced by identity — unchanged. Enforcement ORDER (`enforceCapability` → `enforceScope`, dispatcher:326-349) and the F-005 empty-`calls` fast-path closure preserved.
- **Inline-fix risk (Phase 3):** behavior changes on the authz boundary are bug-pinned + ledgered + codex-audited, auditably distinct from regressions.
- **Residual reviewer-trust seam (accepted):** the exhaustiveness "scopeCheck OR explicit `note`" escape hatch (D10) is mechanically safe only when the `note` is honest — a future method could carry a bogus `note` to skip scope enforcement. Today it is justified solely by `registerToken` (authz inline in `handleRegisterToken`, dispatcher.ts:593). This is strictly stronger than the status quo (no guard at all), but `note` is human-authored, not machine-proven — so any new `note` is a code-review focal point + a codex-audit item. Not closing it further here (would require modelling "authz handled elsewhere" structurally — out of scope).
- **Least privilege / supply chain:** no new deps, tokens, or network surface; CI tokens unchanged; `@aztec/wallet-sdk` stays pinned (schema-patch drift guard depends on it); the `aztec-runtime` layer ban is preserved (registry imports only intra-package types).

## Assumptions

**Facts (verified):**
- Six tables + consumption sites exactly as tabulated. Tables: capability-map.ts:18,21; dispatcher.ts:251,272,286; scope-enforcement.ts:379. Accessor functions: capability-map.ts:60 (`getRequiredCapability`),:67 (`isCapabilityExempt`). Consumption: dispatcher.ts:326-349,392,1001-1003,1064,1069; scope-enforcement.ts:409,430.
- `requestCapabilities`/`batch`/`getAccounts` ARE upstream `WalletSchema` keys (wallet.ts:551,584,623); the 3 customs are schema-patched, not upstream; all three reachability-pinned (dispatcher.test.ts:677,998,1345). `WalletMethodSchemas` is module-PRIVATE (not exported); only `WalletSchema` + `BatchedMethodSchema` are public.
- The stale-and-WRONG comment: dispatcher.ts:987 lists `getAccounts` as exempt; `EXEMPT_METHODS` (capability-map.ts:18) does not contain it (F-003). `handleBatch` re-enters `dispatch()` per leg, refusing only `sendTx`/`registerToken` (dispatcher.ts:481-500).
- `METHOD_SCOPE_CHECKER` holds real closures depending on module-private helpers (scope-enforcement.ts:33,42,47,234-248); `sendTx`/`simulateTx`/`profileTx` are inline arrows (:384-387).
- Popup methods short-circuit before the kind lookup (dispatcher.ts:382-390); no `METHOD_TO_KIND` entry.
- F1 fixed + pinned (capability-map.ts:43-48; dispatcher.test.ts:1459-1544). F-003/F-004/F-005 markers at scope-enforcement.ts:306,325,352. (The stronger claim "the 18-method matrix has NO latent authz bug" is an INFERENCE from static reading — see Inferences — not a source-proven fact; Phase 3 is where derivation would surface one if it exists.)
- Commands real: `typecheck:all`, `lint`, `test`, `test:e2e`, `e2e:agent` (root package.json); `e2e:agent` parallel-safe per worktree.
- `noExplicitAny: error`; `aztec-runtime` import banned for this layer (biome).

**Inferences (attack these):**
- The canonical routable universe = `WalletSchema` post-patch (18) ≡ the 7 `dispatch()` handler literals ∪ the 11 kind-routed methods. RESOLVED → D10 (dual assertion). Both audits verified the schema keys; the local-dispatch assertion is the independent belt-and-suspenders.
- method→kind injective today; kind-sets derive exactly from per-method routing. **The parity test IMPOSES this (build-break on a future shared kind)** — not relied upon as a stable property (opus/codex).
- The leaf-module split (D4) is the right cycle-break (both audits confirmed no checker back-edge); the only real back-edge was the `CapabilityType` import, relocated. Lifting checker bodies won't disturb `enforceScopeWithSession`/F-005 (verified — `validateAccountScopes` stays in the facade).
- Phase 3 is small/empty (the 18-method matrix is internally consistent — no latent authz bug). **If it balloons, STOP and resurface** (not a scope-expansion license). Guard against the inverse risk (opus): a real surfaced inconsistency — e.g. the stale `getAccounts` comment — must be bug-pinned, not rationalized away.

**Asks (user decisions):**
- **All planning Asks are now resolved** (no open item blocking the gate). A3 → D10 (wallet-bridge-local dual-assertion universe; `WalletMethodSchemas` rejected as private). A1 (isTokenRegistered gating) → preserve verbatim. A2 (cycle-break) → leaf module + `CapabilityType` relocation (D4). Listed for traceability.

## Out-of-scope observations (deferred — NOT this plan's job)
- **Raw-protocol `batch` recursion** (codex): `handleBatch` refuses only `sendTx`/`registerToken` legs, so a raw protocol client could batch `grantPublicAuthwit`/`isTokenRegistered`/`requestCapabilities`/nested `batch`. Each leg DOES re-enter `dispatch()` and gets full capability+scope enforcement + (post-refactor) descriptor resolution, so it is not an authz BYPASS — but whether those methods *should* be batchable at all is a policy question independent of this metadata refactor. **This refactor preserves the current batch-leg policy verbatim.** If tightening is wanted, it is a separate `/harden`-style follow-up, explicitly NOT in scope here (locked decision: no scope beyond the registry).

## Audit verdicts

- **Contradiction-check + adversarial (codex, resume of the drafting session):** `conditional approve` — conditions: (1) re-spec A3 → done (D10); (2) narrow `MethodRouting.kind` by route → done (D2); (3) remove the registry→`capability-map` `CapabilityType` back-edge → done (D4); (4) scope the "one row fully gates" claim to metadata → done (Phase 3). All four folded in. Transcript: `audit-codex.md`.
- **Fresh hostile audit (opus, no prior context):** `reject` — 1 substantive (A3 universe, incl. the import-order + private-symbol problems → done, D10) + 4 tightenings (D5 test-cite → done; D5 throw-ordering → analyzed, no test asserts ordering; D6 identity scoped to 11 → done; stale `getAccounts`-exempt comment → done, D9). All folded in. Transcript: `audit-opus.md`.
- **Convergence:** both families independently flagged A3 as the one real blocker; everything else was a tightening. Core design (flat registry, derive-six-tables, harness-before-swap, leaf-module cycle-break, dual runtime+build guard) unchallenged.
- **Final fresh-context codex pass (NEW session on the revised plan):** `conditional approve` — confirmed D2/D4/D9/D10 are genuine fixes (not reworded); confirmed the test-side patched-`WalletSchema` enumeration is an established repo pattern (dispatcher.test.ts:677,998,1345), NOT a production `extension→wallet-bridge` layer edge. One condition: scope the Phase-3 "fully routable in one edit" claim to METADATA only (a new kind still needs the out-of-scope builder switch) → done. Two rigor folds: relabel "no latent bug" as inference → done; acknowledge the `scopeCheck OR note` reviewer-trust residual → done. Transcript appended to `audit-codex.md`.
- **Net:** three independent audit passes (codex resume + fresh opus + fresh codex) all reach conditional-approve/reject-with-conditions; every condition is folded in; the core design was never challenged. Ready for the approval gate.

## Seeds
_Finalized after the approval gate (see eli5.html for drafts)._
