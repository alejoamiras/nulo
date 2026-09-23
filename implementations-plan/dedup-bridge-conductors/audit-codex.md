The plan is not safe to implement as written.

- Chain definitions are uniform within networks: all six Sepolia blocks have identical `id`, `name`, `nativeCurrency`, and `rpcUrls`; all three mainnet blocks are likewise identical. No extras exist. The sandbox chain is intentionally distinct. Mainnet L1 clients are constructed identically everywhere; all ten primary L1 pairs use the supplied account, `http(rpcUrl)`, wallet-first then public-client, with no intervening side effects.
- Preserve [deploy-sandbox.ts](packages/bridge-core/scripts/deploy-sandbox.ts:126)’s extra, peculiar public client (`chain: sandbox`, Sepolia transport) outside the helper.

Critical problems:

1. I1 is directionally right but still under-split. `createL2Wallet` returning both node and wallet changes ordering:

   - [deploy-bridge-mainnet.ts](packages/bridge-core/scripts/deploy-bridge-mainnet.ts:278) creates the wallet, performs the FJ deposit/possible early return, then creates the node at line 337.
   - [fpc-dust-canary-mainnet.ts](packages/bridge-core/scripts/fpc-dust-canary-mainnet.ts:82) creates the node, performs fee checks and L1 setup, then creates the wallet at line 99.

   Split node and `EmbeddedWallet` factories. Also require `createL1Clients` to preserve wallet-before-public order and use overloads so these ten callers receive a non-optional wallet.

2. I3 is correct: factories preserve each runtime RPC URL in chain metadata; static shared constants would not.

3. F6’s current-tree references are accurate: 774–786, 821–829, and 1350–1378.

4. `dispatcher.test.ts` reaches both Q-13 methods, but unauthorized-`from` assertions do not pin the stricter branches. Add exact tests for “no wallet accounts” and “empty session accounts”; those are the actual newly differentiated errors.

5. `loadManifestFromConfigArg` needs a discriminant (`mode: "required" | "fallback"`), and must return raw parsed JSON or accept a parser so the canary retains `parseCandidateManifest` while smoke scripts retain plain `JSON.parse`. Most importantly, the canary must retain its current live-manifest fallback: the plan’s claim that the helper “removes” that footgun violates the zero-change constraint.

6. Q-10 genuinely fits one callback, but not the proposed `{node, ewallet, prepareDeployment}` surface: both twins currently early-return before wallet creation. The helper should perform the existence check first, then create/pass `ewallet`, `node`, and `mins` to a callback returning `{from, fee}`. Add unit tests for early return, exact salt/options, mismatch rejection, and callback sequencing.

The gates miss `deploy-sandbox.ts`, explicitly excluded by `tsconfig.scripts.json`, and no proposed test protects Q-10 sequencing.

**Verdict: reject (with blocking findings: L2 construction reordering, Q-10 early-return reordering, ambiguous config-fallback behavior, and inadequate failure-path/sequencing gates).**
---

## Re-verdict after amendments

No architectural blockers remain. Three stale statements should be aligned before implementation:

- I1 still describes `createL2Wallet` as the whole L2 split.
- Security says the fallback footgun is “removed”; it is intentionally retained but made explicit.
- Phase 2 says all scripts are typechecked despite the documented sandbox exclusion.

**Verdict: conditional approve (conditions: correct those contradictory statements so implementation cannot reinterpret the zero-behavior-change contract).**

---

## Post-implementation diff review (fresh codex session, xhigh)

### Low

- [dispatcher.test.ts:1002](packages/wallet-bridge/src/dispatcher.test.ts:1002) — The plan promised the differentiated “no wallet accounts” and “empty session accounts” branches for **both** migrated handlers. They are tested only through `registerToken`; the `grantPublicAuthwit` test at line 1041 covers only unauthorized `from`. Parameterize those two cases across both handlers.

No production-code defect found. All conductor ordering, URLs, prover flags, config behavior, logs, and domain logic are preserved. The viem cast is sound: `parseAccount` returns object accounts unchanged; runtime identity was confirmed. Missing `--config` paths retain the exact prior `ERR_INVALID_ARG_TYPE` failure. Both PrivateFPC twins and dispatcher success paths preserve behavior.

The bootstrap suite actually contains eight substantive tests, not seven. Independent Vitest execution was prevented by the read-only sandbox before collection; supplied green gates remain the validation basis.

**Verdict: fix required.**

### Convergence

No new material findings. Both `grantPublicAuthwit` failure branches are reachable, assert the promised differentiated errors, and introduce no collateral changes.

converged