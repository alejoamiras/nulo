# Codex — independent planning plan (Round 0)

Session: 019ed76c-1dc7-7aa1-b46a-5f6de7e940b2 · xhigh · read-only
Brief: /tmp/fuel-direct-bridge-brief.md (the shared three-planner brief)

---

Feasible, but the biggest risk is not the L1 deposit. It is the private standalone claim model plus the current shared UI state. The private path looks implementable as a carrierless embedded-FPC tx, but that needs to be proven first because the existing code only uses `privateMintAndPayFee(...)` as fee on `bridge.claim_private(...)` [useDeposit.ts:255](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:255). Separately, a naive third `FuelView` is unsafe because `App.vue` keeps views mounted with `v-show` [App.vue:46](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/App.vue:46), while `BridgeForm` and `BridgeJournal` already own global foreground/journal state [BridgeForm.vue:56](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/components/BridgeForm.vue:56) [BridgeJournal.vue:49](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/components/BridgeJournal.vue:49).

**Phases**
1. Prove the private standalone claim model first.
- Add a focused spike that builds `privateMintAndPayFee(...).getExecutionPayload()` and drives it through `wallet.simulateTx` / `wallet.sendTx` directly, with no carrier call.
- Extract fuel-specific config from the dead swap config: a canonical portal address source, canonical L1 fee-asset source, and a renamed private minimum self-pay floor.
- Fail closed if the portal / underlying / pinned FPC assumptions do not match.
- Validation gate: `bun run --cwd packages/bridge-core test && bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run --cwd packages/faucet test:e2e && bun run lint && bun run typecheck:all`
- Pass criteria: new unit tests prove the payload shape, fee payer, and mocked wallet call path; no existing bridge smoke regressions. If this spike fails, stop before UI work.

2. Generalize the deposit/journal model instead of inventing `direction: "fuel"`.
- Keep `direction: "deposit"`. Add a new deposit discriminator such as `assetKind: "bridge-token" | "fee-juice"`.
- Bump the record schema to `3`. This is not safely additive; an older client must not misread a fee-asset deposit as a token bridge.
- Add only the fee-only private fields needed for recovery and claim rebuild, e.g. `bridgeSecretSalt` and `fpc`.
- Refactor `runDepositClaim` to resolve claim material by variant, not by bare `secretHex`.
- Generalize `deploymentMatches`, backup restore/export, receipt snapshot, phase rail, and toasts to branch on `assetKind`.
- Validation gate: `bun run --cwd packages/bridge-core test && bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run --cwd packages/faucet test:e2e && bun run lint && bun run typecheck:all`
- Pass criteria: schema/backup/journal tests green; existing Bridge flow still passes unit, component, and smoke-e2e unchanged.

3. Implement the direct fee-asset deposit and standalone claims.
- Add a module-singleton `useL1FeeAsset` composable mirroring `useL1Usdc`, but only for `balanceOf`, `allowance`, `approve`, and refresh.
- Public Fuel deposit: approve the canonical `FeeJuicePortal`, call `depositToAztecPublic(recipient, amount, secretHash)`, and claim with sponsored `FeeJuice.claim_and_end_setup(...)`.
- Private Fuel deposit: still call `depositToAztecPublic`, but deposit to `PRIVATE_FPC_ADDRESS` with `privateFuelSecretHash(salt, claimer)` and claim with raw embedded-FPC execution payload from `privateMintAndPayFee(...)`.
- Parse `DepositToAztecPublic` from `FeeJuicePortalAbi` for the leaf index, not `Inbox.MessageSent`.
- Enforce the private minimum amount locally before any irreversible tx.
- Validation gate: `bun run --cwd packages/bridge-core test && bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run --cwd packages/faucet test:e2e && bun run lint && bun run typecheck:all`
- Pass criteria: unit tests cover deposit arg construction and both claim builders; smoke-e2e covers mocked public and private happy paths plus low-amount rejection.

