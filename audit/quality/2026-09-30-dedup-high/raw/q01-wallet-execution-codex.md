# q01-wallet-execution — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`.
- `audit/quality/2026-09-30-dedup-high/raw/repo-map/{_outer,extension-wallet}.md` and `raw/jscpd-production.md`.
- Prior reports: `audit/quality/2026-08-16-extension-mid/report.md` and `audit/quality/2026-08-14-dedup-mid/report.md`.
- Production modules under `apps/extension/src/wallet/services/{execution,fpc,transaction,task}/`, including executors, fee strategies, discovery, builders, caches, simulation helpers, service contracts, and clients.
- Selected colocated tests for discovery, fee-strategy parity, selector binding, and FPC creation.
- `packages/wallet-core/src/storage/entity_storage.ts` — storage handoff inspection for the incidental bug.
- Path-specific git history on `dev` at `910a4defcbacbb4e76b53c1d57551a457b1d3fb0`.

History counts below are **all-history / since 2026-06-01**, without rename following. They measure file churn, not edits exclusively to the cited functions. No files were modified.

## q01-wallet-execution-X-1: Authwit effect decoding is implemented three times

**Title:** Three discovery paths own the same chain-bound effect decoder.

**Smell name:** **Duplicate Code** — Fowler.

**Maintenance impact:** **Structural**, spanning three execution modules. Churn: `authwit-discoverer.ts` **6/6**, `discovery-probe.ts` **2/2**, `dapp-send-executor.ts` **27/27**. **Confidence: high.**

**Concrete evidence:** Each implementation collects offchain effects, returns early when empty, fetches and validates live chain identity, decodes `CallAuthorizationRequest`, computes its message hash, projects a display record, and skips effects that fail decoding:

- `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:110-141`
- `apps/extension/src/wallet/services/execution/discovery-probe.ts:70-101`
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:1000-1019`

`toDiscoveredAuthwit` already centralizes the final record projection, but the larger decoding algorithm remains copied. The probe additionally owns first-use gating and hash deduplication; NO_FROM returns hashes for subsequent signing.

**Why it harms future change:** An upstream authorization-effect encoding change, revised malformed-effect handling, or chain-binding change requires three coordinated edits. Updating the existing record projector does not update those decisions. The probe’s header explicitly describes its loop as mirroring the standalone discoverer.

**Smallest safe refactoring:** **Extract Function** into an execution-local `decode-authwit-effects.ts`, returning ordered `{ record, messageHash }` pairs. Preserve lazy node-info fetching, chain validation before decoding, per-effect error isolation, and the injectable crypto seam. Keep simulation options, probe deduplication/first-use state, action construction, and signing in their current callers.

**What disappears:** Two independent implementations of the chain-binding and decode/hash/project loop; approximately 35–50 duplicated implementation lines, depending on the helper signature. No discovery mode disappears.

**Instances:**

- `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:110`
- `apps/extension/src/wallet/services/execution/discovery-probe.ts:70`
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:1000`

## q01-wallet-execution-X-2: Fee paths duplicate discovery re-simulation and FPC finalization

**Title:** Shared fee-estimation stages remain copied across strategy branches.

**Smell name:** **Duplicate Code** — Fowler.

**Maintenance impact:** **Structural**, involving two strategy modules and three estimation paths. Churn: `fee-juice-strategy.ts` **3/3**, `fpc-strategy.ts` **9/9**. **Confidence: high.**

**Concrete evidence:** Three paths repeat “suggest gas → first simulation → extract discovery effects → append actions → conditionally check cancellation, rebuild, and run a validated simulation”:

- `apps/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:33-58`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:153-176`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:221-258`

The re-simulation predicate deliberately differs: FeeJuice and sponsored fast-path runs rebuild for discovered effects **or** initialization wrapping; two-pass FPC rebuilds its first pass only for initialization wrapping.

Both FPC branches also independently calculate the padded final fee, replace actions with `[fee payload, original actions, discovered actions]`, finalize gas using the already-multiplied base fees, and construct the sponsored estimate:

- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:178-197`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:283-302`

**Why it harms future change:** A change to validated re-simulation options or cancellation handling must be repeated across three branches. A change to final FPC action composition or estimate metadata must land in both FPC tails. The existing shared `probedFirstSimOpts` and `finalizeGasLimits` cover individual operations, leaving their surrounding sequencing duplicated.

**Smallest safe refactoring:** **Extract Function / Parameterize Function** for the post-build discovery/simulation stage under `execution/fee/`, with explicit payment-method and re-simulation policy inputs. Separately **Extract Method** for the common final FPC action splice and gas finalization.

Preserve first-pass admission validation, the sponsored chain-mismatch fallback, action ordering, and two-pass FPC’s intermediate gas envelope. Keep task completion and failure handling outside the extracted stages. The existing structural tests pin the differing simulation counts and payment methods.

**What disappears:** Two copies of the discovery/re-simulation mechanics and one copy of the roughly 20-line FPC finalization tail. The genuine one-pass/two-pass branches remain.

**Instances:**

