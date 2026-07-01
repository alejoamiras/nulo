# P15 · Q-04 + Q-05 — OperationPolicy registry + Capability strategy · tier: **deep** (TRUST-BOUNDARY)

Coupled per the arc plan (the harden report's coupling exception: Q-04+Q-05 land together). Both erase a discriminated union to `Record<string, unknown>` / `unknown[]` at a trust boundary and mirror per-kind logic across sites. **This is the dApp permission boundary** — the authz proof is the frozen oracle + the adversarial-bypass suite, NOT network e2e.

## STEP 1 re-verify (vs `dev-quality` HEAD `7a28f89`) — BOTH VALID
- **Q-04:** `OperationKind = "transfer" | "dapp_execute" | "token_import"` (`operation-journal/spec.ts:36`); the materializer returns `MaterializedOperation = MaterializedSendLike | MaterializedNonSend` where each arm is `{ kind; … } & Record<string, unknown>` (`dapp-interaction/materialize.ts:44-61`), then `service.ts:294` does `operations.push(materialized as unknown as Operation)`. The executable `Operation` union is imported by `execution/service.ts:37` + `execution/client.ts:10`. The popup has a parallel `DraftOperation` (`popup/windows/execute/types.ts:33-58`). VALID.
- **Q-05:** `Capability` union = `AccountsCapability | ContractsCapability | ContractClassesCapability | SimulationCapability | TransactionCapability | DataCapability`, each discriminated by `type` (`capabilities.ts:16-59`), wrapped in `GrantedCapabilityRecord { capability: Capability; grantedAt }` (`:61`). Erased to `capabilities?: unknown[]` (`dispatcher.ts:241`) + the coverage predicates cast back via `cap as unknown as AccountsCapability` / `ContractsCapability` / `TransactionCapability` / `SimulationCapability` (`dispatcher.ts:731,740,748,754`). `CapabilityType` already exists (`capability-map.ts:17`). VALID.

## Frozen oracle (HARD LIMIT — keep green + byte-UNEDITED)
`packages/wallet-bridge/src/method-descriptors.test.ts` — `FROZEN_CAPABILITY_MAP` (method→capability), `FROZEN_METHOD_TO_KIND` (method→kind), `FROZEN_EXEMPT` (`getChainInfo`/`requestCapabilities`/`batch`), `FROZEN_NETWORK_ONLY`, `FROZEN_ACCOUNT`. **Adversarial-bypass anchors** (must stay green): `dispatcher.test.ts`, `scope-enforcement.test.ts`. The refactor centralizes logic these tests already pin — a regression = a red bypass test, which is the whole point of keeping them.

## Decision ledger (main research; codex leg PENDING — `blueprint deep` audit)
- **NO base class.** Both findings want a *registry/strategy table*, not inheritance — the union members have disjoint fields (an `AccountsCapability` has `accounts`, a `TransactionCapability` has `scope`), so a base class would reintroduce `unknown` at the shared slot. Use a `type`-keyed record of pure functions (mirrors the Q-13 free-fn decision + the Q-12 descriptor-registry decision).
- **Q-05 `CapabilityStrategy`:** parse the wire `unknown[]` ONCE into `Capability[]` at the dispatcher entry, then a `Record<Capability["type"], { parse; covers; delta; merge; enrich; check }>` table. The dispatcher coverage predicates (`dispatcher.ts:694-967`) and the call-time enforcement (`method-scope-checkers.ts:42-370`) currently MIRROR each other per capability type — unify each pair into the table's `covers`/`check`. **This is the authz-critical dedup: the two must never drift** (a coverage predicate saying "granted" while the scope-checker says "denied", or vice-versa, is a bypass). The codex leg must enumerate every mirror pair before implementation.
- **Q-04 `OperationPolicy`:** a `Record<OperationKind | MaterializedKind, { accessLevel; materialize; validateSession; dispatch; ui }>` table replacing the `as unknown as Operation` cast + the parallel `DraftOperation`. Export ONE `DraftOperation` + `assertExecutableOperation` at the model seam. Note the two kind vocabularies: `OperationKind` (journal: transfer/dapp_execute/token_import) vs the materializer `kind` (aztec_sendTx/send_transaction/register_contract/…) — the plan must reconcile which keys the policy table (likely the materializer kind, with the journal kind derived).
- **Two PRs or one?** Lean: **two stacked PRs on one branch** (Q-05 capability strategy first — it's self-contained in `wallet-bridge`; then Q-04 operation policy in the extension, which is broader), each independently gated, merged together after both green. Q-04 does NOT depend on Q-05's types. Codex to confirm the split.

## Security / adversarial (TRUST-BOUNDARY — the whole point)
Fail-open landmines the plan MUST pin (each with a `.rejects`/denied test, and the frozen oracle + bypass suite kept green):
1. **`getOperationAccessLevel` / per-kind access default MUST be the MOST restrictive** (e.g. `AccessLevel.Transactions` or a deny), never a permissive fallback. A registry `table[kind] ?? <default>` where the default is permissive is a silent privilege escalation for an unknown kind. Confirm the current default + preserve-or-tighten (never loosen — a loosening is a HARD-LIMIT permission-semantics change → halt+surface).
2. **Dispatcher-coverage ↔ scope-checker-enforcement equivalence.** Unifying the mirror into one `covers`/`check` must be PROVABLY equivalent to today's two implementations (characterization tests capturing current allow/deny verdicts for a matrix of (capability, request) pairs BEFORE the refactor, then driving the SAME matrix through the unified table — like the Q-12 snapshot-as-migration-proof).
3. **`as unknown as XCapability` smuggling.** The parse-once step must VALIDATE each wire capability into its typed form (reject/drop malformed), not just cast — a cast that accepts a malformed capability could smuggle a wrong-typed grant past enforcement. The parser is a trust boundary: it must be at least as strict as the casts it replaces (mirrors the Q-01 "decoder never laxer than the cast" rule).
4. Batch-forbidden set + `registerContractClass` stub + `register_token` anti-phishing special case (from the arc's landmine list) — confirm none are weakened.

## Phasing + gate (DEEP — codex leg refines)
- **P15.0** characterization pins: capture the current allow/deny matrix for the dispatcher-coverage + scope-checker pairs (RED-proof harness) BEFORE any change; capture the current per-kind access levels. These become the equivalence oracle.
- **P15.1 (Q-05)** `CapabilityStrategy` table in `wallet-bridge`: parse-once → `Capability[]`, unify covers/delta/merge/enrich/check; delete the `as unknown as` casts. Gate: wallet-bridge units + **`method-descriptors.test.ts` + `dispatcher.test.ts` + `scope-enforcement.test.ts` green & the two former UNEDITED** + the P15.0 equivalence matrix + smoke + full network.
- **P15.2 (Q-04)** `OperationPolicy` table + shared `DraftOperation` + `assertExecutableOperation`; delete the `as unknown as Operation` cast + the popup duplicate. Gate: dapp-interaction + execution + popup units + the access-level matrix + smoke + full network.
- Per-arc tail: `/code-review max --fix` → codex post-impl (adversarial: attack the unified authz path). After this registry-cluster phase, **re-run the frozen oracle + the full adversarial-bypass suite vs the new HEAD** (arc rule).

## Assumptions
- **Facts (main-verified):** the erasure casts + union shapes cited above (file:line); the frozen oracle is `method-descriptors.test.ts`; the bypass anchors are `dispatcher.test.ts` + `scope-enforcement.test.ts`.
- **Inferences (codex to attack):** Q-04 ⟂ Q-05 (no shared types → separable PRs); a `type`-keyed table can express every current per-kind branch without `unknown`; the current access-level default is already restrictive (MUST verify — if it's permissive today, that's a pre-existing finding to surface, not silently "fix").
- **Asks (surface, do NOT self-resolve):** any place the unified `covers`/`check` would change a real allow/deny verdict = a permission-semantics change = HARD-LIMIT halt+surface. The refactor is behavior-preserving ONLY; a genuine authz bug found en route gets surfaced as a separate tracked finding.

## codex deep-audit (`d5JcE5Ov`) — **PLAN-NEEDS-REVISION** + ⚠ SURFACED OWNER DECISION

codex enumerated the mirror pairs + attacked the landmines. Material corrections to the plan above:

### FACT CORRECTION — the access default is NOT the safety net (my Fact was wrong)
The real path: `isConfirmationNeeded` (`dapp-interaction/service.ts:437-465`) → `getAccessLevel` (`:467-473`) → `getOperationAccessLevel` (`:475-515`). Unknown kind → `AccessLevel.None` at `:513-514`, BUT sessions seed `AccessLevel.Transactions` (`wallet-sdk/background.ts:565-570`) so an unknown kind **would not prompt by access level** — today it fails only because `materializeRequest` THROWS on unknown kind (`materialize.ts:125-127`). ⇒ **The `OperationPolicy` registry MUST have NO permissive fallback**, and MUST preserve the materializer-throw-on-unknown as the hard stop (don't let the registry swallow an unknown kind into a silent default). This is the #1 fail-open risk for Q-04.

### Two PRE-EXISTING permission drifts (codex-confirmed) — PRESERVE, characterize, surface
| drift | coverage says | enforcement says |
|---|---|---|
| **`contractClasses` field-widening** (`dispatcher.ts:760` type-only fallback vs `method-scope-checkers.ts:97-106`) | re-request wider `classes`/`canGetMetadata` after an existing grant → **no prompt** | can **deny** |
| **`data.addressBook`** (`dispatcher.ts:756-758` checks only `privateEvents`) | existing data grant makes `{addressBook:true}` look **covered** | `getAddressBook`/`registerSender` later **deny** |

codex's Ask: **characterize + PRESERVE these as explicit oracle cases; do NOT silently "fix" them in this refactor** (bundling a permission-tightening into a "behavior-preserving" refactor is unreviewable + dangerous at the trust boundary).

### ⚠ SURFACED OWNER DECISION (hard limit — dApp-permission-semantics; NOT self-resolving)
**The approved arc plan (meta `plan.md` P15 line) says: "ADD the missing `contractClasses` delta branch — a fail-CLOSED fix." codex says: PRESERVE the drift, surface it, do NOT fix in this PR.** These conflict, and BOTH are permission-semantics calls (`contractClasses` fix = a fail-CLOSED tightening; `data.addressBook` = an un-pinned drift). Per the arc's HARD LIMITS ("any dApp-permission-semantics or fail-open/closed change not already pinned → halt+surface") + the AFK rule ("codex can't override approved plan scope → surface the conflict"), I am NOT deciding this autonomously. **Owner must choose:**
- **(A) PRESERVE both drifts** (codex's rec): P15 is a strictly behavior-preserving refactor; the 2 drifts are characterized as oracle cases + filed as separate findings for a later fail-CLOSED fix PR. Safest; keeps P15 reviewable. ← my default pending your call.
- **(B) FIX `contractClasses` fail-CLOSED in P15** (meta-plan intent) + preserve/surface `addressBook`: bundles one permission-tightening into P15.
- **(C) FIX both** fail-CLOSED in P15.

Default while awaiting the decision: **(A)** — proceed behavior-preserving so no permission semantics change autonomously.

### DESIGN REVISION — the flat `Record<type,strategy>` is insufficient
codex: the table must support **cross-type checks** (`createAuthWit` is an `accounts` method that also consumes `simulation.transactions` + `transaction` grants — `dispatcher.ts:217-233`, `279-303`; scope-checker `method-scope-checkers.ts:145-186`,`279-303`) and **per-kind exceptions** (`register_token` always-confirm anti-phishing; send-like `feeSettings` gating). ⇒ the strategy table needs a composition hook (a capability can reference OTHER capabilities in its `check`), not a pure per-type isolate. Redesign the table signature to pass the FULL granted `Capability[]` into each `covers`/`check`, not just the same-type slice.

### PARSE-ONCE — must NOT filter or coerce
Wire caps are intentionally `unknown[]` (`dapp-interaction-protocol.ts:143-153`); dispatcher casts at `:704`; NO schema validation today; unknown caps currently reach the popup + are **default-off** (`popup/windows/capabilities/build-items.ts:38-56`). ⇒ parse-once must PRESERVE that: do NOT filter unknowns (hides the warning/default-off path), do NOT coerce malformed known caps (never default a missing `scope`/list to `"*"` — that's a fail-OPEN). "Parse" here = type-narrow the shape the code already trusts, keeping unknown/malformed handling byte-identical.

### P15.0 matrix EXPANSION (codex)
The characterization oracle must cover: malformed/unknown caps, `addressBook`, `contractClasses` widening, `createAuthWit` tx/sim coupling, F-005 account scopes, batch-forbidden methods, `registerToken` per-call confirmation. `method-descriptors.test.ts` (FROZEN_*) pins method metadata but is NOT enough for request-capability coverage — keep `dispatcher.test.ts` + `scope-enforcement.test.ts` + ADD popup capability default-off + `DappInteractionService` access/materialization tests.

> **Status:** codex audit incorporated. **BLOCKED on the SURFACED OWNER DECISION above** (drift fix-vs-preserve) before finalizing the Q-05 covers/check design. Q-04 (OperationPolicy, no-permissive-fallback) + P15.0 (characterization matrix, which captures current behavior regardless of the A/B/C choice) can proceed behavior-preserving under default (A). Next: build P15.0 the equivalence oracle (safe under any choice), then implement per the owner's drift decision.
