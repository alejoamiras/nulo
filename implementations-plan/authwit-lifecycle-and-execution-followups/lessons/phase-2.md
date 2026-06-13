# Phase 2 — Grant-emission surface + playground panel

## Proof-of-life spike verdict (logged BEFORE panel code, per plan)

**Design (a) — schema-patched `grantPublicAuthwit` RPC — WINS.**

Design (b) (Azguard-shape `send_transaction` action path from the page)
is DEAD on repo evidence: repo-wide grep shows NO production constructor
of `send_transaction` operations (only popup rendering/validation), and
`dispatcher.ts` routes zero Azguard-shape methods from page origins —
the wallet-sdk surface is the only dApp-callable path.

Design (a) mechanics, all links verified:
- `SendTransactionRequest = Omit<SendTransactionOperation, SendParams> &
  { account: CaipAccount }` exists in
  `wallet-bridge/src/dapp-interaction-protocol.ts:52` — the dispatcher
  can construct it and route through `dappInteractionService.execute`
  exactly like `handleRegisterToken` (`dispatcher.ts:523`).
- The execute popup already renders `send_transaction` drafts and runs
  fee selection when `feeSettings === undefined`
  (`operation-validation.ts:49`).
- `AddPublicAuthwitAction = { kind: "add_public_authwit", content:
  AuthwitContent }`; the `call` content kind carries
  `{ caller, contract, method, args }`
  (`wallet-bridge/src/authwit-content.ts:5-8`) — exactly the lifecycle's
  grant shape.
- `buildStandard` computes the message hash, calls `trackAuthwit` (so
  the settings revoke UI sees it), and injects `set_authorized`
  (`tx-request-builder.ts:197-265`).

Scope model: `grantPublicAuthwit` gets its OWN entry in
`METHOD_SCOPE_CHECKER` (`scope-enforcement.ts`) validating the target
contract against the session's transaction scope — the capability is
the control, not panel defaults.

## Smoke-gate debugging arc (5 failures → codex reassessment → root cause)

Five consecutive smoke failures, all "cap popup exposed only one account".
Instrumentation ladder: discriminating error (run 2) → storage dump in the
failure (runs 3-4: TWO default accounts, "Second" absent) → post-create
persistence assertion (run 5: appeared to pass). Hypotheses burned:
helper's flaky input-wait (real, fixed — headless-Chrome transition
stick), wrong-chain creation (disproved by dump), same-address overwrite
(disproved — provisioner is serialized ensureDefaultAccount), chain
purge + reseed (plausible, wrong).

**Actual root cause (codex consult caught it via a caveat)**: the very
first fixture edit anchored `createSecondAccount` on a phase block that
TWO fixtures share verbatim — `replace(..., 1)` patched
`dappConnectedExtensionPerTest`, not the `TwoAccountsCap` fixture the
test uses. Every run since: the test's fixture never created "Second";
the dumps faithfully reported reality; the "passing" persistence
assertion never executed (wrong fixture). The 5-failure stop + codex
reassessment worked exactly as designed.

Lessons:
- When patching a file with REPEATED block shapes (vitest fixtures share
  phase sequences verbatim), anchor on a UNIQUE string from the target
  scope (its error-tag literal), or assert the insertion landed within
  the right block span.
- "Assertion passed" is only evidence if the assertion RAN — phase logs
  should be positively confirmed, not inferred from absence of failure.
- Genuine side-finding kept: createAccount helper's input-disappearance
  wait replaced with row-wait (headless transition stick) — real fix.

## Gate CLOSED ✓ — consume smoke green

`authwit-consume-smoke.test.ts`: 1 passed. Step markers confirmed the full
chain live: mint → grant (popup approved, result ok, tx mined) → switch to
caller B → consume (transfer_public_to_public from B with A's public
authwit) → ok. The proof-of-life design (a) — schema-patched
`grantPublicAuthwit` RPC — is validated end-to-end against the local
network.

The gate took 7 runs; EVERY failure was a test-harness defect, never the
feature (which worked from first execution):
1. createAccount helper's input-disappearance wait (headless-Chrome
   transition stick) → row-wait.
2. second-account creation anchored into the WRONG fixture (two share
   verbatim phase blocks; `replace(…,1)` hit dappConnectedExtensionPerTest
   not TwoAccountsCap) → codex consult caught it.
3. tx-hash parsed with JSON.parse (a raw `0x…` is not JSON) → strip-quotes.
4. waitForTxMined accepted only "success"; Aztec returns "finalized" →
   widened the terminal-success set.
5. consume prove latency > 120s under WASM + fee-mult 10 → raised budgets.
Plus several seconds-long launch misfires (running the root `e2e:agent`
script from a drifted cwd). Lesson reinforced: instrument to localize
BEFORE editing; confirm a run actually executed (line count) before
reading its verdict.

Gate: lint 0, tsc 0, full unit suite green earlier (2,362); e2e
authwit-consume-smoke 1 passed.

## Phase 3: lifecycle e2e is prove-latency-bound on local WASM (CI is the gate)

The grant/consume/revoke lifecycle test (steps 1-2; registry-toggle still
to add) runs ~6 proofs serially. On local WASM (no accelerator) under
fee-mult 10, prove times brush the consume budget — run 1 failed with the
G1 CONSUME timing out at 240s, while the consume SMOKE (same grant→consume
path) passed. Latency variance, NOT behavior. Raised to 360s. If it still
flakes locally, the honest gate for the full lifecycle is CI (native
accelerator proving) — local WASM on constrained hardware is the wrong
place to chase a 6-prove serial e2e. The feature is proven by the green
consume smoke + the unit/reachability/scope suite.