- `apps/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:33`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:153`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:221`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:178`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:283`

## q01-wallet-execution-X-3: Six paths separately enforce the selector/name binding rule

**Title:** Selector/name validation has six independent implementations.

**Smell name:** **Duplicate Code**, causing **Shotgun Surgery** — Fowler: changing one binding rule requires coordinated edits across unrelated execution entrypoints.

**Maintenance impact:** **Structural**, with six locations in five modules. Churn: `tx-request-builder.ts` **15/15**, `authwit-discoverer.ts` **6/6**, `service.ts` **30/30**, `view-executor.ts` **7/7**, `fast-path.ts` **2/2**. **Confidence: high.**

**Concrete evidence:** All six sites reject a missing ABI function and reject a supplied name that disagrees with the selector’s resolved function:

- Standard encoded call: `apps/extension/src/wallet/services/execution/tx-request-builder.ts:587-599`
- NO_FROM call: `apps/extension/src/wallet/services/execution/tx-request-builder.ts:340-348`
- Encoded authwit action: `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:197-205`
- Direct create-authwit RPC: `apps/extension/src/wallet/services/execution/service.ts:1043-1051`
- Utility RPC: `apps/extension/src/wallet/services/execution/view-executor.ts:367-373`
- Optimized simulation: `apps/extension/src/wallet/services/execution/fast-path.ts:135-140`

The sites already share `findFunctionBySelector`, but reimplement its required-result/name-binding contract afterward. Error wording differs only by call versus authwit context. The fast path requires a matching name directly; the other paths explicitly permit an absent name.

**Why it harms future change:** Changing name-presence policy, mismatch diagnostics, or the representation of a binding failure requires finding all six entrypoints. Their surrounding code differs substantially—simulation fallback, request construction, or witness hashing—so a text-clone search does not reliably identify the full maintenance surface.

**Smallest safe refactoring:** **Extract Function** beside the existing lookup helpers in `execution/contract-resolver.ts`: a synchronous validator accepting the resolved function and named options for supplied name, target, diagnostic context, and missing-name policy.

Keep lookup awaits and catch boundaries at their current sites. In particular, fast-path lookup failures must still produce fallback, while binding failures must still escape. Keep call construction, mutations, and private/public/utility restrictions local.

**What disappears:** Five duplicate implementations of the missing-function/name-mismatch guard pair and their repeated diagnostic construction. One shared validator retains the two deliberate name-presence policies.

**Instances:**

- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:587`
- `apps/extension/src/wallet/services/execution/tx-request-builder.ts:340`
- `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:197`
- `apps/extension/src/wallet/services/execution/service.ts:1043`
- `apps/extension/src/wallet/services/execution/view-executor.ts:367`
- `apps/extension/src/wallet/services/execution/fast-path.ts:135`

## q01-wallet-execution-X-4: Transaction recording exposes a 12-position API

**Title:** Transaction producers depend on argument positions and numeric type projections.

**Smell name:** **Long Parameter List** and **Data Clumps** — Fowler.

**Maintenance impact:** **Structural**, across the transaction service and two executor modules, with three production call sites. Churn: `transaction/service.ts` **16/16**, `transfer-executor.ts` **17/17**, `dapp-send-executor.ts` **27/27**. **Confidence: high.**

**Concrete evidence:**

- `apps/extension/src/wallet/services/transaction/service.ts:155-170` declares twelve positional parameters, including several string-valued identifiers and an optional metadata tail.
- Producers reconstruct that argument list at:
  - `apps/extension/src/wallet/services/execution/transfer-executor.ts:182-214`
  - `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:528-541`
  - `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:919-932`
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:125-138` derives `SentTx` fields through `AddTransactionArgs[0]`, `[3]`, `[5]`, and `[11]`, embedding the parameter order in a second type.

These values collectively describe one transaction-recording request.

**Why it harms future change:** Reviewing or modifying transaction metadata requires matching positions across three producers and the indexed type projections. Reordering same-typed fields can remain type-correct. The existing `networkId` field occupies the twelfth position, illustrating how the optional tail has accumulated responsibility.

**Smallest safe refactoring:** **Introduce Parameter Object**: define a named transaction-recording input in `transaction/spec.ts`, change `addTransaction` to accept it, and update the three callers. Replace numeric `SentTx` projections with named indexed accesses or `Pick`. Preserve the persisted `Tx` shape and existing recording order.

**What disappears:** The twelve-position method contract, three positional argument lists, and four numeric type projections. This improves change safety without promising a net line-count reduction.

**Instances:**

- `apps/extension/src/wallet/services/transaction/service.ts:155`
- `apps/extension/src/wallet/services/execution/transfer-executor.ts:182`
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:125`
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:528`
- `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:919`

## Non-findings considered