4. Expose the Fuel UX through one shared foreground owner.
- Do not mount a second independent journal/stepper/receipt owner under a hidden view. Either refactor Bridge/Fuel into a shared transfer shell, or keep a top-level Fuel tab but move the singleton foreground surface above both forms.
- Add Fuel-specific copy, selectors, receipt rows, journal card labels, and recovery affordances.
- Private Fuel should omit the current `SEAL` phase; it needs durable record persistence and backup, not the token-bridge bearer-secret flow.
- Run the hardening pass: strict validator coverage for new fields, no secret/salt logging, no public fallback on private flows, mismatch fail-closed.
- Validation gate: `bun run --cwd packages/bridge-core test && bun run --cwd packages/faucet typecheck && bun run --cwd packages/faucet test && bun run --cwd packages/faucet test:e2e && bun run lint && bun run typecheck:all`
- Pass criteria: all local gates green, new Fuel component tests added, new Fuel smoke-e2e scenarios added.

**DQ Verdicts**
- `DQ1`: choose a carrierless raw embedded-FPC tx, not a fake no-op carrier and not a public downgrade. The repo evidence supports this: wallet APIs accept raw `ExecutionPayload`s [wallet.ts:277](/Users/alejoamiras/Projects/nulo/nulo-4/node_modules/@aztec/aztec.js/src/wallet/wallet.ts:277), `sendTx` does not require a separate app call [base_wallet.ts:413](/Users/alejoamiras/Projects/nulo/nulo-4/node_modules/@aztec/wallet-sdk/src/base-wallet/base_wallet.ts:413), and the planner already handles minimal payloads [operation-planner.test.ts:213](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/operation-planner.test.ts:213). I would send the Wonderland payload itself as the tx body. The offline proof is mock-wallet unit/component/e2e coverage; live settlement remains deferred sign-off.
- `DQ2`: reuse the deposit journal and engine, but with a schema bump and `assetKind` discriminator. Do not add `direction: "fuel"`, and do not create a second lightweight journal. New phases stay `APPROVE → DEPOSIT → CROSSING → CLAIM → CONFIRM`; private fee-juice skips `SEAL`.

**Security & Adversarial Considerations**
- Wrong portal / wrong L1 asset is the first theft/stranding risk. Resolve the canonical portal from the node, read `UNDERLYING()` from the portal, and fail closed on mismatch.
- The private secret derivation is non-negotiable. A random secret strands funds forever; private Fuel must use `deriveBridgeSecret(salt, claimer)` and persist the salt durably.
- The pinned `PRIVATE_FPC_ADDRESS` is version-specific and depends on a GitHub-release tarball dependency [package.json:28](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/package.json:28). Keep the existing tripwire tests and refuse drift.
- Current backup validation is not truly strict for existing private-fuel extras; adding Fuel is the wrong time to leave that loose [journal.ts:82](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:82) [backup.ts:109](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/backup.ts:109).
- Hidden mounted views are an integrity bug surface, not just a UX nuisance. A hidden form or journal can react to another flow’s `activeFlowId` and double-toast or mis-render a receipt.
- Public sponsored claim is testnet-only. Keep that path explicitly bounded to the current test deployment; never let Fuel silently normalize sponsored claiming beyond that.
- No swap removes the `setSwapTarget` witness-binding class of risk, but it does not remove configuration-binding risk. The portal/underlying/FPC bindings become the new critical trust edges.
- XSS and local-storage tamper are still high impact. Even when secrets are recipient-bound, deletion or mutation can strand funds. Do not log secrets or salts; keep backup export sealed.

