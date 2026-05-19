# Implementation Plan — Phase 1 + Phase 3 (post-audit revision)

> **Revision history:**
> - v1 — initial draft
> - **v2 (current)** — post Codex + Opus 4.7 audits. Major changes:
>   - **PR 8a deleted** (Aztec version bump not required; 4.2.0 ships every helper)
>   - **PR 8b dramatically shrunk** (Nulo already does stub-account override at `pxe/service.ts:233-246`)
>   - **PR 5 scope reduced** (non-Aztec types only; full revival deferred)
>   - **PR 10 reframed** as a lookup fix, not a schema change
>   - **PR 4 process-polyfill addition dropped** (collides with existing `define`)
>   - PR sequencing reorganized per Opus
>   - User-decision questions consolidated at the bottom
>
> **Audit deliverables**:
> - `wallets-architecture-research/synthesis/audit-codex.md` (codex CLI, xhigh)
> - `wallets-architecture-research/synthesis/audit-opus.md` (Opus 4.7 fresh agent)

## What's actually true (post-audit)

| Plan v1 assumption | Reality | Evidence |
|---|---|---|
| Aztec 4.2.0 may not have stub artifacts | 4.2.0 ships `@aztec/accounts/stub/{schnorr,ecdsa}`, `createStub*Account`, full `base-wallet` helpers, `forEstimation: true` flag, and `SimulationOverrides` | Bun cache + npm tarballs verified by both audits |
| Nulo doesn't have stub-account simulation | Nulo HAS it at `pxe/service.ts:233-246`, triggered by `stubAccountAddresses` parameter | `executeNoFromSendTx:1766` already passes `[account.address.toString()]` |
| `executeNoFromSendTx` "real second simulation" is just a re-sim | It's a validation step against the assembled authwits + real account contract before prove | `service.ts:1791-1798` |
| `pxe.simulateTx({ overrides })` is a free-floating contract | Type def says it requires `skipKernels: true` | `@aztec/pxe@4.2.0/dest/pxe.d.ts:8` |
| Adding `globals.process: true` to nodePolyfills is harmless | Collides with existing `define: { "process.browser": true, "process.env": ... }` AND fights the `detect-node` alias | `vite.config.ts:57-62, 217-223, 245-256` |
| chainId on dapp sessions needs a new field | chainId is already encoded in `chainInfoToChainId` (XOR version) and chain authorization lives in `DappSession.permissions` | `wallet-sdk/background.ts:chainInfoToChainId`, `dapp-session/spec.ts:34-47` |
| `KEYS_TO_WIPE` is the right list for migrating dapp sessions | `EntityStorage` rows are at `nulo:core:dappSessions@<id>` — needs `KEY_PREFIXES_TO_WIPE_LOCAL` | `storage/migrate.ts:KEYS_TO_WIPE` vs `KEY_PREFIXES_TO_WIPE_LOCAL` |
| PR 5 (JSON fallback) is required before PR 8b | Nulo already `jsonSanitize`s before transport. PR 5 may be largely redundant; if scoped, only useful for non-sanitizable error shapes | `wallet-core/src/utils/serialization.ts:23-60`, `extension-messaging/src/background/service.ts:74-100` |

## Goals (unchanged)

- Quick security/correctness wins (Phase 1)
- Bring Nulo to feature parity with Grego on Aztec patterns (Phase 3)
- Free Firefox support (bonus)
- AVOID the durable-jobs refactor (Phase 2) for now

## Global directive — wallet is pre-production

User-direction: "this wallet is NOT in production yet; we don't need to think about migrating previous schemas to new schemas."