- **Prior 2026-08-16 Q-10:** Cache storage and pending-set comparison now use `SingleShotTtlCache` and `pendingHashesChanged`; the remaining validation ladders have different ordering, failure handling, and operation-specific checks. The original mechanics finding is not re-reported.
- **Prior 2026-08-16 Q-07, cluster instances:** Transaction restore uses `restoreRows`; task IDs use `randomIdNotIn`; FPC creation uses `nextRandomId`. Those prior bypasses are addressed.
- **Prior 2026-08-14 Q-01/Q-05, cluster instances:** Reviewed storage writers use `withLock`, and all four clients use `definePassthroughsExhaustive`; the former boilerplate findings are addressed.
- **dApp-send jscpd leads:** `runInSlot`, `proveAndSend`, and `sentTxRecorder` already centralize the substantial lifecycle behavior. Repeated option literals and short return-shaping fragments do not warrant another pipeline finding.
- **Fee strategy differences:** PrivateFPC’s two-pass envelope, embedded-payment cap, and sponsored fast-path eligibility are deliberate behavioral distinctions. Finding X-2 targets their duplicated stages.
- **Transfer versus dApp execution:** The popup transfer’s documented lack of an execution slot is not grounds to merge its lifecycle with slot-bearing dApp sends.
- **Fast-path versus batched-view simulation:** They have different result contracts, utility handling, fallback behavior, and initialization handling; superficially similar orchestration does not establish interchangeable algorithms.
- **Service/client/spec triads, forwarding methods, and type-only cycles:** No additional measurable change amplification established beyond the concrete findings above.
- **File length and accepted complexity directives:** Neither was treated as a finding by itself.
- **Dead code:** No dead-code claim made; registration and exported service surfaces preclude conclusions based solely on explicit-import counts.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/wallet/services/fpc/service.ts:330,375-377` — Start `updateFpcAddress` on a custom sponsored row named `"old"` and pause its PXE lookup. Let `updateFpc(id, "new")` complete (`:309-323`), then resume the address update. Its locked write spreads the pre-lookup `existing` snapshot and restores `"old"`, losing the completed rename. The lock serializes writes but does not refresh the stale row. **Confidence: high; static interleaving, not runtime-tested.**

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **q01-wallet-execution-C-1 — Agree on duplication; partially disagree with “already drifted.”** The decoder should be shared, but probe deduplication explicitly incorporates previously attached hashes (`apps/extension/src/wallet/services/execution/discovery-probe.ts:57,81-94`). That caller-specific responsibility is not evidence of accidental drift; keep it outside the shared decoder.

- **q01-wallet-execution-C-2 — Agree, with evidence corrections.** The listed sites contain **10 literals across seven files**. Reuse `packages/aztec-runtime/src/utils/chain-identity.ts:73-75`; however, not every literal follows a fetch/assert pair: `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:185-188,224-240` receives `nodeInfo` as an argument. Extracting an asynchronous fetch helper therefore applies only to a subset.

- **q01-wallet-execution-C-3 — Partially agree.** Shared discovery/rebuild stages and FPC finalization are real duplicates, but the proposed template needs explicit behavioral boundaries: two-pass discovery appends effects independently of rebuilding (`apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:232-243`), and the fast path completes its task **before** invoking two-pass fallback (`:148-151`). A generic complete/fail wrapper must preserve that lifecycle.

- **q01-wallet-execution-C-4 — Partially agree; split the finding.** The strongest issue is the 12-argument contract (`apps/extension/src/wallet/services/transaction/service.ts:155-170`), already covered by X-4. Small output callbacks, cancellation checks, and snapshot construction are separate extraction candidates, not one demonstrated Alternative Classes smell. Several citations are stale: the cited `getCalls` and output callback actually occur at `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:677-683,736-739`.

- **q01-wallet-execution-C-5 — Partially agree; reject the TTL premise and behavior-changing extraction.** `apps/extension/src/wallet/services/execution/estimate-reuse-shared.ts:33-36` only retrieves/deletes; it does **not** check expiry during consumption. Caller TTL guards remain necessary. Moreover, folding exception handling into `baseFeeDrift` changes operation behavior: compare `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:159-164` with `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:195-210`. Shared handle resolution remains a valid narrower candidate.

- **q01-wallet-execution-C-6 — Agree on Duplicate Code; rate structural.** Seven cited commit points span **five**, not six, service files. The FPC pair is directly confirmed at `apps/extension/src/wallet/services/fpc/service.ts:230-238,293-302`. Preserve the token-specific post-write network check and final authority check (`apps/extension/src/wallet/services/token/service.ts:428-432`) outside any extracted common profile-fence sequence.

**2. What Claude missed that I found**

- **q01-wallet-execution-X-3 — Duplicate Code:** six selector/name-binding guards remain independently maintained; compare `apps/extension/src/wallet/services/execution/tx-request-builder.ts:340-348` and `apps/extension/src/wallet/services/execution/fast-path.ts:135-140`. Extract the synchronous guard with an explicit missing-name policy, preserving lookup exception handling. Claude’s non-findings do not invalidate this.

X-1 and X-2 overlap C-1/C-3. X-4 is already explicitly identified within C-4, despite Claude’s appended rebuttal calling it missed.

**3. What BOTH of us missed**

No additional finding proposed in this light pass.

**Confidence:** high in the source corrections; moderate in the relative refactoring priorities.