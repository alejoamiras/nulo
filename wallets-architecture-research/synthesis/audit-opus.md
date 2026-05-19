# Audit — Implementation Plan P1 + P3

> Reviewer: Opus 4.7 (1M context). Plan under review: `wallets-architecture-research/synthesis/implementation-plan-p1-p3.md` (572 lines).
> Reference materials cross-checked: `wallets-architecture-research/README.md` (678 lines), Grego repo at `(Grego source tree)/`, Nulo `nulo-2` HEAD `65ea47a`, npm registry tarballs of `@aztec/{accounts,wallet-sdk,stdlib,pxe,aztec.js}@4.2.0`.

---

## Bottom line

**Verdict: Sound on direction, but has at least one factual error large enough to delete an entire PR, two design omissions that will silently break PRs as written, and a UX-impact miss in the simplest fix in the plan.** The plan is publishable, but not without the changes below. The author treated the Aztec version-bump as the riskiest unknown — that turns out to be wrong in the helpful direction (no bump needed), but the same lack of verification missed two harder things that DO break the patches as drafted.

**Top 5 highest-severity issues:**

1. **`@aztec/* 4.2.0` already ships every helper PR 8a was supposed to gate on.** Stub artifacts (`@aztec/accounts/stub/{schnorr,ecdsa}`), `@aztec/wallet-sdk/base-wallet` exports (`extractOptimizablePublicStaticCalls`, `simulateViaNode`, `buildMergedSimulationResult`), `forEstimation: true` flag on `completeFeeOptions`, and the `SimulationOverrides` shape on `pxe.simulateTx` are all present in the 4.2.0 tarballs. **PR 8a should be deleted entirely** — see Section B.
2. **Nulo already does stub-account simulation overrides at `aztec-runtime/src/pxe/service.ts:233-246`.** Uses a different upstream artifact (`SimulatedSchnorrAccountContractArtifact` from `@aztec/noir-contracts.js/SimulatedSchnorrAccount`) than Grego's (`StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/schnorr`), but the override mechanism is wired and live. Plan PR 8b's claim that Nulo's `executeNoFromSendTx:1762-1769` does not use stub-account simulation is **wrong**: the `[account.address.toString()]` argument on line 1766 is the `stubAccountAddresses` parameter that triggers the stub override at `service.ts:236`. PR 8b reduces from "rewrite the kernelless path" to "swap upstream artifact + extend FROM_ACCOUNT path of `executeAztecSimulateTx`". See Section C.
3. **PR 8b cannot use `SimulationOverrides` without setting `skipKernels: true`.** From `pxe.d.ts` line 8 (`@aztec/pxe@4.2.0`): `"State overrides for the simulation, such as contract instances and artifacts. Requires skipKernels: true"`. The plan never mentions this. The current `executeNoFromSendTx` discovery sim does not pass `skipKernels` — it uses `skipTxValidation + skipFeeEnforcement` to escape kernel checks indirectly. Whether `skipKernels: true` is semantically equivalent for the discovery path, what changes for the "real simulation" stage at line 1791-1798, and how this interacts with `buildAndEstimateTxRequest`'s coordinator-locked `simulateTxTask` is unanalyzed. **This is the one technical issue that can corrupt sim outputs if missed.** See Section C.
4. **PR 1's signature change breaks the encrypted-key UX without a UI replacement plan.** `key.vue:55-59` reads the encrypted blob via a `selectedKey === "public"` watcher with no password prompt — the encrypted variant is shown directly because the blob is *already* password-encrypted. The plan calls this "Find callers; update each" but does not describe how the variant is gated (password prompt? unlock card? dual-flow with private key?). Also: `e2e/import-paths.test.ts:382-415` (the test the PR has to keep passing) explicitly relies on this no-prompt behavior. See Section D.
5. **`nodePolyfills({ globals: { process: true } })` will fight with the existing `define: { "process.browser": true, "process.env": ... }` at `vite.config.ts:252-256`.** `define` is a compile-time substitution that rewrites the literal `process.browser` and `process.env` references in source. `globals: { process: true }` injects a runtime polyfill via Rollup's `inject` plugin. Because `define` runs first (esbuild), `process.browser` is replaced with `true` at parse time **before** the polyfill plugin sees the source — so most reads should be fine. But any code that does `globalThis.process` or uses bracket notation (`process["env"]`) escapes `define` and falls through to the runtime polyfill. The two then have different shapes. **This is a runtime hazard that could surface as `process.env is undefined` in cold paths.** See Section E.

The remaining issues range from medium (PR 2's race-fix has a sub-race the plan misses; PR 5's risk surface is wider than the plan acknowledges; PR 7 has a manifest permissions question) to small (Chip vs Badge naming; storage migration could be lighter).

---

## A. File-path + line-number verification

I verified 7 of the major citations in the plan against `nulo-2` HEAD and Grego's repo. Results:

| Citation | Plan claim | Actual | Verdict |
|---|---|---|---|
| Plan PR 1 | `profile/service.ts:507-517` | `service.ts:507-517` | ✓ correct |
| Plan PR 2 | `extension-messaging/src/background/client.ts:127-181` | `client.ts:127-181` (request method body); the actual non-null deref is at line 176 | ✓ correct, race characterization matches |
| Plan PR 5 | `extension-messaging/src/background/service.ts:119-127` for `send()` | `service.ts:119-127` is `send()` | ✓ correct |
| Plan PR 5 | `extension-messaging/src/offscreen/service.ts:99-105` | The send-with-retry block is at lines 99-105 | ✓ correct |
| Plan PR 7 | `packages/extension/src/wallet/utils/offscreen.ts` | File exists; current `ensureOffscreenRunning` at line 108-141 unconditionally calls `chrome.offscreen.*` | ✓ correct, no Firefox path today |
| Plan PR 8b | `executeNoFromSendTx` at `service.ts:1700-1826` | `executeNoFromSendTx` definition is at lines 1706-1826 (declaration on 1701, body 1706+) | ✓ correct (off-by-5 on the declaration line; immaterial) |
| Plan PR 8b | "kernelless discovery sim" at lines 1762-1769 | The `pxe.simulateTx(..., [account.address.toString()])` call is at lines 1763-1767 | ✓ correct |
| Plan PR 10 | `dapp-session/service.ts:78-91` for `tryGetDappSessionByOrigin` | Method body at lines 78-91 | ✓ correct |
| Plan PR 3 | `config.ts:13` defaults `strictSecurityMode = true` | `config.ts:13` reads `strictSecurityMode: boolean = true` | ✓ correct |
| Plan PR 3 | `SessionManager.open:202` gates passhash on strict mode | `session-manager.ts:202` reads `const persistPasshash = passhash !== undefined && !this.strictSecurityMode` | ✓ correct |

**Grego refs:**

| Citation | Plan/README claim | Actual | Verdict |
|---|---|---|---|
| `function-bind-stub.cjs` | verbatim copy from Grego | `extension-wallet/src/shared/function-bind-stub.cjs` exists, 22 lines, exactly matches the inline sketch in the plan | ✓ correct |
| `offscreen-lifecycle.ts:67-85` | Firefox fallback location | Lines 67-85 are exactly the `firefoxOffscreenWindowId !== null` branch and minimized-window creation | ✓ correct |
| `offscreen-lifecycle.ts:18-33` | ready-gate / `markOffscreenReady` | Lines 13-33 are the gating + reset logic | ✓ correct |
| `port-server.ts:46-88` | JSON fallback | Lines 39-89 contain the try/catch with `jsonStringify` fallback. Plan's range is slightly tight but cited region is right | ✓ correct |
| `demo-wallet.ts:139-226` | `buildAccountOverrides + simulateViaEntrypoint` | `buildAccountOverrides` at 139-165, `simulateViaEntrypoint` at 167-226 | ✓ correct |
| `internal-wallet.ts:170-200` | sim → authwit → prove flow | Lines 162-209 contain `completeFeeOptions({forEstimation: true})` → `simulateViaEntrypoint` → `collectOffchainEffects` → `createAuthWit` → `getGasLimits` | ✓ correct |
| `authorization-manager.ts:218-256` | wildcard matching | `checkWildcardAuthorization` at 218-256 with `:*` patterns | ✓ correct |

All file paths and line numbers I spot-checked are accurate within ±5 lines. **The plan's citations are reliable.**

---

## B. The Aztec version-bump question — RESOLVED

I pulled the 4.2.0 tarballs from npm without touching the workspace state.

```
npm pack @aztec/accounts@4.2.0       → 116 files
npm pack @aztec/wallet-sdk@4.2.0     → 90 files
npm pack @aztec/stdlib@4.2.0         → 1492 files
npm pack @aztec/pxe@4.2.0            → 354 files
npm pack @aztec/aztec.js@4.2.0       → 283 files
```

**All four artifact families that PR 8a was meant to unlock are present in 4.2.0:**

1. **`@aztec/accounts/stub/{schnorr,ecdsa}`** — confirmed via `package/package.json` exports map (lines 7-13 in the unpacked tarball):
   ```json
   "./stub/schnorr": "./dest/stub/schnorr/index.js",
   "./stub/schnorr/lazy": "./dest/stub/schnorr/lazy.js",
   "./stub/ecdsa": "./dest/stub/ecdsa/index.js",
   "./stub/ecdsa/lazy": "./dest/stub/ecdsa/lazy.js",
   ```
   And the typed API at `dest/stub/schnorr/index.d.ts`:
   ```ts
   export declare const StubSchnorrAccountContractArtifact: ContractArtifact;
   export declare class StubSchnorrAccountContract extends StubBaseAccountContract { ... }
   export declare function createStubSchnorrAccount(originalAddress: CompleteAddress): BaseAccount;
   ```

2. **`@aztec/wallet-sdk/base-wallet` helpers** — confirmed at `dest/base-wallet/index.d.ts:2`:
   ```ts
   export { simulateViaNode, buildMergedSimulationResult, extractOptimizablePublicStaticCalls } from './utils.js';
   ```
   With actual usage in the same package's `BaseWallet.simulateTx` at `dest/base-wallet/base_wallet.js`:
   ```js
   const { optimizableCalls, remainingCalls } = extractOptimizablePublicStaticCalls(executionPayload);
   ...optimizableCalls.length > 0 ? simulateViaNode(this.aztecNode, optimizableCalls, ...)
   ```