**Assumptions**
Facts
- Public standalone Fee Juice claim already exists and is sponsored/idempotent [useDeposit.ts:149](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:149).
- The private fuel helper is a pinned two-call payment wrapper with FPC as fee payer [private-fuel.ts:65](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/private-fuel.ts:65) [private-fuel.test.ts:95](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/private-fuel.test.ts:95).
- The installed `FeeJuicePortal` ABI exposes `UNDERLYING()` and `depositToAztecPublic(...)` [FeeJuicePortalAbi.js:395](/Users/alejoamiras/Projects/nulo/nulo-4/node_modules/@aztec/l1-artifacts/dest/FeeJuicePortalAbi.js:395) [FeeJuicePortalAbi.js:2929](/Users/alejoamiras/Projects/nulo/nulo-4/node_modules/@aztec/l1-artifacts/dest/FeeJuicePortalAbi.js:2929), and the existing private FPC fixture also uses that public deposit path [aztec-private-fpc-bridge.ts:93](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:93).
- Journal deployment matching and backup restore are hard-coded to the token bridge deployment today [useBridgeJournal.ts:273](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:273) [useBridgeBackup.ts:113](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeBackup.ts:113).
- The config already contains `l1.fuel.feeJuicePortal`, but the typed faucet deployment interface omits it [testnet-bridge.json:21](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/public/testnet-bridge.json:21) [bridge-deployments.ts:21](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/contracts/bridge-deployments.ts:21).

Inferences
- Unsafe: treating FeeJuicePortal as a token-portal clone with a private deposit variant. The installed ABI evidence points the other way.
- Unsafe: reusing `BRIDGE_FUEL.feeJuice` as canonical. The router itself defends by reading `UNDERLYING()` live [SwapBridgeRouter.sol:188](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-evm/src/SwapBridgeRouter.sol:188).
- Unsafe: parsing `Inbox.MessageSent` for Fuel just because token deposits do. FeeJuicePortal emits the exact event you want [FeeJuicePortalAbi.js:3015](/Users/alejoamiras/Projects/nulo/nulo-4/node_modules/@aztec/l1-artifacts/dest/FeeJuicePortalAbi.js:3015).
- Unsafe: mirroring `BridgeView` into a second mounted `FuelView` without centralizing the foreground/journal owners.

Asks
- Copy: should the L1 asset be labeled `$AZTEC`, `fee asset`, or `Fee Juice` on L1-facing surfaces? I would not mix L1 `$AZTEC` and L2 `Fee Juice` casually.
- Mismatch policy: if node-reported portal/underlying disagrees with bundled config, should the UI hard-block? Recommendation: yes.
- Shell: are you willing to refactor to one shared transfer shell/foreground owner, even if `Fuel` still appears as a top-level tab? That is the safer implementation.

---

# Codex — combined contradiction-check + audit (Round 1)

Resumed session 019ed76c… · xhigh. Verdict: **conditional reject** (direction right; schema-3 story, DQ1 STOP-gate, and validation gates under-scoped). All blockers folded into plan.md revision.

Brief: /tmp/fuel-review-round.md

Conditional reject: the direction is mostly right, but the plan is not approvable as written because the `schema 3` story, the DQ1 STOP-gate, and the validation gates are materially under-scoped.

