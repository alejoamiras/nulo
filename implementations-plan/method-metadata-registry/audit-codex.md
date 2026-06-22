# Codex audit transcript — Q1 plan (deep)

Two passes: (1) independent draft (`draft-codex.md`), (2) contradiction-check + adversarial + assumption-attack on the consolidated `plan.md` (this file). Session `019ecb8e`.

## Round 2 — contradiction-check + adversarial audit

**Verdict:** `conditional approve (conditions: replace A3 with a concrete patched-WalletSchema + local-dispatch-surface enumeration; narrow MethodRouting.kind by route; remove the registry→capability-map back-edge; scope the "one row fully gates a method" claim to metadata only)`.

### Findings
- **A3 wrong, security-relevant.** `WalletMethodSchemas` is private upstream, NOT exported (only `BatchedMethodSchema` + `WalletSchema` are; wallet.ts:535,619). The true local surface is `dispatch()`; `handleBatch()` re-enters `dispatch()` on arbitrary `method.name`, rejecting only `sendTx`/`registerToken` (dispatcher.ts:481). A schema-only universe can mis-describe the local choke point.
- **D2 doesn't deliver claimed safety.** Shape uses `kind: Operation["kind"]` for both routed variants (plan:74); `Operation["kind"]` includes wrong-route/non-builder kinds (`register_token`, `send_transaction`, `aztec_createAuthWit`; operation.ts:14,52,108). Current methods expressible (incl. exempt+network `getChainInfo`) but the type is NOT closed against illegal states.
- **D4 contradicts its own layering.** Descriptor snippet imports `CapabilityType` from `./capability-map` (plan:68) — `import type` avoids a runtime cycle but reverses the intended seam. Move `CapabilityType` out of the facade.
- **"One row fully gates" overstated.** 7 methods still require explicit handler branches in `dispatch()` (dispatcher.ts:353). Registry centralizes metadata; doesn't make handler behavior single-edit.
- **Factual slips.** F1 narrative says `grantPublicAuthwit` was wired into `METHOD_TO_KIND` (plan:9) — popup methods have no `METHOD_TO_KIND` entry (dispatcher.ts:251,379). "Unsupported wallet method" pin cited to wrong block; real guards at dispatcher.test.ts:813.

### Facts (codex-verified)
- `requestCapabilities`, `batch`, `getAccounts` ARE upstream `WalletSchema` keys (wallet.ts:551,584,623).
- `registerToken`/`isTokenRegistered`/`grantPublicAuthwit` are Nulo-custom + schema-patched, not upstream; reachability-pinned (dispatcher.test.ts:677,998,1345) — reran, all pass.
- `BatchedMethodSchema` excludes `batch` itself + the three customs; covers only the 14 upstream batchable names (wallet.d.ts:2845).
- Only inline closures in `METHOD_SCOPE_CHECKER` are `sendTx`/`simulateTx`/`profileTx` (scope-enforcement.ts:379). D6 correct on that narrow point.

### Inferences
- D2 safe for today's 18 (incl. exempt+network `getChainInfo`) only as an encoding convenience — not a real type-safety upgrade unless `kind` is narrowed per route.
- D4 breaks the cycle if all per-method checker helpers move to the leaf; no checker depends on `validateAccountScopes` (can stay in scope-enforcement.ts:367). The hidden back-edge is the `CapabilityType` import, not the checker split.
- D5 viable if the descriptor guard sits immediately after session capture (dispatcher.ts:322) and before `enforceCapability` (:326); keep handler branches (:353) unchanged; replace old `if (!kind)` (:392) with descriptor-based routing. Do NOT derive handler behavior from `{via:"handler"}`.
- Harness rule (plan:108) implies `getChainInfo` needs a scopeCheck or note (it's `routing≠handler`, no checker) → make explicit or the first exhaustiveness test fails on the plan's own matrix.

### Asks
- Replace A3 with a concrete universe: the 18 local methods. Enumerate direct-call methods from patched `WalletSchema` in the SAME Vitest-style module graph as existing reachability tests, then a SEPARATE assertion for the local raw-batch/handler surface. Do not reference `WalletMethodSchemas`.
- Narrow `MethodRouting.kind` to `NetworkOperationKind`/`AccountOperationKind`, or downgrade D2's rationale.
- Decide whether raw-protocol `batch` is intentionally allowed to recurse `grantPublicAuthwit`/`isTokenRegistered`/`requestCapabilities`/nested `batch` (dispatcher.ts:492). If yes, document; if no, separate hardening follow-up.

## Round 3 — final fresh-context pass (NEW session on the revised plan)

**Verdict:** `conditional approve (conditions: remove the Phase 3 claim that a new kind-routed method is fully routable from one descriptor row; scope that proof to metadata only, because current sink methods still require the out-of-scope builder switches in dispatcher.ts:1057/1089/1138.)` — folded in.

- D10 actually fixed: test-side patched-`WalletSchema` enumeration is an accepted repo pattern (dispatcher.test.ts:677,998,1345 all import the production patch; patch self-documents drift-pinning at nulo-schema-patch.ts:15). Test-only dependency, NOT a production `extension→wallet-bridge` edge. The real local handler surface = the 7 literals at dispatcher.ts:354.
- D2 real fix: route-specific kind sub-unions make illegal pairs untypeable before the builders.
- D4 real fix: re-exporting `CapabilityType` from capability-map.ts preserves the public path (index.ts:15); no in-tree consumers of `CapabilityType` found. Residual: the type def still hand-spells the 6 discriminator strings (it's the definition — acceptable).
- D9 sufficient with the harness: the comment is wrong (dispatcher.ts:987); exempt set is only the 3 (capability-map.ts:18); existing tests already pin getAccounts non-exempt (dispatcher.test.ts:364,374); snapshot+exhaustiveness make it no-longer-comment-trust.
- Adversarial residuals (all preserved-not-introduced): the `scopeCheck OR note` escape hatch is mechanical only for honest notes (justified today by registerToken); raw-protocol `batch` recursion (only sendTx/registerToken refused). "No latent authz bug" is an inference, not a fact. Phase sequencing correct (harness before swap; Phase 2 requires existing tests green unchanged). Wording: root `bun run test` is the extension suite (package.json:16), not a repo-wide sweep.

## Round 1 — independent draft
See `draft-codex.md`.