3. **`forEstimation: true` flag on `completeFeeOptions`** — confirmed at `dest/base-wallet/base_wallet.d.ts`:
   ```ts
   forEstimation?: boolean;
   ```
   And the runtime usage in `base_wallet.js`:
   ```js
   const fullGasSettings = forEstimation ? GasSettings.forEstimation(gasSettingsOverrides) : GasSettings.fallback(gasSettingsOverrides);
   ```

4. **`SimulationOverrides` and the matching `simulateTx` opts** — confirmed at `@aztec/pxe@4.2.0/dest/pxe.d.ts`:
   ```ts
   export type SimulateTxOpts = {
     simulatePublic: boolean;
     skipTxValidation?: boolean;
     skipFeeEnforcement?: boolean;
     skipKernels?: boolean;
     overrides?: SimulationOverrides;   // ← present
     scopes: AztecAddress[];
   };
   ```

**Conclusion: there is no Aztec version bump required for any of the patterns in the plan.** PR 8a should be deleted from the plan entirely. PRs 8b, 8c, and 9 lose their gate dependency. Effort estimate for the whole plan drops by what the author called the "single highest risk" PR. The plan's own `Open decisions for the user`, item 1 ("Aztec version bump 4.2.0 → 4.3.x — accept the regression risk, or stay on 4.2.0 and skip A8b/A8c/A9?") becomes a non-question. **Path (1) and path (2) collapse: stay on 4.2.0 and ship everything.**

This is the single most important finding in the audit.

---

## C. Design challenges

### C1. PR 8b's plan to "replace the existing kernelless path" misreads the existing code

The plan describes Nulo's current `executeNoFromSendTx:1762-1769` as:
> "current `simulatePublic + skipTxValidation + skipFeeEnforcement + scopes_without_account`"

and proposes to replace it with `simulateViaStubAccount(...)`. **What the plan misses is that Nulo already does this swap, just one layer down.** At `aztec-runtime/src/pxe/service.ts:233-246`:

```ts
let overrides = await SimulationOverrides.schema.optional().parseAsync(opts.overrides)
if (stubAccountAddresses?.length) {
  const { SimulatedSchnorrAccountContractArtifact } = await import("@aztec/noir-contracts.js/SimulatedSchnorrAccount")
  const contracts: Record<string, { instance: ContractInstanceWithAddress; artifact: ContractArtifact }> = {}
  for (const addr of stubAccountAddresses) {
    const instance = await getContractInstanceFromInstantiationParams(SimulatedSchnorrAccountContractArtifact, { salt: Fr.random() })
    contracts[addr] = { instance, artifact: SimulatedSchnorrAccountContractArtifact }
  }
  overrides = new SimulationOverrides({ ...(overrides?.contracts ?? {}), ...contracts })
}
return await pxe.simulateTx(..., { overrides, scopes, ... })
```

The third argument `[account.address.toString()]` at `executeNoFromSendTx:1766` IS the `stubAccountAddresses` parameter — visible at `pxe/spec.ts:40`, `pxe/proxy.ts:81`, `pxe/client.ts:130`. So Nulo is already invoking pxe.simulateTx with `SimulationOverrides` containing a stubbed contract for the user account.

**The actual delta with Grego is much narrower:**