**Blocking**
- The plan re-opens a locked decision. `Ask 1` and the “cuttable under pressure” branch allow private to degrade to documented-blocked [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:25) [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:126), but locked decision 2 already says public + private both, full parity [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:29). Keep the live-signoff caveat; drop the scope fallback from the approval plan.
- `assetKind + schema 3` is the right direction, but the safety rationale is incomplete. The current journal still writes top-level `{ schema: 1, records }` under the same `JOURNAL_KEY`, and `parseRecords` ignores per-record schema entirely [journal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:141) [journal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:176). So a record-level bump to `3` does not, by itself, prevent an older client from loading and misreading Fuel records. If that compatibility boundary matters, Phase 2 needs a journal-envelope/key migration. If it does not, stop claiming schema 3 solves old-client misread risk [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:52) [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:71). Related: the plan never says what `JournalBase.bridge` / recovery binding becomes for fee-juice records, even though backup export/restore and recovery-key derivation bind `portal + bridge` today [recovery-crypto.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/recovery-crypto.ts:19) [useBridgeBackup.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeBackup.ts:60).
- Phase 1’s STOP-gate is too weak as written. “Payload shape + mock send path” can devolve into a fake-wallet no-op and prove nothing. To be meaningful without a live prover, it needs to assert at least: `from = claimer`, `feePayer = FPC`, the planner classifies the payload as embedded `fpc`, the granted capability scope includes `FeeJuice.claim` and `PrivateFPC.mint_and_pay_fee` for both send and simulate, and explicit `maxFeesPerGas` / teardown settings survive the extension path [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:65) [operation-planner.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/operation-planner.ts:213) [fee-detection.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/utils/fee-detection.ts:8) [capabilities.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/lib/capabilities.ts:253) [embedded-fpc-cap.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.test.ts:74).
- Phase 4’s gate does not test the bug it claims to fix. The double-owner issue exists in mounted tabs under `App.vue` [App.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/App.vue:46), but the existing bridge smoke mounts `BridgeView` alone [bridge-smoke.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/tests/e2e/bridge-smoke.test.ts:105). “Bridge smoke still green” is not evidence that the shared-shell fix works [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:80). Add an App-level smoke that mounts `App`, switches Bridge/Fuel tabs, and proves a single foreground owner.
- Phase 5’s validation gate is wrong. `bun run audit:vue` runs root `typecheck:all`, root `test`, lint, and root `build` [package.json](/Users/alejoamiras/Projects/nulo/nulo-4/package.json:30). In this repo, root `test` and `build` are extension commands, not faucet commands [package.json](/Users/alejoamiras/Projects/nulo/nulo-4/package.json:16) [package.json](/Users/alejoamiras/Projects/nulo/nulo-4/package.json:12). It also omits `B`, even though Phase 5 tightens bridge-core backup/journal validation [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:85). That gate cannot honestly claim “all local”.

**Non-blocking**
- No rejected alternative needs revival as-is. `fuelOnly` should stay rejected, and mirroring `BridgeView` under the current `v-show` setup should stay rejected [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:139) [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:140). The chosen branches just need tighter scoping.
- The shared-owner fix is directionally right, but the plan should acknowledge the smaller fallback: inactive-view `v-if` is viable because both Aztec and L1 wallet state are already module singletons [useBridgeWallet.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeWallet.ts:1) [useL1Wallet.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useL1Wallet.ts:12). The current `v-show` rationale is stale [App.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/App.vue:46).
- `I4` should be a fact, not an inference: the portal event really is the leaf-index source [FeeJuicePortalAbi.js](/Users/alejoamiras/Projects/nulo/nulo-4/node_modules/@aztec/l1-artifacts/dest/FeeJuicePortalAbi.js:3014) [aztec-private-fpc-bridge.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:98).
- The security section should explicitly preserve the existing least-privilege capability scoping and keep PrivateFPC out of `contracts` registration [capabilities.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/lib/capabilities.ts:265) [capabilities.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/lib/capabilities.test.ts:245).

**Facts**
- The “wallet SDK accepts raw `ExecutionPayload`s / planner handles minimal payloads” fact is technically true, but the cited planner test is weaker than the plan implies. It proves an empty payload maps to `PREEXISTING_FEE_JUICE`, not that a carrierless private-FPC payload survives the dapp-send path [operation-planner.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/operation-planner.test.ts:213).
- “`BRIDGE_FUEL` / `l1.fuel.*` is the dead forked-V4 stack” is overstated as a repo fact. The files prove it is the swap deployment/config surface, not that it is dead [bridge-deployments.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/contracts/bridge-deployments.ts:20) [testnet-bridge.json](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/public/testnet-bridge.json:13) [verify-l1.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/scripts/verify-l1.ts:136).

**Inferences**
- `I1` is unsafe as stated. Generalizing by `assetKind` is not “contained” if the plan’s safety claim depends on older clients not misreading new records; today’s journal envelope/keying does not provide that boundary [journal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:141).
- `I2` is misclassified. It is not “LOW”; it is the highest implementation risk in the plan. The local repo proves structure, not prover acceptance.
- `I5` is too optimistic. `DepositEnvelopeV2` has no salt field [recovery-crypto.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/recovery-crypto.ts:104), so “seal the salt” is not a trivial reuse of existing machinery.

