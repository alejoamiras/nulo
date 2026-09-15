# Codex audit — harden-b1-mechanical

## Round 1 (2026-09-14, GPT-6 Astra `high`, fresh session)

**Packet sent:** seed.md, plan.md (draft), recon.md, the finding sections; adversarial + assumption-attack + implementation-critique asks; open asks A (local l1ChainId), B (data-URI icon), C (inline vs primitive for F-13).

**Response (verbatim):**

reject (with blocking findings: F-01 still accepts rollup-version aliases)

Paths below are relative to `apps/extension/src` unless prefixed `packages/`. Confidence is **high** except where stated.

- **Facts — High, F-01:** `packages/aztec-runtime/src/utils/chain-identity.ts:55`: exact L1 equality does **not** make XOR pin the rollup version exactly. I reproduced identical composites for versions `4248422647` and `8543389943`, both with L1 `1`. Installed `NodeInfoSchema` permits both. Add an unsigned-32-bit rollup-version guard or compare directly with `((network.chainId ^ network.l1ChainId) >>> 0)`. Test this alias alongside the existing two-coordinate collision. The verified finding explicitly requires this.

- **Facts — Medium, F-03:** `wallet/services/fpc/service.ts:431`: `protocolAddresses.get()` can return undefined after worker restart, making a genuine PrivateFPC appear non-protocol. Use `await getOrComputeProtocolAddresses()` before enforcing eligibility. Reject **only** `PrivateFpc && !isProtocol`; preserve custom sponsored FPCs. Test a cold cache and custom sponsorship. Assumption 7 overclaims: `addFpc` accepts PrivateFpc at arbitrary registered addresses (`:276`, `:315`), despite address edits being prohibited.

- **Inferences — Medium, F-08:** `wallet/services/execution/fast-path.ts:188`: binding inside the infrastructure `try` would swallow rejection into fallback. Bind before it. Rebuilding ABI flags also requires rechecking fast-path eligibility: upstream `simulateViaNode` trusts `call.isStatic` and does not reclassify calls. A spoofed static flag could otherwise become a non-static call executed separately from its dependent remainder. Test mismatch propagation, forged flags, and mixed-call ordering. Missing artifacts now fail where simulation previously worked; exercise a real registered-contract flow.

- **Facts — Low, F-12:** `wallet/services/token-balance/reconcile-pairs.ts:143` requires **both** `updatedAt === 0` and absent `syncFailure`. Restore preserves attacker-supplied `syncFailure` (`wallet/services/token-balance/service.ts:710`). Clear that field too; test that activation actually schedules projection. Contact sanitization is appropriate, but confusable letters and fabricated balances remain untrusted presentation until refreshed.

- **Inferences — Low, F-15:** `wallet/services/profile/service.ts:856`: clear both maps under the facade lock **before** awaiting session closure/read-back, so lock failures cannot retain restore authority. At `:2652`, consume/delete the pending entry and place TTL rejection inside guaranteed cleanup for both buffers. The sweep throws no error; reuse the missing-pending-secret error. Test TTL equality, lock failure, and fresh successful restore.

- **Facts — Low, address-preview hygiene:** `components/AddressDisplay.vue:70` automatically substitutes contact/account names; `full` only changes the alternate address text (`:81`). This does not guarantee a visible address. At `popup/pages/settings/accounts/import.vue:227`, render reactive `previewAddress` directly with wrapping. Test an existing contact and narrow popup width.

- **Facts — Low, ordering hygiene:** `packages/aztec-runtime/src/pxe/service.ts:449` calls a **writing** `registerContract` before checking its returned address. Merely moving the class write still leaves an instance mutation on rejection. Compute the address using upstream `computeContractAddressFromInstance`, compare first, then perform both registrations. Assert neither write occurs on mismatch. Likewise hoist the `buildNoFrom` check before `account.ensureRegistered` (`wallet/services/execution/tx-request-builder.ts:381`), not merely before resolver calls.