1. **Different upstream artifact.** Nulo uses `SimulatedSchnorrAccountContractArtifact` from `@aztec/noir-contracts.js/SimulatedSchnorrAccount`. Grego uses `StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/schnorr`. These are different artifacts shipped by different upstream packages. Both produce stub-style auth-passthrough contracts. Whether they are functionally equivalent is the question PR 8b should answer — but it would be a *targeted* swap, not a rewrite. (Naming hint: `Simulated*` vs `Stub*`. Grego's stub also handles `StubBaseAccountContract` with shared `StubAuthWitnessProvider` returning empty AuthWitness.)

2. **FROM_ACCOUNT path coverage.** `executeAztecSimulateTx:1540-1568` and `executeAztecProfileTx:1586-1610` invoke `pxe.simulateTx` / `pxe.profileTx` with the *real* account in scope and **no** `stubAccountAddresses`. This is the path where Grego's pattern adds value: a dApp `aztec_simulateTx` call currently runs through the real account at sim time. PR 8b should specifically target these methods.

3. **`authwit-discoverer.ts:91-103`** is the third site — already uses `stubAccountAddresses`. Identical pattern to `executeNoFromSendTx` discovery.

**Recommendation:** rewrite PR 8b in three pieces:
- **PR 8b-i** Swap `SimulatedSchnorrAccountContractArtifact` → `StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/schnorr` if and only if a behavior diff is documented in test (otherwise leave the existing artifact). Add `StubEcdsaAccountContractArtifact` for ECDSA accounts when Nulo grows that support.
- **PR 8b-ii** Add `stubAccountAddresses: [account.address.toString()]` to the `pxe.simulateTx` calls in `executeAztecSimulateTx` and `executeAztecProfileTx`. Pure addition, low risk.
- **PR 8b-iii** Document the kernelless-vs-skipKernels question (next bullet).

### C2. `overrides` requires `skipKernels: true` — PR 8b does not address this

From `@aztec/pxe@4.2.0/dest/pxe.d.ts`:
```ts
/** State overrides for the simulation, such as contract instances and artifacts. Requires skipKernels: true */
overrides?: SimulationOverrides;
```

The current `pxe/service.ts:248-254` simulateTx call does **not** pass `skipKernels`. It does pass `overrides` (via the `stubAccountAddresses` extension). So either:
- **(a)** the current code is silently violating the contract (it works because the kernel check the docstring warns about isn't fatal in the current upstream PXE implementation — which is fragile)
- **(b)** the docstring is out of date and `overrides` does work without `skipKernels` in 4.2.0
- **(c)** the override is silently ignored, and the kernelless "discovery" path actually works only because of the existing `skipTxValidation: true`

I cannot prove which one without running the code. **PR 8b must include a test that confirms the override actually takes effect** (e.g., simulate a tx that would fail with the real account's `verify_private_authwit` and assert it succeeds with the stub override). If the kernelless behavior is actually load-bearing in 4.2.0, swapping artifacts could fail subtly.

### C3. The `executeAztecSimulateTx` path is not covered by Phase 2's deferral

Plan splits Phase 2 (durable jobs) and Phase 3 (Aztec catch-up). But `executeAztecSimulateTx` (dApp-facing read-heavy) is the *exact* surface where PR 8c's public-static fast path produces real value. The plan vaguely puts PR 8c's file at `execution/service.ts (location of sim invocation)` without naming a method. **It should specifically target `executeAztecSimulateTx` (line 1540-1568) and `executeSimulateUtility` (line 1049+)** — those are the read-heavy public-static dApp entry points.

### C4. The destructive-wipe migration for PR 10 is OK in policy, problematic in surface area

`migrate.ts:13` reads `CURRENT_VERSION = 3`. Plan says to add `nulo:core:dappSessions` to `KEYS_TO_WIPE` and bump to v4. That is consistent with the existing pattern. Two concerns:

1. **DappSession storage uses `EntityStorage<DappSession>` with key `nulo:core:dappSessions`** (verified at `dapp-session/service.ts:78` and confirmed by `grep "nulo:core:dappSessions"`). `EntityStorage` rows are stored under `nulo:core:dappSessions@<id>` — so a wipe needs to either remove the index key AND prefix-match the rows, or use `KEY_PREFIXES_TO_WIPE_LOCAL` with `nulo:core:dappSessions@`. Plan says to add it to `KEYS_TO_WIPE` (the exact-match list), which only nukes the index, not the rows. **Use `KEY_PREFIXES_TO_WIPE_LOCAL` instead.**

2. **`dappSessionService` already has `deleteExpired` and a TTL** (`addDappSession` calls `deleteExpired` at line 104). After a destructive wipe + reseed, every dApp must re-grant. That's fine for pre-launch — but if mainnet is closer than the plan thinks, this is the kind of thing that becomes "we wiped all your dApp connections" the morning of launch.

3. **Open question the plan asked** (line 510): "do we also key on `version`?" is **already answered** by the codebase. `wallet-sdk/background.ts:chainInfoToChainId` does `chainId XOR version`, so the chainId Nulo passes around already encodes version. Keying remembered apps on `(origin, chainId)` IS keying on `(origin, l1ChainId, rollupVersion)`. Plan's open question is moot.

### C5. PR ordering — hidden dependency the plan misses

The plan says PR 5 (jsonStringify fallback) "should land before PR 8b". The reason given is that "stub-sim returns Aztec class instances over the wire that may trigger the fallback path." That's true, but **PR 8b is *already* exercising this surface in the current code**: the existing `pxe/service.ts:233-246` returns `TxSimulationResult` (a class with `Fr`, `AztecAddress`, `Buffer`) over the wire today. The fact that this works today suggests structured-clone is OK for the current types. PR 8b is unlikely to break this.

The real ordering concern is **PR 5 must land before PR 8c**. The public-static fast path runs `simulateViaNode` which returns `TxSimulationResult[]` (an array of class instances). The merge result then crosses ports. PR 8c will hit DataCloneError before PR 8b does.

**Suggested re-order:** PR 5 → (PR 8b in any order) → PR 8c. The PR 8b-before-PR 5 dependency the plan asserts is too cautious.

### C6. Plan understates what "the prove path stays as-is" means in PR 8b

Plan PR 8b says (line 432): "Prove path (line 1802) stays as-is — proving with the real account." That's true at the surface. But the txRequest passed to `proveTxTask` was built using `entrypoint.createTxExecutionRequest(...)` (line 1718, via `txBuilder.buildNoFrom`). For `executeNoFromSendTx`, this uses `DefaultEntrypoint`, never the user account. For Grego's pattern in `simulateViaEntrypoint:188-215`, the txRequest is built from the *stub* account when `from !== NO_FROM`. That means in Grego's FROM_ACCOUNT path, the txRequest is tied to the stub account at sim time, then the real account's signatures are added at prove time. That's a non-obvious refactoring to do safely.

**The plan should explicitly document whether the PR 8b sim-then-prove split is at the layer of `txRequest` (the stub account is *baked into* the sim's txRequest) or at the layer of `simulationOverrides` (the txRequest stays the same but overrides swap the contract during sim).** Nulo's current code is the latter — pure overrides. Grego's is the former + overrides. This is more than artifact-swap.

---

## D. Things missing from the plan

### D1. PR 1's UX impact is undocumented and breaks an e2e test

The plan says of `exportEncrypted`'s signature change (line 103):
> "Migration: ProfileServiceClient signature changes (`password` becomes required). Find callers; update each. Currently exposed via popup export-encrypted-key flow."

The actual caller at `popup/pages/settings/security/export/key.vue:55-59`:
```ts
watch(() => selectedKey.value, async () => {
  if (selectedKey.value === "public") {
    try {
      publicKey.value = await managers.profile.exportEncrypted(appStore.profile.id)
    } catch (error) {}
  }
})
```

There is no password input on this code path. The page has a password input for the *private* key (`handleUnlock` at line 63-74) which calls `exportPlain`. But the encrypted-key variant is exposed via `selectedKey === "public"` and renders directly with no unlock step.

Then at `e2e/import-paths.test.ts:382-415`:
```ts
// Unlike the plain-key flow, the encrypted variant doesn't need the
// agree-continue + unlock-password steps — the blob is already
// password-protected, so the page renders the SecretRevealCard
// directly via the `selectedKey === 'public'` watcher (key.vue:55-59
// kicks off `exportEncrypted` async; the SecretRevealCard mounts as
// soon as `publicKey.value` populates).
```

**The e2e test explicitly relies on the no-prompt UX**, which PR 1 will break.

PR 1 needs a UI plan that probably looks like: "the encrypted variant becomes a two-step like the private variant — agree-continue + password unlock." The crypto-level invariant (encrypted blob locked with the same passhash) makes this redundant from a defense-in-depth perspective (the blob is useless without the password); but the audit's **Crit #5 / A2** in the README does call it out, so the user wants it.

**Alternative the plan should consider:** instead of changing `exportEncrypted`'s signature, gate it behind `await this.requireUnlocked()` which the in-memory passhash check would satisfy. The user is already proving they have a session (they're logged in). This preserves the no-prompt UX while closing the hole. Whether that's enough for the threat model the audit raised is a design call — but the plan should pick a position.

### D2. Missing tests

- **PR 2 (race fix):** plan calls for a unit test mocking "state-flip-during-microtask between loop exit and postMessage." Good in concept — but the plan doesn't account for `connectedPort.postMessage` itself being able to throw synchronously vs the port being reused after disconnect+reconnect. Two test cases: (a) `disconnect()` after `connectedPort` capture but before `postMessage` (port should throw, caller sees `RpcDisconnectedError`); (b) `disconnect+connect` between capture and `postMessage` (the captured port reference is stale; what does Chrome do?). Both should reject with `RpcDisconnectedError`.
- **PR 4 (CSP stub):** plan calls for "no `'unsafe-eval'` CSP violation lands in Chrome console." That's a *negative* assertion — hard to write as a test. The mitigation should be: register a CSP-violation listener at popup init, fail the test if any violation lands. There's also `chrome.devtools.network.onRequestFinished` + `getResponseHeaders` introspection; the cleanest path is probably an existing puppeteer test that fails the page errors check (`pageErrors[]` is already collected — see `tests/e2e/import-paths.test.ts:428` `expect(ctx.pageErrors).toEqual([])`). Filter for "EvalError" or "Refused to evaluate" patterns.
- **PR 8b (stub-account):** plan asserts (line 437) "mock the real account's signing function and assert it was NOT called during sim." Good. But the real-account stub-bypass test should also assert that the resulting `TxSimulationResult.privateExecutionResult` contains a *valid* offchain CallAuthorizationRequest (i.e., the stub's `is_valid` always-true pass-through actually allows discovery). Without that, the test passes vacuously when the stub is broken.
- **PR 11 (multi-tab + cold-SW e2e):** plan says these are "documents the gap before Phase 2 fixes it." OK, but there's value in **also** writing one *passing* e2e: open 2 dApp tabs, both call `aztec_simulateTx` (read-only, public-static), assert both return successfully. Read-only sims do not need the prove queue and shouldn't deadlock on the global `ReadWriteGuard` if implemented correctly today. If they DO deadlock, that's a Phase 2 bug. Either way — informative.

### D3. Capability progressive wildcard — confirmed deferred is correct

The README's Phase 3 list includes "A11 (capability manifests + wildcard matching)". The plan defers it as out-of-scope ("Nulo's typed capability + scope-with-wildcards is a DIFFERENT paradigm from Grego's method-keyed authorization, more design work needed"). This is correct: Nulo already has its own scope-wildcard system (53 tests in `wallet-bridge/src/scope-enforcement.test.ts`), and Grego's progressive-wildcard pattern is a *method:contract:function* progression while Nulo's is *capability-with-scope-pattern*. Cross-paradigm work, not in P1+P3 scope. **Plan's deferral is the right call.**

### D4. README's Phase 1 + Phase 3 cross-check

Phase 1 (per README:553-559):
- Crit #5 — covered by F1 ✓
- Crit #6 — covered by F2 ✓
- Crit #4 — covered by F3 ✓
- Aztec #7 — covered by F6 ✓
- A6 — covered by F5 ✓
- A9 — covered by F4 ✓
- A10 — covered by F4 ✓

Phase 3 (per README:572-580):
- A1 — covered by A8b ✓
- A2 — covered by A8c ✓
- A3 — covered by A9 ✓
- A11 — deferred (correct, see D3) ✓
- A12 — covered by A10 ✓
- Multi-tab/cold-SW e2e — covered by A11 ✓

**Plan covers every item the README's Phase 1 + Phase 3 lists.** No items dropped.

### D5. Bonus item the plan should consider: Grego A14 + A15

README's "Patterns to adopt" lists:
- **A14. Schema-key enumeration NOT Proxy spread** (line 426) — "Spreading a Proxy into a plain object loses the `get` trap."
- **A15. `authorization.getPending` one-shot read at mount, NOT broadcast-replay** (line 429).

Neither is in the plan. A14 is a code-review pass on `wallet-bridge/src/dispatcher.ts`, near zero cost. A15 is more work. Worth at least a one-line audit pass before P1 ships.

---

## E. Risks the plan does not name

### E1. `nodePolyfills` `process: true` will collide with `define`

`vite.config.ts:252-256`:
```ts
define: {
  ...
  "process.browser": true,
  "process.env": JSON.stringify({
    LOG_LEVEL: "verbose",
    BB_WASM_PATH: "/assets/barretenberg.wasm.gz",
  }),
},
```

Plan PR 4 adds:
```ts
nodePolyfills({
  include: ["buffer", "net", "path", "process", "stream", "tty", "vm", "util"],
  globals: { Buffer: true, process: true },
}),
```

`define` rewrites the literal source token `process.browser` → `true` at parse time. But:
- `process.env.SOMETHING_NOT_LISTED_IN_DEFINE` (e.g., `process.env.NODE_ENV` if any code reads it) is rewritten as `(JSON.stringify({LOG_LEVEL:"verbose",BB_WASM_PATH:"..."})).SOMETHING_NOT_LISTED_IN_DEFINE` → `undefined`.
- `globalThis.process.env.NODE_ENV` is not rewritten by `define` (it doesn't match the literal `process.env` pattern). It falls through to the runtime polyfill, which gives a different shape.
- `process["env"]` (bracket notation) similarly escapes `define`.

After PR 4, the runtime polyfill provides a `process` global with `process.env = {}` (empty by default). Source code reading `process.env.NODE_ENV` via `define` gets `undefined`; via the polyfill gets `undefined`. So *for this specific case* the answer is the same.

But the polyfill also sets `process.browser = true` (or `false` depending on the polyfill default). If something reads `globalThis.process.browser` (instead of the literal `process.browser`), it gets the polyfill's value. The `define` value at literal `process.browser` is `true`. Mismatched-shape land.

**Recommendation:** verify by `bun run build` then `grep -r "process\." dist/ | head` and check for any non-literal access patterns. If clean, ship. If dirty, choose one source of truth (drop the `define` entries OR drop the polyfill `globals.process`) and document.

### E2. function-bind alias regex coverage

Plan uses `/^function-bind$/` and `/^function-bind\/implementation$/`. Strict anchors. **No false positives** against `function-bind-other-thing`. But:
- Does the package have other entry points beyond `index.js` and `implementation.js`? I checked the 1.1.2 tarball: `package/.eslintrc package/test/.eslintrc package/.nycrc package/LICENSE package/implementation.js package/index.js package/test/index.js package/package.json package/CHANGELOG.md package/README.md`. Only two real entry points (index.js + implementation.js). The two regex aliases cover both.
- The tarball confirms `function-bind@1.1.2` is the version Nulo's `bun.lockb` references. Good.

### E3. `executeNoFromSendTx` rewrite — caller dependencies

Plan PR 8b proposes to rewrite `executeNoFromSendTx`. Callers of the *result* shape: `executeAztecSendTx:1621` invokes it and returns its `SendReturn<InteractionWaitOptions>` directly. The shape is `{ txHash, ...offchainOutput, [receipt?] }`. PR 8b doesn't change this shape — **safe.** But the discovery-result shape (a `TxSimulationResult` ephemerally read for offchain effects) is internal to `executeNoFromSendTx` and not observed by callers. Also safe.

The risk surface is the **gas-estimation policy difference** between current `gasPadding: 1` and what `forEstimation: true` produces. Plan PR 9 explicitly notes this is "fee logic is sensitive to gas under-estimation." If PR 8b lands without PR 9, the existing `gasPadding: 1` continues to apply. If PR 9 lands later, it changes the estimation policy on the same path — and could regress the multiplier behavior at `feeMultiplier`.

**Worth mapping the gas-multiplier surface explicitly before PR 9 touches it:** check `finalizeGasLimits` (line 1799) call-sites to see what the `gasPadding: 1` value means in this code. The plan asserts `gasPadding: 1` is "different mechanism" than `feeMultiplier` — but doesn't say which produces a higher gas estimate, or how the two compose.

### E4. PR 5's JSON fallback risk surface is wider than acknowledged

Plan says (line 280): "Can mask issues if the fallback catches things that should be debug-noticeable. Add Sentry-equivalent logging on the fallback hit." Good, but the *behavioral* risk is that the fallback succeeds on a payload that `JSON.parse` decodes into a *structurally different* shape than the original class instance. E.g., `Fr.toString()` produces a hex string; `Fr.fromString()` reverses it. But many Aztec class methods (`AztecAddress.equals(other)`, `Buffer.byteLength`) require the recipient to call class methods, not just read properties. **The recipient must reconstitute the type from the JSON, not just deserialize.**

Grego's pattern handles this by typing `resultIsJson: true` and the client transparently `JSON.parse`s. But the *next* step — wrapping plain-object hex strings back into `Fr`/`AztecAddress` — requires a per-method revival map. Grego has `reviveChainInfo` and Zod arg parsers (README:285). **Nulo has none of this** (per README:285: "Implicit via `jsonSanitize` utility; no explicit revival helpers"). Plan PR 5's "client transparently `JSON.parse`s before `entry.resolve(result)`" produces a plain object, not a class instance.

This means PR 5's fallback path *cannot* be transparent for Aztec class results — the dApp expects `Fr`/`AztecAddress` instances, gets plain objects, calls `.equals()` / `.toString()`, and crashes. **PR 5 needs a "revive" hook keyed by method name.** Not in scope of the current PR sketch.

**Recommendation:** scope PR 5 to *non-Aztec* result types (errors, opaque strings). Aztec class results are out of scope until a per-method revival map lands. That dramatically reduces PR 5's value but also its risk.

### E5. Firefox manifest permissions for `chrome.windows.create`

Plan PR 7 calls `chrome.windows.create({state: "minimized"})` for the Firefox fallback. Firefox's `chrome.windows` API does NOT require an explicit `windows` permission, **but** the existing Firefox manifest (`manifest.firefox.config.ts:18`) already strips `"background"` from the permissions list. There's no test that the resulting manifest is loadable in Firefox. PR 7 should add `web-ext lint` (or equivalent) to the build pipeline.

### E6. Heartbeat conflict with offscreen-side ping

Plan PR 7 doesn't mention it, but Nulo already has its own offscreen-keep-alive pattern via `OFFSCREEN_PING`/`OFFSCREEN_PONG` (`offscreen.ts:2-3`). The Firefox path needs to verify the existing health-check + ghost-recovery code doesn't gate the Firefox path on `chrome.runtime.getContexts()` (Firefox's contextTypes may not include `OFFSCREEN_DOCUMENT`). Plan acknowledges this in the "Considerations" section but doesn't flag the existing usage — `ensureOffscreenRunning:108-112` blindly calls `chrome.runtime.getContexts({contextTypes: ["OFFSCREEN_DOCUMENT"], ...})`, which on Firefox would either throw or return undefined.

---

## F. Things I would do differently

### F1. Bundle PR 1 + PR 2 + PR 3 — they are functionally one security PR

Three trivial security/correctness fixes. Plan suggests "PR sizing — small per-item, or bundle related fixes? (PR 1 + PR 2 are trivial — bundle them?)" The answer is: bundle them. One PR titled "fix(audit): close A2/A5 + verify A1 strict-mode default" with three commits. Reviewable in ~30 minutes. Less PR overhead than three separate.

### F2. Skip PR 8a (deleted), reorder Phase 3 to start with PR 9

With no version bump needed, Phase 3 reorders:
1. **PR 9** (`forEstimation: true`) — smallest Aztec change. Touches one method. Establishes the gas-estimation policy boundary so PR 8b can land cleanly.
2. **PR 8b-ii** (add stubAccountAddresses to executeAztecSimulateTx + executeAztecProfileTx) — pure addition, low risk.
3. **PR 8b-i** (swap upstream artifact, optional) — only if a behavioral diff is identified.
4. **PR 8c** (public-static fast path) — depends on PR 5 (jsonStringify fallback) since simulateViaNode returns class arrays.

### F3. Deepen PR 6 — chips visibility coverage

Plan PR 6 adds chips for "Kernelless" and "Paymaster" but the Operation kind humanization (`humanizeOperationKind`) has the pre-existing first-underscore-only bug pinned in tests (CLAUDE.md hard rule #8 referenced this). The user-facing string for `aztec_get_chain_info` reads "aztec get_chain_info" instead of "aztec get chain info". Worth fixing **as part of PR 6** since the chips will be co-rendered next to the humanized kind label. Plan defers this — but it's a 2-line fix.

### F4. Better than Grego's `function-bind-stub.cjs`: install patch

Grego's CJS stub is functionally correct but introduces a long-lived custom shim that the team owns. An alternative: `bun patch function-bind` (or `npm patch-package`) that ships an actual patch to the upstream package. Same outcome at runtime, but the "I own a shim" cost is replaced with a single patch file that auto-applies and surfaces in `git diff` clearly. **Plan should consider patch-package as a sibling option.**

### F5. PR 7 should ship behind a feature flag

Plan acknowledges Firefox e2e infra is unknown ("Open question: does the team have Firefox e2e infrastructure today?"). Until that's answered, the Firefox path should be conditionally compiled (e.g., `if (import.meta.env.MODE === "firefox")` ) so Chrome production isn't carrying dead code. Verify with `bun run build:firefox`.

### F6. The "synchronous popup→SW RPC + 60s timeout" is the real problem

The plan correctly defers the durable-jobs work to Phase 2. But every PR in this plan still runs over the broken `60s ServiceClient timeout` baseline. The PR 11 e2e tests will document the failures — but they won't fix them. **Worth carving out a Phase 1.5 follow-up issue: "design durable jobs"** — open the Linear ticket now so the work is on the books. The plan does not currently mention this as a tracking artifact.

---

## Explicit questions for the user that aren't in the plan's "Open decisions" list

1. **PR 1's UX impact** — what is the desired flow for the encrypted-key variant after the password gate? Three options: (a) full unlock card mirroring the private-key flow; (b) auth-via-existing-session (no prompt if currently unlocked); (c) leave the variant unprotected and document the threat model is "local attack on unlocked session." The plan doesn't pick. The current code is option (c).
2. **`SimulatedSchnorrAccountContractArtifact` vs `StubSchnorrAccountContractArtifact`** — does the team have a position on which upstream artifact is canonical? They're shipped by different upstream packages (`@aztec/noir-contracts.js` vs `@aztec/accounts/stub`). Are they functionally equivalent? Anyone in the team know whether one is deprecated or preferred?
3. **PR 5 scope**: should the JSON fallback be Aztec-class-aware (with revival hooks) or scoped to non-Aztec types (error strings, opaque blobs)? The full Grego pattern requires per-method revivers — not in PR 5's current sketch.
4. **PR 7 testing infra**: does the team have a Firefox CI runner? If not, when is "Firefox parity" a real product requirement? Is it acceptable to ship behind a flag with manual verification?
5. **Capability progressive wildcard (Aztec #11)** — confirmed deferred. But: does Nulo's existing scope-with-wildcards system already cover the use case Grego solves with `simulateTx:0x123:swap → :*:swap → :*`? If yes, A11 is permanently out of scope, not just "not now." The plan suggests "needs design pass" which implies "later." Can the team commit to one or the other?
6. **Phase 2 tracking ticket** — should the durable-jobs design open as a Linear ticket *before* or *after* P1+P3 ships? If after, PR 11's documenting tests have nowhere to link to.

---

## Specific PR sequencing changes I'd make

**Original sequence (from plan):**
1. PR 3 (strict-mode test)
2. PR 1 + PR 2 (auth + race)
3. PR 4 (CSP + nodePolyfills)
4. PR 5 (JSON fallback)
5. PR 6 (UX chips)
6. PR 7 (Firefox)
7. PR 8a (Aztec version bump) ← removed
8. PR 8b (stub-account sim)
9. PR 8c (public-static fast path)
10. PR 9 (forEstimation)
11. PR 10 (chainId on dapp sessions)
12. PR 11 (e2e gap tests)

**My proposed re-sequence:**

Phase 1 (parallel, same week):
1. **PR A = PR 1 + PR 2 + PR 3 bundled** as one "fix(audit): close A1/A2/A5" PR — three commits.
2. **PR 4** (CSP + polyfill) — independent, but verify E1 (process collision) before merging.
3. **PR 6** (UX chips, *plus humanize bug fix*) — independent.
4. **PR 10** (chainId on dapp sessions) — independent. Use `KEY_PREFIXES_TO_WIPE_LOCAL`, not `KEYS_TO_WIPE`.

Phase 1 (after the parallel batch lands):
5. **PR 5 (scoped to non-Aztec types only)** — JSON fallback for error/string payloads. Defer Aztec-class-aware revival to a separate later PR.
6. **PR 7** (Firefox fallback, behind feature flag).

Phase 3 (sequential):
7. **PR 9** — `forEstimation: true` adoption. Smallest Aztec change. Establishes gas-policy boundary.
8. **PR 8b-ii** — add `stubAccountAddresses` to `executeAztecSimulateTx` + `executeAztecProfileTx`. Pure addition.
9. **PR 8b-iii** — verify `skipKernels: true` requirement (test) and add it if needed.
10. **PR 8b-i** (optional) — swap to `StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/schnorr` ONLY if a behavioral test diff is documented. Otherwise leave existing artifact.
11. **PR 8c** — public-static fast path. Depends on PR 5 (revival map) for class returns.
12. **PR 11** — multi-tab + cold-SW e2e. Includes one *passing* concurrent-read test alongside the failing tests, per D2.

**Phase 1.5 (carved out as parallel tracking, no code yet):**
13. Open Linear ticket: "Design durable job submission for prove flows + AbortController plumbing + per-(profileId, chainId) PXE concurrency." This blocks nothing in P1+P3 but should be visible.

**Effort estimate (revised):** with PR 8a deleted and PR 8b reduced from "rewrite" to "extend two methods + optional artifact swap," total effort drops from "3–5 weeks" to **2–3 weeks** of focused work. The single highest-risk PR in the plan (PR 8a) and the second-highest (PR 8b's "rewrite") both shrink.

---

## Closing note

The plan's structure is sound. The author is honest about uncertainty (the "blocking question" frame on the Aztec version bump is exactly the right way to flag a load-bearing assumption you couldn't verify). The citations are reliable within ±5 lines. The deferral of Phase 2 work is correct and the README cross-check shows no dropped items. The biggest weaknesses are **(a)** treating the existing Nulo stub-override implementation as absent (Section C1) and **(b)** not catching that 4.2.0 ships everything the plan needs (Section B). Both are diligence misses, not design errors. With the deltas in Section C/D/F applied, this is a 2–3 week deliverable — half the original estimate, and the path stays tight.