Implications applied across the plan:
- **All storage version bumps are destructive wipes** (consistent with the existing `migrate.ts` pattern's "no production users" comment). No backwards-compat migrators.
- **Breaking RPC contract changes are fine** as long as all callers get updated in the same PR.
- **No deprecation periods** for renamed methods or removed fields.
- This directive applies retroactively across the whole plan. PRs 1, 10, and any other migrations follow it.

## Out of scope (unchanged)

Durable job submission, AbortController plumbing, per-(profileId, chainId) PXE concurrency, `chrome.alarms` wake-up, LavaMoat / Snaps / IndexedDB vault backup / MetaMask messenger / PatchStore (those are Phase 2 / Phase 4).

---

## Final PR list (post-audit)

### Phase 1: parallel-shippable batch (1 week)

#### PR A — bundle: F1 + F2 + F3 — "fix(audit): close A1/A2/A5 + freeze strict-mode default"

Three trivial security/correctness commits in one reviewable PR.

**Commit A.1: Auth gate on `exportEncrypted`** (F1 / Crit #5)
- File: `packages/extension/src/wallet/services/profile/service.ts:507-517`
- **Decision pending** (see Q1 below): which auth approach?
  - **Option (a)**: full unlock card mirroring `exportPlain` (signature change to `exportEncrypted(id, password)`, breaks current UX, breaks `e2e/import-paths.test.ts:382-415`)
  - **Option (b)**: gate behind `await this.getActiveSecret(id)` — only succeeds if the matching profile is currently unlocked. Preserves passwordless UX but closes the local-attack hole.
  - **Option (c)**: leave as-is, document threat model
- Recommended: **(b)**. The encrypted blob is already password-encrypted at rest; the hole is "logged-out-but-popup-open" exfiltration. Tying it to active session is correct.

**Commit A.2: Fix `port!.postMessage` race** (F2 / Crit #6 / AUDIT A5)
- File: `packages/extension-messaging/src/background/client.ts:127-181`
- Pattern (post-audit refinement):
  - Capture `port` to local var at the connect-success branch
  - After loop, check non-null
  - On null OR if `postMessage` throws synchronously, reject pending entry with `RpcDisconnectedError`
- **Refinement (per codex)**: `RpcDisconnectedError` must be a `WalletError` subclass (sibling of `RpcTimeoutError` at `errors.ts:23-55`), so existing structured-error round-trip works on the client side.

**Commit A.3: Strict-mode default freezing test** (F3 / Crit #4)
- Verification only: `config.ts:13` already defaults to `true`.
- Add: 1 unit test asserting passhash NOT in `chrome.storage.session` under default config; 1 e2e test that cold-boot under default re-prompts for password.
- Add: comment-as-test reference in `config.ts:13` linking to the test file.

#### PR 4 — function-bind CSP stub (durable, battle-resistant)

User-direction: "most professional implementation, durable long-term, battle-resistant." That means: explicit, well-documented, tested. NOT install-time patches.

**Files:**
- New: `packages/extension/src/shims/function-bind-stub.cjs` (Grego's pattern; CJS module exporting native `Function.prototype.bind`)
- New: `packages/extension/src/shims/function-bind-stub.test.ts` (unit test: imports the shim, asserts `bind.call(thisArg, ...)` produces a bound function with correct `length` and behavior)
- Edit: `packages/extension/vite.config.ts`
  - Convert `resolve.alias` from object → array form (required for regex aliases — currently mixes object and regex would fail)
  - Add aliases for `^function-bind$` and `^function-bind/implementation$` (anchored regex; no false positives against `function-bind-other-thing` packages)
  - **Add a comment block above the alias** explaining: (a) why the shim exists (MV3 CSP forbids `'unsafe-eval'`; `function-bind` constructs a bound function from a dynamic string to preserve `f.length`), (b) what it replaces (native `Function.prototype.bind`), (c) link to Grego's reference at `wallets-architecture-research/grego/codex-analysis.md` and the source pattern.

**Process polyfill: explicitly NOT changing.** Audit-confirmed:
- Existing `define: { "process.browser": true, "process.env": ... }` (`vite.config.ts:252-256`) is compile-time substitution
- Existing `detect-node` alias to a stub (`vite.config.ts:57-62`) forces detect-node to return false (Aztec foundation pino logger needs this)
- Adding `nodePolyfills({ globals: { process: true } })` would create runtime ambiguity (Opus audit) AND risk reopening browser-detection bugs (codex audit)
- **Decision: leave the three-layer process handling as-is. Add a comment block in `vite.config.ts` documenting all three layers + the rationale for each, so future devs don't silently introduce a fourth conflict.**

**Battle-resistance measures:**
- Pin the `function-bind` package version in `package.json` if not already pinned (currently 1.1.2 per `bun.lockb`).
- Unit test for the shim asserts `bind.length === 1`, `bind.call(thisArg, "a", "b").length === f.length - 2`, and that the result IS callable.
- Add a CSP-violation listener to the existing e2e test infrastructure (`tests/e2e/import-paths.test.ts:428` already collects `pageErrors[]`). Filter for "Refused to evaluate" / "EvalError" patterns; fail any test where one fires.
- Add a `vite.config.ts` comment block (visible to anyone editing aliases) listing every package known to need a CSP shim or polyfill, with the failure mode each prevents. This is the durable institutional memory.

**Tests:**
- Unit: `function-bind-stub.test.ts` (≥3 cases per CLAUDE.md primitive minimums)
- e2e: full e2e regression run (`bun run test:e2e`) — CSP affects everything, not just the function-bind path
- Build: `bun run build` succeeds; size delta ≈ 0
- Manual: open Chrome DevTools console during a fresh popup load; verify zero CSP violations

#### PR 6 — UX chips + humanize bug fix

- Files: `packages/extension/src/popup/windows/execute/{index.vue,OperationCard.vue}` + utility for `humanizeOperationKind`
- Add: "Kernelless execution" chip when `op.executionMode === "default_entrypoint"`
- Add: "Paymaster: <name>" chip when `op.exec.feePayer !== undefined`
  - **Caveat (per codex)**: `paymentMethod.kind === "embedded"` is ambiguous (could mean app-supplied or user-selected). Check `op.exec.feePayer` directly, not just `paymentMethod.kind`.
- Add: fix the `humanizeOperationKind` first-underscore-only bug (M6 STATUS.md follow-up). 2-line fix while the file is open. `aztec_get_chain_info` should render "aztec get chain info" not "aztec get_chain_info".
- Tests: ≥5 cases per chip; pinning test for the humanize fix.

#### PR 10 (REFRAMED) — "Filter remembered apps by chain"

**Original plan said**: add `chainId` field to `DappSession`, bump storage version, wipe.

**Audit-revised plan**: it's a lookup bug, not a storage bug.

- File: `packages/extension/src/wallet/services/dapp-session/service.ts:78-91`
- Change `tryGetDappSessionByOrigin(origin)` to `tryGetDappSessionByOriginAndChain(origin, chainId)` and filter:
  ```ts
  const sessions = (await this.storage.getValues()).filter((x) =>
    x.profileId === profile.id &&
    x.dappMetadata.url === origin &&
    x.permissions.some((p) => p.chainId === chainId) // chain authorization already lives here
  )
  ```
- All callers in `wallet-sdk/background.ts:69-77, 133-145, 294-357` and `wallet-bridge/src/dispatcher.ts:231-253, 314-356, 367-381, 569-584, 775-794` need to pass `chainId`. (Codex audit cited these.)
- `services-contract.ts:50-62` interface needs the chainId added too.
- **No storage migration needed** — schema unchanged.
- Tests: e2e — connect on chain A, switch to chain B, verify dApp re-prompts.
- **Decision pending (Q6)**: lookup fix only, OR add a session-splitting model later (one session per origin-per-chain instead of one multi-chain session)?

### Phase 1: sequential after the parallel batch (1 week)

#### PR 5 (NARROWED SCOPE) — JSON fallback for non-Aztec types only

- Files: same as before (`extension-messaging/src/background/service.ts:119-127`, `offscreen/service.ts:99-105`, the matching client `onMessage` handlers).
- **Scope reduction**: only handles non-Aztec types (error strings, opaque blobs, plain JSON). Aztec class instances need a per-method revival map and that's deferred to a separate later PR.
- Justification: Nulo already `jsonSanitize`s before transport. The remaining DataCloneError surface is largely "errors with non-serializable nested causes" — covered by this scope.
- Tests: 4 unit tests (happy path / DataCloneError → JSON / JSON.stringify fails / port disconnect mid-send).
- **Decision pending (Q5)**: confirm narrow scope, or expand later if a class-revival strategy is approved.

#### PR 7 — Firefox offscreen fallback (behind feature flag)

- File: `packages/extension/src/wallet/utils/offscreen.ts` (port Grego's pattern)
- Add: `hasOffscreenApi()` check; Firefox path via `chrome.windows.create({state:"minimized", focused:false, url: chrome.runtime.getURL(path)})`.
- **Audit-flagged refinement (per codex)**: existing Firefox manifest at `manifest/manifest.firefox.config.ts:18` only filters `"background"`; still inherits `"offscreen"` permission. Need to also filter `"offscreen"` AND test the manifest is loadable in Firefox.
- **Audit-flagged refinement (per codex)**: in-memory `firefoxOffscreenWindowId` dies with SW; on re-spawn, must rediscover existing window by URL or risk leaking hidden windows.
- **Audit-flagged refinement (per opus)**: `chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"]})` may not work on Firefox; gate on `hasOffscreenApi()`.
- Tests: unit (mock `chrome.offscreen` undefined; assert Firefox path executes); manual smoke on actual Firefox.
- **Ship behind a feature flag** (e.g., `import.meta.env.MODE === "firefox"`) so Chrome production isn't carrying dead code.
- **Decision pending (Q4)**: do we have Firefox CI or manual-only?

### Phase 3: sequential, post Phase 1 (1 week)

#### PR 9 (FIRST) — `forEstimation: true` flag adoption

- 4.2.0 already exposes `forEstimation: boolean` on `completeFeeOptions`. Equivalent in 4.2.0 is partly via `completeFeeOptionsForEstimation(...)` and `opts.fee?.estimateGas` (codex finding).
- Find Nulo's fee completion sites and unify sim/real through one fee-completion call with `forEstimation: true` on the sim path.
- **Audit-flagged risk**: existing `gasPadding: 1` (sim) vs `feeMultiplier` (real) is a different mechanism. Map the gas-multiplier surface explicitly before changing.
- Tests: unit + e2e gas regression.

#### PR 8b-ii — Add `stubAccountAddresses` to `executeAztecSimulateTx` + `executeAztecProfileTx`

- Files: `packages/extension/src/wallet/services/execution/service.ts` around `executeAztecSimulateTx:1540-1568` and `executeAztecProfileTx:1586-1610`.
- Today these methods call `pxe.simulateTx` / `pxe.profileTx` with the **real** account in scope and **no** `stubAccountAddresses`. Real signing keys touch the simulator.
- Add: pass `stubAccountAddresses: [accountAddress]` like `executeNoFromSendTx:1766` does.
- This invokes the existing override path at `pxe/service.ts:233-246` for these methods too.
- Tests: mock the real account's signing function; assert it's NOT called during sim. Assert sim still produces valid `TxSimulationResult.privateExecutionResult`.

#### PR 8b-iii — Verify `skipKernels: true` requirement

- The `pxe.simulateTx` `overrides` field's docstring says "Requires skipKernels: true". Current Nulo code does NOT pass `skipKernels`.
- Either we're silently violating a contract, the docstring is stale, or override is silently ignored.
- Test: simulate a tx that would fail with the real account's `verify_private_authwit` and assert it succeeds with the stub override. If broken: pass `skipKernels: true` in the simulateTx call at `pxe/service.ts:248-254` (need to verify it doesn't break the existing kernelless flow).
- **Outcome dictates next steps**: if override is load-bearing today, PR 8b-i becomes higher risk.

#### PR 8b-i (OPTIONAL, decision pending) — Swap stub artifact

**The user's framing was: "scrub Nulo's existing impl in favor of Grego's if Grego's is cleaner."**

Comparison:
- **Nulo today**: `SimulatedSchnorrAccountContractArtifact` from `@aztec/noir-contracts.js/SimulatedSchnorrAccount`. Bespoke artifact path. Lives next to other test/sim contract artifacts.
- **Grego**: `StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/schnorr` — the canonical accounts package. Pairs with `createStubSchnorrAccount(completeAddress)` and `StubBaseAccountContract` with shared `StubAuthWitnessProvider`. Symmetric ECDSA support via `@aztec/accounts/stub/ecdsa`.

**Recommendation: SWAP** — `@aztec/accounts/stub/*` is the canonical Aztec package and the correct dependency boundary. ECDSA support comes free for the day Nulo grows it.

**Hard requirements before swap**:
1. Pin a behavioral-equivalence test: simulate the same tx with both artifacts; assert identical `TxSimulationResult` shape.
2. Verify `StubSchnorrAccountContractArtifact` works with the existing `pxe/service.ts:236-246` override mechanism (instance construction + ContractOverrides).
3. PR 8b-iii must land first (so we know whether `skipKernels` is required).

If 4.2.0 has a divergence we can't reconcile, fall back to keeping the existing artifact and just doing PR 8b-ii (extend coverage to dApp paths).

#### PR 8c — Public-static fast path

- Helpers (verified in 4.2.0): `extractOptimizablePublicStaticCalls`, `simulateViaNode`, `buildMergedSimulationResult` from `@aztec/wallet-sdk/base-wallet`.
- Targets: `executeAztecSimulateTx:1540-1568` and `executeSimulateUtility:1049+` (the dApp-facing read-heavy paths).
- Pattern (per audit-corrected sketch):
  ```ts
  const { optimizableCalls, remainingCalls } = extractOptimizablePublicStaticCalls(executionPayload)
  const [optimizedResults, normalResult] = await Promise.all([
    optimizableCalls.length ? simulateViaNode(node, optimizableCalls, ...) : Promise.resolve([]),
    remainingCalls.length ? pxe.simulateTx(buildTxRequest(remainingCalls), opts) : Promise.resolve(undefined),
  ])
  return buildMergedSimulationResult(optimizedResults, normalResult)
  ```
- **Depends on PR 5** (or class-revival map for `simulateViaNode` results crossing port). If PR 5 is non-Aztec-only, this PR will hit the gap and need to either:
  - Stay SW-internal (offscreen-only) and not cross port at all, OR
  - Wait until class-revival lands
- Tests: parallelism check (mock both pxe + node); sim correctness regression on representative dApp.

#### PR 11 (REFINED) — Multi-tab + cold-SW e2e tests

- New e2e suite: `packages/extension/tests/e2e/long-running-ops.test.ts`
- 3 tests:
  1. **Concurrent read-only sims** (PASSING) — open 2 dApp tabs; both call `aztec_simulateTx` with read-only public-static calls; both succeed concurrently. Documents that read-only doesn't block under the global `ReadWriteGuard`.
  2. **Concurrent proof submissions** (SERIALIZE, both eventually pass) — open 2 dApp tabs; submit prove from each. Should serialize (one finishes, then the other starts). NOT `test.fails`. Asserts the global write lock at `pxe/service.ts:330-345` works.
  3. **Cold-SW mid-proof** (`test.fails(...)`) — submit a tx, suspend the SW mid-proof, wait for re-spawn. Expected to fail — documents the gap before Phase 2.
- Open Linear ticket: "Phase 2 — design durable job submission + AbortController + per-chain PXE concurrency" (per Q9).

---

## DELETED

- ~~PR 8a (Aztec version bump)~~ — not required; 4.2.0 has every helper.
- ~~PR 8b's "rewrite the kernelless path"~~ — replaced with PR 8b-i/ii/iii (much smaller).

## DEFERRED (out of P1 + P3 scope)

- **Aztec class revival in PR 5** — needs per-method revival map; defer until a class-revival strategy is approved.
- **Capability progressive wildcard** (Aztec #11) — paradigm mismatch with Nulo's existing scope-with-wildcards system; defer indefinitely or as part of a future capability-system overhaul.
- **Phase 2** — durable jobs, AbortController, per-chain PXE concurrency, chrome.alarms wake-up architecture. *Refined 2026-05-12: split into Phase 2 (shippable, 8 items), Phase 2+ (durable jobs done right — 6 job-system properties + chaos + narrow formal methods, mostly additive), and Maximalist (5/5 across the board). Storage hardening moves from Phase 2 to Maximalist persistence-spine. See `wallets-architecture-research/{nulo-phase-2,nulo-phase-2-plus,nulo-maximalist}.html`.*

---

## Risk summary (revised)

| Risk | Severity | Mitigation |
|------|----------|------------|
| `skipKernels: true` requirement is silently violated today | HIGH | PR 8b-iii is a dedicated test PR; gates 8b-i |
| PR 1 UX flow break | HIGH (e2e + UX) | Decision Q1 above; option (b) preserves UX |
| PR 4 conversion of alias object → array | LOW | Build + e2e gate |
| Stub artifact swap regression (PR 8b-i) | MEDIUM | Functional-equivalence test required before merge |
| Firefox manifest permissions issue (PR 7) | MEDIUM | Add `web-ext lint` to build pipeline |
| `humanizeOperationKind` fix breaks pinning test | LOW | Update the BUG-PIN test alongside the fix |
| PR 10 lookup change misses chain semantics in `permissions` | LOW | Use existing `chainId` matches in `permissions[]` |

---

## Final order

```
WEEK 1 (parallel, single-week sprint):
  PR A   = F1 + F2 + F3 (security trio)              ✅ shipped
  PR 4   = function-bind CSP stub                     ✅ shipped
  PR 6   = UX chips + humanize bug fix                ✅ shipped
  PR 10  = remembered-apps chain-filter (schema)      ✅ shipped (post-audit fix: parseCaipChain in checkMethodPermission)

WEEK 2:
  PR 5   = JSON fallback (non-Aztec scope)            ✅ shipped
  PR 7   = Firefox fallback (behind flag)             ✅ shipped

WEEK 3:
  PR 9     = forEstimation flag adoption              ✅ shipped (trust upstream defaults; replaces inline GAS_ESTIMATION_* construction)
  PR 8b-ii = stubAccountAddresses on dApp sim methods ✅ shipped (executeAztecSimulateTx; profileTx skipped — upstream ProfileTxOpts has no `overrides` in 4.2.0)
  PR 8b-iii = skipKernels explicit when overrides     ✅ shipped (upstream default is true; pinned explicit to defend against future flip)
  PR 8b-i  = swap to canonical stub artifact          ✅ shipped (StubSchnorrAccountContractArtifact via @aztec/accounts/stub/schnorr)
  PR 8c    = public-static fast path                  ✅ shipped @ v0.14.7 (FULL — mixed payload + fee unification)
                                                         History:
                                                          - v0.14.0 first attempt — class-rehydration bug
                                                            (TypeError: s.isPublicStatic is not a function);
                                                            disabled via hotfix at 4f6c640a (v0.14.3)
                                                          - v0.14.4-6 re-implemented via dedicated fast-path.ts
                                                            with pure-public-static-only restriction
                                                          - v0.14.7 FULL: lifted pure-only restriction to
                                                            support upstream BaseWallet.simulateTx mixed
                                                            payload pattern. Final shape:
                                                            * IPXE.getSyncedBlockHeader() — new RPC method
                                                              on Nulo's PXE surface (5-file plumbing).
                                                              Mixed merge needs both arms to anchor at the
                                                              same chain state; PXE-synced header preferred,
                                                              falls back to node.getBlockHeader().
                                                            * Shared completeFeeOptions translator in
                                                              @nulo/aztec-runtime/account/fee-options.ts.
                                                              Both standard path (nulo-account.ts) AND fast
                                                              path call into it; mirrors upstream
                                                              BaseWallet.completeFeeOptions byte-for-byte
                                                              (Gas.from / GasFees.from rehydration; default
                                                              from node.getCurrentMinFees().mul(1.5)).
                                                              Drift between fast and standard paths
                                                              eliminated.
                                                            * maxPriorityFeesPerGas plumbing: was silently
                                                              dropped in operation-planner.ts before the
                                                              standard path's FeeOptions shim could see it.
                                                              Now threaded through schema (wallet-bridge/
                                                              operation.ts) → planner → tx-request-builder →
                                                              nulo-account.
                                                            * IAccountContract.requiresInitialization(node)
                                                              — new interface method so ExecutionService
                                                              can detect first-tx multicall init state
                                                              without reaching through NuloAccount.instance
                                                              from outside.
                                                            * rehydrateOptimizablePrefix: data-only boundary
                                                              scan then rehydrate ONLY the prefix (avoid
                                                              double-parse — remainder stays raw, planner
                                                              re-rehydrates).
                                                            * runFastPath: parallel arms,
                                                              buildMergedSimulationResult upstream call,
                                                              first-tx multicall init excluded upstream in
                                                              orchestrator (doubly-nested execution tree
                                                              not expressible by flat appCallOffset).
                                                            * Codex iteration: session 019e183f (3 rounds:
                                                              independent draft → consolidation → final
                                                              review).
                                                            * Tests: 24 fast-path.test.ts + 7
                                                              fee-options.test.ts + 2 operation-planner.test.ts
                                                              = 33 new unit tests across 3 files
                                                            * Manual QA verified end-to-end (2026-05-11):
                                                              private↔public transfers, dApp-set fee payer,
                                                              NO_FROM, public fee juice, sponsored FPC.
                                                         Codex sessions: 019e13f8 (initial plan), 019e16ec
                                                         (plan v1-v3), 019e1802 (v0.14.4-6 code review),
                                                         019e183f (v0.14.7 mixed-payload 3-round iteration).
  PR 10 fixup = wallet-sdk pending dedup (origin,chainId)✅ shipped (post-codex audit: re-keyed pendingDiscoveryPromises + pendingVerification + UI fix for blank Networks section)
  PR 11    = multi-tab + cold-SW e2e                  🔁 DEFERRED (local e2e environment was broken at session-end; revisit on clean infra)

PARALLEL TRACKING (no code):
  Linear ticket: Phase 2 design (durable jobs etc.)   🔁 SKIPPED per user direction (no extra noise)
```

Total: ~3 weeks of focused work (down from 3-5 in v1). Phase 1 is fully shipped; Phase 3 is partially shipped with the highest-leverage Aztec change (stub-account-on-dApp-simulateTx) in place.

## Tracked follow-ups (post-ship)

```
1. ✅ DONE @ v0.14.7 — PR 8c MIXED PAYLOAD SUPPORT  (commits f5f8c10d, 1ddc6711)
   Shipped. All four sub-items from the original plan are in:
     (a) ✅ IPXE.getSyncedBlockHeader() RPC plumbing
     (b) ✅ appCallOffset = 1 for Nulo's DefaultAccountEntrypoint
         (verified via wrapStandardArmForMixedMerge tests). First-tx
         multicall case excluded — doubly-nested execution tree not
         representable; tracked as separate follow-up below.
     (c) ✅ Promise.all([simulateViaNode, runStandardForRemainder]) +
         upstream buildMergedSimulationResult
     (d) ✅ 24 fast-path.test.ts cases including mixed split + merge
   Chain-state-divergence risk: mitigated via mandatory
   pxe.getSyncedBlockHeader() anchor (falls back to node head only if
   PXE call throws).

2. ✅ DONE @ v0.14.7 — PR 8c FEE SEMANTICS UNIFICATION  (commit Phase 2)
   Shipped. Nulo's standard path no longer hardcodes 1e18 max fees —
   both paths call into shared completeFeeOptions translator that
   mirrors upstream BaseWallet.completeFeeOptions byte-for-byte.
   maxPriorityFeesPerGas plumbing was a side-discovery during this
   work — codex caught that operation-planner.ts had been silently
   dropping it from the dApp's request before the standard path could
   see it. Full pipeline now threaded.

3. PR 11 — multi-tab + cold-SW e2e
   Still deferred from initial Phase 3; revisit on clean e2e infra.

4. FIRST-TX MIXED-PAYLOAD NORMALIZER  (deliberately not shipped — see below)
   When the user's account hasn't sent its first tx yet AND a dApp
   submits a mixed-payload simulateTx (public-static prefix + non-static
   remainder), the fast path falls through to the standard path
   entirely. Reason: nulo-account.buildTxExecutionRequest wraps the
   first tx via DefaultMultiCallEntrypoint, producing a doubly-nested
   execution tree (multicall → [ctor, entrypoint(appCalls)]) that
   upstream's flat appCallOffset model can't represent.

   Naive approach considered + rejected (2026-05-12): project the
   standard arm's privateExecutionResult tree onto the inner entrypoint
   subtree, then wrap with appCallOffset=1. Codex (session 019e1912)
   and opus 4.7 both flagged real correctness issues:

     (a) publicInputs.gasUsed IS dApp-visible via
         TxSimulationResult.gasUsed (simulated_tx.js:65-71). dApps
         consume this for fee-estimation UI. The naive normalizer
         leaves multicall's gasUsed (which includes ctor execution
         gas) attached to a tree rooted at the entrypoint subtree.
         Over-reports gas vs an already-initialized account.
     (b) firstNullifier of the multicall result IS the account init
         nullifier. Carrying it verbatim onto an entrypoint-rooted
         tree is semantically wrong; the entrypoint subtree's first
         nullifier is whatever the entrypoint emits first.
     (c) Unit tests against synthetic trees can't catch upstream
         tree-shape drift (e.g. if DefaultMultiCallEntrypoint changes
         ordering or wrapping on a stdlib bump); the defensive
         "return result unchanged if nested[1] missing" would mask it.

   Real fix would require recomputing publicInputs over the projected
   tree (non-trivial — kernel circuit output isn't trivially
   partitionable) and either dropping or recomputing firstNullifier.

   Edge case (dApp would need to simulate mixed payload BEFORE the
   user has ever sent a tx). The 3-5 s saving doesn't justify
   shipping a subtly wrong tree projection. Revisit if a real dApp
   pattern emerges that frequently hits this case.
```

---

## Open decisions for the user (consolidated)

These are the questions you need to answer before implementation. Each has a recommendation; reject any.

1. **PR 1 — encrypted-key export auth flow.** Three options:
   - (a) Full unlock card (signature change, breaks current UX, breaks e2e)
   - (b) Gate via active-session check (no extra UI, closes hole) — **recommended**
   - (c) Leave as-is; document threat model

2. **PR 8b-i — stub artifact swap.** Three options:
   - (a) Keep `SimulatedSchnorrAccountContractArtifact` (no churn, works today)
   - (b) Swap to `StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/schnorr` after functional-equivalence test passes — **recommended (your stated preference: scrub Nulo's existing if Grego's is cleaner)**
   - (c) Hold the decision until PR 8b-ii + 8b-iii land

3. **PR sizing.** Bundle PR 1 + PR 2 + PR 3 into one PR with three commits (recommended), or three separate PRs?

4. **PR 7 Firefox.** Do we have Firefox CI? Three options:
   - (a) Full e2e on Firefox in CI
   - (b) Behind feature flag, manual verification only — **recommended if no CI today**
   - (c) Defer Firefox entirely until Phase X

5. **PR 5 scope.** Two options:
   - (a) Non-Aztec types only (errors, opaque blobs, plain JSON) — **recommended**
   - (b) Full Aztec-class-aware (requires per-method revival map; bigger PR)

6. **PR 10 approach.** ✅ **RESOLVED → schema change (option b)**. User-direction: "the most durable and professional fix, no need to only monkey patch." Sessions become per-`(origin, chainId, profileId)`. `DappSession` gets a required `chainId: string` field. `addDappSession` takes chainId. `tryGetDappSessionByOriginAndChain(origin, chainId)` is the new lookup. Storage migration: destructive wipe of `nulo:core:dappSessions@*` via `KEY_PREFIXES_TO_WIPE_LOCAL` (per Opus audit), bump `STORAGE_VERSION_KEY` to 4. **No production users** — destructive wipe is acceptable per global directive (see below).

7. **PR 6 scope creep.** Include the `humanizeOperationKind` first-underscore bug fix while the file is open? **Recommended yes** (2-line fix, M6 STATUS.md follow-up that's been pending).

8. **PR 4 function-bind approach.** ✅ **RESOLVED → CJS shim (option a)**. User explicitly preferred no install-time patches. The shim lives at `packages/extension/src/shims/function-bind-stub.cjs` as a tracked source file. Vite alias in `vite.config.ts` resolves both `function-bind` and `function-bind/implementation` to it.

9. **Phase 2 tracking ticket.** ✅ **RESOLVED → no Linear ticket now**. User flagged it as unnecessary noise. PR 11's failing test docstring will reference Phase 2 inline; we'll formalize tracking when Phase 2 design begins.

---

## Per-PR verification ritual (mandatory)

Every PR follows this exact sequence before push. **No PR is "done" until all six gates pass.**

```
1.  bun run typecheck:all       # types
2.  bun run test                # unit tests (517 baseline)
3.  bun run lint                # biome (incl. layer rules)
4.  bun run build               # production bundle compiles
5.  bun run audit:vue           # the bundled gate above
6.  Relevant e2e tests          # see per-PR map below
```

### Per-PR e2e relevance

E2e suites in this repo:
- **Non-network e2e** (`bun run test:e2e`): popup, vault, settings, dApp connection (mocked). Fast, deterministic.
- **Network e2e** (`bun run test:e2e:network`): hits an Aztec sandbox; tests proof generation, simulation against real PXE state. Slower; flakier; the truth detector for anything Aztec-runtime.

```
╔═════════╦═════════════════════╦═════════════════╦═══════════════════════════════════════════════╗
║ PR      ║ Non-network e2e     ║ Network e2e     ║ Specific suites                                ║
╠═════════╬═════════════════════╬═════════════════╬═══════════════════════════════════════════════╣
║ A.1     ║ ✅                  ║ ❌              ║ tests/e2e/import-paths.test.ts (export flow)   ║
║ A.2     ║ ✅                  ║ ❌              ║ all (port plumbing affects every flow)         ║
║ A.3     ║ ✅                  ║ ❌              ║ tests/e2e/security.test.ts (cold-boot prompt)  ║
║ 4       ║ ✅                  ║ ❌              ║ all (CSP affects every page; check pageErrors) ║
║ 6       ║ ✅                  ║ ❌              ║ execute-related suites; chip rendering         ║
║ 10      ║ ✅                  ║ ✅              ║ dApp connection + chain-switch tests           ║
║ 5       ║ ✅                  ║ ✅              ║ all (transport-affecting)                      ║
║ 7       ║ ✅ (Chrome)         ║ ✅ (if avail)   ║ all + manual smoke on actual Firefox build     ║
║ 9       ║ ❌                  ║ ✅              ║ network/* — gas-estimation correctness         ║
║ 8b-ii   ║ ❌                  ║ ✅              ║ network/* — dApp simulateTx + profileTx        ║
║ 8b-iii  ║ ✅                  ║ ✅              ║ unit (skipKernels test) + network sanity       ║
║ 8b-i    ║ ✅                  ║ ✅              ║ unit (artifact equivalence) + full network     ║
║ 8c      ║ ❌                  ║ ✅              ║ network/* — read-heavy dApp paths              ║
║ 11      ║ N/A (these ARE the new tests)        ║                                                ║
╚═════════╩═════════════════════╩═════════════════╩═══════════════════════════════════════════════╝
```

### What "PR done" means

For every PR, in the PR description:
1. Paste output of `bun run audit:vue` (passing)
2. Paste e2e test output for the relevant suites
3. Note any flake retries (per CLAUDE.md A12 culture: known flakes go to STATUS.md, not silenced)
4. Manual smoke notes if the PR has UX surface

**No PR opens for review until the gate passes locally.** No "let's see what CI says" handoff to the gate.

---

## Audit follow-ups intentionally NOT acted on

- **PR 5 expansion to Aztec-class-aware revival**: deferred per Q5 above.
- **`@aztec/entrypoints/default` import safety in SW**: codex flagged this (`tx-request-builder.ts:415-417`). Not a problem for the revised PR 8b-ii path which uses the existing override mechanism, NOT a new entrypoint construction.
- **PR 11's "passing" multi-tab read test**: included in revised plan.
- **PR 11 cold-SW test as `test.fails`**: included.
- **Capability wildcard (A11)**: confirmed deferred, paradigm mismatch.