**Asks**
- `Ask 1` should not be an ask. The user already answered it in locked decision 2 [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:29).
- A missing ask is whether you are willing to pay the migration cost for a real journal compatibility boundary. If yes, Phase 2 needs a top-level journal-envelope/key bump; if no, the schema-3 rationale must be narrowed.
- A missing ask is what deployment binding a fee-juice record should use for `bridge` / recovery-key derivation / backup headers, since the current binding is token-bridge-specific [recovery-crypto.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/recovery-crypto.ts:27) [useBridgeBackup.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeBackup.ts:115).

---

# Codex — final fresh-context pass (Round 2, new session)

Session: 019ed792-0129-7742-bbed-817c6a29fbe3 · xhigh · read-only · fresh context (not a resume).
Verdict: **conditional approve** — condition (gate honesty) applied to plan.md §6 Phases 1/3/5 + Ask C.

conditional approve (with conditions: tighten the validation gates so they actually execute the layers they claim to prove)

**Conditions / Findings**
- Phase 1 is still under-gated. [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:67) says the STOP-gate proves planner classification, send/sim capability scope, and gas-setting survival through the extension path, but the gate only runs `B && FT && TA && L` [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:71). The send/sim scope checks live in faucet unit tests [capabilities.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/lib/capabilities.test.ts:239), and the embedded-FPC gas-cap behavior is pinned in extension unit tests [embedded-fpc-cap.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.test.ts:74). As written, that gate cannot prove its own pass criteria.
- Carry the same fix into the final gate if implementation relies on or adds extension-path tests. Phase 5’s “all local” set [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:92) still excludes extension tests even though the plan’s private-path confidence story cites extension behavior.

**Adversarial / Security**
- I did not find a new High/Critical miss beyond the already-called-out I2. The main attack surfaces remain the right ones: portal/config mismatch, fail-open self-pay floor, FPC drift, and multi-mounted foreground/journal ownership.
- The additive `assetKind` + envelope-stays-1 fix matches repo reality. The loader only accepts storage-envelope `schema === 1` and ignores per-record schema [journal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:141), while `write()` always persists envelope schema 1 [journal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:175). An envelope bump would drop persisted records; the revised plan is correct not to do that.
- Locked decision 2 is no longer being re-opened. The revised scope keeps private in-plan and only defers live sign-off, not implementation scope [plan.md](/Users/alejoamiras/Projects/nulo/nulo-4/implementations-plan/fuel-direct-bridge/plan.md:23).

**Assumption Attack**
Facts
- No additional factual misstatements in §8 stood up as blockers after spot-checking loader behavior, hardcoded deployment binding, `v-show` tab mounting, and the current fail-open floor [journal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/bridge-core/src/journal.ts:141) [useBridgeJournal.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useBridgeJournal.ts:273) [App.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/App.vue:46) [useDeposit.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:267).

Inferences
- The plan should keep treating explicit `maxFeesPerGas` as a required implementation detail, not as an already-exercised end-to-end path. The current private fueled bridge path still omits explicit max fees [useDeposit.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/composables/useDeposit.ts:292), while what is locally proven today is the helper behavior when those values are supplied [embedded-fpc-cap.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.test.ts:77).

Asks
- `Ask C` is not purely UX. If they choose split Bridge/Fuel journal surfaces instead of the recommended shared journal, they still need singleton toast/watch ownership or the same multi-mounted double-toast class can come back [BridgeJournal.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/components/BridgeJournal.vue:49) [App.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/faucet/src/App.vue:46). I would default to the shared journal unless they can prove equivalent single ownership in the App-level smoke.

**Per-Phase Gate Honesty**
- Phase 0: honest.
- Phase 1: not honest yet; it claims layers its command set does not execute.
- Phases 2-4: honest as written. They explicitly keep private acceptance out of scope and correctly limit smoke-e2e to flow orchestration.
- Phase 5: honest only if it inherits the Phase-1 gate fix; otherwise “all local” still omits extension-path verification the plan relies on.