- **Facts — Low, zeroization hygiene:** `packages/wallet-crypto/src/session-secret-box.ts:93` and `:120` retain independent token buffers; adding `getHashHex` cleanup does not cover them. Include these seed-cited copies, explicitly account for the export plaintext buffers at `packages/aztec-runtime/src/account/account-export.ts:148` and `:156`, and await crypto completion before wiping. Unchanged vectors prove output compatibility, not cleanup on rejection.

- **Inferences — Low, F-10:** `wallet/logger/utils.ts:263`: the string backstop is useful, but “the other sites carry no URL” is unverified. URL scrubbing cannot redact arbitrary flattened secrets. Convert flagged logging calls and avoid whole-file exemptions: `utils/log-payload-ban.test.ts:421` skips every check in allowlisted files.

- **Inferences — Low, remaining hygiene:** `components/composite/import/ImportSecretForm.vue:41` is a recovery phrase, so use `autocomplete="off"` there; reserve current/new-password for actual passwords. CSV neutralization at `components/JsonViewer/logs-csv.ts:24` belongs after splitting, on every final cell, before quoting. Test all listed prefixes, quotes, and line breaks.

- **Asks — A:** Compare canonical live L1 against the **stored row**, including local rows; skip only the composite. `wallet/services/network/service.ts:999` already preserves probed local L1. Seeded local remains 31337; a custom row legitimately carrying another ID must match that ID. Test both. This follows the verified refinement; record the distinction from the seed’s constant wording.

- **Asks — B:** Prefer inline PNG. Installed SDK forwarding accepts the string, but dApp `img-src`/`default-src` can block `data:`; SDK acceptance does not guarantee display. [CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src). Narrowing matches also breaks icons on unlisted dApps. Verify the built discovery response and manifest, plus icon rendering under permissive and restrictive CSP.

- **Asks — C / what looks fine:** Inline address checks fit `wallet/services/account/service.ts:337`; preserve `getAccount`’s undefined-on-mismatch contract and pass the requested address into the imported loader. No shared-storage redesign is needed. Facts 2–6 otherwise match source; Fact 1 needs the acknowledged fast-path type widening and test-fixture updates. The phased structure and existing-helper reuse are sound. Verification here was source inspection plus the arithmetic probe, not browser/E2E execution.

## Round 2 (resumed session, revised plan)

**Response (verbatim):**

approve

- **F-01 — high confidence:** The revised design pins both values exactly for non-local rows. Within u32, XOR with a fixed L1 value is bijective, so matching the composite uniquely determines `rollupVersion`. Local behavior is correct: validate both ranges, compare L1 against the stored row, skip the composite. Local rollup-version drift remains intentionally unpinned; custom devnets need no hardcoded 31337.

- **F-08 — high confidence:** Returning `null` is safe **before either simulation starts**, with the original operation preserved. `view-executor.ts:291` sends the whole operation through the standard path; `operation-planner.ts:206` preserves each call’s name and selector; `tx-request-builder.ts:190,569` resolves the ABI, checks name↔selector, and rebuilds execution metadata. Authorization information is retained. Avoid mutating original call names during fast-path binding, which would erase the evidence needed for revalidation.

- **Validation gaps — low severity:** The revised phase lists still omit the cold-cache genuine-PrivateFPC and custom-sponsored success cases. Phase 1’s ordering test should assert rejection before `account.ensureRegistered`, matching the revised implementation. Exercise fallback through **ViewExecutor**, since `runFastPath` itself merely returns `null`; include a later mismatched call to prove standard-path rejection after fallback.

- **Hygiene — high confidence:** The changes remain appropriately small. Direct address rendering, precomputing the contract address, and local `try/finally` cleanup are justified. Public salts do not need additional secret-cleanup machinery. For token decoding, retain and wipe the decoded Buffer directly where types permit, avoiding another copy. Keep wiping scoped to owned buffers after awaited operations finish.

- **Plan consistency:** Phase 5’s file inventory still omits `session-secret-box.ts` and `packages/aztec-runtime/src/account/account-export.ts`, despite their inclusion in the architecture and ledger. Add them and meaningful rejection-path cleanup coverage. Corrected Fact 7, Inference d, F-12/F-15 cleanup, and the accepted icon-CSP limitation address the earlier concerns. No remaining design blocker found.
